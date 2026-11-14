const calendar=require('./web/calendar');
const DAY=86400000;
const median=values=>{const sorted=[...values].sort((a,b)=>a-b);const middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;};
function suggestions(purchases,cartLines,now=Date.now(),horizonDays=3){
  const groups=new Map(),shoppingDays=new Map();
  for(const purchase of purchases){
    const time=calendar.purchaseDay(purchase),today=calendar.today(now);if(!Number.isFinite(time)||time>today||today-time>366*DAY)continue;
    const clientDays=shoppingDays.get(purchase.client)||new Set();clientDays.add(Math.floor(time/DAY));shoppingDays.set(purchase.client,clientDays);
    const daily=new Map();for(const item of purchase.items||[])if((!item.unit||['each','g'].includes(item.unit))&&/^[a-zA-Z0-9:_-]+$/.test(item.id)&&Number.isFinite(item.quantity)&&item.quantity>0&&!/cancel|refund/i.test(item.status||''))daily.set(item.id,item);
    for(const item of daily.values()){
      const key=purchase.client+':'+item.id;const group=groups.get(key)||{client:purchase.client,id:item.id,days:new Map()};
      const day=Math.floor(time/DAY);const previous=group.days.get(day);
      group.days.set(day,{time,quantity:(previous?.quantity||0)+item.quantity,name:item.name});groups.set(key,group);
    }
  }
  const result=[];
  for(const group of groups.values()){
    const visits=[...group.days.values()].sort((a,b)=>a.time-b.time);
    if(visits.length<3||cartLines.some(line=>line.client===group.client&&line.id===group.id&&line.quantity>0))continue;
    const gaps=visits.slice(1).map((visit,index)=>(visit.time-visits[index].time)/DAY).filter(gap=>gap>=1).slice(-8);
    if(gaps.length<2)continue;
    const interval=median(gaps);if(interval>180)continue;
    const last=visits.at(-1);const due=last.time+interval*DAY;const daysUntil=Math.round((due-calendar.today(now))/DAY);
    const recentShops=[...(shoppingDays.get(group.client)||[])].sort((a,b)=>a-b).slice(-16),recentPurchaseDays=recentShops.filter(day=>group.days.has(day)).length;
    // A ranking score, not a calibrated probability: favor recent shopping participation
    // and gradually fade habits that have gone quiet for several usual intervals.
    const age=(calendar.today(now)-last.time)/DAY,nextShopScore=recentPurchaseDays/Math.max(1,recentShops.length)*Math.min(1,Math.exp(-(age/interval-1)/3)),recommended=age>0&&nextShopScore>=.2;
    if(daysUntil>horizonDays&&!recommended)continue;
    const deviation=median(gaps.map(gap=>Math.abs(gap-interval)))/interval;
    const regularShare=gaps.filter(gap=>Math.abs(gap-interval)<=Math.max(2,interval*.4)).length/gaps.length;
    const regular=gaps.length>=3&&deviation<=.25&&regularShare>=.75;
    result.push({nextShopScore,recommended,recentPurchaseDays,recentShoppingDays:recentShops.length,recommendationReason:'Bought on '+recentPurchaseDays+' of your last '+recentShops.length+' shopping dates. '+(age===0?'Bought today; review your stock before buying it again.':recommended?'Recent frequency and recency make this worth checking for the next shop.':'Timing varies; review what you have before adding.'),client:group.client,id:group.id,name:last.name||'Walmart item '+group.id,quantity:Math.min(100000,median(visits.slice(-5).map(visit=>visit.quantity))),quantitySampleSize:Math.min(5,visits.length),latestQuantity:last.quantity,intervalDays:Math.round(interval),daysUntil,dueAt:new Date(due).toISOString(),lastPurchasedAt:new Date(last.time).toISOString(),lastPurchasedDay:last.time,purchaseCount:visits.length,gapCount:gaps.length,minGap:Math.min(...gaps),maxGap:Math.max(...gaps),timingReliability:regular?'regular':gaps.length<3?'early':'variable',confidence:regular?'established':'learning'});
  }
  return result.sort((a,b)=>Number(b.recommended)-Number(a.recommended)||b.nextShopScore-a.nextShopScore||a.daysUntil-b.daysUntil||a.id.localeCompare(b.id));
}
module.exports={suggestions};
