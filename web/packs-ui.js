(() => {
  let client,packStore,selected='',signature='';let choices=new Map();let builderLimit=20,lastHidden=null,packBusy=false;const lockedControls=new Map();const expandedReasons=new Set();
  const message=text=>{$('pack-status').textContent=text;};
  function busy(value){packBusy=value;if(value){for(const control of $('packs-view').querySelectorAll('input,select,button')){lockedControls.set(control,control.disabled);control.disabled=true;}}else{for(const [control,disabled]of lockedControls)if(control.isConnected)control.disabled=disabled;lockedControls.clear();window.renderPacks?.();}}

  const current=()=>state.packs?.find(pack=>pack.id===selected&&pack.client===selectedAccount&&pack.store===state.preferredStore);
  const newPack=node('button','Create a new pack'),removePack=node('button','Delete saved pack');newPack.id='pack-new';removePack.id='pack-delete';removePack.hidden=true;$('pack-save').after(newPack,removePack);
  const editor=$('pack-name').closest('details'),library=node('div'),search=node('input'),libraryStatus=node('p',undefined,'fine');search.id='pack-library-search';search.type='search';search.placeholder='Find a pack or an item inside it';search.setAttribute('aria-label','Find shopping packs');library.id='pack-library';$('pack-select').before(search,library,libraryStatus);newPack.className='secondary';search.before(newPack);
  const editPack=node('button','Edit name & contents'),hidePack=node('button','Hide this suggestion'),undoHide=node('button','Undo hide');undoHide.hidden=true;$('pack-add').after(editPack,hidePack,undoHide);editPack.onclick=()=>{editor.open=true;$('pack-name').focus();editor.scrollIntoView({block:'start',behavior:'smooth'});};
  const restoreHidden=node('button','Restore hidden suggestions');restoreHidden.hidden=true;search.before(restoreHidden);restoreHidden.onclick=async()=>{try{for(const p of (state.packDismissals||[]).filter(p=>p.client===selectedAccount))await api('/api/packs/dismiss',{...p,undo:true});signature='';await refresh();message('Hidden suggestions restored.');}catch(e){message(e.message);}};
  const quantityHelp=node('p','Quantities are items or packages, not pounds. The store sets the final weight for weighed products.','fine');$('pack-items').before(quantityHelp);
  hidePack.onclick=async()=>{const p=current();if(!p?.learned||packBusy)return;const target=selectedAccount,store=state.preferredStore;busy(true);try{await api('/api/packs/dismiss',{client:target,id:p.id});if(target===selectedAccount&&store===state.preferredStore){lastHidden={client:target,store,id:p.id};selected='';choices.clear();}signature='';await refresh();message('Suggestion hidden. Your saved packs, history and cart were not changed.');}catch(e){message(e.message);}finally{busy(false);undoHide.hidden=!lastHidden||lastHidden.client!==selectedAccount||lastHidden.store!==state.preferredStore;}};
  undoHide.onclick=async()=>{if(!lastHidden||lastHidden.client!==selectedAccount||lastHidden.store!==state.preferredStore)return;try{await api('/api/packs/dismiss',{...lastHidden,undo:true});lastHidden=null;undoHide.hidden=true;signature='';await refresh();message('Suggestion restored.');}catch(e){message(e.message);}};
  function browse(){library.replaceChildren();const q=search.value.toLowerCase(),packs=(state.packs||[]).filter(p=>p.client===selectedAccount&&p.store===state.preferredStore),visible=packs.filter(p=>(p.name+' '+p.items.map(i=>i.name).join(' ')).toLowerCase().includes(q));libraryStatus.textContent=visible.length+' packs · '+(state.preferredStore==='HEB'?'H-E-B':'Walmart');for(const p of visible){const button=node('button',undefined,'pack-library-row');button.setAttribute('aria-pressed',String(p.id===selected));button.append(node('strong',p.name),node('span',p.items.length+' items · '+(p.learned?'Together on '+p.togetherCount+' purchase dates · last '+p.lastTogether:'Saved by you'),'fine'),node('span',p.items.map(i=>i.name).join(' · '),'fine'));button.onclick=()=>{$('pack-select').value=p.id;select();};library.append(button);}if(!visible.length)library.append(node('p',q?'No packs contain that name or item.':'No packs for this store yet. Create a pack with products you choose.','fine'));}
  search.oninput=browse;
  newPack.onclick=()=>{editor.open=true;builderLimit=20;selected='';$('pack-select').value='';choices=new Map();$('pack-name').value='';$('pack-search').value='';message('Choose products and give your new pack a name.');preview();build();browse();$('pack-name').focus();};
  removePack.onclick=async()=>{const pack=current();if(!pack||pack.learned||packBusy)return;const target=selectedAccount,store=state.preferredStore;busy(true);try{await api('/api/packs',{client:target,id:pack.id,remove:true});if(target===selectedAccount&&store===state.preferredStore&&selected===pack.id)newPack.onclick();await refresh();message('Saved pack deleted. Your cart was not changed.');}catch(error){message(error.message);}finally{busy(false);}};
  function choice(id){if(!choices.has(id))choices.set(id,{checked:false,quantity:1});return choices.get(id);}
  function row(item,builder=false){
    const value=choice(item.id);const wrapper=node('div',undefined,'pack-item');const label=node('label',item.name);
    const checkbox=node('input');checkbox.type='checkbox';checkbox.checked=value.checked;checkbox.setAttribute('aria-label',(builder?'Pack includes ':'Add ')+item.name);checkbox.onchange=()=>{value.checked=checkbox.checked;preview();build();};label.prepend(checkbox);
    const quantity=node('input');quantity.type='number';quantity.min=1;quantity.max=100;quantity.value=value.quantity;quantity.setAttribute('aria-label','Quantity for '+item.name);quantity.oninput=()=>{value.quantity=Number(quantity.value);};quantity.onchange=()=>{preview();build();};wrapper.append(productPhoto(state.preferredStore,item.id,item.name,true),label,quantity);if(item.quantityNote)wrapper.append(node('small',item.quantityNote,'fine'));else if(!builder&&current()?.learned)wrapper.append(node('small','Starting quantity from past purchases; review what you need for this shop.','fine'));return wrapper;
  }
  function build(){
    $('pack-builder').replaceChildren();const query=$('pack-search').value.toLowerCase();
    const all=storeProducts().filter(item=>item.name.toLowerCase().includes(query)).sort((a,b)=>Number(choice(b.id).checked)-Number(choice(a.id).checked)||a.name.localeCompare(b.name));
    for(const item of all.slice(0,builderLimit))$('pack-builder').append(row(item,true));if(all.length>builderLimit){const more=node('button','Show 20 more products');more.onclick=()=>{builderLimit+=20;build();};$('pack-builder').append(node('p','Showing '+Math.min(builderLimit,all.length)+' of '+all.length+' products. Search to narrow the list.','fine'),more);}

  }
  function preview(){
    $('pack-items').replaceChildren();const pack=current();$('pack-add').hidden=!pack;$('pack-add').disabled=!!pack&&pack.store!==state.preferredStore;
    const store=pack?.store==='HEB'?'H-E-B':'Walmart';
    removePack.hidden=!pack||pack.learned;editPack.hidden=!pack;hidePack.hidden=!pack?.learned;
    $('pack-add').textContent='Add selected items to '+store+' cart ('+(pack?pack.items.filter(i=>choice(i.id).checked).length:0)+' selected)';
    $('pack-description').textContent=pack?(pack.learned?'Suggested grouping · bought together on '+pack.togetherCount+' dates, most recently '+pack.lastTogether+'. This does not mean all are needed now. Choose items and quantities for this shop.':'Your saved '+store+' pack · '+pack.items.length+' products.')+(pack.store!==state.preferredStore?' Choose '+store+' in the store selector above to add this pack.':''):'Choose a pack to see its items, or create your own pack below.';
    if(!pack)return;
    if(pack.learned){const why=node('details',undefined,'fine'),reasonKey=selectedAccount+'|'+pack.store+'|'+pack.id;why.open=expandedReasons.has(reasonKey);why.ontoggle=()=>{if(why.isConnected){if(why.open)expandedReasons.add(reasonKey);else expandedReasons.delete(reasonKey);}};why.append(node('summary','Why this group?'),node('p','Bought together on '+pack.togetherCount+' of '+pack.shoppingDays+' shopping days. Last bought together: '+pack.lastTogether+'. Based on '+(pack.sources||[]).map(s=>s==='HEB'?'H-E-B':s).join(' and ')+'. These items appear together more often than their individual buying frequency would predict. This is an association, not evidence that you use them together or need them on the same schedule.'));$('pack-items').append(why);}
    for(const item of pack.items)$('pack-items').append(row(item));
  }
  function select(){
    selected=$('pack-select').value;choices=new Map();const pack=current();
    if(pack){for(const item of pack.items)choices.set(item.id,{checked:!item.needsMatch&&!ShoppingAssist.isSnoozed(state,{...item,client:selectedAccount,store:state.preferredStore}),quantity:item.quantity});$('pack-name').value=pack.name;}else $('pack-name').value='';
    message('');preview();build();browse();
  }
  window.renderPacks=()=>{
    if(packBusy)return;
    restoreHidden.hidden=!(state.packDismissals||[]).some(p=>p.client===selectedAccount);
    if(client!==selectedAccount||packStore!==state.preferredStore){client=selectedAccount;packStore=state.preferredStore;selected='';choices=new Map();signature='';$('pack-name').value='';search.value='';undoHide.hidden=true;lastHidden=null;}
    const packs=(state.packs||[]).filter(pack=>pack.client===selectedAccount&&pack.store===state.preferredStore);const next=JSON.stringify({packs,photos:state.productImages,store:state.preferredStore,products:storeProducts().map(item=>[item.id,item.name])});
    if(signature!==next){signature=next;$('pack-select').replaceChildren();const blank=node('option',packs.length?'Choose a shopping pack…':'No packs yet — create one below');blank.value='';$('pack-select').append(blank);
      for(const learned of [false,true]){const group=node('optgroup');group.label=learned?'Suggested from purchase history':'Your saved packs';for(const pack of packs.filter(pack=>pack.learned===learned)){const option=node('option',pack.name+' · '+(pack.store==='HEB'?'H-E-B':'Walmart'));option.value=pack.id;group.append(option);}if(group.children.length)$('pack-select').append(group);}
      if(packs.some(pack=>pack.id===selected))$('pack-select').value=selected;else{selected='';$('pack-select').value='';}preview();build();browse();
    }
  };
  $('pack-select').onchange=select;$('pack-search').oninput=()=>{builderLimit=20;build();};
  $('pack-save').onclick=async()=>{if(packBusy)return;busy(true);try{
    const items=[...choices].filter(([,value])=>value.checked).map(([id,value])=>({id,quantity:value.quantity}));const pack=current();
    const result=await api('/api/packs',{client:selectedAccount,store:state.preferredStore,name:$('pack-name').value,items,...(pack&&!pack.learned?{id:pack.id}:{})});
    selected=result.id;signature='';await refresh();message('Pack saved. Nothing added to your cart.');
  }catch(error){message(error.message);}finally{busy(false);}};
  $('pack-add').onclick=async()=>{
    if(packBusy)return;const target=selectedAccount,store=state.preferredStore;busy(true);
    try{
      const pack=current();if(!pack)throw Error('Choose a pack first.');if(pack.store!==state.preferredStore)throw Error('Select '+pack.store+' as your shopping store first.');
      const selectedItems=pack.items.filter(item=>choice(item.id).checked);if(!selectedItems.length)throw Error('Select at least one product.');
      for(const item of selectedItems){const q=choice(item.id).quantity;if(!Number.isInteger(q)||q<1||q>100)throw Error('Use package quantities from 1 to 100.');if(pack.store!=='HEB'&&!state.products.find(product=>product.id===item.id)?.offerId)throw Error('Capture '+item.name+' on Walmart before adding it.');}
      const latest=await api('/api/state');if(target!==selectedAccount||store!==state.preferredStore||latest.preferredStore!==store)throw Error('The account or store changed. Review the pack again.');
      if(selectedItems.some(item=>(latest.currentPrices||[]).some(p=>p.client===target&&p.store===store&&p.id===item.id&&ShoppingAssist.availabilityFresh(p)&&p.available===false)))throw Error('A selected pack product is now unavailable. Choose an alternative or uncheck it before sending.');
      const items=selectedItems.filter(item=>(selectedLines(latest,target).find(line=>line.id===item.id)?.quantity||0)<choice(item.id).quantity).map(item=>({id:item.id,quantity:choice(item.id).quantity}));
      if(items.length)await api(pack.store==='HEB'?'/api/heb/list':'/api/repeat',{target,items});await refresh();message(items.length?'Selected pack items sent to the selected store cart. Existing quantities were preserved.':'Those quantities are already in the cart; nothing sent.');
    }catch(error){message(error.message);}finally{busy(false);}
  };
  window.renderPacks();
})();
