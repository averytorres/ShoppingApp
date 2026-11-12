// A confirmation needs both a checkout URL and visible order confirmation.
// An empty cart or an old order-detail page is never treated as a purchase.
(() => {
 let sent='';
 function check(){
  if(!chrome.runtime?.id)return;
  if(!/(thank.?you|confirmation|checkout\/complete)/i.test(location.pathname))return;
  const heading=[...document.querySelectorAll('h1,h2,[role="heading"]')].map(n=>n.innerText).join(' ');
  if(!/(order (?:is |was )?(?:placed|confirmed)|thank(?:s| you) for (?:your |the )?order)/i.test(heading))return;
  const match=document.body.innerText.match(/order\s*(?:number|no\.?|#)\s*[:#]?\s*([0-9][0-9-]{4,39})\b/i);if(!match||sent===match[1])return;
  const store=location.hostname==='www.heb.com'?'HEB':'Walmart';
  chrome.runtime.sendMessage({type:'purchaseConfirmed',store,orderId:match[1],path:location.pathname}).then(result=>{if(result?.ok)sent=match[1];}).catch(()=>{});
 }
 setInterval(check,5000);check();
})();
