(() => {
  const store=location.hostname==='www.heb.com'?'HEB':'Walmart';
  let host,timer,progressHost;
  function progress(value,history=false){
    if(value?.store!==store)return;
    progressHost?.remove();progressHost=null;
    if(!value.running||Date.now()-Date.parse(value.at)>120000&&history||!history&&Date.now()-value.at>120000)return;
    const host=document.createElement('div');progressHost=host;host.style.cssText='position:fixed;right:20px;top:100px;z-index:2147483647';
    const root=host.attachShadow({mode:'closed'}),box=document.createElement('section');box.style.cssText='font:14px system-ui;background:white;color:#172b42;border:2px solid #264d3e;border-radius:12px;padding:16px;width:300px;max-width:calc(100vw - 48px);box-shadow:0 4px 24px #0003';box.setAttribute('role','status');box.setAttribute('aria-live','polite');
    const text=document.createElement('p');text.textContent=history?'Reading '+(store==='HEB'?'H-E-B':store)+' purchase history… '+(value.orders||0)+' orders read':value.total?(value.processed||0)+' of '+value.total+' items processed':'Updating Walmart cart…';
    const bar=document.createElement('progress');bar.style.cssText='display:block;width:100%;accent-color:#264d3e';bar.setAttribute('aria-label',history?'Purchase history collection in progress':'Cart sync in progress');if(!history&&value.total){bar.max=value.total;bar.value=Math.min(value.total,value.processed||0);}
    box.append(text,bar);root.append(box);document.documentElement.append(host);
  }
  function show(event){
    if(!event||event.store!==store||Date.now()-event.at>15000)return;
    host?.remove();clearTimeout(timer);host=document.createElement('div');host.style.cssText='position:fixed;right:20px;bottom:20px;z-index:2147483647';
    const root=host.attachShadow({mode:'closed'}),box=document.createElement('section');
    box.style.cssText='font:14px system-ui;background:white;color:#172b42;border:2px solid '+(event.attention?'#a66316':'#264d3e')+';border-radius:12px;padding:16px;max-width:320px;box-shadow:0 4px 24px #0003';box.setAttribute('role','status');box.setAttribute('aria-live','polite');
    const text=document.createElement('p');text.textContent=event.message;
    const close=document.createElement('button');close.textContent='Dismiss';close.onclick=()=>host.remove();box.append(text,close);root.append(box);document.documentElement.append(host);
    if(!event.attention)timer=setTimeout(()=>host.remove(),8000);
  }
  chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local')return;if(changes.syncNotice)show(changes.syncNotice.newValue);if(changes.syncProgress)progress(changes.syncProgress.newValue);if(changes.historyCollection)progress(changes.historyCollection.newValue,true);});
  chrome.storage.local.get(['syncProgress','historyCollection']).then(values=>{if(values.syncProgress?.running)progress(values.syncProgress);if(values.historyCollection?.running)progress(values.historyCollection,true);}).catch(()=>{});
})();
