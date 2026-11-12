(function(root){
 const DAY=86400000,timeZone='America/New_York';
 const formatter=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
 function today(now=Date.now()){const p=Object.fromEntries(formatter.formatToParts(new Date(now)).map(p=>[p.type,p.value]));return Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day));}
 function purchaseDay(purchase){if(purchase.source==='history-import'||/^\d{4}-\d{2}-\d{2}$/.test(purchase.created))return Date.parse(purchase.created.slice(0,10)+'T00:00:00Z');return today(Date.parse(purchase.created));}
 const api={DAY,timeZone,today,purchaseDay,elapsed:(day,now=Date.now())=>Math.max(0,Math.round((today(now)-day)/DAY))};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.HouseholdCalendar=api;
})(globalThis);
