var Household = (() => {
  let busy=false;
  let execute;
  let currentJob;
  let socket, socketBase, heartbeat, reconnectTimer;
  let pendingWake=false;
  let nextCartRead=0;
  let waitingForWindow=false;
  function liveConnection(base){
    if(socketBase===base&&socket&&[WebSocket.OPEN,WebSocket.CONNECTING].includes(socket.readyState))return;
    clearInterval(heartbeat);clearTimeout(reconnectTimer);
    const old=socket;socket=null;if(old)old.close();
    socketBase=base;
    const current=new WebSocket(base.replace(/^http:/,'ws:')+'/api/bridge/events');socket=current;
    current.onopen=()=>{
      if(socket!==current)return;
      chrome.storage.local.set({householdLive:true});
      heartbeat=setInterval(()=>{if(current.readyState===WebSocket.OPEN){current.send('ping');if(!busy)tick();}},8000);
    };
    current.onmessage=event=>{
      if(socket!==current||!['ready','jobs-available'].includes(event.data))return;
      if(busy)pendingWake=true;else tick();
    };
    current.onerror=()=>{};
    current.onclose=()=>{
      if(socket!==current)return;
      clearInterval(heartbeat);socket=null;
      chrome.storage.local.set({householdLive:false});
      reconnectTimer=setTimeout(()=>liveConnection(base),3000);
    };
  }
  const valid = address => {
    const url=new URL(address);
    const allowed = (url.port==='4317'&&['localhost','127.0.0.1','192.168.1.250','groceries.local'].includes(url.hostname)) || (url.hostname==='groceries.local'&&!url.port);
    if(url.protocol!=='http:'||!allowed||url.username||url.password||url.search||url.hash)throw Error('Use http://groceries.local or http://127.0.0.1:4317');
    return url.origin;
  };
  async function request(base,route,data){const response=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Grocery-Bridge':'1'},body:JSON.stringify(data),signal:AbortSignal.timeout(10000)});const result=await response.json();if(!response.ok)throw Error(result.error||'Household server error');return result;}
  async function announce(store,message,attention=false){await chrome.storage.local.set({syncNotice:{id:crypto.randomUUID(),store,message,attention,at:Date.now()}});}
  async function tick(){
    if(busy)return;busy=true;let syncingJob=false;
    try{
      const {householdUrl,householdClientId,householdAccountName,savedProducts=[],shoppingHistory=[],householdPendingResult}=await chrome.storage.local.get(['householdUrl','householdClientId','householdAccountName','savedProducts','shoppingHistory','householdPendingResult']);
      if(!householdUrl)return;
      const base=valid(householdUrl);
      liveConnection(base);
      if(householdPendingResult){await request(base,'/api/bridge/result',householdPendingResult);await chrome.storage.local.remove('householdPendingResult');}
      await request(base,'/api/bridge/sync',{clientId:householdClientId,accountName:householdAccountName,products:savedProducts,history:shoppingHistory,syncVersion:3,ready:CartRequests.ready()});
      await chrome.storage.local.set({householdStatus:'Connected · synced '+new Date().toLocaleTimeString()});
      if(!execute)return;
      const {run}=await chrome.storage.local.get('run');if(run?.running)return;
      const {job}=await request(base,'/api/bridge/claim',{clientId:householdClientId});if(!job){if(Date.now()<nextCartRead)return;nextCartRead=Date.now()+8000;const result=await execute({action:'snapshot',items:[]});waitingForWindow=!!result.error?.startsWith('Chrome is closed.');if(result.error)nextCartRead=Date.now()+60000;await request(base,'/api/bridge/cart',{clientId:householdClientId,cart:result.cart,error:result.error});return;}
      syncingJob=true;currentJob={id:job.id,clientId:householdClientId,base};
      await chrome.storage.local.set({syncProgress:{store:'Walmart',running:true,at:Date.now(),processed:0,total:job.items?.length||0}});
      let result;
      try{result=await execute(job);}catch{result={error:'Cart job was interrupted. Check Walmart before retrying.',report:[]};}
      currentJob=null;
      const payload={id:job.id,clientId:householdClientId,...result};
      await chrome.storage.local.set({householdPendingResult:payload});
      await request(base,'/api/bridge/result',payload);await chrome.storage.local.remove('householdPendingResult');
      const attention=!!result.error||(result.report||[]).some(item=>!['added','already-present','updated','removed'].includes(item.status))||(result.report||[]).length!==(job.items||[]).length;
      await announce('Walmart',attention?'Cart sync needs attention. Check Home Grocery for details.':'Walmart cart sync complete.',attention);
      const latest=await chrome.storage.local.get(['savedProducts','shoppingHistory']);
      await request(base,'/api/bridge/sync',{clientId:householdClientId,accountName:householdAccountName,products:latest.savedProducts||[],history:latest.shoppingHistory||[],syncVersion:3,ready:CartRequests.ready()});
    }catch(error){await chrome.storage.local.set({householdStatus:error.message});}
    finally{if(syncingJob)await chrome.storage.local.set({syncProgress:{store:'Walmart',running:false,at:Date.now()}}).catch(()=>{});currentJob=null;busy=false;if(pendingWake){pendingWake=false;setTimeout(tick,0);}}
  }
  async function connect(address,accountName){const url=valid(address);const {householdClientId}=await chrome.storage.local.get('householdClientId');await chrome.storage.local.set({householdUrl:url,householdAccountName:String(accountName||'My Walmart').trim().slice(0,60)||'My Walmart',householdClientId:householdClientId||crypto.randomUUID()});await chrome.alarms.create('household-sync',{periodInMinutes:.5});await tick();const {householdStatus}=await chrome.storage.local.get('householdStatus');return householdStatus;}
  let publishChain=Promise.resolve();
  function publishCart(){
    const cart=CartRequests.snapshot();if(!cart)return Promise.resolve();
    publishChain=publishChain.catch(()=>{}).then(async()=>{
      const {householdUrl,householdClientId}=await chrome.storage.local.get(['householdUrl','householdClientId']);
      if(householdUrl&&householdClientId){await request(valid(householdUrl),'/api/bridge/cart',{clientId:householdClientId,cart});const signature=JSON.stringify((cart.lines||[]).map(item=>({id:item.id,quantity:item.quantity})).sort((a,b)=>String(a.id).localeCompare(String(b.id))));const {lastAnnouncedCart}=await chrome.storage.local.get('lastAnnouncedCart');await chrome.storage.local.set({lastAnnouncedCart:signature});if(lastAnnouncedCart&&lastAnnouncedCart!==signature&&!currentJob)await announce('Walmart','Cart changes synced to Home Grocery.');}
    });
    return publishChain;
  }
  function resumeChecks(){nextCartRead=0;waitingForWindow=false;if(busy)pendingWake=true;else tick();}
  function start(callback){execute=callback;
    chrome.windows.onCreated.addListener(window=>{if(window.type==='normal')resumeChecks();});
    chrome.windows.onFocusChanged.addListener(windowId=>{if(waitingForWindow&&windowId!==chrome.windows.WINDOW_ID_NONE)resumeChecks();});
    chrome.tabs.onUpdated.addListener((tabId,change,tab)=>{if(waitingForWindow&&change.status==='complete'&&tab.url?.startsWith('https://www.walmart.com/'))resumeChecks();});chrome.runtime.onStartup.addListener(()=>tick());chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='household-sync')tick();});
    chrome.storage.onChanged.addListener(changes=>{if(currentJob&&changes.run?.newValue?.running){const job=currentJob;const run=changes.run.newValue;chrome.storage.local.set({syncProgress:{store:'Walmart',running:true,at:Date.now(),processed:(run.report||[]).filter(i=>i.id).length,total:run.total||0}}).catch(()=>{});request(job.base,'/api/bridge/progress',{id:job.id,clientId:job.clientId,report:changes.run.newValue.report}).catch(()=>{});}});
    chrome.storage.local.get('householdUrl').then(({householdUrl})=>{if(householdUrl){chrome.alarms.create('household-sync',{periodInMinutes:.5});liveConnection(valid(householdUrl));tick();}});}
  async function previewHistory(store,orders,warnings,incomplete){const {householdUrl,householdClientId}=await chrome.storage.local.get(['householdUrl','householdClientId']);if(!householdUrl||!householdClientId)throw Error('Connect the household website first.');return request(valid(householdUrl),'/api/history-import/preview',{client:householdClientId,store,format:'json',text:JSON.stringify({orders}),collectionWarnings:warnings,incomplete});}
  async function repairPrices(store,order){const {householdUrl,householdClientId}=await chrome.storage.local.get(['householdUrl','householdClientId']);if(!householdUrl||!householdClientId)throw Error('Connect household first');return request(valid(householdUrl),'/api/bridge/history-prices',{client:householdClientId,store,order});}
  async function auditedOrders(store){const {householdUrl,householdClientId}=await chrome.storage.local.get(['householdUrl','householdClientId']);const response=await fetch(valid(householdUrl)+'/api/state',{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('Could not read receipt audit coverage');const state=await response.json();const verified=state.purchases.filter(p=>p.client===householdClientId&&p.store===store&&p.receipt?.state==='verified'&&Number.isFinite(p.receipt.total)&&p.receipt.source_url).map(p=>new URL(p.receipt.source_url).pathname.split('/').filter(Boolean).at(-1));verified.hasIncomplete=state.purchases.some(p=>p.client===householdClientId&&p.store===store&&!(p.receipt?.state==='verified'&&Number.isFinite(p.receipt.total)));return verified;}

  async function taskRequest(route,data={}){const {householdUrl,householdClientId}=await chrome.storage.local.get(['householdUrl','householdClientId']);if(!householdUrl||!householdClientId)return {};return request(valid(householdUrl),route,{clientId:householdClientId,...data});}
  return {start,connect,tick,publishCart,previewHistory,repairPrices,announce,auditedOrders,taskRequest};
})();
