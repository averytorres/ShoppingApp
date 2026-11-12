const calendar=require('./web/calendar');
const crypto=require('node:crypto');
function shortName(name){
  const text=String(name||'');
  // Name the product before its ingredients/flavours (whole-milk yogurt is yogurt).
  const dairy=/\byogurt\b/i.test(text);if(dairy){const flavor=/strawberr/i.test(text)?'Strawberry ':/blueberr/i.test(text)?'Blueberry ':/vanilla/i.test(text)?'Vanilla ':/plain/i.test(text)?'Plain ':'';return flavor+(/greek/i.test(text)?'Greek yogurt':'yogurt');}
  for(const [pattern,label] of [[/toilet paper/i,'Toilet paper'],[/q[ -]?tips|cotton swabs/i,'Cotton swabs'],[/bagels?/i,'Bagels'],[/\bmilk\b/i,'Milk'],[/\beggs\b/i,'Eggs'],[/\bbread\b/i,'Bread'],[/\bbutter\b/i,'Butter'],[/\bpapaya\b/i,'Papaya'],[/mandarin/i,'Mandarins'],[/apple/i,'Apples'],[/broccoli/i,'Broccoli'],[/chicken thighs/i,'Chicken thighs'],[/cucumber/i,'Cucumbers'],[/romaine|lettuce|salad blend/i,'Salad greens'],[/onion/i,'Onions'],[/tomato/i,'Tomatoes'],[/avocado/i,'Avocados'],[/cantaloupe/i,'Cantaloupe'],[/strawberr/i,'Strawberries'],[/blueberr/i,'Blueberries'],[/bananas?/i,'Bananas'],[/shrimp/i,'Shrimp'],[/kidney beans/i,'Kidney beans'],[/lemon/i,'Lemons']])if(pattern.test(text))return label;
  return text.replace(/^(?:(?:Great Value|Marketside|H-E-B|Fresh|Organic|Organics|Central Market)\s+)+/i,'').split(/[,—]/)[0].trim().slice(0,36);
}
function describe(items){const names=[...new Set(items.map(item=>shortName(item.name)))].sort((a,b)=>a.localeCompare(b));return names.length<2?names[0]||'Shopping pack':names.slice(0,-1).join(', ')+' & '+names.at(-1);}
function learnedPacks(purchases,now=Date.now()){
  const days=new Map();
  for(const purchase of purchases){
    const time=calendar.purchaseDay(purchase),today=calendar.today(now);if(!Number.isFinite(time)||time>today||today-time>366*86400000)continue;
    const date=new Date(time).toISOString().slice(0,10);const key=purchase.client+':'+date;const shop=days.get(key)||{client:purchase.client,day:date,items:new Map(),sources:new Set()};
    shop.sources.add(purchase.sourceStore||purchase.store||'Walmart');
    for(const item of purchase.items||[])if((!item.unit||item.unit==='each')&&/^[a-zA-Z0-9:_-]+$/.test(item.id)&&Number.isInteger(item.quantity)&&item.quantity>0&&item.quantity<=100)shop.items.set(item.id,item);
    days.set(key,shop);
  }
  const clients=new Map();for(const shop of days.values()){if(!clients.has(shop.client))clients.set(shop.client,[]);clients.get(shop.client).push(shop);}
  const result=[];
  for(const [client,shops] of clients){
    shops.sort((a,b)=>a.day.localeCompare(b.day));const n=shops.length;if(n<6)continue;
    const frequencies=new Map(),pairs=new Map();
    for(const shop of shops){const ids=[...shop.items.keys()].sort();for(const id of ids)frequencies.set(id,(frequencies.get(id)||0)+1);for(let a=0;a<ids.length;a++)for(let b=a+1;b<ids.length;b++){const key=JSON.stringify([ids[a],ids[b]]);pairs.set(key,(pairs.get(key)||0)+1);}}
    const relation=(a,b)=>{const count=pairs.get(JSON.stringify([a,b].sort()))||0;const coverage=count/Math.max(frequencies.get(a),frequencies.get(b));const lift=count*n/(frequencies.get(a)*frequencies.get(b));return {count,coverage,lift,strong:count>=3&&coverage>=.65&&lift>=1.5};};
    const seeds=[...pairs].map(([key])=>{const ids=JSON.parse(key);return {ids,...relation(...ids)};}).filter(pair=>pair.strong).sort((a,b)=>b.lift-a.lift||b.count-a.count||a.ids.join().localeCompare(b.ids.join()));
    const candidates=new Map();
    for(const seed of seeds){let ids=[...seed.ids],matches=shops.filter(shop=>ids.every(id=>shop.items.has(id)));
      const extras=[...frequencies.keys()].filter(id=>!ids.includes(id)).sort((a,b)=>Math.min(...ids.map(id=>relation(a,id).lift))-Math.min(...ids.map(id=>relation(b,id).lift))).reverse();
      for(const id of extras){if(ids.length>=5)break;if(!ids.every(other=>relation(id,other).strong))continue;const together=matches.filter(shop=>shop.items.has(id));if(together.length>=3&&together.length/matches.length>=.8){ids.push(id);matches=together;}}
      ids.sort();const signature=ids.join(',');if(candidates.has(signature))continue;
      const items=ids.map(id=>{const rows=matches.map(shop=>shop.items.get(id));const qs=rows.map(item=>item.quantity).sort((a,b)=>a-b);return {id,name:rows.at(-1).name,quantity:qs[Math.floor(qs.length/2)]};});
      const links=ids.flatMap((id,index)=>ids.slice(index+1).map(other=>relation(id,other)));
      candidates.set(signature,{id:'learned-'+crypto.createHash('sha256').update(client+':'+signature).digest('hex').slice(0,24),client,name:describe(items),items,learned:true,togetherCount:matches.length,shoppingDays:n,minAssociation:Math.round(Math.min(...links.map(link=>link.coverage))*100),associationLift:Number(Math.min(...links.map(link=>link.lift)).toFixed(2)),lastTogether:matches.at(-1).day,sources:[...new Set(matches.flatMap(shop=>[...shop.sources]))]});
    }
    const ranked=[...candidates.values()].filter(pack=>calendar.today(now)-Date.parse(pack.lastTogether)<=120*86400000).sort((a,b)=>b.togetherCount-a.togetherCount||b.items.length-a.items.length||b.associationLift-a.associationLift);
    const accepted=[];for(const pack of ranked){if(accepted.some(old=>{const overlap=pack.items.filter(item=>old.items.some(other=>other.id===item.id)).length;return overlap/Math.min(pack.items.length,old.items.length)>=.5;}))continue;accepted.push(pack);if(accepted.length>=5)break;}result.push(...accepted);
  }
  return result;
}
module.exports={learnedPacks,describe,shortName};
