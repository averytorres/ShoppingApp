(() => {
 let signature='',previous=new Map();
 function comparePrices(){
  const host=$('current-price-comparisons');if(!host)return;host.replaceChildren();let found=0;
  for(const item of CurrentPriceComparisons.compare(state,selectedAccount)){
   const row=node('div',undefined,'stat-driver'),info=node('div');info.append(node('strong',item.name));
   for(const p of [item.heb,item.walmart]){const link=node('a',(p.store==='HEB'?'H-E-B':'Walmart')+' $'+p.price.toFixed(2)+' · '+p.name);link.href=p.url;link.target='_blank';link.rel='noopener noreferrer';const line=node('p');line.append(link);info.append(line,node('p','Checked '+new Date(p.at).toLocaleString()+(p.promotion?' · Offer: '+p.promotion:''),'fine'));}
   info.append(node('p',item.percent>=1?(item.cheaper.store==='HEB'?'H-E-B':'Walmart')+' is '+Math.round(item.percent)+'% less for the same matched amount.':'Similar prices for the same matched amount.','fine'));row.append(info);host.append(row);found++;
  }
  if(!found)host.append(node('p','No fresh comparable prices yet. Check matched prices at both stores above. Your PC browser collects them without changing either cart.','fine'));
 }
 window.renderStoreSync=()=>{
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
