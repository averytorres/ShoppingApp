(function(root){
  const calendar=typeof module!=='undefined'&&module.exports?require('./calendar'):root.HouseholdCalendar;
  const DAY=86400000,grams={lb:453.59237,oz:28.349523125,g:1,kg:1000};
  const median=values=>{const v=[...values].sort((a,b)=>a-b),m=Math.floor(v.length/2);return v.length%2?v[m]:(v[m-1]+v[m])/2;};
  const cadenceBands=[{name:'Every few days',label:'Every few days',max:4},{name:'Weekly',label:'About weekly',max:10},{name:'Every two weeks',label:'About every 2 weeks',max:20},{name:'Monthly',label:'About monthly',max:45},{name:'Every few months',label:'Every few months',max:120},{name:'Less often',label:'Less often',max:Infinity}];
  const percentile=(values,fraction)=>{const v=[...values].sort((a,b)=>a-b),pos=(v.length-1)*fraction,index=Math.floor(pos);return v[index]+(v[Math.min(index+1,v.length-1)]-v[index])*(pos-index);};
  const week=time=>{const d=new Date(time);d.setUTCHours(0,0,0,0);d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.getTime();};
  function analyze(state,{client,store='all',days=90,now=Date.now()}={}){
    const end=calendar.today(now),start=days?end-(days-1)*DAY:0;
    const purchases=(state.purchases||[]).filter(p=>p.client===client&&(store==='all'||p.store===store)&&calendar.purchaseDay(p)>=start&&calendar.purchaseDay(p)<=end);
    const groups=new Map((state.householdItems||[]).map(g=>[g.id,g]));
    const links=new Map((state.householdVariants||[]).filter(v=>v.client===client).map(v=>[v.store+'|'+v.productId+'|'+v.unit,v]));
    const weighted=new Set((state.householdVariants||[]).filter(v=>v.client===client&&v.unit!=='each').map(v=>v.groupId));
    const items=new Map(),weeks=new Map();let receiptSpend=0,receiptOrders=0,knownSpend=0,pricedRows=0,totalRows=0,completeOrders=0;
    const first=purchases.length?Math.min(...purchases.map(p=>calendar.purchaseDay(p))):end;
    const recorded=(state.purchases||[]).filter(p=>p.client===client&&(store==='all'||p.store===store)&&calendar.purchaseDay(p)<=end);
    const historyStart=recorded.length?Math.min(...recorded.map(p=>calendar.purchaseDay(p))):end;
    const effectiveStart=Math.max(start,historyStart);const coveredDays=Math.max(1,Math.floor((end-Math.floor(effectiveStart/DAY)*DAY)/DAY)+1);for(let w=week(effectiveStart);w<=week(end);w+=7*DAY)weeks.set(w,{at:w,Walmart:0,HEB:0,spend:0,missing:0});
    for(const purchase of purchases){
      const time=calendar.purchaseDay(purchase),day=Math.floor(time/DAY),w=weeks.get(week(time));w[purchase.store]=(w[purchase.store]||0)+1;
      const receipt=purchase.receipt;
      if(receipt?.state==='verified'&&Number.isFinite(receipt.total)){receiptSpend+=receipt.total;receiptOrders++;w.spend+=receipt.total;}else w.missing++;
      let complete=true;
      for(const item of purchase.items||[]){
        if(!Number.isFinite(item.quantity)||item.quantity<=0)continue;totalRows++;
        const unit=item.unit||'each',link=links.get(purchase.store+'|'+item.id+'|'+unit),key=link?.groupId||purchase.store+'|'+item.id+'|'+unit;
        const factor=unit==='each'?(link?.factor||1):grams[unit]||1;
        const row=items.get(key)||{id:key,name:groups.get(key)?.name||item.name,days:new Set(),weeks:new Map(),stores:new Set(),quantity:0,unit:unit==='each'&&!(link&&weighted.has(link.groupId))?'equivalent packages':'g',prices:[]};
        row.days.add(day);row.stores.add(purchase.store);const visits=row.weeks.get(week(time))||new Set();visits.add(day);row.weeks.set(week(time),visits);row.quantity+=item.quantity*factor;
        if(Number.isFinite(item.unitPrice)&&item.unitPrice>=0){const amount=Number.isFinite(item.lineTotal)?item.lineTotal:item.unitPrice*item.quantity;knownSpend+=amount;pricedRows++;if(groups.get(key)?.kind!=='substitute')row.prices.push({store:purchase.store,price:item.unitPrice/factor,time});}else complete=false;
        items.set(key,row);
      }
      if(complete&&(purchase.items||[]).length)completeOrders++;
    }
    // The display/spending window must not erase older evidence about an active product.
    const lifetimeDays=new Map(),lifetimeStores=new Map();for(const purchase of recorded){const day=Math.floor(calendar.purchaseDay(purchase)/DAY);for(const item of purchase.items||[]){if(!(item.quantity>0))continue;const unit=item.unit||'each',link=links.get(purchase.store+'|'+item.id+'|'+unit),key=link?.groupId||purchase.store+'|'+item.id+'|'+unit;if(!items.has(key))continue;const seen=lifetimeDays.get(key)||new Set();seen.add(day);lifetimeDays.set(key,seen);const stores=lifetimeStores.get(key)||new Set();stores.add(purchase.store);lifetimeStores.set(key,stores);}}
    const patterns=[...items.values()].map(row=>{
      const dates=[...(lifetimeDays.get(row.id)||row.days)].sort((a,b)=>a-b),gaps=dates.slice(1).map((day,i)=>day-dates[i]).filter(g=>g>=1).slice(-12);
      const interval=gaps.length>=2?median(gaps):null;const variation=interval?median(gaps.map(g=>Math.abs(g-interval)))/interval:null;
      const regularShare=interval?gaps.filter(g=>Math.abs(g-interval)<=Math.max(2,interval*.4)).length/gaps.length:0;
      const consistent=gaps.length>=3&&variation<=.4&&regularShare>=.75;
      // Frequency describes the typical gap. Reliability is a separate judgment:
      // a mix of weekly and fortnightly purchases still has useful frequency evidence.
      const band=interval===null?null:cadenceBands.find(b=>Math.round(interval)<=b.max);
      const cadence=dates.length===1?'Bought once':dates.length===2?'Bought twice':band.name;
      return {...row,days:dates,stores:[...(lifetimeStores.get(row.id)||row.stores)],first:dates[0]*DAY,gaps,gapCount:gaps.length,minGap:gaps.length?Math.min(...gaps):null,maxGap:gaps.length?Math.max(...gaps):null,typicalMinGap:gaps.length?Math.floor(percentile(gaps,.25)):null,typicalMaxGap:gaps.length?Math.ceil(percentile(gaps,.75)):null,consistent,regularTiming:interval!==null&&variation<=.6&&regularShare>=.7,visits:dates.length,interval,cadence,cadenceLabel:band?.label||cadence,confidence:consistent?'Fairly regular':gaps.length<3?'Early estimate':'Variable timing',last:dates.at(-1)*DAY,repeatWeeks:[...row.weeks.values()].filter(v=>v.size>1).length};
    }).sort((a,b)=>b.visits-a.visits||a.name.localeCompare(b.name));
    const cadence=cadenceBands.map(({name,label})=>{const members=patterns.filter(p=>p.cadence===name);return {name,label,count:members.length,regular:members.filter(p=>p.consistent).length,early:members.filter(p=>p.confidence==='Early estimate').length,variable:members.filter(p=>p.confidence==='Variable timing').length};});
    const savings=[];
    if(pricedRows<totalRows)savings.push({title:'Some item prices are still missing',text:(totalRows-pricedRows)+' purchased items are missing prices. Item-price comparisons will improve as those are collected. Spending totals come from full order receipts.',kind:'data'});
    const repeat=patterns.filter(p=>p.repeatWeeks>=2).slice(0,3);
    if(repeat.length)savings.push({title:'Check these before the next top-up shop',text:repeat.map(p=>p.name+' ('+p.repeatWeeks+' weeks with repeat buys)').join('; ')+'. Planning these together may avoid an extra trip; no delivery-fee saving is assumed.',kind:'planning'});
    const regular=patterns.filter(p=>p.cadence==='Weekly'&&p.consistent).slice(0,3);
    if(regular.length)savings.push({title:'Compare unit prices on your weekly staples',text:regular.map(p=>p.name).join('; ')+'. A larger pack is better value only if its price per ounce, pound or count is lower and you can use it.',kind:'value'});
    for(const item of patterns){const recent=item.prices.filter(p=>now-p.time<=180*DAY),heb=recent.filter(p=>p.store==='HEB'),walmart=recent.filter(p=>p.store==='Walmart');if(!heb.length||!walmart.length)continue;const a=median(heb.map(p=>p.price)),b=median(walmart.map(p=>p.price));if(Math.min(a,b)>0&&Math.abs(a-b)/Math.max(a,b)>=.05){const factor=item.unit==='g'?453.59237:1;savings.push({store:a<b?'HEB':'Walmart',query:item.name,title:'Compare prices you paid before',text:item.name+': H-E-B $'+(a*factor).toFixed(2)+' versus Walmart $'+(b*factor).toFixed(2)+' '+(item.unit==='g'?'per lb':'for the same matched amount')+'. Typical prices you paid in the last 180 days. Compare the current products before choosing.',kind:'comparison'});}}
    const weekCount=weeks.size||1;
    const all=(state.purchases||[]).filter(p=>p.client===client&&(store==='all'||p.store===store)&&calendar.purchaseDay(p)<=end);
    const boundary=week(end),recentStart=boundary-28*DAY,previousStart=recentStart-28*DAY;
    const summarize=(from,to)=>{const orders=all.filter(p=>calendar.purchaseDay(p)>=from&&calendar.purchaseDay(p)<to);return {orders:orders.length,complete:orders.every(p=>p.receipt?.state==='verified'&&Number.isFinite(p.receipt.total)),total:orders.reduce((n,p)=>n+(p.receipt?.state==='verified'&&Number.isFinite(p.receipt.total)?p.receipt.total:0),0)};};
    const recent=summarize(recentStart,boundary),previous=summarize(previousStart,recentStart);
    const canCompare=all.some(p=>calendar.purchaseDay(p)<=previousStart)&&recent.complete&&previous.complete;
    const comparison={available:canCompare,recent,previous,from:recentStart,to:boundary-DAY,previousFrom:previousStart,delta:canCompare?(recent.total-previous.total)/4:null};
    const priceHistory=new Map();
    for(const purchase of all){const time=calendar.purchaseDay(purchase);for(const item of purchase.items||[]){
      if(!(item.quantity>0)||!Number.isFinite(item.lineTotal)||!String(item.priceSource||'').startsWith('receipt-'))continue;
      const exact=purchase.store+'|'+item.id+'|'+(item.unit||'each');
      if(item.quantityBasis!=='receipt-line'&&!item.id.startsWith('unmapped-')&&!(item.unit==='each'&&/\bavg\.?|\d+(?:\.\d+)?\s*[-–]\s*\d+(?:\.\d+)?\s*lbs?\b/i.test(item.name))){const packCount=Number(item.name.match(/^\((\d+)\s*pack\)/i)?.[1]||1),priceKey=exact+'|pack:'+packCount;const prices=priceHistory.get(priceKey)||[];prices.push({name:item.name,store:purchase.store,at:time,price:item.lineTotal/item.quantity,unit:item.unit||'each'});priceHistory.set(priceKey,prices);}
    }}
    const priceRises=[];for(const prices of priceHistory.values()){prices.sort((a,b)=>a.at-b.at);const latest=prices.at(-1);if(now-latest.at>90*DAY)continue;const prior=prices.filter(p=>p.at<latest.at&&latest.at-p.at<=180*DAY).at(-1);if(!prior||prior.price<=0)continue;const percent=(latest.price/prior.price-1)*100;if(percent>=5&&latest.price-prior.price>=.1)priceRises.push({...latest,previous:prior.price,previousAt:prior.at,percent});}priceRises.sort((a,b)=>b.percent-a.percent);
    const assist=typeof module!=='undefined'?require('./shopping-assist'):root.ShoppingAssist;
    const planning=(state.usualSuggestions||state.suggestions||[]).filter(item=>!assist?.isSnoozed(state,item,now)&&item.client===client&&(store==='all'||item.store===store)&&!item.needsMatch&&item.daysUntil>=-item.intervalDays*2);
    return {infrequent:{once:patterns.filter(p=>p.visits===1).length,twice:patterns.filter(p=>p.visits===2).length},coveredDays,rangeStart:effectiveStart,comparison,priceRises:priceRises.slice(0,6),planning,averageOrder:receiptOrders===purchases.length&&purchases.length?receiptSpend/purchases.length:null,ordersPerWeek:purchases.length/(coveredDays/7),orders:purchases.length,stores:{HEB:purchases.filter(p=>p.store==='HEB').length,Walmart:purchases.filter(p=>p.store==='Walmart').length},first:purchases.length?first:null,last:purchases.length?Math.max(...purchases.map(p=>calendar.purchaseDay(p))):null,weeks:[...weeks.values()],weekCount,receiptSpend,receiptOrders,knownSpend,pricedRows,totalRows,completeOrders,coverage:totalRows?pricedRows/totalRows:0,averageWeekly:purchases.length&&receiptOrders===purchases.length?receiptSpend/(coveredDays/7):null,patterns,cadence,savings:savings.sort((a,b)=>Number(b.kind==='comparison')-Number(a.kind==='comparison')).slice(0,5)};
  }
  const api={analyze,median,week};if(typeof module!=='undefined')module.exports=api;else root.GroceryStatistics=api;
})(globalThis);
