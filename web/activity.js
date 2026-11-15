(() => {
 let sentAt=0,lastActivityAt=Date.now(),timer;
 async function send(){
  clearTimeout(timer);timer=undefined;if(document.hidden)return;
  sentAt=Date.now();
  try{await api('/api/activity',{ageMs:Math.max(0,Date.now()-lastActivityAt)});}catch{sentAt=0;}
 }
 function activity(){
  if(document.hidden)return;
  lastActivityAt=Date.now();
  const delay=30000-(Date.now()-sentAt);
  if(delay<=0)send();else if(!timer)timer=setTimeout(send,delay);
 }
 for(const name of ['pointerdown','keydown','input','wheel','touchstart'])document.addEventListener(name,activity,{passive:true,capture:true});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(timer);timer=undefined;}else{lastActivityAt=Date.now();send();}});
 window.addEventListener('focus',()=>{lastActivityAt=Date.now();send();});
 if(!document.hidden)send();
})();
