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
      const previous=rows.get(term);if(previous){previous.quantity+=quantity;if(previous.quantity>100)throw Error('Combined quantity is over 100 for '+term);}
      else rows.set(term,{term,id:saved?.id||'',quantity,reason:saved?'Saved household default':'Choose the product your household means',included:true,explicit:true});
    }
    // Each term is expanded once, so cycles and shared extras never multiply items.
    for(const row of rows.values())for(const rule of rules.filter(rule=>rule.trigger===row.term)){
      if(rows.has(rule.extra))continue;if(rows.size>=100)throw Error('Associations expand this list beyond 100 items.');
      const saved=defaults.find(item=>item.term===rule.extra);
      rows.set(rule.extra,{term:rule.extra,id:saved?.id||'',quantity:saved?.quantity||1,reason:'Because '+row.term+' was requested',included:row.included&&rule.mode==='include',explicit:false});
    }
    return [...rows.values()];
  }
  const api={normalize,parse};if(typeof module!=='undefined')module.exports=api;else root.ListPlanner=api;
})(globalThis);
