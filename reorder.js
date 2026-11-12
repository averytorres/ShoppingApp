const calendar=require('./web/calendar');
const DAY=86400000;
const median=values=>{const sorted=[...values].sort((a,b)=>a-b);const middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;};
function suggestions(purchases,cartLines,now=Date.now(),horizonDays=3){
  const groups=new Map();
  for(const purchase of purchases){
    const time=calendar.purchaseDay(purchase),today=calendar.today(now);if(!Number.isFinite(time)||time>today||today-time>366*DAY)continue;
    const daily=new Map();for(const item of purchase.items||[])if((!item.unit||['each','g'].includes(item.unit))&&/^[a-zA-Z0-9:_-]+$/.test(item.id)&&Number.isFinite(item.quantity)&&item.quantity>0)daily.set(item.id,item);
    for(const item of daily.values()){
      const key=purchase.client+':'+item.id;const group=groups.get(key)||{client:purchase.client,id:item.id,days:new Map()};
      const day=Math.floor(time/DAY);const previous=group.days.get(day);
      if(!previous||previous.time<time)group.days.set(day,{time,quantity:item.quantity,name:item.name});groups.set(key,group);
    }
  }
  const result=[];
  for(const group of groups.values()){
    const visits=[...group.days.values()].sort((a,b)=>a.time-b.time);
    if(visits.length<3||cartLines.some(line=>line.client===group.client&&line.id===group.id&&line.quantity>0))continue;
    const gaps=visits.slice(1).map((visit,index)=>(visit.time-visits[index].time)/DAY).filter(gap=>gap>=1);
    if(gaps.length<2)continue;
    const interval=median(gaps);if(interval>180)continue;
    const last=visits.at(-1);const due=last.time+interval*DAY;const daysUntil=Math.round((due-calendar.today(now))/DAY);
    if(daysUntil>horizonDays)continue;
    const deviation=median(gaps.map(gap=>Math.abs(gap-interval)))/interval;
    result.push({client:group.client,id:group.id,name:last.name||'Walmart item '+group.id,quantity:Math.min(100000,median(visits.slice(-5).map(visit=>visit.quantity))),intervalDays:Math.round(interval),daysUntil,dueAt:new Date(due).toISOString(),lastPurchasedAt:new Date(last.time).toISOString(),lastPurchasedDay:last.time,purchaseCount:visits.length,confidence:gaps.length>=3&&deviation<=.25?'established':'learning'});
  }
  return result.sort((a,b)=>a.daysUntil-b.daysUntil||a.id.localeCompare(b.id));
}
module.exports={suggestions};
