(() => {
  let draft,sending=false,syncDraftControls=()=>{};const contextDisabled=new WeakMap();
  const evidence=()=>JSON.stringify({items:(state.usualSuggestions||state.suggestions||[]).filter(i=>i.client===selectedAccount&&i.store===state.preferredStore),snoozes:(state.itemSnoozes||[]).filter(i=>i.client===selectedAccount)});
  const amount=ShoppingGuidance.startingAmount;
  function applyStartingSelection(){
    const focused=draft.mode==='focused',limit=focused?5:(state.recommendationMethod==='category-cycle'?15:30);
    const eligible=draft.rows.filter(item=>item.automaticSuggestionEligible!==false&&!item.needsMatch&&item.matchKind!=='substitute'&&!item.snoozed&&!ShoppingAssist.isSnoozed(state,item)&&
      !(state.currentPrices||[]).some(p=>p.client===draft.client&&p.store===draft.store&&p.id===item.id&&ShoppingAssist.availabilityFresh(p)&&p.available===false)&&
      (focused?ShoppingGuidance.group(item)!=='older'&&(Number.isFinite(item.focusedScore)||ShoppingGuidance.startSelected(item)):ShoppingGuidance.startSelected(item)))
      .sort((a,b)=>(focused?(b.focusedScore??b.nextShopScore??0)-(a.focusedScore??a.nextShopScore??0):(b.nextShopScore||0)-(a.nextShopScore||0))||String(a.householdItemId||a.id).localeCompare(String(b.householdItemId||b.id)));
    const selected=new Set(eligible.slice(0,limit));
    for(const row of draft.rows)row.checked=selected.has(row);
  }
  function build(){
    if(sending)return;
    if(state.recommendationMethod==='category-cycle'&&state.recommendationStatus?.clients?.[selectedAccount]?.status==='updating'){notice('Your category + cycle suggestions are updating. Please try again in a moment.');return;}
    const current=selectedLines();
    const rows=(state.usualSuggestions||state.suggestions||[]).filter(item=>item.client===selectedAccount&&item.store===state.preferredStore&&!ShoppingAssist.isSnoozed(state,item)&&!current.some(line=>line.id===item.id&&line.quantity>0)).map(item=>({...item,amount:amount(item),checked:ShoppingGuidance.startSelected(item)}));
    draft={client:selectedAccount,store:state.preferredStore,day:HouseholdCalendar.today(),evidence:evidence(),mode:'broader',rows};applyStartingSelection();renderDraft();
  }
  function renderDraft(){
    const reviewedDraft=draft,host=$('usual-draft');host.hidden=false;host.replaceChildren();
    const store=draft.store==='HEB'?'H-E-B':'Walmart';
    host.append(node('h3','Review your usual list'),node('p','For '+(state.clients.find(c=>c.id===draft.client)?.name||'this account')+' · '+store+'. Recent purchase patterns suggest checking these before your next shop; older habits are separate. Nothing changes in your cart until you accept.','fine'));
    host.append(node('p','Based on purchases, not home inventory. Items with stronger recent purchase evidence start checked, even when timing varies. Review the other suggestions and starting quantities before accepting.','fine'));
    const selection=node('div',undefined,'usual-selection'),mode=node('select');mode.id='usual-selection-mode';
    for(const [value,text]of [['broader','Broader · up to 30 starting items'],['focused','Focused · up to 5 starting items']]){const option=node('option',text);option.value=value;mode.append(option);}
    mode.value=draft.mode||'broader';const modeLabel=node('label','Starting selection');modeLabel.htmlFor=mode.id;
    mode.onchange=()=>{if(sending||draft.client!==selectedAccount||draft.store!==state.preferredStore){mode.value=draft.mode;return;}draft.mode=mode.value;applyStartingSelection();renderDraft();};selection.append(modeLabel,mode);host.append(selection,node('p','Changing the starting selection updates the checkboxes and keeps your quantity edits. All other suggestions remain available to choose.','fine'));
    if(!draft.rows.length)host.append(node('p','No suggestions to review for the next week, or those items are already in your cart. You can still add products below.','fine'));
    if(draft.removed?.length){const undo=node('button','Undo last removal','secondary');undo.onclick=()=>{const removed=draft.removed.pop();draft.rows.splice(removed.index,0,removed.item);renderDraft();};host.append(undo);}
    const status=node('p',undefined,'fine');status.setAttribute('role','status');
    const accept=node('button','Add selected to '+store+' cart','primary');
    const update=()=>{const count=draft.rows.filter(row=>row.checked).length;accept.textContent='Add '+count+' selected to '+store+' cart';accept.disabled=sending||!count||selectedAccount!==draft.client||state.preferredStore!==draft.store;};
    const product=item=>({name:item.name||'Choose product'}),enabled=item=>!item.needsMatch&&(draft.store==='HEB'||state.products.some(p=>p.id===item.id&&p.offerId))&&!(state.currentPrices||[]).some(p=>p.client===draft.client&&p.store===draft.store&&p.id===item.id&&ShoppingAssist.availabilityFresh(p)&&p.available===false);
    const renderItems=(items,parent,suffix='')=>window.categoryReview(items.filter(i=>!i.snoozed&&!ShoppingAssist.isSnoozed(state,i)),parent,{product,enabled,checked:i=>i.checked,select:(i,value)=>{i.checked=value;},redraw:renderDraft,suffix,render:(item,section)=>{
        const row=node('div',undefined,'usual-row'),label=node('label'),check=node('input');check.type='checkbox';check.checked=item.checked;
        const unavailable=(state.currentPrices||[]).some(p=>p.client===draft.client&&p.store===draft.store&&p.id===item.id&&ShoppingAssist.availabilityFresh(p)&&p.available===false);const available=!unavailable&&!item.needsMatch&&(draft.store==='HEB'||state.products.some(product=>product.id===item.id&&product.offerId));check.disabled=!available;if(!available){item.checked=false;check.checked=false;}
        check.onchange=()=>{item.checked=check.checked;update();};label.append(check,node('span',item.name));
        const detail=node('small','Last bought '+HouseholdCalendar.elapsed(item.lastPurchasedDay??Date.parse(item.lastPurchasedAt.slice(0,10)))+' days ago · typical gap '+item.intervalDays+' days · '+ShoppingGuidance.reliabilityLabel(item)+(!available?(unavailable?' · Unavailable when checked':' · Choose a product first'):''),'fine');
        const basis=node('details',undefined,'fine');basis.open=!!item.evidenceOpen;basis.ontoggle=()=>{if(basis.isConnected)item.evidenceOpen=basis.open;};basis.append(node('summary','Timing & quantity details'),node('p','Based on '+item.purchaseCount+' purchase days within the last year. '+(draft.mode==='focused'&&item.focusedReason?item.focusedReason+' ':'')+(item.recommendationReason||'')+' '+ShoppingGuidance.quantityNote(item)));
        const info=node('div');info.append(label,detail);if(item.unit!=='each')info.append(node('small','Item/package count, not pounds.','fine'));info.append(basis);if(item.matchKind==='substitute')info.append(node('small',item.matchNote||'Alternative product: review the type and quantity.','fine'));const quantity=node('input');quantity.type='number';quantity.min=1;quantity.max=100;quantity.step=1;quantity.value=item.amount;quantity.disabled=!available;quantity.setAttribute('aria-label','Draft quantity for '+item.name);quantity.oninput=()=>{item.amount=Number(quantity.value);};if(item.id&&window.snoozeControl)info.append(window.snoozeControl(item,()=>{item.checked=false;item.snoozed=true;if(draft===reviewedDraft)renderDraft();}));window.decorateShoppingProduct?.(info,item,candidate=>{Object.assign(item,{id:candidate.id,name:candidate.name,unit:(state.itemCatalog||[]).find(p=>p.client===draft.client&&p.store===draft.store&&p.productId===candidate.id)?.unit||'each',amount:candidate.chosenQuantity||1,needsMatch:false,checked:true,quantityNote:'Replacement you chose; review its package size and starting amount.'});renderDraft();});const remove=node('button','Remove','text-button');remove.setAttribute('aria-label','Remove '+item.name+' from suggested list');remove.onclick=()=>{(draft.removed||=[]).push({item,index:draft.rows.indexOf(item)});draft.rows=draft.rows.filter(i=>i!==item);renderDraft();};row.append(info,window.quantityControls(quantity),remove);section.append(row);

    }});
    renderItems(draft.rows.filter(i=>i.checked||ShoppingGuidance.group(i)!=='older'),host);
    const older=draft.rows.filter(i=>!i.checked&&ShoppingGuidance.group(i)==='older');if(older.length){const details=node('details',undefined,'usual-group');details.dataset.group='older';details.open=!!draft.olderOpen;details.append(node('summary','Older habits · '+older.length));details.ontoggle=()=>{if(details.isConnected)draft.olderOpen=details.open;};renderItems(older,details,' older habits');host.append(details);}
    accept.onclick=async()=>{
      if(sending)return;const submitted=draft,disabledBefore=new Map();
      try{
        if(selectedAccount!==submitted.client||state.preferredStore!==submitted.store)throw Error('The account or store changed. Build a new usual list before accepting.');
        const chosen=submitted.rows.filter(row=>row.checked).map(row=>({...row}));if(!chosen.length||chosen.length>100)throw Error('Choose between 1 and 100 items.');
        if(chosen.some(row=>!Number.isInteger(row.amount)||row.amount<1||row.amount>100))throw Error('Use whole quantities from 1 to 100.');
        sending=true;$('build-usual').disabled=true;for(const control of host.querySelectorAll('input,button,select')){disabledBefore.set(control,control.disabled);control.disabled=true;}
        const latest=await api('/api/state');
        if(draft!==submitted||selectedAccount!==submitted.client||state.preferredStore!==submitted.store)throw Error('The account or store changed. Review the draft again.');
        if(latest.preferredStore!==submitted.store)throw Error('The store changed elsewhere. Build a new usual list.');
        if(chosen.some(row=>ShoppingAssist.isSnoozed(latest,row)))throw Error('An item was marked as already stocked while this draft was open. Show it again or build a fresh review.');
        if(chosen.some(row=>(latest.currentPrices||[]).some(p=>p.client===submitted.client&&p.store===submitted.store&&p.id===row.id&&ShoppingAssist.availabilityFresh(p)&&p.available===false)))throw Error('A selected product is now unavailable. Build a fresh review and choose an alternative.');
        const lines=submitted.store==='HEB'?hebLines(latest,submitted.client):latest.list.filter(line=>line.client===submitted.client);
        const combined=new Map();for(const row of chosen){const quantity=(combined.get(row.id)||0)+row.amount;if(quantity>100)throw Error('Combined quantity is over 100 for '+row.name);combined.set(row.id,quantity);}const items=[...combined].map(([id,quantity])=>({id,quantity:Math.max(quantity,lines.find(line=>line.id===id)?.quantity||0)}));
        await api(submitted.store==='HEB'?'/api/heb/list':'/api/repeat',{target:submitted.client,items});
        host.hidden=true;draft=null;await refresh();notice('Your reviewed list was sent to '+store+'. You can continue changing items and quantities in the cart.');$('cart-details').open=true;
      }catch(error){status.textContent=error.message;}finally{sending=false;$('build-usual').disabled=false;for(const [control,disabled]of disabledBefore)if(control.isConnected)control.disabled=disabled;if(draft===submitted){for(const control of host.querySelectorAll('input,select,button'))contextDisabled.delete(control);syncDraftControls();}}
    };
    const cancel=node('button','Discard draft','secondary');cancel.onclick=()=>{draft=null;host.hidden=true;};const actions=node('div',undefined,'usual-actions');actions.append(accept,cancel);host.append(status,actions);syncDraftControls=()=>{update();const locked=selectedAccount!==draft.client||state.preferredStore!==draft.store;for(const control of host.querySelectorAll('input,select,button')){if(control===cancel||control===accept)continue;if(locked){if(!contextDisabled.has(control))contextDisabled.set(control,control.disabled);control.disabled=true;}else if(contextDisabled.has(control)){control.disabled=contextDisabled.get(control);contextDisabled.delete(control);}}};syncDraftControls();
  }
  window.refreshUsualDraftTiming=()=>{if(!draft||$('usual-draft').hidden)return;syncDraftControls();let warning=$('usual-draft-aged');if(!warning){warning=node('p',undefined,'fine');warning.id='usual-draft-aged';$('usual-draft').prepend(warning);}const differentContext=draft.client!==selectedAccount||draft.store!==state.preferredStore,olderDay=draft.day!==HouseholdCalendar.today(),changed=differentContext||olderDay||draft.evidence!==evidence();warning.hidden=!changed;warning.textContent=differentContext?'The account or store changed. Return to the draft’s original account/store or build a new list.':(olderDay?'This draft was built on a previous day.':'Your routine data changed while this draft was open.')+' Your edits are preserved; choose Suggest a shopping list again for updated timing.';};
  window.usualDraftBusy=()=>sending;
  $('build-usual').onclick=build;
})();
