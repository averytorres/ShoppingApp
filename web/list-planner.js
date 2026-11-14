(function(root){
  const normalize=text=>String(text).normalize('NFKC').toLowerCase().trim().replace(/\s+/g,' ');
  function parse(text,defaults=[],rules=[]){
    if(typeof text!=='string'||text.length>10000)throw Error('Use a list under 10,000 characters.');
    const lines=text.split(/[\n,;]+/).map(line=>line.trim()).filter(Boolean);
    if(!lines.length||lines.length>100)throw Error('Enter between 1 and 100 list items.');
    const rows=new Map();
    for(let line of lines){
      const originalEntry=line;
      line=line.replace(/^[-*•]\s*/, '');let count=null;
      const leading=line.match(/^(\d+)\s*(?:[x×]\s*|\s+)(.+)$/i);const trailing=line.match(/^(.+?)\s+(?:[x×]\s*)?(\d+)$/i);
      if(leading){count=Number(leading[1]);line=leading[2];}else if(trailing){count=Number(trailing[2]);line=trailing[1];}
      if(count!==null&&(!Number.isInteger(count)||count<1||count>100))throw Error('Quantities must be between 1 and 100 packages.');
      const term=normalize(line);if(!term||term.length>100)throw Error('Item names must be between 1 and 100 characters.');
      const saved=defaults.find(item=>item.term===term);const quantity=count??saved?.quantity??1;
      const previous=rows.get(term);if(previous){previous.entries=(previous.entries||1)+1;(previous.originalEntries||=[]).push(originalEntry);previous.quantity+=quantity;if(previous.quantity>100)throw Error('Combined quantity is over 100 for '+term);}
      else rows.set(term,{term,originalEntries:[originalEntry],id:saved?.id||'',quantity,explicitQuantity:count!==null,entries:1,reason:saved?'Saved household default':'Choose the product your household means',included:true,explicit:true});
    }
    // Expand new extras and revisit only when an optional extra becomes required.
    // Each row can be added once and promoted once, so cycles always terminate.
    const pending=[...rows.values()];
    for(let index=0;index<pending.length;index++){
      const row=pending[index];for(const rule of rules.filter(rule=>rule.trigger===row.term)){
        const included=row.included&&rule.mode==='include',existing=rows.get(rule.extra);
        if(existing){if(!existing.explicit&&included&&!existing.included){existing.included=true;existing.reason='Because '+row.term+' was requested';pending.push(existing);}continue;}
        if(rows.size>=100)throw Error('Associations expand this list beyond 100 items.');
        const saved=defaults.find(item=>item.term===rule.extra),extra={term:rule.extra,id:saved?.id||'',quantity:saved?.quantity||1,reason:'Because '+row.term+' was requested',included,explicit:false};rows.set(rule.extra,extra);pending.push(extra);
      }
    }
    return [...rows.values()];
  }

  function packageQuantity(row,product){
    if(!product)return {...row};
    const term=normalize(row.term),name=normalize(product.name);
    const looseProduce=/^(?:tomato(?:es)?|onions?|potato(?:es)?|apples?|oranges?|lemons?|limes?|peppers?|avocados?|carrots?|beets?|beetroots?|cucumbers?|bananas?)$/i.test(term);
    const packaged=/\b(?:bags?|bundles?|bunch(?:es)?|packages?|packs?|punnets?|clamshells?|pints?|quarts?)\b|\b\d+(?:\.\d+)?\s*(?:lb|lbs|oz|pounds?|ounces?|kg|grams?|g)\b/i.test(name);
    const eggs=/^eggs?$/.test(term)&&/\b(?:\d+[\s-]*(?:ct|count|pk|pack)|dozen|carton)\b/i.test(name);
    if(row.explicitQuantity&&((looseProduce&&packaged)||eggs)&&row.quantity>1&&!row.packageQuantityAdjusted){return {...row,requestedQuantity:row.quantity,quantity:1,packageQuantityAdjusted:true,reason:(row.reason?row.reason+'. ':'')+'You requested '+row.quantity+' individual '+row.term+'; this product is sold as a '+(eggs?'carton':'package')+'. Starting with 1 '+(eggs?'carton':'package')+'—check its size and adjust if needed.'};}
    return {...row};
  }
  function resolve(rows,{catalog=[],purchases=[],variants=[],groups=[],defaults=[],reviews=[],client,store}={}){
    const words=text=>normalize(text)
      .replace(/\bq[ -]?tips?\b/g,'cotton swabs').replace(/\btp\b/g,'toilet paper')
      .replace(/\b(?:mince(?:d)? meat|mince(?:d)? beef|beef mince)\b/g,'ground beef')
      .replace(/\b(?:chick[ -]?peas?|garbanzo(?: beans?)?)\b/g,'chickpea')
      .replace(/\bbeetroots?\b/g,'beet').replace(/\bsweetened\b/g,'sweet')
      .replace(/\btomatoes\b/g,'tomato').replace(/\bpotatoes\b/g,'potato')
      .replace(/[^\p{L}\p{N}\s%]/gu,' ').split(/\s+/).filter(Boolean)
      .map(w=>w.endsWith('ies')?w.slice(0,-3)+'y':w.endsWith('s')&&!w.endsWith('ss')?w.slice(0,-1):w);
    const tokensMatch=(term,name)=>{
      const terms=words(term),tokens=words(name),canned=terms.some(t=>['can','canned','tinned','tin'].includes(t));
      const wanted=terms.filter(t=>!['can','canned','tinned','tin'].includes(t));
      if(!wanted.length||!wanted.every(t=>tokens.includes(t)))return false;
      if(canned){
        if(/\b(?:fresh|frozen|dried|dry|cob|flour|chips?|snack|soup)\b/i.test(name))return false;
        const explicit=/\b(?:canned|tinned|cans?)\b/i.test(name);
        const typicalCan=wanted.some(t=>['corn','bean','chickpea','pea','tomato'].includes(t))&&/\b\d+(?:\.\d+)?\s*(?:oz|ounces?|g|grams?)\b/i.test(name);
        if(!explicit&&!typicalCan)return false;
      }
      return true;
    };
    const links=new Map(variants.filter(v=>v.client===client).map(v=>[v.store+'|'+v.productId+'|'+(v.unit||'each'),v])),own=new Map(),shared=new Map(),history=[];
    const calendar=typeof module!=='undefined'&&module.exports?require('./calendar'):root.HouseholdCalendar;
    for(const purchase of purchases.filter(p=>p.client===client)){const day=calendar?calendar.purchaseDay(purchase):Date.parse(purchase.created);if(!Number.isFinite(day))continue;for(const item of purchase.items||[]){if(!(item.quantity>0)||/cancel|refund/i.test(item.status||''))continue;const key=purchase.store+'|'+item.id,entry=own.get(key)||{days:new Set(),last:0};entry.days.add(day);entry.last=Math.max(entry.last,day);own.set(key,entry);history.push({store:purchase.store,id:item.id,unit:item.unit||'each',name:item.name,last:day});const link=links.get(key+'|'+(item.unit||'each'));if(link){const entry=shared.get(link.groupId)||{days:new Set(),last:0,entries:[]};entry.entries.push({store:purchase.store,id:item.id,unit:item.unit||'each',name:item.name,day});entry.days.add(day);if(day>=entry.last){entry.last=day;entry.store=purchase.store;entry.name=item.name;}shared.set(link.groupId,entry);}}}
    const genericUnsafe=new Set(['food','stuff','items','medicine','pills','cream']);
    return rows.map(row=>{
      if(row.id)return packageQuantity(row,catalog.find(product=>product.id===row.id));if(genericUnsafe.has(normalize(row.term)))return {...row};const terms=words(row.term);
      const recentOther=history.filter(p=>p.store!==store&&tokensMatch(row.term,p.name)&&!(/\btortilla\b/.test(words(row.term).join(' '))&&/chips/i.test(p.name))).sort((a,b)=>b.last-a.last)[0];
      const approved=new Map();for(const r of reviews.filter(r=>r.client===client&&r.status==='approved'&&r.source.store!==store&&r.target.store===store&&tokensMatch(row.term,r.source.name)&&own.has(r.source.store+'|'+r.source.productId)).sort((a,b)=>String(a.updated||'').localeCompare(String(b.updated||''))))approved.set(r.target.productId,r);
      const candidates=catalog.filter(product=>{
        if(store==='Walmart'&&!product.offerId)return false;if(approved.has(product.id))return true;const name=normalize(product.name),tokens=words(name);if(!tokensMatch(row.term,product.name))return false;
        if(terms.length===1&&terms[0]==='tortilla'&&/\bchips?\b/.test(name))return false;
        if(terms.length===1&&terms[0]==='bread'&&/\b(crumbs?|soup|chowder|macaroni|mac\s*&|buns?|rolls?|pudding|stuffing|garlic|banana)\b/.test(name))return false;
        if(terms.length===1&&terms[0]==='butter'&&/\b(peanut|almond|cashew|cocoa|body|cookies?|sauce)\b/.test(name))return false;
        if(terms.length===1&&terms[0]==='salad'&&/\b(chicken|tuna|egg|potato|macaroni|dressing)\b/.test(name))return false;
        if(terms.length===1&&terms[0]==='milk'&&/\b(condensed|evaporated|lotion|magnesia)\b|milk chocolate/.test(name))return false;
        return true;
      }).map(product=>{const evidence=own.get(store+'|'+product.id)||{days:new Set(),last:0},link=links.get(store+'|'+product.id+'|each'),matched=(()=>{const original=shared.get(link?.groupId);if(!original)return {days:new Set(),last:0};const entries=original.entries.filter(e=>!reviews.some(r=>r.client===client&&r.source.store===e.store&&r.source.productId===e.id&&r.source.unit===e.unit&&(r.originalTarget||r.target).store===store&&(r.originalTarget||r.target).productId===product.id&&(r.status==='dismissed'||r.status==='approved'&&r.target.productId!==(r.originalTarget||r.target).productId)));if(entries.length===original.entries.length)return original;const latest=entries.slice().sort((a,b)=>b.day-a.day)[0];return {days:new Set(entries.map(e=>e.day)),last:latest?.day||0,name:latest?.name,store:latest?.store};})(),source=matched.name||recentOther?.name||'',sourceWords=words(source),similarity=words(product.name).filter(w=>sourceWords.includes(w)).length/Math.max(1,new Set([...words(product.name),...sourceWords]).size),alias=defaults.some(d=>(d.store||store)===store&&d.id===product.id&&words(d.term).join(' ')===terms.join(' '));return {product,reviewed:approved.has(product.id),count:evidence.days.size,last:evidence.last,shared:matched.days.size,sharedLast:matched.last,sourceStore:matched.store,alternative:groups.find(g=>g.id===link?.groupId)?.kind==='substitute',similarity,alias};}).sort((a,b)=>Number(b.alias)-Number(a.alias)||Number(b.reviewed)-Number(a.reviewed)||Number(b.count>0||b.shared>0)-Number(a.count>0||a.shared>0)||Math.max(b.last,b.sharedLast)-Math.max(a.last,a.sharedLast)||b.last-a.last||b.similarity-a.similarity||b.count-a.count||b.shared-a.shared||a.product.name.length-b.product.name.length||String(a.product.id).localeCompare(String(b.product.id)));
      const best=candidates[0];if(!best)return {...row};
      const basis=best.alias?'Suggested from a saved household product choice':best.reviewed?'Your approved cross-store alternative; review package quantities':best.count?'Last bought at '+(store==='HEB'?'H-E-B':'Walmart')+' on '+new Date(best.last).toISOString().slice(0,10)+' · bought on '+best.count+' shopping '+(best.count===1?'date':'dates'):best.shared?(best.alternative?'Suggested alternative':'Suggested product')+' from your latest reviewed cross-store match on '+new Date(best.sharedLast).toISOString().slice(0,10):candidates.length===1?'Only matching saved product':'Suggested from saved products; review the type and size';
      return packageQuantity({...row,id:best.product.id,reason:row.explicit===false?row.reason+'. '+basis:basis,inferred:true},best.product);
    });
  }

  const api={normalize,parse,resolve,packageQuantity};if(typeof module!=='undefined')module.exports=api;else root.ListPlanner=api;
})(globalThis);
