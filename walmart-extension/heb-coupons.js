var HebCoupons=(()=>{
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 async function flush(post){const {hebCouponPendingReport}=await chrome.storage.local.get('hebCouponPendingReport');if(hebCouponPendingReport){await post('/api/bridge/heb/coupons/result',hebCouponPendingReport);await chrome.storage.local.remove('hebCouponPendingReport');}}
 async function read(tab,id,action){for(let n=0;n<60;n++){try{const result=await chrome.tabs.sendMessage(tab,{type:'hebCoupons',id,action});if(result?.error)throw Error(result.error);if(!result||result.productId!==id||!Array.isArray(result.coupons))throw Error('Unreadable H-E-B coupon response');return result;}catch(e){if(!/Receiving end|still loading/i.test(e.message)||n===59)throw e;await sleep(400);}}}
 async function loaded(tab,id){for(let n=0;n<100;n++){await sleep(250);const t=await chrome.tabs.get(tab);if(t.status==='complete'&&t.url?.startsWith('https://www.heb.com/product-detail/')&&new URL(t.url).pathname.endsWith('/'+id))return;}throw Error('H-E-B coupon product page timed out');}
 async function check(post,cart,windowId,force=false){
  if(!cart.lines.length)return;const {householdClientId}=await chrome.storage.local.get('householdClientId');
  const key='hebCouponChecks:'+householdClientId,cache=(await chrome.storage.local.get(key))[key]||{};
  const pending=cart.lines.filter(item=>force||!cache[item.id]||cache[item.id].quantity!==item.quantity||Date.now()-cache[item.id].at>6*3600000);
  if(!pending.length)return;let worker;const pendingIds=new Set(pending.map(x=>x.id)),results=cart.lines.filter(x=>!pendingIds.has(x.id)&&cache[x.id]?.result).map(x=>cache[x.id].result);let error=null;
  const report=running=>post('/api/bridge/heb/coupons/result',{running,processed:results.length,total:cart.lines.length,items:results,error});
  try{await report(true);worker=await chrome.tabs.create({windowId,url:'https://www.heb.com/product-detail/item/'+pending[0].id,active:false});
   for(const item of pending){try{
    if(item!==pending[0])await chrome.tabs.update(worker.id,{url:'https://www.heb.com/product-detail/item/'+item.id});await loaded(worker.id,item.id);
    const clipped=await read(worker.id,item.id,'clip');await chrome.tabs.reload(worker.id);await loaded(worker.id,item.id);const verified=await read(worker.id,item.id,'read');
    for(const coupon of clipped.coupons)if(coupon.status==='clipped'&&!verified.coupons.some(c=>c.id===coupon.id&&c.status==='clipped'))throw Error('Coupon '+coupon.id+' was not saved after reload');
    if(verified.coupons.some(c=>c.status!=='clipped'))throw Error('Some H-E-B coupon controls could not be verified');
    const result={id:item.id,name:item.name,quantity:item.quantity,coupons:verified.coupons};results.push(result);cache[item.id]={at:Date.now(),quantity:item.quantity,result};await chrome.storage.local.set({[key]:cache});
   }catch(e){results.push({id:item.id,name:item.name,quantity:item.quantity,coupons:[],error:e.message});error=e.message;if(/sign in|sign into|human|account is still loading/i.test(e.message))break;}await report(true);}
  }catch(e){error=e.message;}finally{if(worker)await chrome.tabs.remove(worker.id).catch(()=>{});const final={running:false,processed:results.length,total:cart.lines.length,items:results,error};await chrome.storage.local.set({hebCouponPendingReport:final});await flush(post).catch(()=>{});}
 }
 return {check,flush};
})();
