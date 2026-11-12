(() => {
 function render(holder){
  const {photoStore:store,photoId:id,photoName:name,photoCompact:compact}=holder.dataset;
  const photo=(state.productImages||[]).find(p=>p.store===store&&p.id===id),signature=photo?String(photo.updated):'missing';
  if(holder.dataset.photoVersion===signature)return;holder.dataset.photoVersion=signature;holder.replaceChildren();holder.classList.remove('photo-pending');
  const missing=()=>{holder.replaceChildren(document.createTextNode('No photo yet'));holder.classList.add('photo-pending');holder.setAttribute('aria-label','Photo not available for '+name);};
  if(!photo){missing();return;}holder.removeAttribute('aria-label');const img=document.createElement('img');img.src='/api/product-images/'+store+'/'+encodeURIComponent(id)+'?v='+encodeURIComponent(photo.updated);img.alt=name;img.loading='lazy';img.decoding='async';img.width=img.height=compact==='true'?48:96;img.onerror=missing;holder.append(img);
 }
 window.productPhoto=(store,id,name,compact=false)=>{const holder=document.createElement('span');holder.className='product-photo'+(compact?' compact':'');Object.assign(holder.dataset,{photoStore:store,photoId:String(id||''),photoName:name||'Saved product',photoCompact:String(compact)});render(holder);return holder;};
 window.itemPhoto=(item,compact=true)=>{
  let choices=[];
  if(item.store&&item.id)choices=[{store:item.store,id:item.id,name:item.name}];
  else{const raw=String(item.id||'').split('|');if(['HEB','Walmart'].includes(raw[0])&&raw[1])choices.push({store:raw[0],id:raw[1],name:item.name});choices.push(...(state.householdVariants||[]).filter(v=>v.client===selectedAccount&&v.groupId===item.id&&(!item.stores||item.stores.includes(v.store))).map(v=>({store:v.store,id:v.productId,name:v.name})));}
  choices.sort((a,b)=>Number(b.store===state.preferredStore)-Number(a.store===state.preferredStore));const chosen=choices.find(c=>(state.productImages||[]).some(p=>p.store===c.store&&p.id===c.id))||choices[0];const holder=chosen?productPhoto(chosen.store,chosen.id,chosen.name||item.name,compact):productPhoto(state.preferredStore,'',item.name,compact);if(chosen)holder.title=(chosen.name||item.name)+' · '+(chosen.store==='HEB'?'H-E-B':chosen.store);return holder;
 };
 window.refreshProductPhotos=()=>{for(const holder of document.querySelectorAll('.product-photo[data-photo-store]'))render(holder);};
})();
