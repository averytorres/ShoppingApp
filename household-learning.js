const calendar=require('./web/calendar');
const {suggestions}=require('./reorder');
const {learnedPacks}=require('./shopping-packs');
const {focusScores}=require('./recommendation-risk');
const grams={g:1,kg:1000,lb:453.59237,oz:28.349523125};
function identity(store,id,unit){return store+':'+id+':'+(unit==='each'?'each':'weight');}
function learn(purchases,cartLines,groups,links,preferredStore='HEB',now=Date.now(),horizonDays=3,options={}){
  const definitions=new Map(groups.map(group=>[group.id,group]));const variants=new Map();const sources=new Map();const weightGroups=new Set(links.filter(link=>link.unit!=='each').map(link=>link.groupId));
  const keyFor=(client,store,item)=>{
    const unit=item.unit||'each';const link=links.find(link=>link.client===client&&link.store===store&&link.productId===item.id&&link.unit===unit);
    const key=link?.groupId||identity(store,item.id,unit);return {key,link,unit};
  };
  const observed=purchases.filter(p=>{const day=calendar.purchaseDay(p);return Number.isFinite(day)&&day<=calendar.today(now);}).sort((a,b)=>calendar.purchaseDay(a)-calendar.purchaseDay(b)||a.created.localeCompare(b.created));
  const normalized=observed.map(purchase=>{
    const store=purchase.store||'Walmart';const items=[];
    for(const item of purchase.items){
      if(!Number.isFinite(item.quantity)||item.quantity<=0||/cancel|refund/i.test(item.status||''))continue;
      const {key,link,unit}=keyFor(purchase.client,store,item);const sourceKey=purchase.client+'|'+key;const time=calendar.purchaseDay(purchase);if(Number.isFinite(time)&&time<=calendar.today(now)&&calendar.today(now)-time<=366*86400000){const stores=sources.get(sourceKey)||new Set();stores.add(store);sources.set(sourceKey,stores);}if(unit!=='each'&&!grams[unit])continue;
      const factor=unit==='each'?(link?.factor||1):grams[unit];const group=definitions.get(key);
      const list=variants.get(purchase.client+'|'+key)||[];
      let observed=list.find(variant=>variant.store===store&&variant.id===item.id&&variant.unit===unit);if(!observed){observed={store,id:item.id,name:item.name,unit,factor,quantities:[]};list.push(observed);}observed.quantities.push(item.quantity);observed.lastPurchasedAt=purchase.created;
      variants.set(purchase.client+'|'+key,list);
      items.push({id:key,name:group?.name||item.name,sourceName:item.name,sourceProductId:item.id,quantity:item.quantity*factor,unit:unit==='each'&&!(link&&weightGroups.has(link.groupId))?'each':'g'});
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
    return {variant:list.filter(variant=>variant.store===preferredStore&&!variant.id.startsWith('unmapped-')).sort((a,b)=>String(b.lastPurchasedAt||'').localeCompare(String(a.lastPurchasedAt||''))||(b.quantities?.length||0)-(a.quantities?.length||0))[0],alternatives:list};
  };
  // Rank household needs before resolving products at the selected store.
  // Both store histories contribute to the same canonical item and scorer.
  const householdScores=new Map(),categoryStates=new Map(),boughtToday=new Set(normalized.filter(p=>calendar.purchaseDay(p)===calendar.today(now)).flatMap(p=>p.items.filter(i=>i.quantity>0).map(i=>p.client+'|'+i.id)));
  for(const client of new Set(normalized.map(purchase=>purchase.client))){
    const eligible=new Set(normalized.filter(purchase=>purchase.client===client).flatMap(purchase=>purchase.items.map(item=>item.id)).filter(key=>definitions.get(key)?.kind!=='substitute'));
    householdScores.set(client,focusScores(normalized,client,now,eligible));
    if(options.method==='category-cycle'&&options.categoryCycle)categoryStates.set(client,options.categoryCycle.request(normalized,client,now,groups));
  }
  const categoryReady=client=>categoryStates.get(client)?.ready;
  const sourceSuggestions=suggestions(normalized,mappedCart,now,horizonDays);
  if(options.method==='category-cycle')for(const item of suggestions(normalized,mappedCart,now,Number.MAX_SAFE_INTEGER))if(categoryReady(item.client)&&categoryStates.get(item.client).eligible[item.id]?.oneToFour&&!sourceSuggestions.some(i=>i.client===item.client&&i.id===item.id))sourceSuggestions.push(item);
  if(options.method==='category-cycle')for(const [client,state]of categoryStates)if(state.ready){
    for(const [id,info]of Object.entries(state.eligible))if(info.oneToFour&&!sourceSuggestions.some(i=>i.client===client&&i.id===id)&&!mappedCart.some(i=>i.client===client&&i.id===id&&i.quantity>0)){
      const last=calendar.today(now)-info.daysSinceLast*86400000;
      sourceSuggestions.push({client,id,name:info.name,quantity:1,intervalDays:Math.round(info.medianGapDays),daysUntil:Math.round(info.medianGapDays-info.daysSinceLast),lastPurchasedAt:new Date(last).toISOString(),lastPurchasedDay:last,purchaseCount:info.priorPurchaseDays,gapCount:info.priorPurchaseDays-1,timingReliability:info.relativeMAD<=.25&&info.priorPurchaseDays>=4?'regular':'variable',recommended:false,nextShopScore:0});
    }
  }
  const recommendations=sourceSuggestions.map(item=>{
    const {variant,alternatives}=choose(item.client,item.id);const definition=definitions.get(item.id);
    // Predict the latest purchase-day amount, then choose the nearest feasible
    // whole package at this store. Past weight cannot establish item count.
    const amount=Number.isFinite(item.latestQuantity)&&item.latestQuantity>0?item.latestQuantity:item.quantity;
    const quantity=variant?(variant.unit==='each'?Math.max(1,Math.round(amount/variant.factor)):1):null;
    const quantityNote=!variant?'Choose a matching product at this store to set a starting amount.':variant.unit!=='each'?'Starts at 1 item/package, not the past weight. Review the count; the store sets final weight.':'Starting amount from your most recent purchase day'+(definitions.has(item.id)?', adjusted to the nearest whole package at this store':'')+'. '+(!variant.quantities?.length?'No purchase quantity for this product at this store yet; review its package size.':'Review what you need today.');
    const category=categoryStates.get(item.client),active=categoryReady(item.client),automatic=active?!!category.eligible[item.id]?.oneToFour&&!boughtToday.has(item.client+'|'+item.id):undefined;
    const info=active?category.eligible[item.id]:null,timing=info?.oneToFour&&!boughtToday.has(item.client+'|'+item.id)?{intervalDays:Math.round(info.medianGapDays),daysUntil:Math.round(info.medianGapDays-info.daysSinceLast),dueAt:new Date(calendar.today(now)+(info.medianGapDays-info.daysSinceLast)*86400000).toISOString(),lastPurchasedDay:calendar.today(now)-info.daysSinceLast*86400000,lastPurchasedAt:new Date(calendar.today(now)-info.daysSinceLast*86400000).toISOString(),purchaseCount:info.priorPurchaseDays,gapCount:info.priorPurchaseDays-1,timingReliability:info.priorPurchaseDays>=4&&info.relativeMAD<=.25&&info.regularShare>=.75?'regular':info.priorPurchaseDays<4?'early':'variable'}:{};
    const score=active?category.scores.get(item.id):householdScores.get(item.client)?.get(item.id);
    return {...item,...timing,...(active?{recommendationMethod:'category-cycle',automaticSuggestionEligible:automatic,nextShopScore:Number.isFinite(score)?score:0,recommended:automatic&&Number.isFinite(score)&&score>0}:{}),...(Number.isFinite(score)?{focusedScore:score,focusedReason:active?'Prioritized by grocery category and your usual restock cycle, using purchases from both stores.':'Prioritized using your repeat purchases across both stores, usual refill intervals and recent shopping patterns.'}:{}),householdItemId:item.id,id:variant?.id||null,store:preferredStore,quantity,quantitySampleSize:variant?.unit==='each'?1:0,quantityNote,matchKind:definition?.kind||'equivalent',matchNote:definition?.note||null,unit:variant?.unit||'each',alternatives,needsMatch:!variant,sources:[...(sources.get(item.client+'|'+item.id)||[])]};
  });
  // Cap preselected items after resolving the selected store, keeping alternatives optional.
  for(const client of new Set(recommendations.map(item=>item.client))){const chosen=new Set(recommendations.filter(item=>item.client===client&&item.recommended&&!item.needsMatch&&item.matchKind!=='substitute').sort((a,b)=>b.nextShopScore-a.nextShopScore||String(a.householdItemId).localeCompare(String(b.householdItemId))).slice(0,categoryReady(client)?15:30).map(item=>item.householdItemId));for(const item of recommendations.filter(item=>item.client===client))item.recommended=chosen.has(item.householdItemId);}
  const packs=learnedPacks(normalized.map(purchase=>({...purchase,items:purchase.items.map(item=>({...item,quantity:1,unit:'each'}))})),now).map(pack=>({
    ...pack,store:preferredStore,items:pack.items.map(item=>{const {variant}=choose(pack.client,item.id);return {...item,householdItemId:item.id,id:variant?.id||item.id,name:variant?.name||item.name,quantity:variant?.unit==='each'&&variant?.quantities?.length?Math.min(100,Math.max(1,Math.round([...variant.quantities].sort((a,b)=>a-b)[Math.floor(variant.quantities.length/2)]))):1,store:preferredStore,quantityNote:variant?.unit!=='each'?'Item count, not pounds; final weight is set by the store.':!variant?.quantities?.length?'Starts at one package; no purchase quantity at this store yet.':null,needsMatch:!variant};})
  }));
  return {suggestions:recommendations,packs:packs.filter(pack=>pack.items.every(item=>!item.needsMatch)&&new Set(pack.items.map(item=>item.id)).size===pack.items.length)};
}
module.exports={learn,grams};
