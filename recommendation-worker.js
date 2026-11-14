const {parentPort,workerData}=require('node:worker_threads');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
try{
 const engine=require('./recommendation-category-cycle');
 const built=engine.buildFrames(workerData.purchases,workerData.client,workerData.now,{definitions:workerData.definitions});
 const request={frames:built.frames,currentT:built.current.t,featureCount:built.featureCount};
 const run=spawnSync(workerData.python,[path.join(__dirname,'recommendation-trainer.py')],{input:JSON.stringify(request),encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:8*1024*1024,env:{...process.env,OPENBLAS_NUM_THREADS:'1',OMP_NUM_THREADS:'1',MKL_NUM_THREADS:'1',PYTHONDONTWRITEBYTECODE:'1'}});
 if(run.error||run.status!==0)throw Error('Recommendation trainer unavailable or failed');
 const training=JSON.parse(run.stdout);if(!['trained','cold-prefix','zero-target'].includes(training.status))throw Error('Invalid recommendation training response');
 const scores=[...engine.scoreCurrent(built.current,training)];
 if(scores.some(([,v])=>!Number.isFinite(v)||v<0||v>1))throw Error('Invalid recommendation score');
 parentPort.postMessage({ok:true,scores,eligible:built.current.eligible,training});
}catch(error){parentPort.postMessage({ok:false,error:'Category and cycle suggestions could not update. Run the recommendation setup on the hosting PC or choose the previous method.'});}
