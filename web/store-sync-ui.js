(() => {
 let signature='',previous=new Map();
 function coupons(){
  let host=$('heb-coupons');if(!host){host=node('section',undefined,'coupon-summary');host.id='heb-coupons';$('checkout-link').before(host);}
  host.hidden=state.preferredStore!=='HEB';if(host.hidden)return;const detailsOpen=host.querySelector('details')?.open;host.replaceChildren(node('h3','H-E-B coupons'));
  const cart=(state.hebCarts||[]).find(c=>c.client===selectedAccount)?.lines||[],ids=new Set(cart.map(i=>i.id)),check=(state.hebCoupons||[]).find(c=>c.client===selectedAccount);
  if(check?.running&&Date.now()-Date.parse(check.at)<300000){host.append(node('p','Checking coupons · '+check.processed+' of '+check.total+' products','fine'));const p=node('progress');p.max=check.total||1;p.value=check.processed;p.setAttribute('aria-label','Checking H-E-B coupons');host.append(p);}
  else if(check?.running)host.append(node('p','The coupon check was interrupted. Choose Check coupons now to retry.','fine'));
  else if(!cart.length)host.append(node('p','Coupons are clipped automatically when you add H-E-B items.','fine'));
  else if(check){
   const items=check.items.filter(i=>ids.has(i.id)),coverage=ShoppingGuidance.couponCoverage(check,cart),offers=new Map();
   for(const item of items)for(const coupon of item.coupons){const old=offers.get(coupon.id);const entry={...coupon,checkedAt:item.checkedAt};if(!old||(Date.parse(entry.checkedAt)||0)>(Date.parse(old.checkedAt)||0)||entry.checkedAt===old.checkedAt&&entry.applied)offers.set(coupon.id,entry);}
   const count=[...offers.values()].filter(c=>c.status==='clipped').length;
   host.append(node('p',count?count+' coupon'+(count===1?'':'s')+' saved for these items.':check.error?'Coupon check incomplete.':coverage.checked?'No coupons found for the '+coverage.checked+' checked products.':'These cart items have not been checked yet.','fine'));
   host.append(node('p',coverage.checked+' of '+coverage.total+' current products checked at their current quantity.','fine'));
   if(!coverage.sameCart)host.append(node('p','The cart differs from the last completed check. Recheck coupon eligibility for this cart.','fine'));
   if(check.error)host.append(node('p','Coupon check needs attention: '+check.error,'fine'));
   const details=node('details'),summary=node('summary','Coupon details');details.open=!!detailsOpen;details.append(summary);
   for(const c of offers.values()){const row=node('p'),a=node('a',c.offer);a.href=c.url;a.target='_blank';a.rel='noopener noreferrer';const when=c.checkedAt?new Date(c.checkedAt).toLocaleString():null;row.append(a,node('span',' · '+(c.applied?'Savings applied when checked':'Clipped · requirements may apply')));details.append(row,node('p',when?'Checked '+when:'Checked earlier; refresh to verify current eligibility.','fine'));if(c.requirements)details.append(node('p',c.requirements,'fine'));}
   details.append(node('p','Saved coupons are potential savings. Eligibility can change with cart edits, quantities, expiration and substitutions. Confirm the final discount at H-E-B checkout.','fine'));host.append(details);
  }else host.append(node('p','The helper will check coupons for items in your H-E-B cart.','fine'));
  const button=node('button','Check coupons now');button.className='secondary full';button.disabled=!cart.length||!!(check?.running&&Date.now()-Date.parse(check.at)<300000);button.onclick=async()=>{button.disabled=true;try{await api('/api/heb/coupons/check',{target:selectedAccount});notice('H-E-B coupon check requested. Your PC helper will clip available offers.');await refresh();}catch(e){notice(e.message);button.disabled=false;}};host.append(button);
 }
 function comparePrices(){
  const host=$('current-price-comparisons');if(!host)return;host.replaceChildren();let found=0;
  for(const item of CurrentPriceComparisons.compare(state,selectedAccount)){
   const row=node('div',undefined,'stat-driver'),info=node('div');info.append(node('strong',item.name));
   for(const p of [item.heb,item.walmart]){const link=node('a',(p.store==='HEB'?'H-E-B':'Walmart')+' $'+p.price.toFixed(2)+' · '+p.name);link.href=p.url;link.target='_blank';link.rel='noopener noreferrer';const line=node('p');line.append(link);info.append(line,node('p','Checked '+new Date(p.at).toLocaleString()+(p.promotion?' · Offer: '+p.promotion:''),'fine'));}
   info.append(node('p',item.percent>=1?'At the checked prices, '+(item.cheaper.store==='HEB'?'H-E-B':'Walmart')+' was '+Math.round(item.percent)+'% less for the same matched amount.':'Similar prices for the same matched amount.','fine'));info.append(node('p','Comparison uses saved package-size equivalents. Potential item savings exclude delivery charges, tax and checkout coupons; confirm the final store price.','fine'));row.append(info);host.append(row);found++;
  }
  if(!found)host.append(node('p','No fresh comparable prices yet. Check matched prices at both stores above. Your PC browser collects them without changing either cart.','fine'));
 }
 window.renderStoreSync=()=>{
  coupons();
  comparePrices();$('photo-cache-status').textContent=(state.productImages||[]).filter(p=>p.store===state.preferredStore).length+' '+(state.preferredStore==='HEB'?'H-E-B':'Walmart')+' product photos cached on this PC.';if(document.activeElement!==$('heb-ripeness'))$('heb-ripeness').value=state.hebPreferences?.ripeness||'No preference';
  const tasks=(state.storeTasks||[]).filter(t=>t.client===selectedAccount),next=JSON.stringify(tasks);if(next===signature)return;signature=next;
  let activeBox=$('store-task-progress');const active=tasks.find(t=>t.state==='running');
  if(active){if(!activeBox){activeBox=node('aside',undefined,'store-task-progress');activeBox.id='store-task-progress';activeBox.setAttribute('role','status');document.body.append(activeBox);}activeBox.replaceChildren(node('span',(active.store==='HEB'?'H-E-B':'Walmart')+(active.kind==='prices'?' price check':active.kind==='photos'?' photo collection':' history sync')+' in progress'),node('progress'));activeBox.hidden=false;}else if(activeBox)activeBox.hidden=true;
  for(const t of tasks)if(previous.get(t.id)==='running'&&['finished','needs-attention'].includes(t.state))window.SyncFeedback?.toast(t.store+(t.state==='finished'?' sync complete.':' sync needs attention. Open Settings.'),t.state!=='finished');
  previous=new Map(tasks.map(t=>[t.id,t.state]));$('history-sync-tasks').replaceChildren();
  for(const t of tasks.slice(0,6)){
   const row=node('div',undefined,'panel'),status={queued:'Waiting for your PC browser',running:'Checking '+(t.kind==='prices'?'store prices':t.kind==='photos'?'product photos':'purchase history'),finished:'Up to date','needs-attention':'Needs attention'}[t.state];
   row.append(node('strong',(t.store==='HEB'?'H-E-B':'Walmart')+' '+(t.kind==='prices'?'prices':t.kind==='photos'?'photos':'history')+' · '+status),node('p',new Date(t.updated).toLocaleString(),'fine'));
   if(t.state==='running'){const progress=node('progress');progress.setAttribute('aria-label','Checking '+t.store);row.append(progress);}
   if(t.result)row.append(node('p',t.result.error||(['prices','photos'].includes(t.kind)?(t.result.checked||0)+' of '+(t.result.total||t.payload.items?.length||0)+(t.kind==='photos'?' photos found'+(t.result.unavailable?' · '+t.result.unavailable+' not available yet':''):' prices checked'):(t.result.read||0)+' new or incomplete receipts checked · '+(t.result.skipped||0)+' already verified receipts skipped')));
   if(t.state==='needs-attention'){const retry=node('button','Retry '+(t.store==='HEB'?'H-E-B':'Walmart'));retry.onclick=async()=>{try{await api('/api/store-tasks/retry',{id:t.id});await refresh();}catch(e){notice(e.message);}};row.append(retry);}
   $('history-sync-tasks').append(row);
  }
 };
 $('heb-ripeness').onchange=async()=>{try{await api('/api/heb/preferences',{ripeness:$('heb-ripeness').value});notice('H-E-B ripeness preference saved.');await refresh();}catch(e){notice(e.message);}};
 $('history-sync-now').onclick=async()=>{const button=$('history-sync-now');button.disabled=true;try{await api('/api/history-sync/start',{client:selectedAccount,force:true});$('history-sync-status').textContent='Both stores queued. You can keep using the site while the PC checks for new receipts.';await refresh();}catch(e){$('history-sync-status').textContent=e.message;}finally{button.disabled=false;}};
 $('current-prices-refresh').onclick=async()=>{const button=$('current-prices-refresh');button.disabled=true;try{const result=await api('/api/store-prices/compare',{client:selectedAccount});$('current-prices-status').textContent=result.count+' matched products queued across both stores. Progress appears here while your PC browser checks prices.';await refresh();}catch(e){$('current-prices-status').textContent=e.message;}finally{button.disabled=false;}};
 $('collect-photos').onclick=async()=>{const button=$('collect-photos');button.disabled=true;try{const result=await api('/api/product-photos/collect',{client:selectedAccount,store:state.preferredStore});$('photo-collect-status').textContent=result.count?result.count+' products queued. The PC helper collects photos without changing your cart.':'All saved products at this store already have a cached photo.';await refresh();}catch(e){$('photo-collect-status').textContent=e.message;}finally{button.disabled=false;}};
 window.renderStoreSync();
})();
