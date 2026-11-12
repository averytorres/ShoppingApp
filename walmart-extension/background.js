importScripts('request-engine.js');
importScripts('history.js');
importScripts('household.js');
importScripts('history-runner.js');
let running = false;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function initializeSession(tabId) {
  if (running) return { ready: CartRequests.ready(), detail: 'A cart run is active.' };
  try { await chrome.tabs.sendMessage(tabId, { type: 'initializeSession' }); } catch {}
  CartRequests.invalidate();
  // Only open Walmart's normal cart page. Never issue an initialization mutation.
  const before = await chrome.tabs.get(tabId);
  if (before.url === 'https://www.walmart.com/cart') await chrome.tabs.reload(tabId);
  else await chrome.tabs.update(tabId, { url: 'https://www.walmart.com/cart' });
  for (let n = 0; n < 20; n++) {
    await pause(500);
    if (CartRequests.ready()) return { ready: true };
    try { await chrome.tabs.sendMessage(tabId, { type: 'initializeSession' }); } catch {}
  }
  const { cartProtocol } = await chrome.storage.local.get('cartProtocol');
  const diagnostic = { at: new Date().toISOString(), version: chrome.runtime.getManifest().version,
    protocolSaved: !!cartProtocol, ready: CartRequests.ready(), reason: cartProtocol ? 'fresh-cart-response-not-observed' : 'add-protocol-not-learned' };
  await chrome.storage.local.set({ connectionDiagnostic: diagnostic });
  try { await chrome.downloads.download({ filename: `Home Grocery Helper/logs/session-${Date.now()}.json`, saveAs: false,
    url: `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(diagnostic,null,2))}` }); } catch {}
  return { ready: false, detail: cartProtocol ? 'Add format is saved, but no fresh cart response was captured. A session diagnostic was saved automatically.' :
    'The Add request format has not been learned yet. Make one normal Walmart cart change after refreshing the page.' };
}
async function fill(sourceUrl, items, shopperTabId) {
  running = true;
  let workerTabId;
  const report = [];
  const events = [];
  const startedAt = new Date().toISOString();
  let historyError;
  const save = async (stage, productId) => {
    events.push({ at: new Date().toISOString(), stage, ...(productId ? { productId } : {}) });
    const run = { running, shopperTabId, total: items.length, startedAt, version: chrome.runtime.getManifest().version, report, events, ...(historyError ? { historyError } : {}) };
    await chrome.storage.local.set({ run });
    const attention = report.some(item => !['added', 'already-present'].includes(item.status));
    await chrome.action.setBadgeText({ text: running ? `${report.filter(item => item.id).length}/${items.length}` : attention ? '!' : '✓' });
    await chrome.action.setBadgeBackgroundColor({ color: running ? '#075ed1' : attention ? '#a85a00' : '#17743b' });
    try { await chrome.tabs.sendMessage(shopperTabId, { type: 'progress', run }); } catch { /* Shopper may be navigating. */ }
  };
  await save('started');
  try {
    workerTabId = shopperTabId;
    await chrome.storage.local.set({ queue: { items, nextIndex: 0, workerTabId, state: 'processing' } });
    await save('using-direct-cart-requests');
    for (const item of items) {
      if (!/^\d+$/.test(item.id)) throw new Error('Invalid Walmart product ID.');
      await save('sending-cart-request', item.id);
      await chrome.storage.local.set({ queue: { items, nextIndex: report.length, workerTabId, state: 'processing', currentItemId: item.id } });
      let result;
      try {
        result = await CartRequests.add(item);
      } catch {
        result = { status: 'uncertain', detail: 'Starting-page action was interrupted. Check the cart before retrying.' };
      }
      report.push({ id: item.id, name: item.name, ...result });
      try { await ShoppingHistory.record(startedAt, report[report.length - 1]); }
      catch { historyError = 'An item was added, but shopping history could not be saved. Export the diagnostic log before closing this run.'; }
      await chrome.storage.local.set({ queue: { items, nextIndex: report.length, workerTabId, state: 'queued', lastStatus: result.status } });
      await save(`result-${result.status}`, item.id);
      // Missing/already-present products were not clicked; continue the list.
      // Interrupted or uncertain actions stop to avoid accidental duplicate adds.
      if (!['added', 'already-present', 'not-on-page', 'unavailable'].includes(result.status)) break;
    }
  } catch (error) { report.push({ status: 'error', detail: error.message }); }
  finally {
    running = false;
    const completed = report.filter(item => item.id).length === items.length &&
      report.every(item => ['added', 'already-present', 'not-on-page', 'unavailable'].includes(item.status));
    await chrome.storage.local.set({ queue: { items, nextIndex: report.filter(item => item.id).length,
      workerTabId, state: completed ? 'finished' : 'needs-attention',
      uncertain: report.some(item => item.status === 'uncertain') } });
    await save('finished');
    const { openCartWhenDone } = await chrome.storage.local.get('openCartWhenDone');
    if (openCartWhenDone) {
      await chrome.storage.local.set({ openCartWhenDone: false });
      await pause(1600);
      try { await chrome.tabs.update(shopperTabId, { url: 'https://www.walmart.com/cart' }); } catch {}
    }
    // Service workers cannot create blob URLs; this data URL contains only our
    // deliberately limited diagnostic record, never page HTML or session data.
    const { run } = await chrome.storage.local.get('run');
    try {
      const filename = `Home Grocery Helper/logs/walmart-${startedAt.replace(/[:.]/g, '-')}.json`;
      if (!chrome.downloads?.download) throw new Error('Downloads API unavailable. Reload the extension and check its downloads permission.');
      await chrome.storage.local.set({ automaticLog: { filename, state: 'starting', startedAt } });
      const downloadId = await chrome.downloads.download({
        url: `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(run, null, 2))}`,
        filename,
        saveAs: false,
        conflictAction: 'uniquify'
      });
      // download() resolving means accepted, not necessarily saved to disk.
      const [download] = await chrome.downloads.search({ id: downloadId });
      await chrome.storage.local.set({ automaticLog: { filename, downloadId, startedAt, state: download?.state || 'in_progress', error: download?.error || null } });
    } catch (error) {
      await chrome.storage.local.set({ automaticLog: { startedAt, state: 'failed', error: `Automatic log download failed: ${String(error.message).slice(0, 300)}` } });
    }
  }
}
chrome.downloads?.onChanged.addListener(async delta => {
  const { automaticLog } = await chrome.storage.local.get('automaticLog');
  if (automaticLog?.downloadId !== delta.id) return;
  if (delta.state || delta.error) {
    await chrome.storage.local.set({ automaticLog: { ...automaticLog,
      state: delta.state?.current || automaticLog.state,
      error: delta.error?.current || automaticLog.error || null } });
  }
});
function handleMessage(message, sender, reply) {
  if(message.type==='auditReceipt'){
    (async()=>{let detail;for(let attempt=0;attempt<35;attempt++){await chrome.tabs.sendMessage(message.tabId,{type:'historyCollect',action:'expand'});await pause(350);detail=await chrome.tabs.sendMessage(message.tabId,{type:'historyCollect',action:'extract'});if(detail.blocked)throw Error('Complete the store human check first');if(detail.order?.items?.length&&detail.order.receiptComplete)break;}
      if(!detail?.order?.receiptComplete)throw Error('Receipt items did not finish loading');const result=await Household.repairPrices(detail.store,detail.order);await chrome.storage.local.set({receiptAuditStatus:{at:Date.now(),store:detail.store,...result}});await Household.announce(detail.store,result.receiptVerified?'Receipt item costs verified against the store subtotal.':'Receipt needs review; prices were updated only where verified.',!result.receiptVerified);return result;
    })().then(result=>reply(result),error=>reply({error:error.message}));return true;
  }
  if(message.type==='collectPurchaseHistory'){try{reply(HistoryRunner.start(message.tabId,message.store,message.startPage));}catch(error){reply({error:error.message});}return;}
  if(message.type==='connectHousehold'){
    Household.connect(message.url,message.accountName).then(status=>reply({status})).catch(error=>reply({error:error.message}));return true;
  }
  if (message.type === 'cartSnapshot') {
    if (!sender.tab || !sender.url?.startsWith('https://www.walmart.com/')) return;
    if (running) { reply({ ready: CartRequests.ready() }); return; }
    CartRequests.restore(message.snapshot).then(async ready => { await Household.publishCart().catch(()=>{}); reply({ ready }); }).catch(() => reply({ ready: false }));
    return true;
  }
  if (message.type === 'connectSession') {
    initializeSession(message.tabId).then(reply).catch(() => reply({ ready: false, detail: 'Could not load the Walmart cart.' }));
    return true;
  }
  if (message.type === 'liveCartContext') {
    if (!sender.tab || !sender.url?.startsWith('https://www.walmart.com/')) return;
    CartRequests.learn(message.context).then(async ready => {
      // Normal page clicks are distinct from extension-worker requests. Cached
      // context replays use the same activity timestamp and are idempotent.
      if (ready && !running && message.context.activityAt && Array.isArray(message.context.additions)) {
        for (const item of message.context.additions) await ShoppingHistory.record(message.context.activityAt, item, message.context.activityAt);
      }
      if(!running)await Household.publishCart().catch(()=>{});
      reply({ ready });
    }).catch(() => reply({ ready: false }));
    return true;
  }
  if (message.type === 'requestStatus') { reply({ ready: CartRequests.ready() }); return; }
  if (message.type === 'cartObservation') {
    // Accept only our Walmart content script. No raw request/response body is stored.
    if (!sender.tab || !sender.url?.startsWith('https://www.walmart.com/')) return;
    const entry = message.entry;
    if (!entry || JSON.stringify(entry).length > 100000) return;
    chrome.storage.local.get('cartObservations').then(async ({ cartObservations = [] }) => {
      const observations = [...cartObservations, entry].slice(-20);
      await chrome.storage.local.set({ cartObservations: observations });
      const filename = `Home Grocery Helper/logs/cart-request-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      try {
        await chrome.downloads.download({ filename, saveAs: false, conflictAction: 'uniquify',
          url: `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify({ version: chrome.runtime.getManifest().version, observations }, null, 2))}` });
      } catch { /* Manual diagnostic export also includes observations. */ }
      reply({ recorded: true });
    });
    return true;
  }
  if (message.type === 'getProgress') {
    chrome.storage.local.get('run').then(({ run }) => reply({ run: run?.shopperTabId === sender.tab?.id ? run : null }));
    return true;
  }
  if (message.type === 'openCart') {
      chrome.tabs.update(message.tabId, { url: 'https://www.walmart.com/cart' }).then(() => reply({ opened: true })).catch(() => reply({ error: 'Cannot open this tab.' }));
    return true;
  }
  if (message.type !== 'fill') return;
  if (!CartRequests.ready()) {
    initializeSession(message.tabId).then(result => {
      if (!result.ready) { reply({ error: result.detail }); return; }
      handleMessage(message, sender, reply);
    });
    return true;
  }
  if (running) { reply({ error: 'A cart run is already active.' }); return; }
  if (!Array.isArray(message.items) || !message.items.length || message.items.length > 100) { reply({ error: 'Select between 1 and 100 products. Nothing has been added.' }); return; }
  let source;
  try { source = new URL(message.sourceUrl); } catch { reply({ error: 'Capture products on Walmart before starting.' }); return; }
  if (source.origin !== 'https://www.walmart.com') { reply({ error: 'The shopping queue must start on Walmart.' }); return; }
  if (message.items.some(item => !/^\d+$/.test(item.id))) { reply({ error: 'Invalid product ID.' }); return; }
  running = true;
  // Persist before replying; closing the popup cannot lose the selection.
  chrome.storage.local.set({ openCartWhenDone: false, queue: { items: message.items, nextIndex: 0, state: 'queued' } }).then(() => {
    fill(source.href, message.items, message.tabId);
    reply({ started: true });
  }).catch(() => { running = false; reply({ error: 'Could not save the shopping queue. Nothing was started.' }); });
  return true;
}
chrome.runtime.onMessage.addListener(handleMessage);
Household.start(async job=>{
  if(running)return {error:'Another cart run is active. Please try again after it finishes.',report:[]};
  let tabs=await chrome.tabs.query({url:'https://www.walmart.com/*'});
  let tab=tabs.find(tab=>tab.url==='https://www.walmart.com/cart');
  if(!tab){
    const windows=await chrome.windows.getAll({windowTypes:['normal']});
    // An idle read must respect the user's decision to close all windows.
    // Explicit website jobs may open a window to complete the requested work.
    if(!windows.length&&job.action==='snapshot'&&!job.id)return {report:[],error:'Chrome is closed. Automatic cart checks are paused; a website cart request can reopen it.'};
    if(windows.length)tab=await chrome.tabs.create({windowId:windows[0].id,url:'https://www.walmart.com/cart',active:false});
    else{
      const window=await chrome.windows.create({url:'https://www.walmart.com/cart',state:'minimized',focused:false});
      tab=window.tabs?.[0];
      if(!tab)throw Error('Could not open the background Walmart tab.');
    }
  }
  if(job.action==='snapshot'||job.action==='set'||!CartRequests.ready()){
    const connected=await initializeSession(tab.id);
    if(!connected.ready&&!(job.action==='snapshot'&&CartRequests.snapshot()))return {error:connected.detail,report:[]};
  }
  if(job.action==='snapshot')return {report:[],cart:CartRequests.snapshot()};
  if(job.action==='set'){running=true;try{const report=[];for(const item of job.items){const result=await CartRequests.set(item);report.push({...item,...result});if(result.status==='updated'&&item.quantity>item.expectedQuantity)await ShoppingHistory.record(job.id,{...item,status:'added',quantity:item.quantity-item.expectedQuantity},new Date().toISOString());if(!['updated','removed','already-present'].includes(result.status))break;}return {report,cart:CartRequests.snapshot()};}finally{running=false;}}
  await fill('https://www.walmart.com/cart',job.items,tab.id);
  const {run}=await chrome.storage.local.get('run');
  return {report:run?.report||[],cart:CartRequests.snapshot(),...(run?.historyError?{error:run.historyError}:{})};
});

importScripts('heb-runner.js');

importScripts('price-runner.js');
importScripts('store-task-runner.js');

chrome.runtime.onMessage.addListener((message,sender,reply)=>{if(message.type!=='purchaseConfirmed')return;let url;try{url=new URL(sender.url);}catch{return;}const store=url.origin==='https://www.heb.com'?'HEB':url.origin==='https://www.walmart.com'?'Walmart':null;if(!store||store!==message.store||message.path!==url.pathname)return;Household.taskRequest('/api/bridge/purchase-complete',{store,orderId:message.orderId,path:url.pathname}).then(reply,error=>reply({error:error.message}));return true;});

chrome.runtime.onMessage.addListener((message,sender,reply)=>{if(message.type!=='storeProductsObserved')return;let url;try{url=new URL(sender.tab?.url||'');}catch{return;}const store=url.origin==='https://www.heb.com'?'HEB':url.origin==='https://www.walmart.com'?'Walmart':null;if(!store)return;Household.taskRequest('/api/bridge/product-observations',{store,items:(message.items||[]).slice(0,40)}).then(reply,error=>reply({error:error.message}));return true;});
