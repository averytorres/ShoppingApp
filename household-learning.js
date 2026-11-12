const calendar=require('./web/calendar');
const {suggestions}=require('./reorder');
const {learnedPacks}=require('./shopping-packs');
const grams={g:1,kg:1000,lb:453.59237,oz:28.349523125};
function identity(store,id,unit){return store+':'+id+':'+(unit==='each'?'each':'weight');}
function learn(purchases,cartLines,groups,links,preferredStore='HEB',now=Date.now(),horizonDays=3){
  const definitions=new Map(groups.map(group=>[group.id,group]));const variants=new Map();const sources=new Map();const weightGroups=new Set(links.filter(link=>link.unit!=='each').map(link=>link.groupId));
  const keyFor=(client,store,item)=>{
    const unit=item.unit||'each';const link=links.find(link=>link.client===client&&link.store===store&&link.productId===item.id&&link.unit===unit);
    const key=link?.groupId||identity(store,item.id,unit);return {key,link,unit};
  };
  const normalized=purchases.map(purchase=>{
    const store=purchase.store||'Walmart';const items=[];
    for(const item of purchase.items){
      const {key,link,unit}=keyFor(purchase.client,store,item);const sourceKey=purchase.client+'|'+key;const time=calendar.purchaseDay(purchase);if(Number.isFinite(time)&&time<=calendar.today(now)&&calendar.today(now)-time<=366*86400000){const stores=sources.get(sourceKey)||new Set();stores.add(store);sources.set(sourceKey,stores);}if(unit!=='each'&&!grams[unit])continue;
      const factor=unit==='each'?(link?.factor||1):grams[unit];const group=definitions.get(key);
      const list=variants.get(purchase.client+'|'+key)||[];
      let observed=list.find(variant=>variant.store===store&&variant.id===item.id&&variant.unit===unit);if(!observed){observed={store,id:item.id,name:item.name,unit,factor,quantities:[]};list.push(observed);}observed.quantities.push(item.quantity);observed.lastPurchasedAt=purchase.created;
      variants.set(purchase.client+'|'+key,list);
      items.push({id:key,name:group?.name||item.name,quantity:item.quantity*factor,unit:unit==='each'&&!(link&&weightGroups.has(link.groupId))?'each':'g'});
    }
    // One household item can have multiple variants in a single order.
    const merged=new Map();for(const item of items){const old=merged.get(item.id);if(old)old.quantity+=item.quantity;else merged.set(item.id,{...item});}
    return {...purchase,sourceStore:store,store:'Walmart',items:[...merged.values()]};
  });
  const mappedCart=cartLines.map(line=>({...line,id:keyFor(line.client,'Walmart',{...line,unit:'each'}).key}));
  const choose=(client,key)=>{
    const list=variants.get(client+'|'+key)||[];
    // An explicit reviewed mapping can supply a preferred-store counterpart
    // even if it has not yet appeared in a completed purchase.
    for(const link of links.filter(link=>link.client===client&&link.groupId===key))if(!list.some(variant=>variant.store===link.store&&variant.id===link.productId&&variant.unit===link.unit))list.push({store:link.store,id:link.productId,name:link.name,unit:link.unit,factor:link.unit==='each'?link.factor:grams[link.unit]});
    return {variant:list.filter(variant=>variant.store===preferredStore&&!variant.id.startsWith('unmapped-')).sort((a,b)=>(b.quantities?.length||0)-(a.quantities?.length||0)||String(b.lastPurchasedAt||'').localeCompare(String(a.lastPurchasedAt||'')))[0],alternatives:list};
  };
  const recommendations=suggestions(normalized,mappedCart,now,horizonDays).map(item=>{
    const {variant,alternatives}=choose(item.client,item.id);const definition=definitions.get(item.id);const quantity=variant?Math.max(1,(definition?.kind==='substitute'?Math.round:Math.ceil)(item.quantity/variant.factor)):null;
    const quantityNote=variant?.unit!=='each'?'Starts at 1 item/package, not the past weight. Review the count; the store sets final weight.':!variant?.quantities?.length?'Converted from the matched item’s past amounts. No purchase quantity for this product at this store yet; review the package size.':'Starting amount from the last '+item.quantitySampleSize+' purchase days'+(definitions.has(item.id)?', adjusted for this product’s matched package size':'')+'. Review what you need today.';
    return {...item,householdItemId:item.id,id:variant?.id||null,store:preferredStore,quantity,quantityNote,matchKind:definition?.kind||'equivalent',matchNote:definition?.note||null,unit:variant?.unit||'each',alternatives,needsMatch:!variant,sources:[...(sources.get(item.client+'|'+item.id)||[])]};
  });
  const packs=learnedPacks(normalized.map(purchase=>({...purchase,items:purchase.items.map(item=>({...item,quantity:1,unit:'each'}))})),now).map(pack=>({
    ...pack,store:preferredStore,items:pack.items.map(item=>{const {variant}=choose(pack.client,item.id);return {...item,householdItemId:item.id,id:variant?.id||item.id,name:variant?.name||item.name,quantity:variant?.unit==='each'&&variant?.quantities?.length?Math.min(100,Math.max(1,Math.round([...variant.quantities].sort((a,b)=>a-b)[Math.floor(variant.quantities.length/2)]))):1,store:preferredStore,quantityNote:variant?.unit!=='each'?'Item count, not pounds; final weight is set by the store.':!variant?.quantities?.length?'Starts at one package; no purchase quantity at this store yet.':null,needsMatch:!variant};})
  }));
  return {suggestions:recommendations,packs:packs.filter(pack=>pack.items.every(item=>!item.needsMatch)&&new Set(pack.items.map(item=>item.id)).size===pack.items.length)};
}
module.exports={learn,grams};
