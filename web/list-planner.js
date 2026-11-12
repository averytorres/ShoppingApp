(function(root){
  const normalize=text=>String(text).normalize('NFKC').toLowerCase().trim().replace(/\s+/g,' ');
  function parse(text,defaults=[],rules=[]){
    if(typeof text!=='string'||text.length>10000)throw Error('Use a list under 10,000 characters.');
    const lines=text.split(/[\n,;]+/).map(line=>line.trim()).filter(Boolean);
    if(!lines.length||lines.length>100)throw Error('Enter between 1 and 100 list items.');
    const rows=new Map();
    for(let line of lines){
      line=line.replace(/^[-*•]\s*/, '');let count=null;
      const leading=line.match(/^(\d+)\s*(?:[x×]\s*|\s+)(.+)$/i);const trailing=line.match(/^(.+?)\s+[x×]\s*(\d+)$/i);
      if(leading){count=Number(leading[1]);line=leading[2];}else if(trailing){count=Number(trailing[2]);line=trailing[1];}
      if(count!==null&&(!Number.isInteger(count)||count<1||count>100))throw Error('Quantities must be between 1 and 100 packages.');
      const term=normalize(line);if(!term||term.length>100)throw Error('Item names must be between 1 and 100 characters.');
      const saved=defaults.find(item=>item.term===term);const quantity=count??saved?.quantity??1;
      const previous=rows.get(term);if(previous){previous.entries=(previous.entries||1)+1;previous.quantity+=quantity;if(previous.quantity>100)throw Error('Combined quantity is over 100 for '+term);}
      else rows.set(term,{term,id:saved?.id||'',quantity,entries:1,reason:saved?'Saved household default':'Choose the product your household means',included:true,explicit:true});
    }
    // Each term is expanded once, so cycles and shared extras never multiply items.
    for(const row of rows.values())for(const rule of rules.filter(rule=>rule.trigger===row.term)){
      if(rows.has(rule.extra))continue;if(rows.size>=100)throw Error('Associations expand this list beyond 100 items.');
      const saved=defaults.find(item=>item.term===rule.extra);
      rows.set(rule.extra,{term:rule.extra,id:saved?.id||'',quantity:saved?.quantity||1,reason:'Because '+row.term+' was requested',included:row.included&&rule.mode==='include',explicit:false});
    }
    return [...rows.values()];
  }

  function resolve(rows,{catalog=[],purchases=[],variants=[],groups=[],defaults=[],client,store}={}){
    const words=text=>normalize(text).replace(/q[ -]?tips?/g,'cotton swabs').replace(/\btp\b/g,'toilet paper').replace(/\btomatoes\b/g,'tomato').replace(/\bpotatoes\b/g,'potato').replace(/[^\p{L}\p{N}\s%]/gu,' ').split(/\s+/).filter(Boolean).map(w=>w.endsWith('ies')?w.slice(0,-3)+'y':w.endsWith('s')&&!w.endsWith('ss')?w.slice(0,-1):w);
    const links=new Map(variants.filter(v=>v.client===client).map(v=>[v.store+'|'+v.productId+'|'+(v.unit||'each'),v])),own=new Map(),shared=new Map(),history=[];
    const calendar=typeof module!=='undefined'&&module.exports?require('./calendar'):root.HouseholdCalendar;
    for(const purchase of purchases.filter(p=>p.client===client)){const day=calendar?calendar.purchaseDay(purchase):Date.parse(purchase.created);if(!Number.isFinite(day))continue;for(const item of purchase.items||[]){if(!(item.quantity>0)||/cancel|refund/i.test(item.status||''))continue;const key=purchase.store+'|'+item.id,entry=own.get(key)||{days:new Set(),last:0};entry.days.add(day);entry.last=Math.max(entry.last,day);own.set(key,entry);history.push({store:purchase.store,name:item.name,last:day});const link=links.get(key+'|'+(item.unit||'each'));if(link){const entry=shared.get(link.groupId)||{days:new Set(),last:0};entry.days.add(day);if(day>=entry.last){entry.last=day;entry.store=purchase.store;entry.name=item.name;}shared.set(link.groupId,entry);}}}
    const genericUnsafe=new Set(['food','stuff','items','medicine','pills','cream']);
    return rows.map(row=>{
      if(row.id||genericUnsafe.has(normalize(row.term)))return {...row};const terms=words(row.term);
      const recentOther=history.filter(p=>p.store!==store&&words(row.term).every(t=>words(p.name).includes(t))&&!(/\btortilla\b/.test(words(row.term).join(' '))&&/chips/i.test(p.name))).sort((a,b)=>b.last-a.last)[0];
      const candidates=catalog.filter(product=>{
        if(store==='Walmart'&&!product.offerId)return false;const name=normalize(product.name),tokens=words(name);if(!terms.every(t=>tokens.includes(t)))return false;
        if(terms.length===1&&terms[0]==='tortilla'&&/\bchips?\b/.test(name))return false;
        if(terms.length===1&&terms[0]==='bread'&&/\b(crumbs?|soup|chowder|macaroni|mac\s*&|buns?|rolls?|pudding|stuffing|garlic|banana)\b/.test(name))return false;
        if(terms.length===1&&terms[0]==='butter'&&/\b(peanut|almond|cashew|cocoa|body|cookies?|sauce)\b/.test(name))return false;
        if(terms.length===1&&terms[0]==='milk'&&/\b(condensed|evaporated|lotion|magnesia)\b|milk chocolate/.test(name))return false;
        return true;
      }).map(product=>{const evidence=own.get(store+'|'+product.id)||{days:new Set(),last:0},link=links.get(store+'|'+product.id+'|each'),matched=shared.get(link?.groupId)||{days:new Set(),last:0},source=matched.name||recentOther?.name||'',sourceWords=words(source),similarity=words(product.name).filter(w=>sourceWords.includes(w)).length/Math.max(1,new Set([...words(product.name),...sourceWords]).size),alias=defaults.some(d=>d.id===product.id&&terms.every(t=>words(d.term).includes(t)));return {product,count:evidence.days.size,last:evidence.last,shared:matched.days.size,sharedLast:matched.last,sourceStore:matched.store,alternative:groups.find(g=>g.id===link?.groupId)?.kind==='substitute',similarity,alias};}).sort((a,b)=>Number(b.alias)-Number(a.alias)||Number(b.count>0)-Number(a.count>0)||b.last-a.last||b.sharedLast-a.sharedLast||b.similarity-a.similarity||b.count-a.count||b.shared-a.shared||a.product.name.length-b.product.name.length||String(a.product.id).localeCompare(String(b.product.id)));
      const best=candidates[0];if(!best)return {...row};
      const basis=best.alias?'Suggested from a saved household product choice':best.count?'Last bought at '+(store==='HEB'?'H-E-B':'Walmart')+' on '+new Date(best.last).toISOString().slice(0,10)+' · bought on '+best.count+' shopping '+(best.count===1?'date':'dates'):best.shared?(best.alternative?'Suggested alternative':'Suggested product')+' from your latest reviewed cross-store match on '+new Date(best.sharedLast).toISOString().slice(0,10):candidates.length===1?'Only matching saved product':'Suggested from saved products; review the type and size';
      return {...row,id:best.product.id,reason:row.explicit===false?row.reason+'. '+basis:basis,inferred:true};
    });
  }

  const api={normalize,parse,resolve};if(typeof module!=='undefined')module.exports=api;else root.ListPlanner=api;
})(globalThis);
