var HistoryRunner=(()=>{
  let collecting=false;
  const recovered=chrome.storage.local.get('historyCollection').then(async ({historyCollection})=>{if(historyCollection?.running)await chrome.storage.local.set({historyCollection:{...historyCollection,running:false,incomplete:true,message:'Collection interrupted by an extension restart. Start collection again; nothing was imported.'}});});
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const signatureOf=page=>JSON.stringify(page.urls.length?page.urls:page.dates?.length&&page.dates.every(Boolean)?page.dates:page.labels);
  const origins={Walmart:'https://www.walmart.com',HEB:'https://www.heb.com'};
  async function progress(value){await chrome.storage.local.set({historyCollection:{at:new Date().toISOString(),...value}});}
  async function read(tabId,action,index){return chrome.tabs.sendMessage(tabId,{type:'historyCollect',action,index});}
  async function wait(tabId,kind,expectedUrl){
    let last;for(let n=0;n<40;n++){
      try{const value=await read(tabId,kind);last=value;if(value.blocked)throw Error('Complete the store human check in the collection tab, then start a new collection.');
        if(kind==='listing'&&value.listing&&(value.count||value.empty))return value;
        if(kind==='extract'&&value.order?.purchasedAt&&(!expectedUrl||new URL(value.url).pathname===new URL(expectedUrl).pathname))return value;
      }catch(error){if(error.message.includes('human check'))throw error;}
      await sleep(400);
    }
    throw Error('The order page did not become readable ('+kind+'). '+JSON.stringify(last?.diagnostic||{error:last?.error||'No response'}));
  }
  async function listingAt(tabId,root,pageNumber){
    await chrome.tabs.update(tabId,{url:'about:blank'});await sleep(150);await chrome.tabs.update(tabId,{url:root});await sleep(800);for(let n=0;n<60;n++){const current=await chrome.tabs.get(tabId);if(current.status==='complete')break;await sleep(200);}let page=await wait(tabId,'listing');
    const target=pageNumber+1;
    for(let attempt=0;page.pageNumber!==target&&attempt<200;attempt++){
      const before=page.pageNumber,action=before<target?'next':'previous',expected=before+(action==='next'?1:-1);
      const clicked=await read(tabId,action);if(!clicked.clicked)throw Error('Could not restore history page '+target+' from '+before);
      let moved=false;for(let n=0;n<40;n++){await sleep(400);page=await wait(tabId,'listing');if(page.pageNumber===expected){await sleep(900);page=await wait(tabId,'listing');moved=true;break;}}if(!moved)throw Error('History pagination did not advance to '+expected);
    }
    if(page.pageNumber!==target)throw Error('History page restoration exceeded its limit');
    return page;
  }
  function start(tabId,requestedStore,startPage=1){if(collecting)throw Error('A history collection is already running.');collecting=true;run(tabId,requestedStore,startPage).finally(()=>{collecting=false;});return {started:true};}
  async function run(sourceTabId,requestedStore,startPage,taskId){
    let tab,detailTab,store;const orders=[],warnings=[];let incomplete=false,skipped=0;
    try{
      let source=await chrome.tabs.get(sourceTabId);for(let n=0;n<40&&!/^https:\/\//.test(source.url||'');n++){await sleep(250);source=await chrome.tabs.get(sourceTabId);}source={...source,url:source.url||source.pendingUrl};const origin=new URL(source.url).origin;
      store=origins[requestedStore]?requestedStore:Object.keys(origins).find(key=>origins[key]===origin);if(!store)throw Error('Open Walmart or H-E-B in the current Chrome profile first.');
      const settings=await chrome.storage.local.get(['householdUrl','householdClientId']);
      if(!settings.householdUrl||!settings.householdClientId)throw Error('Connect this extension to the household website first.');
      const coverage=await Household.auditedOrders(store),auditedOrders=new Set(coverage);let knownPages=0;const storeOrigin=origins[store];let root=store==='Walmart'?storeOrigin+'/orders':storeOrigin+'/my-account/your-orders';if(store==='Walmart'&&new URL(source.url).pathname==='/orders'){const filtered=new URL(source.url);filtered.searchParams.delete('page');root=filtered.href;}
      let firstPage=0;if(new URL(source.url).origin===storeOrigin&&/^\/orders\/?$|^\/my-account\/your-orders\/?$/.test(new URL(source.url).pathname)){tab=source;firstPage=Math.max(0,(Number(new URL(source.url).searchParams.get('page'))||1)-1);}else tab=await chrome.tabs.create({url:root,active:false});
      if(Number.isInteger(startPage)&&startPage>1&&startPage<=200){firstPage=startPage-1;await listingAt(tab.id,root,firstPage);}
      await recovered;await progress({running:true,store,orders:0,message:'Reading order history…'});
      const seenOrders=new Set();const pages=new Set();
      for(let pageNumber=firstPage;pageNumber<200;pageNumber++){
        let page=await wait(tab.id,'listing');
        if(store==='Walmart')pageNumber=page.pageNumber-1;
        if(page.empty)break;
        const signature=signatureOf(page);
        if(pages.has(signature)){warnings.push('Pagination repeated a page; collection stopped to avoid duplicates.');incomplete=true;break;}pages.add(signature);
        let knownOnPage=0;for(let index=0;index<page.count;index++){
          if(orders.length>=1000){warnings.push('Stopped at the 1,000-order safety limit. Older history remains.');incomplete=true;break;}
          const listedId=page.urls[index]?new URL(page.urls[index]).pathname.split('/').filter(Boolean).at(-1):null;
          if(listedId&&auditedOrders.has(listedId)){skipped++;knownOnPage++;continue;}
          let readingTab=tab;
          if(page.urls.length){if(!detailTab)detailTab=await chrome.tabs.create({url:'about:blank',active:false});readingTab=detailTab;const url=new URL(page.urls[index]);if(url.origin!==storeOrigin)throw Error('History link points outside the selected store.');await chrome.tabs.update(readingTab.id,{url:url.href});}
          else{const clicked=await read(tab.id,'detail',index);if(!clicked.clicked)throw Error('Could not open an order detail.');}
          let detail=await wait(readingTab.id,'extract',page.urls[index]);
          const alreadyAudited=auditedOrders.has(detail.order.orderId);
          if(store==='Walmart'&&!alreadyAudited){let stableRows=-1;for(let attempt=0;attempt<30;attempt++){await read(readingTab.id,'expand');await sleep(400);const loaded=await read(readingTab.id,'extract');if(loaded.blocked)throw Error('Complete the store human check before collecting again.');if(loaded.order?.purchasedAt)detail=loaded;if(detail.order.items.length&&detail.order.items.length===stableRows&&!detail.diagnostic?.showItems)break;stableRows=detail.order.items.length;}}
          if(alreadyAudited){skipped++;knownOnPage++;}
          if(!alreadyAudited&&!seenOrders.has(detail.order.orderId)){
            if(!detail.order.purchasedAt||!detail.order.items.length){warnings.push('An order could not be fully read and was left out.');incomplete=true;}
            else{seenOrders.add(detail.order.orderId);orders.push(detail.order);const repair=taskId?await Household.taskRequest('/api/bridge/store-tasks/receipt',{id:taskId,order:detail.order}):await Household.repairPrices(store,detail.order);if(repair.warnings?.length)warnings.push('Order '+orders.length+': '+repair.warnings.length+' saved item prices still need verification.');for(const warning of detail.warnings||[])warnings.push('Order '+orders.length+': '+warning);}
          }
          await progress({running:true,store,orders:orders.length,skipped,message:'Read '+orders.length+' new or incomplete orders; skipped '+skipped+' verified receipts.'});
          if(!page.urls.length){let restored=false;try{await chrome.tabs.goBack(tab.id);for(let attempt=0;attempt<80;attempt++){await sleep(150);const back=await read(tab.id,'listing');if(back.listing&&signatureOf(back)===signature){page=back;restored=true;break;}}}catch{}if(!restored)page=await listingAt(tab.id,root,pageNumber);}
        }
        knownPages=knownOnPage===page.count?knownPages+1:0;if(taskId&&!coverage.hasIncomplete&&knownPages>=2)break;
        if(taskId)await Household.taskRequest('/api/bridge/store-tasks/result',{id:taskId,complete:false,result:{read:orders.length,skipped}});
        if(incomplete||!page.hasNext)break;
        if(pageNumber===199){warnings.push('Stopped at the 200-page safety limit. Older history remains.');incomplete=true;break;}
        const beforeNumber=page.pageNumber;const moved=await read(tab.id,'next');if(!moved.clicked)throw Error('Could not open the next history page.');await sleep(400);
        let changed=false;for(let attempt=0;attempt<30;attempt++){const next=await wait(tab.id,'listing');if((store!=='Walmart'||next.pageNumber===beforeNumber+1)&&signatureOf(next)!==signature){await sleep(800);changed=true;break;}await sleep(400);}if(!changed)throw Error('The next page did not change. Review this partial collection.');
      }
    }catch(error){warnings.push(error.message);incomplete=true;}
    if(taskId){if(detailTab)await chrome.tabs.remove(detailTab.id).catch(()=>{});await progress({running:false,store,orders:orders.length,skipped,incomplete,message:incomplete?'History sync needs attention.':'History sync complete.'});return {read:orders.length,skipped,...(incomplete?{error:warnings.at(-1)||'History collection incomplete'}:{})};}
    try{
      if(orders.length){
        const preview=await Household.previewHistory(store,orders,warnings,incomplete);
        if(!incomplete&&!preview.eligible){await Household.announce(store,'History up to date. Verified receipts were skipped.');await progress({running:false,store,orders:orders.length,incomplete:false,warnings,previewId:preview.id,skipped,message:'New or incomplete history checked; '+skipped+' verified receipts skipped. No new purchases to import.'});return;}
        await Household.announce(store,incomplete?'History collection needs attention. Review the partial collection in Home Grocery.':'Purchase history collected. Review it in Home Grocery to finish importing.',incomplete);
        await progress({running:false,store,orders:orders.length,incomplete,warnings,previewId:preview.id,message:'Collection ready for review. Nothing imported or added to a cart.'});
        const {householdUrl}=await chrome.storage.local.get('householdUrl');
        await chrome.tabs.create({url:householdUrl+'/?import='+encodeURIComponent(preview.id)+'#history',active:true});
      }else await progress({running:false,store,orders:0,incomplete,warnings,skipped,message:incomplete?'History check needs attention.':skipped?'History up to date; '+skipped+' verified receipts skipped.':'No purchase history found. Nothing imported.'});
    }catch(error){await progress({running:false,store,orders:orders.length,incomplete:true,warnings:[...warnings,error.message],message:'Could not prepare the import preview. No purchases imported. Try collecting again.'});}
    // Leave the read-only collection tab available for sign-in/checks and inspection.
  }
  async function task(tabId,store,id){if(collecting)throw Error('Another history collection is running');collecting=true;try{return await run(tabId,store,1,id);}finally{collecting=false;}}
  return {start,task};
})();
