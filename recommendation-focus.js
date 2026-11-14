const calendar=require('./web/calendar');
const {build}=require('./recommendation-evidence');
const DAY=86400000;

// Combine distinct repeat-purchase signals after calibrating them on completed
// earlier weeks. Values are used for ranking, not displayed as probabilities.
const experts=[10,5,6,8,9,11,13,14,16,17,18];

function calibrate(rows){
  const sorted=[...rows].sort((a,b)=>a.score-b.score);
  const prior=(rows.reduce((n,row)=>n+row.bought,0)+1)/(rows.length+2);
  const size=Math.max(20,Math.floor(sorted.length/12)),bins=[];
  let group=[];
  const finish=()=>{
    bins.push({at:group.at(-1).score,count:group.length+5,bought:group.reduce((n,row)=>n+row.bought,0)+5*prior});
    group=[];
  };
  for(let i=0;i<sorted.length;i++){
    group.push(sorted[i]);
    if(group.length>=size&&(i===sorted.length-1||sorted[i].score!==sorted[i+1].score))finish();
  }
  if(group.length)finish();
  const blocks=[];
  for(const bin of bins){
    blocks.push(bin);
    while(blocks.length>1&&blocks.at(-2).bought/blocks.at(-2).count>blocks.at(-1).bought/blocks.at(-1).count){
      const right=blocks.pop(),left=blocks.pop();
      blocks.push({at:right.at,count:left.count+right.count,bought:left.bought+right.bought});
    }
  }
  return {prior,blocks};
}

function apply(calibration,score){
  const block=calibration.blocks.find(block=>score<=block.at)||calibration.blocks.at(-1);
  return block?block.bought/block.count:calibration.prior;
}

function focusScores(purchases,client,now,eligible){
  // Align completed calibration windows to the request's weekday. A Wednesday
  // forecast is compared with earlier Wednesday-to-Wednesday outcomes.
  const day=calendar.today(now),boundary=day;
  const history=purchases.filter(p=>p.client===client&&calendar.purchaseDay(p)<=day);
  const samples=[];
  let observedWeeks=0;
  for(let start=boundary-26*7*DAY;start<boundary;start+=7*DAY){
    const past=history.filter(p=>calendar.purchaseDay(p)<start);
    const actual=history.filter(p=>calendar.purchaseDay(p)>=start&&calendar.purchaseDay(p)<start+7*DAY);
    if(actual.length)observedWeeks++;
    const bought=new Set(actual.flatMap(p=>p.items.filter(i=>i.quantity>0&&!/cancel|refund/i.test(i.status||'')).map(i=>i.id)));
    for(const row of build(past,client,start,7))if(eligible.has(row.id))samples.push({row,bought:Number(bought.has(row.id))});
  }
  const current=build(history,client,day,7).filter(row=>eligible.has(row.id)&&row.count>=3&&row.age>0);
  if(samples.length<100||observedWeeks<4)return new Map(current.map(row=>[row.id,row.x[10]]));
  const calibrations=experts.map(index=>calibrate(samples.map(sample=>({score:sample.row.x[index],bought:sample.bought}))));
  return new Map(current.map(row=>[row.id,experts.reduce((total,index,i)=>total+apply(calibrations[i],row.x[index]),0)/experts.length]));
}

module.exports={focusScores,calibrate,apply};
