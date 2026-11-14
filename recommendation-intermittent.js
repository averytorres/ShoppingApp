const calendar=require('./web/calendar');
const risk=require('./recommendation-risk');
const {calibrate,apply}=require('./recommendation-focus');
const DAY=86400000;

const median=values=>{
  const sorted=[...values].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
};
const logit=value=>{
  const p=Math.max(.002,Math.min(.998,value));
  return Math.log(p/(1-p));
};

// This selected SBA occurrence variant starts from all completed earlier gaps,
// then smooths every positive event gap. Quantity forecasts remain separate.
function sbaProbability(days,initialGap=7){
  if(!days.length)return null;
  const gaps=days.slice(1).map((day,i)=>(day-days[i])/DAY);
  let gap=gaps.length?gaps.reduce((sum,value)=>sum+value,0)/gaps.length:initialGap;
  for(const value of gaps)gap+=.1*(value-gap);
  const daily=Math.min(.999,.95/Math.max(1,gap));
  return 1-Math.pow(1-daily,7);
}

function daySeries(purchases,client,day){
  const bags=new Map();
  for(const purchase of purchases){
    if(purchase.client!==client)continue;
    const at=calendar.purchaseDay(purchase);
    if(!Number.isFinite(at)||at>day)continue;
    for(const item of purchase.items||[]){
      if(!Number.isFinite(item.quantity)||item.quantity<=0||/cancel|refund/i.test(item.status||''))continue;
      const bag=bags.get(at)||new Set();
      bag.add(item.id);bags.set(at,bag);
    }
  }
  const days=[...bags.keys()].sort((a,b)=>a-b),visits=new Map();
  for(const at of days)for(const id of bags.get(at)){
    const series=visits.get(id)||[];series.push(at);visits.set(id,series);
  }
  return {bags,days,visits};
}

function focusScores(purchases,client,now,eligible){
  const base=risk.focusScores(purchases,client,now,eligible);
  if(!base.size)return base;
  const day=calendar.today(now),{bags,days,visits}=daySeries(purchases,client,day),samples=[];
  let shoppingWeeks=0;
  // Match the experiment's 26 aligned calendar windows, retaining samples only
  // from completed windows with purchases. No future-due/older habit filtering.
  for(let start=day-26*7*DAY;start<day;start+=7*DAY){
    const bought=new Set();
    for(const at of days)if(at>=start&&at<start+7*DAY)for(const id of bags.get(at))bought.add(id);
    if(!bought.size)continue;
    shoppingWeeks++;
    const priorDays=days.filter(at=>at<start),tripGaps=priorDays.slice(1).map((at,i)=>(at-priorDays[i])/DAY).slice(-16).sort((a,b)=>a-b);
    const tripInterval=tripGaps.length?tripGaps[Math.floor(tripGaps.length/2)]:7;
    for(const [id,all] of visits){
      if(!eligible.has(id))continue;
      const past=all.filter(at=>at<start),recent=past.filter(at=>start-at<=366*DAY);
      if(recent.length<3||start-recent.at(-1)<=0)continue;
      const gaps=recent.slice(1).map((at,i)=>(at-recent[i])/DAY).slice(-8);
      if(median(gaps)>180)continue;
      samples.push({score:sbaProbability(past,tripInterval),bought:Number(bought.has(id))});
    }
  }
  if(shoppingWeeks<4||samples.length<20)return base;
  const calibration=calibrate(samples),scores=new Map();
  for(const [id,value] of base){
    const probability=sbaProbability(visits.get(id)||[]);
    // Return ranking logits, not a displayed purchase probability. Only the
    // existing repeat scorer's candidates are returned; broader lists stay separate.
    scores.set(id,probability===null?logit(value):.75*logit(value)+.25*logit(apply(calibration,probability)));
  }
  return scores;
}

module.exports={focusScores,sbaProbability,daySeries};
