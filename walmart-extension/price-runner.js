var StorePriceRunner=(()=>{
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 async function task(tabId,task){let checked=0;const failures=[];
  for(const item of task.payload.items){
   const url=task.store==='HEB'?'https://www.heb.com/product-detail/item/'+item.id:'https://www.walmart.com/ip/'+item.id;
   await chrome.tabs.update(tabId,{url});let result;
   for(let n=0;n<(task.kind==='photos'?60:35);n++){await sleep(400);try{result=await chrome.tabs.sendMessage(tabId,{type:task.kind==='photos'?'readStoreProduct':'readStorePrice',id:item.id});if(!result.error||(task.kind==='photos'&&result.imageUrl))break;if(/human check/.test(result.error))return {checked,error:result.error};}catch{}}
   let observation;if(result?.imageUrl)observation=await Household.taskRequest('/api/bridge/product-observations',{store:task.store,items:[{id:item.id,imageUrl:result.imageUrl,...(!result.error?{price:result}:{})}]});
   if(task.kind==='photos'){if(observation?.photos)checked++;else failures.push(item.name);}else if(result&&!result.error){await Household.taskRequest('/api/bridge/store-price',{taskId:task.id,price:result});checked++;}else failures.push(item.name);
   await Household.taskRequest('/api/bridge/store-tasks/result',{id:task.id,complete:false,result:{checked,total:task.payload.items.length}});
  }
  if(task.kind==='photos')return {checked,total:task.payload.items.length,unavailable:failures.length,failures};
  return {checked,total:task.payload.items.length,...(failures.length?{error:failures.length+(task.kind==='photos'?' photos could not be collected. Existing photos were preserved.':' prices could not be confirmed. Previous prices were preserved.'),failures}:{})};
 }
 return {task};
})();
