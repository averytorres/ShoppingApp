const calendar=require('./web/calendar');
const evidence=require('./recommendation-evidence');
const risk=require('./recommendation-risk');
const {categoryFor,productCategories}=require('./recommendation-category');
const trees=require('./recommendation-trees');
const structural=require('./recommendation-public-features');
const publicModel=require('./models/replenishment-public.json');
const DAY=86400000,WEEK=7*DAY,categories=productCategories.slice(1);
const cadences=['weekly','every2weeks','every3weeks','monthly','every2months','every3months'];
const windows=[1,2,4,8,13,26];
const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
const median=a=>{a=[...a].sort((x,y)=>x-y);return a.length?(a.length%2?a[a.length>>1]:(a[a.length/2-1]+a[a.length/2])/2):0;};
const std=a=>Math.sqrt(mean(a.map(v=>(v-mean(a))**2)));
const lex=(a,b)=>a<b?-1:a>b?1:0;
const order=d=>[...d.keys()].sort((a,b)=>d.get(b)-d.get(a)||lex(a,b));
function cadence(m){return m<=10?'weekly':m<=18?'every2weeks':m<=25?'every3weeks':m<=40?'monthly':m<=75?'every2months':'every3months';}
function positive(i){return Number.isFinite(i.quantity)&&i.quantity>0&&!/cancel|refund/i.test(i.status||'');}
function buildFrames(purchases,client,now,{definitions=[],aliases={}}={}){
 const day=calendar.today(now),defs=new Map(definitions.map(g=>[g.id,g])),need=id=>aliases[id]||id;
 const history=purchases.filter(p=>p.client===client&&calendar.purchaseDay(p)<day).map(p=>({...p,day:calendar.purchaseDay(p),items:(p.items||[]).filter(positive)})).filter(p=>p.items.length).sort((a,b)=>a.day-b.day||lex(a.created,b.created));
 if(!history.length)return {frames:[],current:{t:day,groups:[],eligible:{},anchor:{}},featureCount:94};
 const first=history[0].day,start=day-Math.max(0,Math.floor((day-first-8*WEEK)/WEEK))*WEEK;
 const rawFrames=[],frames=[];
 for(let t=start;t<=day;t+=WEEK){
  const prior=history.filter(p=>p.day<t),actual=history.filter(p=>p.day>=t&&p.day<t+WEEK);
  const rows=evidence.build(prior,client,t,7).filter(r=>defs.get(r.id)?.kind!=='substitute').map(r=>({...r,mapped:true}));
  const rf={t,rows,truth:[...new Set(actual.flatMap(p=>p.items.map(i=>i.id)))],shopping:actual.length>0};
  const rawRisk=risk.scoreFrames(rf,rawFrames.slice(-26));rawFrames.push(rf);
  const rawDays=new Map(),days=new Map(),visits=new Map(),latest=new Map();
  for(const p of prior){
   const raw=rawDays.get(p.day)||new Set(),bag=days.get(p.day)||new Set();
   p.items.forEach((i,k)=>{raw.add(i.id);const id=need(i.id);bag.add(id);if(p.day>=t-730*DAY&&defs.get(i.id)?.kind!=='substitute'){const ds=visits.get(id)||new Set();ds.add(p.day);visits.set(id,ds);}const key=[p.day,p.created,p.sourceStore||p.store||'',String(i.sourceProductId||i.rawProductId||''),k];const old=latest.get(id);const later=!old||key.some((v,n)=>key.slice(0,n).every((x,z)=>x===old.key[z])&&v>old.key[n]);if(later)latest.set(id,{key,name:i.sourceName||i.name||'',category:categoryFor({name:i.sourceName||i.name||''})});});
   rawDays.set(p.day,raw);days.set(p.day,bag);
  }
  const publicIds=rows.filter(r=>r.age>0).map(r=>r.id).sort(),px=structural.features([...rawDays].sort((a,b)=>a[0]-b[0]).map(v=>v[1]),publicIds),publicPredictions=trees.predictMany(publicModel,px),publicScores=new Map(publicIds.map((id,k)=>[id,publicPredictions[k]]));
  const eligible={},scores=new Map(),pub=new Map();
  for(const [id,set]of visits){const ds=[...set].sort((a,b)=>a-b);if(ds.length<3)continue;const gaps=ds.slice(-9).slice(1).map((v,k)=>(v-ds.slice(-9)[k])/DAY),m=median(gaps),age=(t-ds.at(-1))/DAY;if(m>90||age>3*m+14)continue;eligible[id]={name:latest.get(id)?.name||id,priorPurchaseDays:ds.length,medianGapDays:m,relativeMAD:median(gaps.map(g=>Math.abs(g-m)))/Math.max(m,1),regularShare:gaps.filter(g=>Math.abs(g-m)<=Math.max(2,m*.4)).length/gaps.length,daysSinceLast:age,cadence:cadence(m),category:latest.get(id)?.category||'Other',oneToFour:m>=3.5&&m<31.5};scores.set(id,0);pub.set(id,0);}
  for(const [id,v]of rawRisk)if(scores.has(need(id)))scores.set(need(id),Math.max(v,scores.get(need(id))));
  for(const [id,v]of publicScores)if(pub.has(need(id)))pub.set(need(id),Math.max(v,pub.get(need(id))));
  const ids=Object.keys(eligible).sort(),rr=new Map(order(scores).map((id,k)=>[id,k])),pr=new Map(order(pub).map((id,k)=>[id,k]));
  const anchor=Object.fromEntries(ids.map(id=>[id,.5*5/(5+rr.get(id))+.5*5/(5+pr.get(id))]));
  const partition=new Map();for(const id of ids){const i=eligible[id],key=i.category+'|'+i.cadence;const g=partition.get(key)||{key,category:i.category,cadence:i.cadence,ids:[]};g.ids.push(id);partition.set(key,g);}
  const truth=new Set(actual.flatMap(p=>p.items.map(i=>need(i.id)))),obs=prior.length?prior[0].day:t,groups=[];
  for(const g of [...partition.values()].sort((a,b)=>lex(a.key,b.key))){
   const inf=g.ids.map(id=>eligible[id]),members=new Set(g.ids),z=[Math.log1p(g.ids.length),...categories.map(c=>Number(c===g.category)),...cadences.map(c=>inf.filter(i=>i.cadence===c).length/inf.length)];
   for(const v of [inf.map(i=>i.daysSinceLast/Math.max(1,i.medianGapDays)),inf.map(i=>i.relativeMAD),inf.map(i=>i.priorPurchaseDays),inf.map(i=>i.medianGapDays)])z.push(mean(v),std(v),Math.min(...v),Math.max(...v));
   for(const v of [g.ids.map(id=>scores.get(id)),g.ids.map(id=>1/(61+rr.get(id))),g.ids.map(id=>pub.get(id))])z.push(v.reduce((a,b)=>a+b,0),mean(v),Math.max(...v));
   const gd=[...days].map(([d,b])=>[d,new Set([...b].filter(id=>members.has(id)))]).filter(v=>v[1].size);z.push(gd.length?(t-Math.max(...gd.map(v=>v[0])))/DAY:0,Number(gd.length>0));
   for(const w of windows){const counts=[],union=new Set();let exposure=0,fully=0;for(let step=w;step>0;step--){const lo=t-step*WEEK,hi=lo+WEEK,ex=Math.max(0,Math.min(1,(hi-Math.max(lo,obs))/WEEK));if(ex<=0)continue;const bag=new Set(gd.filter(v=>v[0]>=lo&&v[0]<hi).flatMap(v=>[...v[1]]));counts.push(bag.size);for(const id of bag)union.add(id);exposure+=ex;fully+=Number(ex===1);}const mid=Math.floor(counts.length/2);z.push(mean(counts),std(counts),counts.at(-1)||0,counts.length?counts.filter(v=>v>0).length/counts.length:0,union.size,exposure,fully,mid?mean(counts.slice(mid))-mean(counts.slice(0,mid)):0);}
   if(z.length!==94||z.some(v=>!Number.isFinite(v)))throw Error('Invalid category-cycle features');
   groups.push({...g,n:g.ids.length,features:z.map(Math.fround),targetCount:g.ids.filter(id=>truth.has(id)).length,publicSum:g.ids.reduce((s,id)=>s+pub.get(id),0)});
  }
  frames.push({t,shopping:actual.length>0,groups,eligible,anchor});
 }
 return {frames:frames.slice(0,-1),current:frames.at(-1),featureCount:94};
}
function allocate(mu,weights){const n=weights.length,out=Array(n).fill(0);let remaining=Math.max(0,Math.min(n,mu)),active=Array.from({length:n},(_,k)=>k);while(active.length&&remaining>1e-12){const sum=active.reduce((s,k)=>s+Math.max(weights[k],1e-12),0),pp=active.map(k=>remaining*Math.max(weights[k],1e-12)/sum),sat=active.filter((k,j)=>pp[j]>=1);if(!sat.length){active.forEach((k,j)=>out[k]=pp[j]);break;}for(const k of sat)out[k]=1;remaining-=sat.length;const full=new Set(sat);active=active.filter(k=>!full.has(k));}return out;}
function scoreCurrent(current,training){const scores=new Map(),predictions=training.status==='trained'?trees.predictMany(training.model,current.groups.map(g=>g.features)):[];current.groups.forEach((g,j)=>{const mu=training.status==='zero-target'?0:training.status==='cold-prefix'?g.publicSum:g.n*predictions[j],v=allocate(mu,g.ids.map(id=>Math.max(current.anchor[id],1e-6)));g.ids.forEach((id,k)=>scores.set(id,v[k]));});return scores;}
module.exports={buildFrames,scoreCurrent,allocate,cadence,categories};
