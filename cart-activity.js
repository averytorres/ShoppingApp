const {randomUUID}=require('node:crypto');
module.exports=({now=Date.now}={})=>{
 const idleAfterMs=10*60*1000;
 let lastActivityAt=null,wakeId=null;
 function state(){const elapsed=lastActivityAt===null?Infinity:now()-lastActivityAt;return {active:elapsed>=0&&elapsed<idleAfterMs,lastActivityAt,idleAfterMs,wakeId};}
 function touch(ageMs=0){const waking=!state().active;if(waking)wakeId=randomUUID();const age=Number.isFinite(ageMs)?Math.min(30000,Math.max(0,ageMs)):0;lastActivityAt=Math.max(lastActivityAt??-Infinity,now()-age);return {...state(),waking};}
 return {state,touch};
};
