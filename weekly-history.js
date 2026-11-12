// Dates are calculated in the household timezone, including daylight-saving changes.
function cycle(now=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
 const date=new Date(Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day))),offset=(date.getUTCDay()+6)%7;
 date.setUTCDate(date.getUTCDate()-offset);if(offset===0&&Number(parts.hour)<2)date.setUTCDate(date.getUTCDate()-7);
 return date.toISOString().slice(0,10);
}
module.exports={cycle};
