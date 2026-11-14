(() => {
  let draft,sending=false,contextWarning=false;const disabledReviewControls=new WeakMap();
  const library=node('details',undefined,'saved-list-library'),picker=node('select'),load=node('button','Review saved list','secondary'),nameInput=node('input'),saveList=node('button','Save reviewed list','secondary'),saveCopy=node('button','Save a copy','text-button'),removeList=node('button','Delete saved list','text-button'),preview=node('div');
  picker.id='saved-list-picker';picker.setAttribute('aria-label','Saved shopping list');nameInput.id='saved-list-name';nameInput.maxLength=80;nameInput.placeholder='e.g. Dad’s weekly groceries';nameInput.setAttribute('aria-label','Shopping list name');
  library.append(node('summary','Saved household lists'),node('p','Load a list to review its original requests, products and quantities. Nothing is sent automatically.','fine'),picker,load,preview,removeList);$('grocery-text').closest('.planner').prepend(library);const saveControls=node('section',undefined,'save-list-controls');saveControls.id='save-reviewed-list';saveControls.hidden=true;saveControls.append(node('label','Save this list for next time'),nameInput,saveList,saveCopy);$('plan-send').before(saveControls);
  let librarySignature='',libraryScope='';window.renderReusableLists=()=>{const lists=(state.savedLists||[]).filter(l=>l.client===selectedAccount&&l.store===state.preferredStore),signature=JSON.stringify([selectedAccount,state.preferredStore,lists]);const scope=selectedAccount+'|'+state.preferredStore;if(scope!==libraryScope){libraryScope=scope;library.open=lists.length>0;}library.querySelector('summary').textContent='Saved household lists · '+lists.length;if(signature!==librarySignature){const selected=picker.value;librarySignature=signature;picker.replaceChildren(node('option','Choose a saved list…'));picker.firstChild.value='';for(const list of lists){const option=node('option',list.name);option.value=list.id;picker.append(option);}picker.value=lists.some(l=>l.id===selected)?selected:'';preview.replaceChildren();}renderSavedPreview();picker.disabled=sending;load.disabled=removeList.disabled=sending||!picker.value;saveControls.hidden=!draft;saveList.disabled=saveCopy.disabled=sending||!draft||draft.target!==selectedAccount||draft.store!==state.preferredStore;};
  function renderSavedPreview(){const list=(state.savedLists||[]).find(l=>l.id===picker.value&&l.client===selectedAccount&&l.store===state.preferredStore);preview.replaceChildren();if(list)for(const r of list.rows){const product=storeProducts().find(p=>p.id===r.id);const line=node('p',undefined,'fine product-line');if(product)line.append(productPhoto(state.preferredStore,product.id,product.name,true));line.append(node('span',r.term+' → '+(product?.name||'Choose a product')+' × '+r.quantity+(r.included?'':' · not selected')));preview.append(line);}}
  picker.onchange=()=>window.renderReusableLists();
  load.onclick=()=>{if(sending)return;const list=(state.savedLists||[]).find(l=>l.id===picker.value&&l.client===selectedAccount&&l.store===state.preferredStore);if(!list)return;draft={target:selectedAccount,store:state.preferredStore,rows:structuredClone(list.rows),text:list.text,savedId:list.id};$('grocery-text').value=list.text||list.rows.filter(r=>r.explicit!==false).map(r=>r.term).join('\n');nameInput.value=list.name;review();message('Loaded '+list.name+'. Review products and quantities before sending.');};
  const persistList=async copy=>{if(sending)return;try{reviewedRows();sending=true;settings();window.renderReusableLists();const result=await api('/api/reusable-lists',{client:draft.target,store:draft.store,id:copy?undefined:draft.savedId,name:nameInput.value,text:draft.text,rows:draft.rows});draft.savedId=result.id;librarySignature='';await refresh();picker.value=result.id;window.renderReusableLists();message('Shopping list saved. Nothing sent to the store.');}catch(e){message(e.message);}finally{sending=false;settings();window.renderReusableLists();}};saveList.onclick=()=>persistList(false);saveCopy.onclick=()=>persistList(true);
  removeList.onclick=async()=>{if(sending)return;const id=picker.value,client=selectedAccount;if(!id)return;sending=true;settings();window.renderReusableLists();try{await api('/api/reusable-lists',{client,id,remove:true});if(draft?.savedId===id&&draft.target===client)draft.savedId=null;librarySignature='';await refresh();message('Saved list deleted. The reviewed draft and store cart stay unchanged.');}catch(e){message(e.message);}finally{sending=false;settings();window.renderReusableLists();}};

  const rememberChoices=node('button','Remember these choices');rememberChoices.id='plan-remember';rememberChoices.hidden=true;$('plan-send').before(rememberChoices);
  const message=text=>{$('plan-status').textContent=text;};
  let choiceSaveQueue=Promise.resolve();
  function rememberSelection(row){
    if(!row.id||row.remember===false||!draft)return;
    const choice={kind:'default',store:draft.store,term:row.term,id:row.id,quantity:Number.isInteger(row.quantity)&&row.quantity>=1&&row.quantity<=100?row.quantity:1};
    message('Remembering your choice for “'+choice.term+'”…');
    choiceSaveQueue=choiceSaveQueue.then(async()=>{
      try{await api('/api/list-preferences',choice);
        const defaults=state.listDefaults||=[];const old=defaults.findIndex(d=>(d.store||'Walmart')===choice.store&&d.term===choice.term);const saved={store:choice.store,term:choice.term,id:choice.id,quantity:choice.quantity};if(old>=0)defaults[old]=saved;else defaults.push(saved);
        message('Remembered '+choice.term+' for next time. Nothing sent to your cart.');settings();
      }catch(error){message('Could not remember '+choice.term+': '+error.message+'. Use Remember these choices to retry.');}
    });
    return choiceSaveQueue;
  }

  function settings(){
    $('saved-defaults').replaceChildren();
    for(const saved of (state.listDefaults||[]).filter(item=>(item.store||'Walmart')===state.preferredStore)){
      const product=storeProducts().find(product=>product.id===saved.id);const row=node('p',saved.term+' → '+(product?.name||'Product no longer learned')+' × '+saved.quantity+' ');
      const remove=node('button','Forget default');remove.onclick=async()=>{try{await api('/api/list-preferences',{kind:'default',store:state.preferredStore,term:saved.term,remove:true});await refresh();}catch(error){message(error.message);}};row.append(remove);$('saved-defaults').append(row);
    }
    $('saved-rules').replaceChildren();
    for(const rule of state.listRules||[]){const row=node('p',rule.trigger+' → '+rule.extra+' ('+(rule.mode==='include'?'Add automatically to the review':'Suggest as an optional extra')+') ');const remove=node('button','Remove association');remove.onclick=async()=>{try{await api('/api/list-preferences',{kind:'rule',...rule,remove:true});await refresh();}catch(error){message(error.message);}};row.append(remove);$('saved-rules').append(row);}
    const changed=!!draft&&(draft.target!==selectedAccount||draft.store!==state.preferredStore),locked=sending||changed||!!draft?.cartSent;
    $('plan-send').disabled=locked||!draft?.rows.some(r=>r.included);rememberChoices.disabled=sending||changed||!draft?.rows.some(r=>r.included);if(draft?.cartSent)$('plan-send').hidden=true;$('plan-list').disabled=sending;$('grocery-text').disabled=nameInput.disabled=sending;
    for(const control of $('plan-review').querySelectorAll('input,select,button')){if(locked){if(!disabledReviewControls.has(control))disabledReviewControls.set(control,control.disabled);control.disabled=true;}else if(disabledReviewControls.has(control)){control.disabled=disabledReviewControls.get(control);disabledReviewControls.delete(control);}}
    if(changed&&!sending){contextWarning=true;message('The account or store changed. Return to this draft’s original account/store or review a new list.');}else if(contextWarning&&!sending){contextWarning=false;message(draft?.cartSent?'These reviewed items were already sent. You can retry Remember these choices without sending the cart again.':'You are back on this draft’s account and store. Review it before sending.');}
  }
  window.renderPlannerSettings=settings;
  function summary(){
    $('plan-summary').replaceChildren();if(!draft)return;
    const combined=new Map();for(const row of draft.rows.filter(row=>row.included&&row.id)){const previous=combined.get(row.id)||0;combined.set(row.id,previous+row.quantity);}
    if(combined.size)$('plan-summary').append(node('h3','Your cart after adding this list'));
    for(const [id,quantity] of combined){const product=storeProducts().find(item=>item.id===id);const existing=selectedLines(state,draft.target).find(line=>line.id===id)?.quantity||0;const line=node('p',undefined,'product-line');if(product)line.append(productPhoto(draft.store,id,product.name,true));line.append(node('span',(product?.name||id)+' × '+Math.max(existing,quantity)+(existing?' ('+existing+' already in cart)':'')));$('plan-summary').append(line);}
  }
  function updateDraftText(){draft.text=draft.rows.filter(r=>r.explicit!==false).map(r=>(r.quantity===1?'':r.quantity+' ')+r.term).join('\n');$('grocery-text').value=draft.text;}
  function review(){
    $('plan-review').replaceChildren();
    if(draft.removed?.length){const undo=node('button','Undo last removal','secondary');undo.onclick=()=>{const removed=draft.removed.pop();draft.rows.splice(removed.index,0,removed.row);updateDraftText();review();};$('plan-review').append(undo);}
    if(!draft.rows.length)$('plan-review').append(node('p','Your reviewed list is empty. Undo a removal or enter a new list.','fine'));
    window.categoryReview(draft.rows,$('plan-review'),{product:row=>storeProducts().find(p=>p.id===row.id)||{name:row.term},enabled:row=>!!row.id&&!(state.currentPrices||[]).some(p=>p.client===draft.target&&p.store===draft.store&&p.id===row.id&&ShoppingAssist.availabilityFresh(p)&&p.available===false),checked:row=>row.included,select:(row,value)=>{row.included=value;},redraw:review,render:(row,section)=>{
      const card=node('details',undefined,'plan-row');card.open=row.reviewOpen??!row.id;card.ontoggle=()=>{if(card.isConnected)row.reviewOpen=card.open;};
      const include=node('input');include.type='checkbox';include.checked=row.included;include.setAttribute('aria-label','Include '+row.term);include.onchange=()=>{row.included=include.checked;summary();settings();};
      const heading=node('summary'),title=node('span');title.append(node('strong',row.term),node('span',' — '+(row.originalEntries?.join('; ')||row.term),'fine'));heading.append(include,title);const brief=node('small',undefined,'review-item-brief'),updateBrief=()=>{brief.textContent=(storeProducts().find(p=>p.id===row.id)?.name||'Choose a product')+' · '+row.quantity+' item/package'+(row.quantity===1?'':'s');};updateBrief();heading.append(brief);if(row.packageQuantityAdjusted){const carton=/^eggs?$/i.test(row.term),warning=node('small','Requested '+row.requestedQuantity+' '+row.term+' → starting with 1 '+(carton?'carton':'package')+'. Check pack size and adjust if needed.','review-package-warning');heading.append(warning);}const headerProduct=storeProducts().find(product=>product.id===row.id);if(headerProduct){const headerPhoto=productPhoto(draft.store,headerProduct.id,headerProduct.name,true);headerPhoto.classList.add('review-collapsed-photo');heading.append(headerPhoto);}card.append(heading,node('p',row.reason,'fine'));
      if(row.entries>1)card.append(node('p',row.entries+' entries combined. If one was accidental, reduce the quantity below.','fine'));
      const remove=node('button','Remove','text-button');remove.setAttribute('aria-label','Remove '+row.term+' from reviewed list');remove.onclick=()=>{(draft.removed||=[]).push({row,index:draft.rows.indexOf(row)});draft.rows=draft.rows.filter(r=>r!==row);updateDraftText();review();};card.append(remove);
      const search=node('input');search.type='search';search.placeholder='Find the right product';search.setAttribute('aria-label','Find product for '+row.term);
      const select=node('select');select.setAttribute('aria-label','Product for '+row.term);
      function options(query=''){
        select.replaceChildren();const unknown=node('option','Choose a product…');unknown.value='';select.append(unknown);
        const terms=query.toLowerCase().split(/\s+/).filter(Boolean);
        const choices=storeProducts().filter(product=>product.id===row.id||terms.every(term=>product.name.toLowerCase().includes(term)));
        for(const product of choices){const available=draft.store==='HEB'||!!product.offerId;const option=node('option',product.name+(!available?' — capture this product on Walmart first':''));option.value=product.id;option.disabled=!available;select.append(option);}
        select.value=choices.some(product=>product.id===row.id&&(draft.store==='HEB'||product.offerId))?row.id:'';row.id=select.value;
      }
      options();card.classList.toggle('plan-row-unmatched',!row.id);if(!row.id){card.append(node('p','Choose a product to match this list item.','unmatched-hint'));select.setAttribute('aria-label','Choose a product for unmatched item '+row.term);}search.oninput=()=>options(search.value);select.onchange=()=>{row.id=select.value;Object.assign(row,ListPlanner.packageQuantity(row,storeProducts().find(product=>product.id===row.id)));updateDraftText();rememberSelection(row);review();};
      const quantity=node('input');quantity.type='number';quantity.min=1;quantity.max=100;quantity.value=row.quantity;quantity.setAttribute('aria-label','Quantity for '+row.term);quantity.oninput=()=>{row.quantity=Number(quantity.value);updateBrief();updateDraftText();summary();};
      const compactQuantity=node('input');compactQuantity.type='number';compactQuantity.min=1;compactQuantity.max=100;compactQuantity.value=row.quantity;compactQuantity.setAttribute('aria-label','Collapsed quantity for '+row.term);compactQuantity.oninput=()=>{quantity.value=compactQuantity.value;row.quantity=Number(compactQuantity.value);updateBrief();updateDraftText();summary();};quantity.addEventListener('input',()=>{compactQuantity.value=quantity.value;});const compactControls=window.quantityControls(compactQuantity);compactControls.classList.add('review-collapsed-quantity');for(const event of ['click','keydown'])compactControls.addEventListener(event,e=>e.stopPropagation());heading.append(compactControls);
      const remember=node('input');remember.type='checkbox';remember.checked=row.remember!==false;row.remember=remember.checked;remember.onchange=()=>{row.remember=remember.checked;if(row.remember)rememberSelection(row);};const rememberLabel=node('label','Remember this '+(draft.store==='HEB'?'H-E-B':'Walmart')+' product and quantity for “'+row.term+'”');rememberLabel.prepend(remember);
      card.append(search,select,node('span','Items/packages'),window.quantityControls(quantity,summary),rememberLabel);const chosen=storeProducts().find(p=>p.id===row.id);if(chosen){const picture=node('div',undefined,'product-line plan-product-preview');picture.append(productPhoto(draft.store,chosen.id,chosen.name,true),node('span',chosen.name));card.append(picture);}if(chosen)window.decorateShoppingProduct?.(card,chosen,candidate=>{row.id=candidate.id;row.quantity=candidate.chosenQuantity||row.quantity;updateDraftText();row.reason='Replacement chosen for '+row.term;rememberSelection(row);review();});section.append(card);

    }});
    for(const section of [...$('plan-review').querySelectorAll('.review-category')]){
      const category=section.dataset.reviewCategory;draft.categoryOpen||={};
      const details=node('details',undefined,'review-category');details.dataset.reviewCategory=category;details.open=draft.categoryOpen[category]??true;
      details.ontoggle=()=>{if(details.isConnected)draft.categoryOpen[category]=details.open;};
      const categoryHeading=section.querySelector('.review-category-heading'),summaryHeading=node('summary');summaryHeading.append(categoryHeading);details.append(summaryHeading);
      while(section.firstChild)details.append(section.firstChild);section.replaceWith(details);
      const syncCategory=()=>{const boxes=[...details.querySelectorAll('.plan-row input[type=checkbox]')].filter(input=>input.getAttribute('aria-label')?.startsWith('Include ')),all=categoryHeading.querySelector('input');all.checked=boxes.length>0&&boxes.every(input=>input.checked);all.indeterminate=boxes.some(input=>input.checked)&&!all.checked;};details.addEventListener('change',syncCategory);
    }
    $('plan-review').querySelectorAll('.plan-row').forEach((row,index)=>row.classList.toggle('plan-row-alternate',index%2===1));
    $('plan-send').hidden=false;$('plan-send').disabled=false;rememberChoices.hidden=false;rememberChoices.disabled=false;summary();settings();window.renderReusableLists?.();
  }
  $('plan-list').onclick=()=>{if(sending)return;try{
    if(!selectedAccount)throw Error('Choose the destination household account first.');
    nameInput.value='';draft={target:selectedAccount,store:state.preferredStore,text:$('grocery-text').value,rows:ListPlanner.resolve(ListPlanner.parse($('grocery-text').value,(state.listDefaults||[]).filter(item=>(item.store||'Walmart')===state.preferredStore),state.listRules),{catalog:storeProducts(),purchases:state.purchases||[],variants:state.householdVariants||[],groups:state.householdItems||[],reviews:state.matchReviews||[],defaults:(state.listDefaults||[]).filter(item=>(item.store||'Walmart')===state.preferredStore),client:selectedAccount,store:state.preferredStore})};review();
    const name=state.clients.find(client=>client.id===draft.target)?.name;
    message('Review for '+name+'. Choose exact products, quantities and any extras. Nothing has been sent.');
  }catch(error){message(error.message);}};
  $('rule-save').onclick=async()=>{try{await api('/api/list-preferences',{kind:'rule',trigger:$('rule-trigger').value,extra:$('rule-extra').value,mode:$('rule-mode').value});await refresh();message('Extra item saved. Review the list again to include it.');}catch(error){message(error.message);}};
  function reviewedRows(){
    if(!draft||draft.target!==selectedAccount||draft.store!==state.preferredStore)throw Error('The account or store changed. Review the list again.');
    const rows=draft.rows.filter(row=>row.included);if(!rows.length)throw Error('Choose at least one item to include.');
    for(const row of rows){const product=storeProducts().find(p=>p.id===row.id);if(!product)throw Error('Choose the exact product for “'+row.term+'”, or uncheck it.');if(draft.store==='Walmart'&&!product.offerId)throw Error('Capture '+product.name+' using the Walmart helper first.');if(!Number.isInteger(row.quantity)||row.quantity<1||row.quantity>100)throw Error('Choose a package quantity from 1 to 100 for '+row.term);}
    if(rows.some(row=>(state.currentPrices||[]).some(p=>p.client===draft.target&&p.store===draft.store&&p.id===row.id&&ShoppingAssist.availabilityFresh(p)&&p.available===false)))throw Error('A selected product was unavailable when checked. Choose an alternative, recheck availability or uncheck it.');return rows;
  }
  async function saveChoices(rows,context){for(const row of rows)if(row.remember)await api('/api/list-preferences',{kind:'default',store:context.store,term:row.term,id:row.id,quantity:row.quantity});}
  rememberChoices.onclick=async()=>{if(sending)return;sending=true;settings();try{const rows=reviewedRows().map(row=>({...row})),context={...draft};if(!rows.some(r=>r.remember))throw Error('Check “Remember” beside at least one item.');await saveChoices(rows,context);await refresh();message(context.cartSent?'Usual choices saved. Your earlier cart submission was not sent again.':'Usual '+(context.store==='HEB'?'H-E-B':'Walmart')+' products and quantities saved. Nothing sent to your cart.');}catch(error){message(error.message);}finally{sending=false;settings();window.renderReusableLists?.();}};
  $('plan-send').onclick=async()=>{
    if(sending)return;sending=true;settings();window.renderReusableLists?.();let cartSubmitted=false,submitted;
    try{
      const rows=reviewedRows().map(row=>({...row})),context={...draft};submitted=draft;
      const combined=new Map();
      for(const row of rows){
        const product=storeProducts().find(product=>product.id===row.id);
        if(!Number.isInteger(row.quantity)||row.quantity<1||row.quantity>100)throw Error('Choose a package quantity from 1 to 100 for '+row.term);
        const quantity=(combined.get(row.id)||0)+row.quantity;if(quantity>100)throw Error('Combined package quantity is over 100 for '+product.name);combined.set(row.id,quantity);
      }
      // Refresh before calculating targets, so an existing quantity is preserved.
      const latest=await api('/api/state');if(context.target!==selectedAccount||context.store!==state.preferredStore||latest.preferredStore!==context.store)throw Error('The account or store changed. Review the list again.');const items=[];
      if(rows.some(row=>(latest.currentPrices||[]).some(p=>p.client===context.target&&p.store===context.store&&p.id===row.id&&ShoppingAssist.availabilityFresh(p)&&p.available===false)))throw Error('A selected product is now unavailable. Choose an alternative, recheck availability or uncheck it.');
      for(const [id,quantity] of combined){const existing=selectedLines(latest,draft.target).find(line=>line.id===id)?.quantity||0;if(existing<quantity)items.push({id,quantity});}
      if(items.length){await api(context.store==='HEB'?'/api/heb/list':'/api/repeat',{target:context.target,items});cartSubmitted=true;}
      await saveChoices(rows,context);
      message(items.length?'Reviewed items sent. Existing cart quantities were preserved; check activity for store confirmation.':'These quantities are already in the site cart. Defaults saved; nothing sent.');
      draft=null;$('plan-review').replaceChildren();$('plan-summary').replaceChildren();saveControls.hidden=true;$('plan-send').hidden=true;rememberChoices.hidden=true;await refresh();showView('cart');window.scrollTo({top:0,behavior:'instant'});
    }catch(error){if(cartSubmitted&&submitted){submitted.cartSent=true;message('Your reviewed cart changes were sent, but saving your usual choices failed: '+error.message+' Use Remember these choices to retry saving without resending the cart.');}else message(error.message);}finally{sending=false;settings();window.renderReusableLists?.();}
  };
  settings();
})();
