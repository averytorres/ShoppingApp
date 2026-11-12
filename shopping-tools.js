const crypto=require('node:crypto');
const calendar=require('./web/calendar');
module.exports=db=>{
 db.exec(`CREATE TABLE IF NOT EXISTS item_snoozes(client TEXT,item_key TEXT,until_day TEXT,name TEXT,PRIMARY KEY(client,item_key));
 CREATE TABLE IF NOT EXISTS reusable_lists(id TEXT PRIMARY KEY,client TEXT,store TEXT,name TEXT,data TEXT,updated TEXT);
 CREATE TABLE IF NOT EXISTS replacement_preferences(client TEXT,store TEXT,source_id TEXT,target_id TEXT,PRIMARY KEY(client,store,source_id));
 CREATE TABLE IF NOT EXISTS store_price_history(client TEXT,store TEXT,id TEXT,at TEXT,data TEXT,PRIMARY KEY(client,store,id,at));
 INSERT OR IGNORE INTO store_price_history SELECT client,store,id,json_extract(data,'$.at'),data FROM store_prices WHERE json_extract(data,'$.at') IS NOT NULL;
 CREATE TRIGGER IF NOT EXISTS store_price_history_insert AFTER INSERT ON store_prices BEGIN
 INSERT OR IGNORE INTO store_price_history VALUES(NEW.client,NEW.store,NEW.id,json_extract(NEW.data,'$.at'),NEW.data); END;
 CREATE TRIGGER IF NOT EXISTS store_price_history_update AFTER UPDATE ON store_prices BEGIN
 INSERT OR IGNORE INTO store_price_history VALUES(NEW.client,NEW.store,NEW.id,json_extract(NEW.data,'$.at'),NEW.data); END;`);
 function known(client,store,id){if(!/^\d{1,25}$/.test(id))return false;if(store==='Walmart'&&db.prepare('SELECT id FROM products WHERE id=?').get(id))return true;if(db.prepare('SELECT id FROM saved_store_products WHERE client=? AND store=? AND id=?').get(client,store,id)||db.prepare('SELECT product_id FROM household_variants WHERE client=? AND store=? AND product_id=?').get(client,store,id))return true;return db.prepare('SELECT data FROM purchases WHERE client=? AND store=?').all(client,store).some(p=>JSON.parse(p.data).some(i=>i.id===id));}
 const key=(client,store,id)=>db.prepare('SELECT group_id FROM household_variants WHERE client=? AND store=? AND product_id=?').get(client,store,id)?.group_id||store+':'+id;
 function handle(route,data){const client=String(data.client||data.target||''),store=String(data.store||'');if(!db.prepare('SELECT id FROM clients WHERE id=?').get(client))throw Error('Choose a household account');
  if(route==='/api/snoozes'){
   if(data.remove){db.prepare('DELETE FROM item_snoozes WHERE client=? AND item_key=?').run(client,String(data.key));return {ok:true};}
   if(!['HEB','Walmart'].includes(store)||!known(client,store,String(data.id)))throw Error('Choose a saved product');const until=String(data.until||''),day=Date.parse(until+'T00:00:00Z'),today=calendar.today();if(!/^\d{4}-\d{2}-\d{2}$/.test(until)||!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==until||day<=today||day>today+366*86400000)throw Error('Choose a future date within the next year');
   db.prepare('INSERT OR REPLACE INTO item_snoozes VALUES(?,?,?,?)').run(client,key(client,store,String(data.id)),until,String(data.name||'Saved item').slice(0,300));return {ok:true};
  }
  if(route==='/api/reusable-lists'){
   if(data.remove){db.prepare('DELETE FROM reusable_lists WHERE client=? AND id=?').run(client,String(data.id));return {ok:true};}
   const name=String(data.name||'').trim();if(!['HEB','Walmart'].includes(store)||!name||name.length>80)throw Error('Choose a store and a list name of 1–80 characters');
   if(!Array.isArray(data.rows)||!data.rows.length||data.rows.length>100)throw Error('Save 1–100 reviewed list items');
   const rows=data.rows.map(r=>{const term=String(r.term||'').trim(),id=String(r.id||'');if(!term||term.length>100||!Number.isInteger(r.quantity)||r.quantity<1||r.quantity>100||id&&!known(client,store,id))throw Error('Check each requested item, product and quantity');return {term,id,quantity:r.quantity,included:r.included!==false,explicit:r.explicit!==false,remember:false,reason:String(r.reason||'Saved list choice').slice(0,300)};});
   const id=data.id?String(data.id):crypto.randomUUID();if(data.id&&!db.prepare('SELECT id FROM reusable_lists WHERE client=? AND store=? AND id=?').get(client,store,id))throw Error('That saved list belongs to another account or store');
   if(db.prepare('SELECT id FROM reusable_lists WHERE client=? AND store=? AND name=? COLLATE NOCASE AND id<>?').get(client,store,name,id))throw Error('That list name already exists. Choose another name or update the saved list.');
   if(!data.id&&db.prepare('SELECT count(*) n FROM reusable_lists WHERE client=?').get(client).n>=100)throw Error('You already have 100 saved lists');
   db.prepare('INSERT OR REPLACE INTO reusable_lists VALUES(?,?,?,?,?,?)').run(id,client,store,name,JSON.stringify({text:String(data.text||'').slice(0,10000),rows}),new Date().toISOString());return {ok:true,id};
  }
  if(route==='/api/replacement-preferences'){
   if(!['HEB','Walmart'].includes(store)||!known(client,store,String(data.sourceId)))throw Error('Choose a saved source product');if(data.remove){db.prepare('DELETE FROM replacement_preferences WHERE client=? AND store=? AND source_id=?').run(client,store,data.sourceId);return {ok:true};}
   if(data.sourceId===data.targetId||!known(client,store,String(data.targetId)))throw Error('Choose a different saved replacement');db.prepare('INSERT OR REPLACE INTO replacement_preferences VALUES(?,?,?,?)').run(client,store,data.sourceId,data.targetId);return {ok:true};
  }
  throw Error('Unknown shopping tool');
 }
 function state(){return {itemSnoozes:db.prepare('SELECT client,item_key AS key,until_day AS until,name FROM item_snoozes').all(),savedLists:db.prepare('SELECT * FROM reusable_lists ORDER BY updated DESC').all().map(r=>({...r,...JSON.parse(r.data),data:undefined})),replacementPreferences:db.prepare('SELECT client,store,source_id AS sourceId,target_id AS targetId FROM replacement_preferences').all(),priceHistory:db.prepare("SELECT client,store,id,data FROM store_price_history WHERE at>=? ORDER BY at DESC LIMIT 5000").all(new Date(Date.now()-180*86400000).toISOString()).map(r=>({...JSON.parse(r.data),client:r.client,store:r.store,id:r.id}))};}
 return {state,handle};
};
