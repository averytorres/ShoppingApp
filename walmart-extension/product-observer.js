(() => {
 const store=location.hostname==='www.heb.com'?'HEB':'Walmart',seen=new Map();let timer;
 const hosts=store==='HEB'?['images.heb.com']:['i5.walmartimages.com','i5.walmartimages.ca'];
 function photoUrl(input){try{const url=new URL(input,location.href);return url.protocol==='https:'&&hosts.includes(url.hostname)&&!/logo|sprite|banner/i.test(url.pathname)?url.href:null;}catch{return null;}}
 async function scan(){if(document.hidden||/verify you are human|robot or human|press & hold|access denied/i.test(document.body.innerText))return;const found=new Map(),match=location.pathname.match(store==='HEB'?/^\/product-detail\/.*\/(\d+)\/?$/:/^\/ip\/(?:.*\/)?(\d+)\/?$/);
  if(match&&window.StoreProductDetails){const detail=StoreProductDetails.read(match[1]);if(detail?.id){const imageUrl=photoUrl(detail.imageUrl),price=detail.error?null:detail;if(imageUrl||price)found.set(detail.id,{id:detail.id,imageUrl,price});}}
  for(const link of document.querySelectorAll(store==='HEB'?'a[href*="/product-detail/"]':'a[href*="/ip/"]')){if(found.size>=40)break;const box=link.getBoundingClientRect();if(!box.width||box.bottom<0||box.top>innerHeight+300)continue;let id;try{id=new URL(link.href).pathname.match(/\/(\d+)\/?$/)?.[1];}catch{}const img=link.querySelector('img'),imageUrl=photoUrl(img?.currentSrc||img?.src);if(id&&imageUrl&&!found.has(id))found.set(id,{id,imageUrl});}
  const items=[...found.values()].filter(item=>{const signature=JSON.stringify({...item,price:item.price?{...item.price,at:undefined}:null}),old=seen.get(item.id);if(old&&old.signature===signature&&Date.now()-old.at<6*3600000)return false;item._signature=signature;return true;});if(!items.length)return;
  try{const result=await chrome.runtime.sendMessage({type:'storeProductsObserved',items:items.map(({_signature,...item})=>item)});if(!result?.error)for(const item of items)seen.set(item.id,{signature:item._signature,at:Date.now()});}catch{}
 }
 const schedule=()=>{clearTimeout(timer);timer=setTimeout(scan,1800);};new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});addEventListener('scroll',schedule,{passive:true});addEventListener('popstate',schedule);document.addEventListener('visibilitychange',schedule);setTimeout(scan,3000);setTimeout(scan,12000);setInterval(scan,30000);
})();
