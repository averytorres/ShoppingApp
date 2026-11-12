var StoreTaskRunner=(()=>{
 let busy=false;
 async function tick(){if(busy)return;busy=true;let task,tab;try{
   const old=await chrome.storage.local.get('activeStoreTask');if(old.activeStoreTask){await Household.taskRequest('/api/bridge/store-tasks/result',{id:old.activeStoreTask,result:{error:'The helper restarted during this task. Retry it in Settings.'}});await chrome.storage.local.remove('activeStoreTask');}
   task=(await Household.taskRequest('/api/bridge/store-tasks/claim'))?.task;if(!task)return;
   await chrome.storage.local.set({activeStoreTask:task.id});
   const root=task.store==='HEB'?'https://www.heb.com/my-account/your-orders':'https://www.walmart.com/orders';
   const windows=await chrome.windows.getAll({windowTypes:['normal']});
   if(windows.length)tab=await chrome.tabs.create({url:root,active:false});else{const window=await chrome.windows.create({url:root,state:'minimized',focused:false});tab=window.tabs[0];}
   let result;if(task.kind==='history')result=await HistoryRunner.task(tab.id,task.store,task.id);else if(['prices','photos'].includes(task.kind))result=await StorePriceRunner.task(tab.id,task);else throw Error('Unsupported store task: '+task.kind);
   await Household.taskRequest('/api/bridge/store-tasks/result',{id:task.id,result});
   await Household.announce(task.store,result.error?'Store sync needs attention: '+result.error:task.kind==='history'?'Purchase history is up to date.':task.kind==='photos'?'Product photo collection finished.':'Store prices checked.',!!result.error);
   if(!result.error)await chrome.tabs.remove(tab.id);
 }catch(error){if(task)await Household.taskRequest('/api/bridge/store-tasks/result',{id:task.id,result:{error:error.message}}).catch(()=>{});}finally{if(task)await chrome.storage.local.remove('activeStoreTask');busy=false;}}
 chrome.alarms.create('store-tasks',{periodInMinutes:.5});chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='store-tasks')tick();});setInterval(tick,10000);tick();return {tick};
})();
