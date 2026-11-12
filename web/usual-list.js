(() => {
  let draft;
  const cadence=days=>days<=2?'Daily':days<=4?'Every few days':days<=10?'Weekly':days<=20?'Every two weeks':days<=45?'Monthly':'Occasionally';
  const evidence=()=>JSON.stringify((state.usualSuggestions||state.suggestions||[]).filter(i=>i.client===selectedAccount&&i.store===state.preferredStore));
  const amount=item=>item.unit==='each'?Math.min(100,Math.max(1,Math.round(item.quantity||1))):1;
  function build(){
    const current=selectedLines();
    const rows=(state.usualSuggestions||state.suggestions||[]).filter(item=>item.client===selectedAccount&&!current.some(line=>line.id===item.id&&line.quantity>0)).map(item=>({...item,amount:amount(item),checked:!item.needsMatch&&item.confidence==='established'&&item.daysUntil>=-item.intervalDays*2}));
    draft={client:selectedAccount,store:state.preferredStore,day:HouseholdCalendar.today(),evidence:evidence(),rows};renderDraft();
  }
  function renderDraft(){
    const host=$('usual-draft');host.hidden=false;host.replaceChildren();
    const store=draft.store==='HEB'?'H-E-B':'Walmart';
    host.append(node('h3','Review your usual list'),node('p','For '+(state.clients.find(c=>c.id===draft.client)?.name||'this account')+' · '+store+'. Items due now or in the next 7 days. Nothing changes in your cart until you accept.','fine'));
    host.append(node('p','Based on at least three purchase days. Less certain or long-overdue patterns start unchecked. Quantities count packages or individual items; weighed products start at 1 for you to review.','fine'));
    if(!draft.rows.length)host.append(node('p','Nothing looks due in the next week, or those items are already in your cart. You can still add products below.','fine'));
    const status=node('p',undefined,'fine');status.setAttribute('role','status');
    const accept=node('button','Add selected to '+store+' cart','primary');
    const update=()=>{const count=draft.rows.filter(row=>row.checked).length;accept.textContent='Add '+count+' selected to '+store+' cart';accept.disabled=!count;};
    for(const group of ['Daily','Every few days','Weekly','Every two weeks','Monthly','Occasionally']){
      const items=draft.rows.filter(item=>cadence(item.intervalDays)===group);if(!items.length)continue;
      host.append(node('h4',group));
      for(const item of items){
        const row=node('div',undefined,'usual-row'),label=node('label'),check=node('input');check.type='checkbox';check.checked=item.checked;
        const available=!item.needsMatch&&(draft.store==='HEB'||state.products.some(product=>product.id===item.id&&product.offerId));check.disabled=!available;if(!available)item.checked=false;
        check.onchange=()=>{item.checked=check.checked;update();};label.append(check,node('span',item.name));
        const detail=node('small',(item.daysUntil>0?'Due in about '+item.daysUntil+' days':'Due now')+' · usually every '+item.intervalDays+' days · '+item.purchaseCount+' purchase days'+(!available?' · Match/connect this product in Settings first':item.unit!=='each'?' · Bought by weight; review package count':''),'fine');
        const info=node('div');info.append(label,detail);if(item.matchKind==='substitute')info.append(node('small',item.matchNote||'Alternative product: review the type and quantity.','fine'));const quantity=node('input');quantity.type='number';quantity.min=1;quantity.max=100;quantity.step=1;quantity.value=item.amount;quantity.disabled=!available;quantity.setAttribute('aria-label','Draft quantity for '+item.name);quantity.oninput=()=>{item.amount=Number(quantity.value);};row.append(info,quantity);host.append(row);
      }
    }
    accept.onclick=async()=>{
      try{
        if(selectedAccount!==draft.client||state.preferredStore!==draft.store)throw Error('The account or store changed. Build a new usual list before accepting.');
        const chosen=draft.rows.filter(row=>row.checked);if(!chosen.length||chosen.length>100)throw Error('Choose between 1 and 100 items.');
        if(chosen.some(row=>!Number.isInteger(row.amount)||row.amount<1||row.amount>100))throw Error('Use whole quantities from 1 to 100.');
        accept.disabled=true;
        // Refresh before submitting so accepting never reduces quantities already in the cart.
        const latest=await api('/api/state');
        if(latest.preferredStore!==draft.store)throw Error('The store changed elsewhere. Build a new usual list.');
        const lines=draft.store==='HEB'?hebLines(latest,draft.client):latest.list.filter(line=>line.client===draft.client);
        const items=chosen.map(row=>({id:row.id,quantity:Math.max(row.amount,lines.find(line=>line.id===row.id)?.quantity||0)}));
        await api(draft.store==='HEB'?'/api/heb/list':'/api/repeat',{target:draft.client,items});
        host.hidden=true;draft=null;await refresh();notice('Your reviewed list was sent to '+store+'. You can continue changing items and quantities in the cart.');$('cart-details').open=true;
      }catch(error){status.textContent=error.message;update();}
    };
    const cancel=node('button','Discard draft','secondary');cancel.onclick=()=>{draft=null;host.hidden=true;};const actions=node('div',undefined,'usual-actions');actions.append(accept,cancel);host.append(status,actions);update();
  }
  window.refreshUsualDraftTiming=()=>{if(!draft||$('usual-draft').hidden)return;let warning=$('usual-draft-aged');if(!warning){warning=node('p',undefined,'fine');warning.id='usual-draft-aged';$('usual-draft').prepend(warning);}const olderDay=draft.day!==HouseholdCalendar.today(),changed=olderDay||draft.evidence!==evidence();warning.hidden=!changed;warning.textContent=(olderDay?'This draft was built on a previous day.':'Your routine data changed while this draft was open.')+' Your edits are preserved; choose Suggest a shopping list again for updated timing.';};
  $('build-usual').onclick=build;
})();
