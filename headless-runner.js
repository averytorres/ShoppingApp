// Dedicated profiles keep grocery automation separate from the user's Chrome.
const {spawn}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const WebSocket=require('ws');
const sessions=new Map();
function executable(){
  const candidate=process.env.GROCERY_CHROMIUM||path.join(process.env.USERPROFILE,'Documents/Transfer/ShoppingApp/walmart-request-tests/browser-cache/chromium-1194/chrome-win/chrome.exe');
  if(!fs.existsSync(candidate))throw Error('The dedicated Chromium browser is missing. Set GROCERY_CHROMIUM to its chrome.exe.');
  return candidate;
}
async function start(client,name,visible=false){
  if(!/^[a-zA-Z0-9-]{1,80}$/.test(client))throw Error('Invalid grocery account');
  const existing=sessions.get(client);
  if(existing){if(visible&&!existing.visible)throw Error('Close the headless runner using its setup control before signing in.');return;}
  const root=path.resolve(process.env.GROCERY_DATA_DIR||path.join(__dirname,'.data'),'browsers',client);
  fs.mkdirSync(root,{recursive:true});
  const args=['--user-data-dir='+root,'--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--no-first-run','--no-default-browser-check','--load-extension='+path.join(__dirname,'walmart-extension'),'--disable-extensions-except='+path.join(__dirname,'walmart-extension'),...(visible?[]:['--headless=new']),'https://www.walmart.com/cart'];
  const child=spawn(executable(),args,{windowsHide:true,stdio:['ignore','ignore','pipe']});
  const entry={child,visible};sessions.set(client,entry);
  child.once('exit',()=>{if(sessions.get(client)===entry)sessions.delete(client);});
  let socket;
  try{
    const endpoint=await new Promise((resolve,reject)=>{
      let buffer='';const timer=setTimeout(()=>reject(Error('Grocery browser did not start within 20 seconds.')),20000);
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',()=>{clearTimeout(timer);reject(Error('Grocery browser closed before connecting.'));});
      child.stderr.on('data',chunk=>{buffer=(buffer+chunk.toString()).slice(-8000);const match=buffer.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
    });
    // Debugging endpoint is loopback-only and never sent to the household site.
    entry.endpoint=endpoint;
    socket=new WebSocket(endpoint);entry.socket=socket;
    await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
    let sequence=0;const pending=new Map();
    socket.on('message',raw=>{const message=JSON.parse(raw);const waiter=pending.get(message.id);if(waiter){pending.delete(message.id);clearTimeout(waiter.timer);message.error?waiter.reject(Error('Browser command failed')):waiter.resolve(message.result);}});
    const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Browser command timed out'));},10000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
    entry.close=()=>send('Browser.close').catch(()=>{});
    let worker;
    for(let attempt=0;attempt<40;attempt++){
      const {targetInfos}=await send('Target.getTargets');worker=targetInfos.find(target=>target.type==='service_worker'&&target.url.startsWith('chrome-extension://')&&target.url.endsWith('/background.js'));
      if(worker)break;await new Promise(resolve=>setTimeout(resolve,250));
    }
    if(!worker)throw Error('The grocery extension did not load in the dedicated browser.');
    const {sessionId}=await send('Target.attachToTarget',{targetId:worker.targetId,flatten:true});
    const settings={householdUrl:'http://127.0.0.1:4317',householdClientId:client,householdAccountName:name};
    const result=await send('Runtime.evaluate',{expression:`(async()=>{await chrome.storage.local.set(${JSON.stringify(settings)});Household.tick();return true;})()`,awaitPromise:true,returnByValue:true},sessionId);
    if(result.exceptionDetails)throw Error('The grocery extension could not connect to the household server.');
  }catch(error){child.kill();sessions.delete(client);throw error;}
  finally{socket?.close();}
}
async function stop(client){
  const entry=sessions.get(client);if(!entry)return;
  if(!entry.endpoint)throw Error('The grocery browser is still starting. Try again shortly.');
  const socket=new WebSocket(entry.endpoint);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.terminate();reject(Error('Could not close the grocery browser'));},10000);socket.once('error',error=>{clearTimeout(timer);reject(error);});socket.once('open',()=>socket.send(JSON.stringify({id:1,method:'Browser.close'})));socket.once('close',()=>{clearTimeout(timer);resolve();});});
  for(let n=0;n<40&&sessions.has(client);n++)await new Promise(resolve=>setTimeout(resolve,100));
  if(sessions.has(client))throw Error('Grocery browser is still closing. Try again shortly.');
}
async function stopAll(){await Promise.allSettled([...sessions.keys()].map(stop));}
module.exports={start,stop,stopAll,executable};
