(() => {
 function read(id){try{
   const text=document.body.innerText;
   if(/verify you are human|robot or human|access denied|press & hold/i.test(text))throw Error('Complete the store human check');
   if(!location.pathname.endsWith('/'+id))throw Error('The requested product has not loaded');
   const name=document.querySelector('h1')?.innerText?.trim();if(!name)throw Error('Product name is still loading');
   const products=[];function walk(value){if(!value||typeof value!=='object')return;if([value['@type']].flat().includes('Product'))products.push(value);if(Array.isArray(value))value.forEach(walk);else if(value['@graph'])walk(value['@graph']);}
   for(const script of document.querySelectorAll('script[type="application/ld+json"]'))try{walk(JSON.parse(script.textContent));}catch{}
   const product=products.find(p=>p.name?.trim().toLowerCase()===name.toLowerCase())||products.find(p=>String(p.sku)===id)||(products.length===1?products[0]:null);
   const imageAddress=input=>{try{let url=new URL(input,location.href);if(url.searchParams.has('url')){const underlying=new URL(url.searchParams.get('url'),location.href);if(['images.heb.com','i5.walmartimages.com','i5.walmartimages.ca'].includes(underlying.hostname))url=underlying;}return url.protocol==='https:'&&['images.heb.com','i5.walmartimages.com','i5.walmartimages.ca'].includes(url.hostname)&&!/logo|sprite|banner/i.test(url.pathname)?url.href:null;}catch{return null;}};
   const normalize=text=>text.toLowerCase().replace(/[^a-z0-9]/g,'');
   const matchingImages=[...document.querySelectorAll('img')].filter(img=>img.alt&&normalize(img.alt).includes(normalize(name)));
   const candidates=[...[product?.image].flat().map(value=>typeof value==='string'?value:value?.url||value?.contentUrl),document.querySelector('meta[property="og:image"]')?.content,document.querySelector('meta[name="twitter:image"]')?.content,document.querySelector('link[rel="image_src"]')?.href,...matchingImages.flatMap(img=>[img.currentSrc,img.src,...(img.srcset||'').split(',').map(s=>s.trim().split(/\s+/)[0])])];
   const imageUrl=candidates.map(imageAddress).find(Boolean)||null;
   const offers=[product?.offers].flat().filter(Boolean),offer=offers.find(o=>o.priceCurrency==='USD'&&Number.isFinite(Number(o.price)));
   const priceElement=document.querySelector('[itemprop="price"]');let price=offer?Number(offer.price):Number(priceElement?.getAttribute('content')||priceElement?.textContent.replace(/[^0-9.]/g,''));
   if(!price&&location.hostname==='www.walmart.com'){const visible=document.querySelector('[data-testid="price-wrap"]')?.innerText?.match(/(?:current price|Now)?\s*\$\s*(\d+(?:\.\d{2})?)/i);if(visible)price=Number(visible[1]);}
   if(!Number.isFinite(price)||price<=0||price>=100000||!text.replace(/\s/g,'').includes('$'+price.toFixed(2)))return {id,name,imageUrl,error:'Could not confirm a visible current price for this product'};
   const priceScope=priceElement?.closest('[data-testid="price-wrap"]')||document.querySelector('[data-testid="price-wrap"]')||priceElement?.parentElement;
   const localText=priceScope?.innerText||'';
   const escaped=price.toFixed(2).replace('.', '\\.');const pricedByWeight=new RegExp('\\$\\s*'+escaped+'\\s*(?:/|per\\s+)(lb|pound|oz|ounce)\\b','i').exec(localText);
   const priceUnit=pricedByWeight?(/lb|pound/i.test(pricedByWeight[1])?'lb':'oz'):/\b(?:avg|average|final cost by weight|priced by weight)\b/i.test(name+' '+localText)?'unknown':'each';
   const promotion=localText.split('\n').map(t=>t.trim()).filter(t=>/rollback|sale|coupon|buy\s+\d|save\s*\$|\d+\s+for\s*\$/i.test(t)).slice(0,3).join(' · ').slice(0,300)||null;
   const validUntil=offer?.priceValidUntil&&Number.isFinite(Date.parse(offer.priceValidUntil))?new Date(offer.priceValidUntil).toISOString():null;
   const available=offer?.availability?/\/InStock$|\/LimitedAvailability$/i.test(offer.availability):null;
   return {id:id,name,price,priceUnit,promotion,validUntil,available,basis:'displayed-product-price',url:location.origin+location.pathname,at:new Date().toISOString(),imageUrl};
  }catch(error){return {error:error.message};}}
 window.StoreProductDetails={read};
 chrome.runtime.onMessage.addListener((message,sender,reply)=>{if(['readStorePrice','readStoreProduct'].includes(message.type))reply(read(message.id));});
})();
