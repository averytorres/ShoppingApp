(() => {
  const money=value=>new Intl.NumberFormat(undefined,{style:'currency',currency:'USD'}).format(value);
  let page=0,signature='',historyClient;const size=12,opened=new Set();
  window.renderPurchaseHistory=()=>{
    if(historyClient!==selectedAccount){historyClient=selectedAccount;page=0;}
    const store=$('history-store').value,query=$('history-search').value.trim().toLowerCase();const all=(state.purchases||[]).filter(p=>p.client===selectedAccount);const filtered=all.filter(p=>(store==='all'||p.store===store)&&(!query||p.items.some(i=>i.name.toLowerCase().includes(query))));
    page=Math.min(page,Math.max(0,Math.ceil(filtered.length/size)-1));const next=JSON.stringify({account:selectedAccount,filtered,page,pending:state.purchaseCompletions});if(next===signature)return;signature=next;
    $('pending-purchases').replaceChildren();for(const p of (state.purchaseCompletions||[]).filter(p=>p.client===selectedAccount)){const row=node('section',undefined,'panel');row.append(node('strong',(p.store==='HEB'?'H-E-B':'Walmart')+' · waiting for receipt'),node('p','Checkout marked complete '+new Date(p.at).toLocaleString()+'. This shop will enter history and spending once its receipt is collected.'));if(p.method==='manual'){const undo=node('button','Undo completion');undo.onclick=async()=>{try{await api('/api/purchase-complete/undo',{target:selectedAccount,id:p.id});await refresh();}catch(error){notice(error.message);}};row.append(undo);}$('pending-purchases').append(row);}
    $('history-summary').textContent=filtered.length+' of '+all.length+' completed purchases · '+all.filter(p=>p.store==='HEB').length+' H-E-B / '+all.filter(p=>p.store==='Walmart').length+' Walmart';$('history').replaceChildren();
    for(const purchase of filtered.slice(page*size,(page+1)*size)){
      const card=node('details',undefined,'purchase-card');const openKey=selectedAccount+'|'+purchase.id;card.open=opened.has(openKey);card.ontoggle=()=>{if(card.isConnected){if(card.open)opened.add(openKey);else opened.delete(openKey);}};const summary=node('summary');summary.append(node('span',purchase.store==='HEB'?'H-E-B':'Walmart','store-tag'),node('strong',new Date(purchase.created).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric',timeZone:purchase.source==='history-import'?'UTC':undefined})),node('small',purchase.items.length+' products · view items'));card.append(summary);
      const receipt=purchase.receipt;card.append(node('p',receipt?.state==='verified'&&Number.isFinite(receipt.total)?'Order total: '+money(receipt.total)+' · includes taxes, fees and tips.':'Order total not yet collected.','fine'));
      const list=node('ul');for(const item of purchase.items)list.append(node('li',(item.unit&&item.unit!=='each'?item.quantity+' '+item.unit+' · ':item.quantity+' × ')+item.name+(Number.isFinite(item.lineTotal)?' — '+money(item.lineTotal):'')));card.append(list);$('history').append(card);
    }
    if(!filtered.length)$('history').append(node('p',all.length?'No purchases match this search.':'No completed purchases yet. Check for new purchases in Settings, or import older receipts below.','empty'));
    $('history-pagination').replaceChildren();if(filtered.length>size){const back=node('button','← Previous'),forward=node('button','Next →');back.disabled=page===0;forward.disabled=(page+1)*size>=filtered.length;const move=delta=>{page+=delta;signature='';window.renderPurchaseHistory();$('history-summary').scrollIntoView({block:'center',behavior:'smooth'});};back.onclick=()=>move(-1);forward.onclick=()=>move(1);$('history-pagination').append(back,node('span','Page '+(page+1)+' of '+Math.ceil(filtered.length/size)),forward);}
  };
  for(const id of ['history-search','history-store'])$(id).addEventListener(id==='history-search'?'input':'change',()=>{page=0;signature='';window.renderPurchaseHistory();});
  window.renderPurchaseHistory();
})();
