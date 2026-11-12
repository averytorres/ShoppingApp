// Only coupons offered for this exact product, never recommendations or cart adds.
(() => {
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const visible=el=>!!el.getClientRects().length;
 const text=el=>(el.getAttribute('aria-label')||el.textContent||'').replace(/\s+/g,' ').trim();
 function ready(id){
  if(!/^\d{1,25}$/.test(id)||!location.pathname.startsWith('/product-detail/')||!location.pathname.endsWith('/'+id))throw Error('Wrong H-E-B coupon product page');
  if(/verify you are human|access denied|robot check/i.test(document.body.innerText))throw Error('Complete the H-E-B human check');
  if(document.querySelector('input[type=password]'))throw Error('Sign into H-E-B to clip coupons');
  if(![...document.querySelectorAll('button')].some(b=>/^Hi,\s*\S/i.test(text(b))))throw Error('H-E-B account is still loading');
  const root=document.querySelector('[aria-label="product purchase details"]');
  if(!root?.querySelector('h1,h2')||!root.querySelector('button'))throw Error('H-E-B product is still loading');
  return root;
 }
 function cards(id){const root=ready(id),region=root.querySelector('[aria-label="Coupons"],[aria-labelledby="coupon-section-heading"]')||root;
  return [...region.querySelectorAll('a[href*="/digital-coupon/coupon-detail/"]')].filter(visible).map(link=>{
   const url=new URL(link.href),couponId=url.pathname.match(/^\/digital-coupon\/coupon-detail\/(\d+)$/)?.[1];if(url.origin!=='https://www.heb.com'||!couponId)return null;
   const button=[...link.querySelectorAll('button')].find(visible),label=button?text(button):'';
   const offer=(link.getAttribute('aria-label')||[...link.querySelectorAll('img')].map(x=>x.alt).join(' ')||link.textContent||'H-E-B coupon').replace(/^Coupon savings (?:not )?applied:\s*/i,'').replace(/\b(?:Clip|Clipped)\s*$/i,'').trim();
   return {id:couponId,url:url.href,offer:offer.slice(0,300),requirements:(link.innerText||'').replace(/\b(?:Clip|Clipped)\s*$/i,'').trim().slice(0,1000),status:/^(?:clipped\b|add items$|savings applied$)/i.test(label)?'clipped':/^clip$/i.test(label)&&!button.disabled?'available':'unconfirmed',applied:/^Coupon savings applied:/i.test(link.getAttribute('aria-label')||''),button};
  }).filter(Boolean);
 }
 let busy=false;
 async function run(message){if(busy)throw Error('Coupon check already running');busy=true;try{
  ready(message.id);await sleep(1400);let list=cards(message.id);
  if(message.action==='clip')for(const card of list){if(card.status!=='available')continue;card.button.click();let saved=false;for(let i=0;i<30;i++){await sleep(250);const current=cards(message.id).find(c=>c.id===card.id);if(current?.status==='clipped'){saved=true;break;}if(document.querySelector('input[type=password]'))throw Error('Sign into H-E-B to clip coupons');}if(!saved)throw Error('H-E-B did not confirm clipping coupon '+card.id);}
  return {productId:message.id,coupons:cards(message.id).map(({button,...card})=>card)};
 }finally{busy=false;}}
 chrome.runtime.onMessage.addListener((message,sender,reply)=>{if(message.type!=='hebCoupons'||!['clip','read'].includes(message.action))return;run(message).then(reply,e=>reply({error:e.message}));return true;});
})();
