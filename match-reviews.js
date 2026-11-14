const crypto = require('node:crypto');

// Review choices are directed product pairs, not edits to canonical match groups.
module.exports = function matchReviews(db) {
  db.exec('CREATE TABLE IF NOT EXISTS product_match_reviews(id TEXT PRIMARY KEY,client TEXT NOT NULL,origin TEXT NOT NULL,data TEXT NOT NULL,updated TEXT NOT NULL)');
  const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const key = item => [item.store,item.productId,item.unit].join('|');
  const url = item => item.store === 'HEB' ? 'https://www.heb.com/product-detail/item/'+item.productId : 'https://www.walmart.com/ip/'+item.productId;
  const product = row => ({store:row.store,productId:row.productId||row.product_id,unit:row.unit,name:row.name,url:url({...row,productId:row.productId||row.product_id})});
  function rows() {
    const records = db.prepare('SELECT * FROM product_match_reviews').all();
    const saved = new Map(records.map(r => [r.id,{...r,...JSON.parse(r.data)}]));
    const links = db.prepare('SELECT client,store,product_id AS productId,unit,group_id AS groupId,factor,name FROM household_variants').all();
    const byGroup = new Map();
    for (const link of links) { const list=byGroup.get(link.groupId)||[];list.push(link);byGroup.set(link.groupId,list); }
    const result=[];
    for (const group of db.prepare("SELECT * FROM household_items WHERE kind='substitute'").all()) {
      const members=(byGroup.get(group.id)||[]).filter(v=>v.client===group.client);
      for (const source of members.filter(v=>v.store==='Walmart')) for (const target of members.filter(v=>v.store==='HEB')) {
        const id=hash([group.client,group.id,key(source),key(target)]);
        const fingerprint=hash([group.id,group.note,source,target]);
        const record=saved.get(id),valid=record?.fingerprint===fingerprint;
        const base={id,client:group.client,source:product(source),target:product(target),note:group.note||'',status:'pending',origin:'legacy',fingerprint,originalTarget:product(target)};
        const row=valid?{...base,target:record.target,note:record.note,status:record.status,updated:record.updated}:base;
        row.revision=hash([fingerprint,valid?[record.updated,record.target,record.status,record.note]:null]);result.push(row);
      }
    }
    for (const r of records.filter(r=>r.origin==='proposal')) {
      const data=JSON.parse(r.data);result.push({id:r.id,client:r.client,...data,origin:'proposal',updated:r.updated,revision:hash([r.id,r.updated,data])});
    }
    return result;
  }
  function catalog(client) {
    const items=new Map();
    for(const row of db.prepare('SELECT store,data FROM purchases WHERE client=?').all(client)) for(const item of JSON.parse(row.data)) {
      const p={store:row.store,productId:item.id,unit:item.unit||'each',name:item.name};items.set(key(p),p);
    }
    for(const p of db.prepare('SELECT store,id AS productId,unit,name FROM saved_store_products WHERE client=?').all(client))items.set(key(p),p);
    for(const p of db.prepare('SELECT store,product_id AS productId,unit,name FROM household_variants WHERE client=?').all(client))items.set(key(p),p);
    for(const r of rows().filter(r=>r.client===client))for(const p of [r.source,r.target])items.set(key(p),p);
    return [...items.values()];
  }
  function validate(raw,client,store) {
    if(!raw||raw.store!==store||!['Walmart','HEB'].includes(store))throw Error('Choose a product from the other store');
    if(!/^\d{1,25}$/.test(String(raw.productId))||!['each','lb','oz','kg','g'].includes(raw.unit))throw Error('Choose a valid product and quantity unit');
    const found=catalog(client).find(p=>key(p)===key(raw));
    if(found)return product(found);
    let link;try{link=new URL(raw.url);}catch{}
    const host=store==='HEB'?'www.heb.com':'www.walmart.com';
    const pattern=store==='HEB'?/^\/product-detail\/(?:.*\/)?(\d+)\/?$/:/^\/ip\/(?:.*\/)?(\d+)\/?$/;
    if(!link||link.protocol!=='https:'||link.hostname!==host||link.port||link.username||link.password||link.pathname.match(pattern)?.[1]!==String(raw.productId))throw Error('Paste a product-page link from the selected store');
    if(typeof raw.name!=='string'||!raw.name.trim()||raw.name.length>300)throw Error('Enter the product name, including its package size');
    return product({...raw,name:raw.name.trim()});
  }
  function save(data) {
    const client=String(data.client||'');
    if(!db.prepare('SELECT id FROM clients WHERE id=?').get(client))throw Error('Choose a connected household account');
    if(data.action==='propose') {
      const source=validate(data.source,client,data.source?.store),target=validate(data.target,client,source.store==='HEB'?'Walmart':'HEB');
      const duplicate=rows().find(r=>r.client===client&&key(r.source)===key(source)&&key(r.target)===key(target));
      if(duplicate)return {ok:true,id:duplicate.id};
      const id=crypto.randomUUID(),note=String(data.note||'').trim();if(note.length>600)throw Error('Keep the explanation under 600 characters');
      const payload={source,target,originalTarget:target,note,status:'pending'};
      db.prepare('INSERT INTO product_match_reviews VALUES(?,?,?,?,?)').run(id,client,'proposal',JSON.stringify(payload),new Date().toISOString());return {ok:true,id};
    }
    const row=rows().find(r=>r.id===data.id&&r.client===client);
    if(!row)throw Error('This review is no longer available');
    if(data.revision!==row.revision)throw Error('This choice changed. Refresh the review before saving again.');
    const status={approve:'approved',dismiss:'dismissed',reopen:'pending'}[data.action];
    if(!status)throw Error('Choose Approve, Not suitable, or Review again');
    const target=data.action==='approve'&&data.target?validate(data.target,client,row.source.store==='HEB'?'Walmart':'HEB'):row.target;
    const note=String(data.note??row.note).trim();if(note.length>600)throw Error('Keep the explanation under 600 characters');
    const payload={source:row.source,target,originalTarget:row.originalTarget||row.target,note,status,...(row.fingerprint?{fingerprint:row.fingerprint}:{})};
    db.prepare('INSERT INTO product_match_reviews VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated').run(row.id,client,row.origin,JSON.stringify(payload),new Date().toISOString());
    return {ok:true,id:row.id};
  }
  return {rows,catalog,save};
};
