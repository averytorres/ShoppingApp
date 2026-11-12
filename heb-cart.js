const crypto=require('node:crypto');
module.exports=db=>{
 db.exec('CREATE TABLE IF NOT EXISTS heb_coupon_checks(client TEXT PRIMARY KEY,data TEXT NOT NULL,requested INTEGER NOT NULL DEFAULT 0)');
 db.exec(`CREATE TABLE IF NOT EXISTS heb_carts(client TEXT PRIMARY KEY,data TEXT NOT NULL,synced TEXT,completed INTEGER NOT NULL DEFAULT 0);CREATE TABLE IF NOT EXISTS heb_jobs(id TEXT PRIMARY KEY,client TEXT NOT NULL,created TEXT NOT NULL,state TEXT NOT NULL,data TEXT NOT NULL,result TEXT);`);
 if(!db.prepare('PRAGMA table_info(heb_carts)').all().some(c=>c.name==='last_nonempty'))db.exec('ALTER TABLE heb_carts ADD COLUMN last_nonempty TEXT');
 const jobs=client=>db.prepare("SELECT * FROM heb_jobs WHERE client=? AND state IN ('queued','running') ORDER BY created,rowid").all(client);
 const cart=client=>JSON.parse(db.prepare('SELECT data FROM heb_carts WHERE client=?').get(client)?.data||'[]');
 function state(){return {hebCoupons:db.prepare('SELECT client,data FROM heb_coupon_checks').all().map(r=>({client:r.client,...JSON.parse(r.data)})),hebCarts:db.prepare('SELECT * FROM heb_carts').all().map(row=>({...row,lines:JSON.parse(row.data),data:undefined})),hebJobs:db.prepare('SELECT * FROM heb_jobs ORDER BY created DESC LIMIT 50').all().map(row=>({...row,items:JSON.parse(row.data),result:row.result?JSON.parse(row.result):null,data:undefined}))};}
 function handle(route,data){
  const client=String(data.target||data.clientId||'');if(!db.prepare('SELECT id FROM clients WHERE id=?').get(client))throw Error('Choose a connected household account');
  if(route==='/api/heb/coupons/check'){
   db.prepare("INSERT INTO heb_coupon_checks(client,data,requested) VALUES(?,?,1) ON CONFLICT(client) DO UPDATE SET requested=1").run(client,JSON.stringify({running:false,items:[],at:new Date().toISOString()}));return {ok:true};
  }
  if(route==='/api/bridge/heb/coupons/claim'){
   const requested=!!db.prepare('SELECT requested FROM heb_coupon_checks WHERE client=?').get(client)?.requested;if(requested)db.prepare('UPDATE heb_coupon_checks SET requested=0 WHERE client=?').run(client);return {requested};
  }
  if(route==='/api/bridge/heb/coupons/result'){
   if(!Array.isArray(data.items)||data.items.length>300||!Number.isInteger(data.total)||data.total<0||data.total>300||!Number.isInteger(data.processed)||data.processed<0||data.processed>data.total)throw Error('Invalid coupon check');
   const items=data.items.map(x=>{if(!/^\d{1,25}$/.test(x.id)||!Array.isArray(x.coupons)||x.coupons.length>50)throw Error('Invalid coupon item');return {id:x.id,name:String(x.name||'').slice(0,300),quantity:Number(x.quantity)||1,error:x.error?String(x.error).slice(0,300):null,coupons:x.coupons.map(c=>{if(!/^\d{1,25}$/.test(c.id))throw Error('Invalid coupon');return {id:c.id,url:'https://www.heb.com/digital-coupon/coupon-detail/'+c.id,offer:String(c.offer||'H-E-B coupon').slice(0,300),requirements:String(c.requirements||'').slice(0,1000),status:c.status==='clipped'?'clipped':'unconfirmed',applied:c.applied===true};})};});
   const result={running:data.running===true,processed:data.processed,total:data.total,items,error:data.error?String(data.error).slice(0,300):null,at:new Date().toISOString()};
   db.prepare('INSERT INTO heb_coupon_checks(client,data) VALUES(?,?) ON CONFLICT(client) DO UPDATE SET data=excluded.data').run(client,JSON.stringify(result));return {ok:true};
  }
  if(route==='/api/heb/list'){

   const items=data.items||[data];if(!Array.isArray(items)||!items.length||items.length>100||new Set(items.map(x=>x.id)).size!==items.length)throw Error('Choose 1–100 distinct H-E-B products');
   if(jobs(client).length>=100)throw Error('Too many pending cart requests');
   const current=cart(client);for(const job of jobs(client))for(const item of JSON.parse(job.data)){const old=current.find(x=>x.id===item.id);if(old)old.quantity=item.quantity;else current.push(item);}
   const catalog=db.prepare("SELECT data FROM purchases WHERE client=? AND store='HEB'").all(client).flatMap(row=>JSON.parse(row.data));const linked=db.prepare("SELECT product_id AS id,name FROM household_variants WHERE client=? AND store='HEB'").all(client);
   const clean=items.map(item=>{if(!/^\d{1,25}$/.test(item.id)||!Number.isInteger(item.quantity)||item.quantity<0||item.quantity>100)throw Error('Use H-E-B item counts from 0 to 100');const product=[...catalog,...linked,...current].find(p=>p.id===item.id);if(!product)throw Error('Choose a saved H-E-B product');return {id:item.id,name:product.name,quantity:item.quantity,expectedQuantity:current.find(p=>p.id===item.id)?.quantity||0,ripeness:db.prepare("SELECT value FROM household_settings WHERE key='hebRipeness'").get()?.value||'No preference'};});
   const id=crypto.randomUUID();db.prepare('INSERT INTO heb_jobs VALUES(?,?,?,?,?,NULL)').run(id,client,new Date().toISOString(),'queued',JSON.stringify(clean));return {ok:true,id};
  }
  if(route==='/api/bridge/heb/claim'){
   const active=jobs(client).find(j=>j.state==='running');if(active)return {job:null};const job=jobs(client)[0];if(job)db.prepare("UPDATE heb_jobs SET state='running' WHERE id=?").run(job.id);return {job:job?{id:job.id,items:JSON.parse(job.data)}:null};
  }
  if(route==='/api/bridge/heb/cart'){
   if(!Array.isArray(data.lines)||data.lines.length>300||!Number.isFinite(data.observedAt))throw Error('Invalid H-E-B cart');
   const lines=data.lines.map(x=>{if(!/^\d{1,25}$/.test(x.id)||!Number.isInteger(x.quantity)||x.quantity<1||x.quantity>100||typeof x.name!=='string')throw Error('Unreadable H-E-B quantity');return {id:x.id,name:x.name.slice(0,300),quantity:x.quantity,unit:'each'};});
   const old=db.prepare('SELECT synced FROM heb_carts WHERE client=?').get(client);if(old&&Date.parse(old.synced)>data.observedAt)return {ok:true};
   db.prepare('INSERT INTO heb_carts(client,data,synced) VALUES(?,?,?) ON CONFLICT(client) DO UPDATE SET data=excluded.data,synced=excluded.synced,completed=CASE WHEN excluded.data=\'[]\' THEN 0 ELSE heb_carts.completed END').run(client,JSON.stringify(lines),new Date(data.observedAt).toISOString());if(lines.length)db.prepare('UPDATE heb_carts SET last_nonempty=? WHERE client=?').run(JSON.stringify(lines),client);return {ok:true};
  }
  if(route==='/api/bridge/heb/result'||route==='/api/bridge/heb/progress'){
   const job=db.prepare('SELECT * FROM heb_jobs WHERE id=? AND client=?').get(data.id,client);if(!job||job.state!=='running')return {ok:true};
   const report=(data.report||[]).slice(0,100).map(x=>({id:String(x.id||''),name:String(x.name||'').slice(0,300),status:String(x.status||'').slice(0,40)}));const result={report,error:data.error?String(data.error).slice(0,400):null};
   const done=route.endsWith('/result');const ok=!result.error&&report.length===JSON.parse(job.data).length&&report.every(x=>['updated','already-present','removed'].includes(x.status));db.prepare('UPDATE heb_jobs SET state=?,result=? WHERE id=?').run(done?(ok?'finished':'needs-attention'):'running',JSON.stringify(result),job.id);return {ok:true};
  }
  throw Error('Unknown H-E-B action');
 }
 return {state,handle};
};
