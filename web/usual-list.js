(() => {
  let draft;
  const evidence=()=>JSON.stringify((state.usualSuggestions||state.suggestions||[]).filter(i=>i.client===selectedAccount&&i.store===state.preferredStore));
  const amount=ShoppingGuidance.startingAmount;
  function build(){
    const current=selectedLines();
    const rows=(state.usualSuggestions||state.suggestions||[]).filter(item=>item.client===selectedAccount&&item.store===state.preferredStore&&!current.some(line=>line.id===item.id&&line.quantity>0)).map(item=>({...item,amount:amount(item),checked:ShoppingGuidance.group(item)==='regular'&&item.matchKind!=='substitute'&&item.daysUntil>=-item.intervalDays*2}));
    draft={client:selectedAccount,store:state.preferredStore,day:HouseholdCalendar.today(),evidence:evidence(),rows};renderDraft();
  }
  function renderDraft(){
    const host=$('usual-draft');host.hidden=false;host.replaceChildren();
    const store=draft.store==='HEB'?'H-E-B':'Walmart';
    host.append(node('h3','Review your usual list'),node('p','For '+(state.clients.find(c=>c.id===draft.client)?.name||'this account')+' · '+store+'. Past timing suggests checking these now or within the next 7 days; older habits are separate. Nothing changes in your cart until you accept.','fine'));
    host.append(node('p','Based on purchases, not home inventory. Only recent, fairly regular restocks start checked. Review the other suggestions and starting quantities before accepting.','fine'));
    if(!draft.rows.length)host.append(node('p','No suggestions to review for the next week, or those items are already in your cart. You can still add products below.','fine'));
    const status=node('p',undefined,'fine');status.setAttribute('role','status');
    const accept=node('button','Add selected to '+store+' cart','primary');
    const update=()=>{const count=draft.rows.filter(row=>row.checked).length;accept.textContent='Add '+count+' selected to '+store+' cart';accept.disabled=!count;};
    for(const group of ShoppingGuidance.groups){
      const items=draft.rows.filter(item=>ShoppingGuidance.group(item)===group.id);if(!items.length)continue;
      const section=node(['older','match'].includes(group.id)?'details':'section',undefined,'usual-group');section.dataset.group=group.id;
      section.append(node(section.tagName==='DETAILS'?'summary':'h4',group.title+' · '+items.length),node('p',group.description,'fine'));host.append(section);
      for(const item of items){
        const row=node('div',undefined,'usual-row'),label=node('label'),check=node('input');check.type='checkbox';check.checked=item.checked;
        const available=!item.needsMatch&&(draft.store==='HEB'||state.products.some(product=>product.id===item.id&&product.offerId));check.disabled=!available;if(!available)item.checked=false;
        check.onchange=()=>{item.checked=check.checked;update();};label.append(check,node('span',item.name));
        const detail=node('small','Last bought '+HouseholdCalendar.elapsed(item.lastPurchasedDay??Date.parse(item.lastPurchasedAt.slice(0,10)))+' days ago · typical gap '+item.intervalDays+' days · '+ShoppingGuidance.reliabilityLabel(item)+(!available?' · Choose a product first':''),'fine');
        const basis=node('details',undefined,'fine');basis.append(node('summary','Timing & quantity details'),node('p','Based on '+item.purchaseCount+' purchase days within the last year. '+ShoppingGuidance.quantityNote(item)));
        const info=node('div');info.append(label,detail);if(item.unit!=='each')info.append(node('small','Item/package count, not pounds.','fine'));info.append(basis);if(item.matchKind==='substitute')info.append(node('small',item.matchNote||'Alternative product: review the type and quantity.','fine'));const quantity=node('input');quantity.type='number';quantity.min=1;quantity.max=100;quantity.step=1;quantity.value=item.amount;quantity.disabled=!available;quantity.setAttribute('aria-label','Draft quantity for '+item.name);quantity.oninput=()=>{item.amount=Number(quantity.value);};row.append(info,quantity);section.append(row);
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
