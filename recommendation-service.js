const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {Worker}=require('node:worker_threads');
const calendar=require('./web/calendar');
module.exports=function({dataDirectory,onChange=()=>{}}){
 const directory=path.join(dataDirectory,'recommendations');fs.mkdirSync(directory,{recursive:true});
 const states=new Map(),queue=new Map();let running=false,revision=0;
 const version=crypto.createHash('sha256').update(['recommendation-category-cycle.js','recommendation-trainer.py','recommendation-trees.js','recommendation-public-features.js','recommendation-risk.js','recommendation-evidence.js','recommendation-category.js','models/replenishment-public.json'].map(p=>fs.readFileSync(path.join(__dirname,p))).join('')).digest('hex');
 const filename=client=>path.join(directory,crypto.createHash('sha256').update(client).digest('hex')+'.json');
 function config(){try{return JSON.parse(fs.readFileSync(path.join(directory,'config.json'),'utf8'));}catch{return {};}}
 function python(){const c=config(),venv=path.join(directory,'venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');return c.pythonExecutable||process.env.GROCERY_PYTHON||(fs.existsSync(venv)?venv:process.platform==='win32'?'python':'python3');}
 function changed(){revision++;onChange();}
 function kick(){
  if(running||!queue.size)return;const [client,job]=queue.entries().next().value;queue.delete(client);running=true;
  const worker=new Worker(path.join(__dirname,'recommendation-worker.js'),{workerData:job});let received=false;
  const finish=result=>{if(received)return;received=true;const current=states.get(client);if(current?.key===job.key){if(result.ok){const saved={key:job.key,scores:result.scores,eligible:result.eligible,training:result.training,updatedAt:new Date().toISOString()};try{const target=filename(client),temp=target+'.tmp';fs.writeFileSync(temp,JSON.stringify(saved));fs.renameSync(temp,target);states.set(client,{...saved,ready:true,status:'ready',attempt:Date.now()});}catch{states.set(client,{key:job.key,ready:false,status:'error',attempt:Date.now()});}}else states.set(client,{key:job.key,ready:false,status:'error',attempt:Date.now()});changed();}};
  worker.on('message',finish);worker.on('error',()=>finish({ok:false}));worker.on('exit',()=>{finish({ok:false});running=false;kick();});
 }
 function request(purchases,client,now,definitions){
  definitions=definitions.filter(g=>g.client===client);
  const day=calendar.today(now),history=purchases.filter(p=>p.client===client&&calendar.purchaseDay(p)<day).map(p=>({...p,items:(p.items||[]).filter(i=>i.quantity>0&&!/cancel|refund/i.test(i.status||''))}));
  const fingerprint=history.map(p=>[p.created,p.source,p.sourceStore||p.store,p.items.map(i=>[i.id,i.sourceName||i.name,i.sourceProductId||''])]);
  const key=crypto.createHash('sha256').update(JSON.stringify([version,day,fingerprint,definitions.map(g=>[g.id,g.kind]),python()])).digest('hex');
  let state=states.get(client);
  if(!state){try{const saved=JSON.parse(fs.readFileSync(filename(client),'utf8'));if(saved.key===key&&saved.eligible&&typeof saved.eligible==='object'&&!Array.isArray(saved.eligible)&&Array.isArray(saved.scores)&&saved.scores.every(v=>Array.isArray(v)&&typeof v[0]==='string'&&Number.isFinite(v[1])&&v[1]>=0&&v[1]<=1&&saved.eligible[v[0]]&&Number.isFinite(saved.eligible[v[0]].medianGapDays)&&Number.isFinite(saved.eligible[v[0]].daysSinceLast)))state={...saved,ready:true,status:'ready'};}catch{}}
  if(state?.key===key){states.set(client,state);if(state.ready)return {...state,scores:new Map(state.scores)};if(state.status==='updating'||Date.now()-state.attempt<300000)return state;}
  state={key,ready:false,status:'updating',attempt:Date.now()};states.set(client,state);queue.set(client,{key,purchases:history,client,now,definitions,python:python()});setImmediate(kick);return state;
 }
 function status(){return {revision,clients:Object.fromEntries([...states].map(([client,s])=>[client,{ready:!!s.ready,status:s.status,updatedAt:s.updatedAt||null,learning:s.training?.status==='cold-prefix'}]))};}
 function retry(){for(const [client,s]of states)if(!s.ready)states.delete(client);changed();}
 return {request,status,retry,get revision(){return revision;}};
};
