(() => {
  let draft;
  const library=node('details',undefined,'saved-list-library'),picker=node('select'),load=node('button','Review saved list','secondary'),nameInput=node('input'),saveList=node('button','Save reviewed list','secondary'),saveCopy=node('button','Save a copy','text-button'),removeList=node('button','Delete saved list','text-button'),preview=node('div');
  picker.id='saved-list-picker';picker.setAttribute('aria-label','Saved shopping list');nameInput.id='saved-list-name';nameInput.maxLength=80;nameInput.placeholder='e.g. Dad’s weekly groceries';nameInput.setAttribute('aria-label','Shopping list name');
  library.append(node('summary','Saved household lists'),node('p','Load a list to review its original requests, products and quantities. Nothing is sent automatically.','fine'),picker,load,preview,removeList);$('grocery-text').closest('.planner').prepend(library);const saveControls=node('section',undefined,'save-list-controls');saveControls.id='save-reviewed-list';saveControls.hidden=true;saveControls.append(node('label','Save this list for next time'),nameInput,saveList,saveCopy);$('plan-send').before(saveControls);
  let librarySignature='',libraryScope='';window.renderReusableLists=()=>{const lists=(state.savedLists||[]).filter(l=>l.client===selectedAccount&&l.store===state.preferredStore),signature=JSON.stringify([selectedAccount,state.preferredStore,lists]);const scope=selectedAccount+'|'+state.preferredStore;if(scope!==libraryScope){libraryScope=scope;library.open=lists.length>0;}library.querySelector('summary').textContent='Saved household lists · '+lists.length;if(signature!==librarySignature){const selected=picker.value;librarySignature=signature;picker.replaceChildren(node('option','Choose a saved list…'));picker.firstChild.value='';for(const list of lists){const option=node('option',list.name);option.value=list.id;picker.append(option);}picker.value=lists.some(l=>l.id===selected)?selected:'';preview.replaceChildren();}load.disabled=removeList.disabled=!picker.value;saveControls.hidden=!draft;saveList.disabled=saveCopy.disabled=!draft||draft.target!==selectedAccount||draft.store!==state.preferredStore;};
  picker.onchange=()=>{const list=(state.savedLists||[]).find(l=>l.id===picker.value&&l.client===selectedAccount&&l.store===state.preferredStore);preview.replaceChildren();if(list){for(const r of list.rows){const product=storeProducts().find(p=>p.id===r.id);preview.append(node('p',r.term+' → '+(product?.name||'Choose a product')+' × '+r.quantity+(r.included?'':' · not selected'),'fine'));}}window.renderReusableLists();};
  load.onclick=()=>{const list=(state.savedLists||[]).find(l=>l.id===picker.value&&l.client===selectedAccount&&l.store===state.preferredStore);if(!list)return;draft={target:selectedAccount,store:state.preferredStore,rows:structuredClone(list.rows),text:list.text,savedId:list.id};$('grocery-text').value=list.text||list.rows.filter(r=>r.explicit!==false).map(r=>r.term).join('\n');nameInput.value=list.name;review();message('Loaded '+list.name+'. Review products and quantities before sending.');};
  const persistList=async copy=>{try{reviewedRows();const result=await api('/api/reusable-lists',{client:draft.target,store:draft.store,id:copy?undefined:draft.savedId,name:nameInput.value,text:draft.text,rows:draft.rows});draft.savedId=result.id;librarySignature='';await refresh();picker.value=result.id;window.renderReusableLists();message('Shopping list saved. Nothing sent to the store.');}catch(e){message(e.message);}};saveList.onclick=()=>persistList(false);saveCopy.onclick=()=>persistList(true);
  removeList.onclick=async()=>{try{const id=picker.value;if(!id)return;await api('/api/reusable-lists',{client:selectedAccount,id,remove:true});if(draft?.savedId===id)draft.savedId=null;librarySignature='';await refresh();message('Saved list deleted. The reviewed draft and store cart stay unchanged.');}catch(e){message(e.message);}};

  const rememberChoices=node('button','Remember these choices');rememberChoices.id='plan-remember';rememberChoices.hidden=true;$('plan-send').before(rememberChoices);
  const message=text=>{$('plan-status').textContent=text;};
  function settings(){
    $('saved-defaults').replaceChildren();
    for(const saved of (state.listDefaults||[]).filter(item=>(item.store||'Walmart')===state.preferredStore)){
      const product=storeProducts().find(product=>product.id===saved.id);const row=node('p',saved.term+' → '+(product?.name||'Product no longer learned')+' × '+saved.quantity+' ');
      const remove=node('button','Forget default');remove.onclick=async()=>{try{await api('/api/list-preferences',{kind:'default',store:state.preferredStore,term:saved.term,remove:true});await refresh();}catch(error){message(error.message);}};row.append(remove);$('saved-defaults').append(row);
    }
    $('saved-rules').replaceChildren();
    for(const rule of state.listRules||[]){const row=node('p',rule.trigger+' → '+rule.extra+' ('+(rule.mode==='include'?'Add automatically to the review':'Suggest as an optional extra')+') ');const remove=node('button','Remove association');remove.onclick=async()=>{try{await api('/api/list-preferences',{kind:'rule',...rule,remove:true});await refresh();}catch(error){message(error.message);}};row.append(remove);$('saved-rules').append(row);}
    if(draft){const changed=draft.target!==selectedAccount||draft.store!==state.preferredStore;$('plan-send').disabled=changed;rememberChoices.disabled=changed;}
  }
  window.renderPlannerSettings=settings;
  function summary(){
    $('plan-summary').replaceChildren();if(!draft)return;
    const combined=new Map();for(const row of draft.rows.filter(row=>row.included&&row.id)){const previous=combined.get(row.id)||0;combined.set(row.id,previous+row.quantity);}
    if(combined.size)$('plan-summary').append(node('h3','Your cart after adding this list'));
    for(const [id,quantity] of combined){const product=storeProducts().find(item=>item.id===id);const existing=selectedLines(state,draft.target).find(line=>line.id===id)?.quantity||0;$('plan-summary').append(node('p',(product?.name||id)+' × '+Math.max(existing,quantity)+(existing?' ('+existing+' already in cart)':'')));}
  }
  function review(){
    $('plan-review').replaceChildren();
    window.categoryReview(draft.rows,$('plan-review'),{product:row=>storeProducts().find(p=>p.id===row.id)||{name:row.term},enabled:row=>!!row.id&&!(state.currentPrices||[]).some(p=>p.client===draft.target&&p.store===draft.store&&p.id===row.id&&ShoppingAssist.fresh(p)&&p.available===false),checked:row=>row.included,select:(row,value)=>{row.included=value;},redraw:review,render:(row,section)=>{
      const card=node('article',undefined,'plan-row');
      const include=node('input');include.type='checkbox';include.checked=row.included;include.setAttribute('aria-label','Include '+row.term);include.onchange=()=>{row.included=include.checked;summary();};
      const heading=node('label',row.term);heading.prepend(include);card.append(heading,node('p',row.reason,'fine'));
      const search=node('input');search.type='search';search.placeholder='Find the right product';search.setAttribute('aria-label','Find product for '+row.term);
      const select=node('select');select.setAttribute('aria-label','Product for '+row.term);
      function options(query=''){
        select.replaceChildren();const unknown=node('option','Choose a product…');unknown.value='';select.append(unknown);
        const terms=query.toLowerCase().split(/\s+/).filter(Boolean);
        const choices=storeProducts().filter(product=>product.id===row.id||terms.every(term=>product.name.toLowerCase().includes(term)));
        for(const product of choices){const available=draft.store==='HEB'||!!product.offerId;const option=node('option',product.name+(!available?' — capture this product on Walmart first':''));option.value=product.id;option.disabled=!available;select.append(option);}
        select.value=choices.some(product=>product.id===row.id&&(draft.store==='HEB'||product.offerId))?row.id:'';row.id=select.value;
      }
      options();search.oninput=()=>options(search.value);select.onchange=()=>{row.id=select.value;review();};
      const quantity=node('input');quantity.type='number';quantity.min=1;quantity.max=100;quantity.value=row.quantity;quantity.setAttribute('aria-label','Quantity for '+row.term);quantity.oninput=()=>{row.quantity=Number(quantity.value);summary();};
      const remember=node('input');remember.type='checkbox';remember.checked=row.remember!==false;row.remember=remember.checked;remember.onchange=()=>{row.remember=remember.checked;};const rememberLabel=node('label','Remember this '+(draft.store==='HEB'?'H-E-B':'Walmart')+' product and quantity for “'+row.term+'”');rememberLabel.prepend(remember);
      card.append(search,select,node('span','Items/packages'),window.quantityControls(quantity,summary),rememberLabel);const chosen=storeProducts().find(p=>p.id===row.id);if(chosen)window.decorateShoppingProduct?.(card,chosen,candidate=>{row.id=candidate.id;row.quantity=candidate.chosenQuantity||row.quantity;row.reason='Replacement chosen for '+row.term;review();});section.append(card);

    }});
    $('plan-send').hidden=false;$('plan-send').disabled=false;rememberChoices.hidden=false;rememberChoices.disabled=false;summary();window.renderReusableLists?.();
  }
  $('plan-list').onclick=()=>{try{
    if(!selectedAccount)throw Error('Choose the destination household account first.');
    draft={target:selectedAccount,store:state.preferredStore,text:$('grocery-text').value,rows:ListPlanner.parse($('grocery-text').value,(state.listDefaults||[]).filter(item=>(item.store||'Walmart')===state.preferredStore),state.listRules)};review();
    const name=state.clients.find(client=>client.id===draft.target)?.name;
    message('Review for '+name+'. Choose exact products, quantities and any extras. Nothing has been sent.');
  }catch(error){message(error.message);}};
  $('rule-save').onclick=async()=>{try{await api('/api/list-preferences',{kind:'rule',trigger:$('rule-trigger').value,extra:$('rule-extra').value,mode:$('rule-mode').value});await refresh();message('Extra item saved. Review the list again to include it.');}catch(error){message(error.message);}};
  function reviewedRows(){
    if(!draft||draft.target!==selectedAccount||draft.store!==state.preferredStore)throw Error('The account or store changed. Review the list again.');
    const rows=draft.rows.filter(row=>row.included);if(!rows.length)throw Error('Choose at least one item to include.');
    for(const row of rows){const product=storeProducts().find(p=>p.id===row.id);if(!product)throw Error('Choose the exact product for “'+row.term+'”, or uncheck it.');if(draft.store==='Walmart'&&!product.offerId)throw Error('Capture '+product.name+' using the Walmart helper first.');if(!Number.isInteger(row.quantity)||row.quantity<1||row.quantity>100)throw Error('Choose a package quantity from 1 to 100 for '+row.term);}
    if(rows.some(row=>(state.currentPrices||[]).some(p=>p.client===draft.target&&p.store===draft.store&&p.id===row.id&&ShoppingAssist.fresh(p)&&p.available===false)))throw Error('A selected product was unavailable when checked. Choose an alternative, recheck availability or uncheck it.');return rows;
  }
  async function saveChoices(rows,context){for(const row of rows)if(row.remember)await api('/api/list-preferences',{kind:'default',store:context.store,term:row.term,id:row.id,quantity:row.quantity});}
  rememberChoices.onclick=async()=>{rememberChoices.disabled=true;try{const rows=reviewedRows(),context={...draft};if(!rows.some(r=>r.remember))throw Error('Check “Remember” beside at least one item.');await saveChoices(rows,context);await refresh();message('Usual '+(context.store==='HEB'?'H-E-B':'Walmart')+' products and quantities saved. Nothing sent to your cart.');}catch(error){message(error.message);}finally{rememberChoices.disabled=!!draft&&(draft.target!==selectedAccount||draft.store!==state.preferredStore);}};
  $('plan-send').onclick=async()=>{
    $('plan-send').disabled=true;
    try{
      const rows=reviewedRows(),context={...draft};
      const combined=new Map();
      for(const row of rows){
        const product=storeProducts().find(product=>product.id===row.id);
        if(!Number.isInteger(row.quantity)||row.quantity<1||row.quantity>100)throw Error('Choose a package quantity from 1 to 100 for '+row.term);
        const quantity=(combined.get(row.id)||0)+row.quantity;if(quantity>100)throw Error('Combined package quantity is over 100 for '+product.name);combined.set(row.id,quantity);
      }
      // Refresh before calculating targets, so an existing quantity is preserved.
      const latest=await api('/api/state');if(context.target!==selectedAccount||context.store!==state.preferredStore)throw Error('The account or store changed. Review the list again.');const items=[];
      for(const [id,quantity] of combined){const existing=selectedLines(latest,draft.target).find(line=>line.id===id)?.quantity||0;if(existing<quantity)items.push({id,quantity});}
      if(items.length)await api(draft.store==='HEB'?'/api/heb/list':'/api/repeat',{target:draft.target,items});
      await saveChoices(rows,context);
      message(items.length?'Reviewed items sent. Existing cart quantities were preserved; check activity for store confirmation.':'These quantities are already in the site cart. Defaults saved; nothing sent.');
      draft=null;$('plan-send').hidden=true;rememberChoices.hidden=true;await refresh();
    }catch(error){message(error.message);if(draft)$('plan-send').disabled=draft.target!==selectedAccount||draft.store!==state.preferredStore;}
  };
  settings();
})();
