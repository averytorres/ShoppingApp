// Reads only rendered order pages. Never clicks reorder/cart/checkout controls.
(function(root){
  function quantity(text){
    const weighed=String(text).match(/\bQty\s*:?\s*(\d+(?:\.\d+)?)\s+of\s+\d+(?:\.\d+)?\s*(lbs?|oz|kg|g)\b/i);if(weighed)return {quantity:Number(weighed[1]),unit:weighed[2].toLowerCase().replace(/^lbs$/,'lb')};
    const source=String(text);const pattern=prefix=>new RegExp('\\b'+prefix+'\\s*:?\\s*(\\d+(?:\\.\\d+)?)\\s*(lbs?\\b|pounds?\\b|oz\\b|ounces?\\b|kg\\b|kilograms?\\b|g\\b|grams?\\b|eachs?\\b|ea\\b)?','i');
    const match=source.match(pattern('Wt'))||source.match(pattern('Weight'))||source.match(pattern('Qty'))||source.match(pattern('Quantity'));
    if(!match)return null;
    const units={lb:'lb',lbs:'lb',pound:'lb',pounds:'lb',oz:'oz',ounce:'oz',ounces:'oz',kg:'kg',kilogram:'kg',kilograms:'kg',g:'g',gram:'g',grams:'g',each:'each',eachs:'each',ea:'each'};
    const amount=Number(match[1]),unit=units[(match[2]||'each').toLowerCase()];
    if(!(amount>0&&amount<=(unit==='each'?100:100000))||unit==='each'&&!Number.isInteger(amount))return null;
    return {quantity:amount,unit};
  }
  function quantityRows(text){text=String(text).replace(/Requested weight\s*:?\s*\d+(?:\.\d+)?\s*(?:lbs?|oz|kg|g)?/gi,'');for(const label of ['Wt','Weight','Qty','Quantity']){const matches=String(text).match(new RegExp('\\b'+label+'\\s*:?\\s*\\d+(?:\\.\\d+)?','gi'));if(matches?.length)return matches.length;}return 0;}
  function date(text,store){
    const months='Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
    const pattern=store==='Walmart'?new RegExp('('+months+')\\s+(\\d{1,2}),?\\s+(20\\d{2})\\s+order','i'):new RegExp('('+months+')\\s+(\\d{1,2}),?\\s+(20\\d{2})','i');
    const clean=text.replace(/[\u200e\u200f\u202a-\u202e]/g,'').replace(/\s+/g,' ');const match=clean.match(pattern)||clean.match(new RegExp('('+months+')\\s+(\\d{1,2}),?\\s+(20\\d{2})','i'));if(!match)return null;
    const parsed=new Date(match[1]+' '+match[2]+', '+match[3]+' 12:00:00 UTC');
    return Number.isFinite(parsed.getTime())?parsed.toISOString().slice(0,10):null;
  }
  function storeFor(url){const host=new URL(url).hostname;return host==='www.walmart.com'?'Walmart':host==='www.heb.com'?'HEB':null;}
  function receiptPrice(text,q){
    const accessible=String(text).match(/\bPrice:\s*\$([\d,]+\.\d{2})/i);if(accessible){const lineTotal=Number(accessible[1].replaceAll(',',''));return {lineTotal,unitPrice:lineTotal/q.quantity,priceSource:'receipt-line-total'};}
    // A product's comparison price (/lb, /oz) is not necessarily its paid price.
    const labelled=[...String(text).matchAll(/(?:discount price|current price|now)\s*\$([\d,]+\.\d{2})(?!\d|\s*\/)/gi)].map(m=>Number(m[1].replaceAll(',','')));if(new Set(labelled).size===1)return {lineTotal:labelled[0],unitPrice:labelled[0]/q.quantity,priceSource:'receipt-line-total'};
    const paid=String(text).replace(/\bOrdered price\s*\$[\d,]+(?:\.\d{1,2})?/gi,'').replace(/\bWas\s*\$[\d,]+(?:\.\d{1,2})?/gi,'').replace(/\$[\d,]+(?:\.\d{1,2})?\s*(?:from\s+savings|saved|savings)/gi,'');
    const amounts=paid.split(/\n/).map(s=>s.trim()).filter(s=>/^\$[\d,]+\.\d{2}$/.test(s)).map(s=>Number(s.replace(/[$,]/g,'')));
    const unlabelled=paid.replace(/\$[\d,]+(?:\.\d{1,2})?\s*\/[^\n]*/g,'').replace(/\$[\d,]+(?:\.\d{1,2})?\s*(?:\/\s*|\s+)(?:ea|each|lb|oz|kg|g)\b/gi,'');
    const remaining=[...unlabelled.matchAll(/\$([\d,]+\.\d{2})/g)].map(m=>Number(m[1].replaceAll(',','')));
    const unique=[...new Set(amounts.length?amounts:remaining)];
    if(unique.length===1)return {lineTotal:unique[0],unitPrice:unique[0]/q.quantity,priceSource:'receipt-line-total'};
    const prices=[...String(text).matchAll(/\$([\d,]+(?:\.\d{1,2})?)\s*(?:\/\s*|\s+)(ea|each|lb|oz|kg|g)\b/gi)].filter(m=>(/^(ea|each)$/i.test(m[2])?'each':m[2].toLowerCase())===q.unit);
    const values=[...new Set(prices.map(m=>Number(m[1].replaceAll(',',''))))];
    return values.length===1?{unitPrice:values[0],priceSource:'receipt-unit-price'}:{};
  }
  function controls(){return [...document.querySelectorAll('button,a')];}
  const label=element=>(element.getAttribute('aria-label')||element.innerText||'').trim();
  function challenge(){return /robot or human|verify (?:that )?you(?:'re| are) human|press (?:and|&) hold|access denied|unusual traffic/i.test(document.body.innerText.slice(0,20000));}
  function listing(){
    const store=storeFor(location.href);if(challenge())return {blocked:true,store};
    const buttons=controls().filter(el=>store==='Walmart'?/^View details(?: of|$)/i.test(label(el)):/^View details$/i.test(label(el)));
    const links=[...document.querySelectorAll('a[href]')].filter(el=>store==='Walmart'?/^\/orders\/\d+\/?$/.test(el.pathname):/^\/my-account\/order-history\/[^/]+\/?$/.test(el.pathname));
    const urls=[...new Set(links.map(el=>el.href))];
    const next=controls().find(el=>/^Next page$/i.test(label(el))&&!el.disabled&&el.getAttribute('aria-disabled')!=='true');
    const text=document.body.innerText;
    return {store,pageNumber:Number(label(document.querySelector('[aria-current="page"]')||controls().find(el=>/^Page \d+$/i.test(label(el)))||{getAttribute:()=>'',innerText:''}).match(/\d+/)?.[0])||Number(new URL(location.href).searchParams.get('page'))||1,count:urls.length||buttons.length,urls,labels:buttons.map(label),dates:buttons.map(button=>date(label(button),store)),hasNext:!!next,empty:/no (?:past |previous |recent )?(?:orders|purchases)|haven.t placed (?:an|any) order/i.test(text),listing:store==='Walmart'?/\/orders\/?$/.test(location.pathname):/\/my-account\/your-orders\/?$/.test(location.pathname)};
  }
  function clickRead(action,index){
    if(challenge())return {blocked:true};const store=storeFor(location.href);let control;
    if(action==='next')control=controls().find(el=>/^Next page$/i.test(label(el))&&!el.disabled&&el.getAttribute('aria-disabled')!=='true');
    else if(action==='previous')control=controls().find(el=>/^Previous page$/i.test(label(el))&&!el.disabled&&el.getAttribute('aria-disabled')!=='true');
    else if(action==='expand'){const panels=controls().filter(el=>/^Show items$/i.test(label(el)));for(const panel of panels)panel.click();return {clicked:!!panels.length,count:panels.length};}
    else if(action==='detail')control=controls().filter(el=>store==='Walmart'?/^View details(?: of|$)/i.test(label(el)):/^View details$/i.test(label(el)))[index];
    if(control){control.click();return {clicked:true};}return {clicked:false};
  }
  function extract(){
    const store=storeFor(location.href);if(challenge())return {blocked:true,store};
    const text=document.body.innerText;
    const orderId=store==='Walmart'?location.pathname.match(/^\/orders\/(\d+)\/?$/)?.[1]:location.pathname.match(/^\/my-account\/order-history\/([^/]+)\/?$/)?.[1];
    if(!orderId)return {error:'This is not an order-detail page.'};
    const status=/\border(?: was)?\s+cancell?ed\b|\bcancell?ed order\b/i.test(text)?'canceled':/order (?:was )?refunded/i.test(text)?'refunded':store==='HEB'?/Order delivered/i.test(text)?'delivered':/Order picked up/i.test(text)?'picked up':'unknown':/Delivered\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(text)?'delivered':/Picked up/i.test(text)?'picked up':new URL(location.href).searchParams.get('storePurchase')==='true'&&/Store purchase/i.test(text)?'completed':'unknown';
    const purchasedAt=date(text,store);const items=[],warnings=[];const seen=new Set();
    const selector=store==='Walmart'?'a[href*="/ip/"]':'a[href*="/product-detail/"]';
    const storeReceipt=store==='Walmart'&&new URL(location.href).searchParams.get('storePurchase')==='true';
    const candidates=[...document.querySelectorAll(selector),...(storeReceipt?[...document.querySelectorAll('main a[href]')].filter(a=>new URL(a.href).pathname===location.pathname):[])];
    const groupPattern=/^\d+\s+(?:(?:canceled|cancelled|unavailable|not received|returned|refunded)\s+items?|shopped|substituted|weight adjusted)$/i;
    const groupHeaders=store==='Walmart'?[...document.querySelectorAll('body *')].filter(el=>groupPattern.test((el.innerText||'').trim().replace(/\s+/g,' '))&&!Array.from(el.children).some(child=>groupPattern.test((child.innerText||'').trim().replace(/\s+/g,' ')))):[];
    for(const link of new Set(candidates)){
      const url=new URL(link.href);const mapped=store==='HEB'||url.pathname.startsWith('/ip/');const productId=mapped?url.pathname.match(/\/(\d+)\/?$/)?.[1]:'';if(mapped&&!productId)continue;
      if(!link.getClientRects().length||getComputedStyle(link).visibility==='hidden')continue;
      const productName=(link.innerText||link.getAttribute('aria-label')||'').trim();if(!productName||/^prescription details$/i.test(productName))continue;
      let container=(store==='HEB'?link.closest('li'):null)||link.parentElement;
      for(let depth=0;container&&depth<7;depth++,container=container.parentElement){
        const body=container.innerText||'';if(store==='Walmart'&&/Multipack Quantity/i.test(body)&&! /\b(?:Qty|Wt|Weight)\s*:?\s*\d/i.test(body))continue;let q=quantity(body);if(!q&&storeReceipt&&Number.isFinite(receiptPrice(body,{quantity:1,unit:'each'}).lineTotal))q={quantity:1,unit:'each',quantityBasis:'receipt-line'};if(!q)continue;if(quantityRows(body)>1)break;
        const ids=new Set([...container.querySelectorAll(selector)].map(el=>new URL(el.href).pathname.match(/\/(\d+)\/?$/)?.[1]).filter(Boolean));
        if(mapped?(ids.size!==1||!ids.has(productId)):ids.size!==0)break;
        if(seen.has(container)||[...seen].some(previous=>previous.contains(container)||container.contains(previous)))break;seen.add(container);
        const name=productName;
        if(!name){warnings.push('An item had no readable product name.');break;}
        let excluded=/\b(?:returned|refunded|canceled|cancelled|not delivered|not received)\b/i.test(body);
        const precedingGroup=groupHeaders.filter(header=>header.compareDocumentPosition(link)&Node.DOCUMENT_POSITION_FOLLOWING).at(-1);
        if(precedingGroup&&/canceled|cancelled|unavailable|not received|returned|refunded/i.test(precedingGroup.innerText))excluded=true;
        for(let section=container.parentElement,depth=0;section&&depth<9;section=section.parentElement,depth++){
          const header=(section.innerText||'').slice(0,240).trim().replace(/\s+/g,' ');
          if(/^\d+\s+(?:canceled|cancelled|unavailable|not received|returned|refunded)\s+items?\b/i.test(header)){excluded=true;break;}
          if(/^\d+\s+(?:shopped|substituted|weight adjusted)\b/i.test(header))break;
        }
        let price={},priceContext=body;
        // Walmart puts the paid total beside, rather than inside, the name/Qty block.
        // Grow only within this exact product row, never into a sibling product.
        for(let scope=container,n=0;scope&&n<6;n++,scope=scope.parentElement){
          const scopeIds=new Set([...scope.querySelectorAll(selector)].map(el=>new URL(el.href).pathname.match(/\/(\d+)\/?$/)?.[1]).filter(Boolean));if(mapped?(scopeIds.size!==1||!scopeIds.has(productId)):scopeIds.size!==0)break;
          let paidBody=scope.innerText||'';if(quantityRows(paidBody)>1)break;priceContext=paidBody;for(const old of scope.querySelectorAll('s,del,.strike,[class*="line-through"]'))if(old.innerText)paidBody=paidBody.replace(old.innerText,'');const found=receiptPrice(paidBody,q);if(Number.isFinite(found.lineTotal)){price=found;break;}if(Number.isFinite(found.unitPrice))price=found;
        }
        if(!Number.isFinite(price.unitPrice))warnings.push('Receipt price unreadable for '+productId+': '+priceContext.split(/\n/).filter(line=>/\$|Qty|Wt|Was|savings|price/i.test(line)).join(' | ').slice(0,350));
        items.push({productId,name:name.slice(0,300),...q,...price,status:excluded?'returned':status});break;
      }
    }
    const expected=store==='Walmart'?text.match(/(\d+)\s+items delivered/i)?.[1]:null;
    if(!items.length)warnings.push('No item rows could be read. Expand the order items and try again.');
    // Badges may count individual quantities rather than rows; do not infer missing items.
    if(expected)warnings.push('Store reports '+expected+' items delivered; collected '+items.length+' product rows. Review substitutions and quantities.');
    if(/substitut/i.test(text))warnings.push('Substitutions are present. Review the received products before importing.');
    const subtotalMatch=text.match(/(?:^|\n)Subtotal(?:\s*\([^)]*\))?\s*\n?\s*\$([\d,]+\.\d{2})/i);const receiptSubtotal=subtotalMatch?Number(subtotalMatch[1].replaceAll(',','')):null;
    const discountMatch=store==='HEB'?text.match(/Your savings\s*\n?\s*-\$([\d,]+\.\d{2})/i):null;const receiptDiscount=discountMatch?Number(discountMatch[1].replaceAll(',','')):0;const totalMatch=text.match(/(?:^|\n)Total\s*\n?\s*\$([\d,]+\.\d{2})/i);const receiptTotal=totalMatch?Number(totalMatch[1].replaceAll(',','')):null;
    return {url:location.href,store,order:{orderId,purchasedAt,status,items,receiptSubtotal,receiptTotal,receiptDiscount,storePurchase:storeReceipt,receiptComplete:!controls().some(el=>/^Show items$/i.test(label(el)))},warnings,diagnostic:{dateFound:!!purchasedAt,itemRows:items.length,productLinks:document.querySelectorAll(selector).length,showItems:controls().some(el=>/^Show items$/i.test(label(el))),dateCandidates:(text.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2}/gi)||[]).slice(0,3)}};
  }
  const api={quantity,quantityRows,date,receiptPrice,storeFor,listing,clickRead,extract};
  if(typeof module!=='undefined')module.exports=api;else root.HistoryCollector=api;
  if(typeof chrome!=='undefined'&&chrome.runtime?.onMessage)chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(message.type!=='historyCollect')return;
    try{reply(message.action==='listing'?listing():message.action==='extract'?extract():clickRead(message.action,message.index));}catch{reply({error:'Could not read this order page.'});}
  });
})(globalThis);
