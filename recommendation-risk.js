const calendar=require('./web/calendar');
const {build}=require('./recommendation-evidence');
const DAY=86400000;
const experts=[10,5,6,8,9,11,13,14,16,17,18];

// General model settings selected on earlier validation weeks. No household
// product identifiers, purchase records, or fitted private weights are stored.
function cadence(row){
  return row.x[23]*3>.5?'irregular':row.interval<=10?'weekly':row.interval<=21?'biweekly':row.interval<=45?'monthly':'occasional';
}
function logGamma(z){
  const c=[676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61502916214059,12.507343278686905,-.13857109526572012,9.984369578019572e-6,1.5056327351493116e-7];
  if(z<.5)return Math.log(Math.PI)-Math.log(Math.sin(Math.PI*z))-logGamma(1-z);
  z--;let x=.99999999999980993;
  for(let i=0;i<c.length;i++)x+=c[i]/(z+i+1);
  const t=z+c.length-.5;
  return .5*Math.log(2*Math.PI)+(z+.5)*Math.log(t)-t+Math.log(x);
}
const logBeta=(a,b)=>logGamma(a)+logGamma(b)-logGamma(a+b);
function concentration(stats,p){
  if(stats.size<3)return 15;
  let best=15,value=-Infinity;
  for(const strength of [.25,.5,1,2,5,10,20,50]){
    const a=Math.max(.001,p*strength),b=Math.max(.001,(1-p)*strength);
    let score=0;
    for(const row of stats.values())score+=logBeta(a+row.h,b+row.n-row.h)-logBeta(a,b);
    if(score>value){value=score;best=strength;}
  }
  return best;
}
function ranked(rows,index){
  return rows.filter(row=>row.mapped!==false&&row.count>=3&&row.age>0)
    .sort((a,b)=>b.x[index]-a.x[index]||a.id.localeCompare(b.id));
}
function scoreFrames(current,past){
  const earlier=past.filter(frame=>frame.t+7*DAY<=current.t).sort((a,b)=>a.t-b.t).slice(-26);
  const tables=experts.map(index=>{
    const bins=new Map();
    for(const frame of earlier){
      if(!frame.shopping)continue;
      const actual=new Set(frame.truth),weight=Math.pow(.5,(current.t-frame.t)/(7*DAY*13));
      ranked(frame.rows,index).forEach((row,rank)=>{
        for(const group of ['all',cadence(row)]){
          const key=group+'|'+Math.floor(rank/5),table=bins.get(key)||{n:0,h:0,own:new Map()};
          const hit=Number(actual.has(row.id)),own=table.own.get(row.id)||{n:0,h:0};
          table.n+=weight;table.h+=weight*hit;own.n+=weight;own.h+=weight*hit;
          table.own.set(row.id,own);bins.set(key,table);
        }
      });
    }
    for(const table of bins.values()){
      table.p=(table.h+1)/(table.n+2);
      table.strength=concentration(table.own,table.p);
    }
    return bins;
  });
  const ranks=experts.map(index=>new Map(ranked(current.rows,index).map((row,rank)=>[row.id,rank])));
  return new Map(ranked(current.rows,experts[0]).map(row=>{
    let calibrated=0,base=0;
    ranks.forEach((map,i)=>{
      const rank=map.get(row.id)??100,bin=Math.floor(rank/5);
      const table=tables[i].get(cadence(row)+'|'+bin)||tables[i].get('all|'+bin)||{p:.5,strength:15,own:new Map()};
      const own=table.own.get(row.id)||{h:0,n:0};
      calibrated+=(own.h+table.strength*table.p)/(own.n+table.strength);
      base+=5/(5+rank);
    });
    return [row.id,.5*(calibrated+base)/experts.length];
  }));
}
function focusScores(purchases,client,now,eligible){
  const day=calendar.today(now),history=purchases.filter(p=>p.client===client&&calendar.purchaseDay(p)<=day),past=[];
  for(let start=day-26*7*DAY;start<day;start+=7*DAY){
    const previous=history.filter(p=>calendar.purchaseDay(p)<start);
    const actual=history.filter(p=>calendar.purchaseDay(p)>=start&&calendar.purchaseDay(p)<start+7*DAY);
    const truth=[...new Set(actual.flatMap(p=>(p.items||[]).filter(i=>i.quantity>0&&!/cancel|refund/i.test(i.status||'')).map(i=>i.id)))];
    past.push({t:start,shopping:truth.length>0,truth,rows:build(previous,client,start,7).filter(row=>eligible.has(row.id))});
  }
  const rows=build(history,client,day,7).filter(row=>eligible.has(row.id));
  if(past.filter(frame=>frame.shopping).length<4)return new Map(rows.filter(row=>row.count>=3&&row.age>0).map(row=>[row.id,row.x[10]]));
  return scoreFrames({t:day,rows},past);
}
module.exports={focusScores,scoreFrames,cadence};
