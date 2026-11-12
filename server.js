const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {suggestions}=require('./reorder');
const householdCalendar=require('./web/calendar');
const historyImport=require('./history-import');
const {learnedPacks}=require('./shopping-packs');
const householdLearning=require('./household-learning');
const launcher=require('./chrome-launcher');
const headless=require('./headless-runner');
const {WebSocketServer,WebSocket}=require('ws');
const events=new WebSocketServer({noServer:true,maxPayload:1024});
const notify=()=>{for(const peer of events.clients)if(peer.readyState===WebSocket.OPEN)peer.send('jobs-available');};
events.on('connection',peer=>{peer.on('error',()=>{});peer.send('ready');peer.on('message',message=>{if(message.toString()==='ping')peer.send('pong');});});
function attachEvents(server){
  server.on('upgrade',(req,socket,head)=>{
    const host=(req.headers.host||'').toLowerCase();
    const origin=req.headers.origin;
    const remote=(req.socket.remoteAddress||'').replace(/^::ffff:/,'');
    const allowedHost=/^(localhost|127\.0\.0\.1|192\.168\.1\.250|groceries\.local)(:\d+)?$/.test(host);
    const allowedRemote=remote==='::1'||/^127\.|^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(remote);
    if(!allowedHost||!allowedRemote||req.url!=='/api/bridge/events'||(origin&&origin!==`http://${host}`&&!origin.startsWith('chrome-extension://'))){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
    events.handleUpgrade(req,socket,head,peer=>events.emit('connection',peer,req));
  });
}
const { DatabaseSync } = require('node:sqlite');
const port = Number(process.env.PORT || 4317);
const dataDirectory = path.resolve(process.env.GROCERY_DATA_DIR || path.join(__dirname, '.data'));
fs.mkdirSync(dataDirectory, { recursive: true });
const recoveryMode=process.env.GROCERY_RECOVERY_MODE==='1'||fs.existsSync(path.join(dataDirectory,'RECOVERY-READONLY'));
const db = new DatabaseSync(path.join(dataDirectory, 'groceries.sqlite'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS history(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS shared_list(id TEXT PRIMARY KEY, quantity INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS clients(id TEXT PRIMARY KEY, seen TEXT NOT NULL, ready INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, created TEXT NOT NULL, state TEXT NOT NULL, client TEXT, data TEXT NOT NULL, result TEXT);
`);
// Additive migration keeps existing household data and completed jobs.
for(const [table,column,type] of [['clients','name',"TEXT NOT NULL DEFAULT 'My Walmart'"],['jobs','target','TEXT'],['clients','sync_version','INTEGER NOT NULL DEFAULT 0'],['clients','cart_error','TEXT']]){
  if(!db.prepare('PRAGMA table_info('+table+')').all().some(row=>row.name===column))db.exec('ALTER TABLE '+table+' ADD COLUMN '+column+' '+type);
}
db.exec('CREATE TABLE IF NOT EXISTS browser_launchers(client TEXT PRIMARY KEY, profile TEXT NOT NULL)');
const waking=new Map();
async function wake(job){if(recoveryMode)return;
  if(waking.has(job.id)||!db.prepare("SELECT id FROM jobs WHERE id=? AND state='queued'").get(job.id))return;
  const mapping=db.prepare('SELECT profile FROM browser_launchers WHERE client=?').get(job.target);
  if(!mapping)return;
  waking.set(job.id,Date.now());
  db.prepare('UPDATE jobs SET result=? WHERE id=? AND state=?').run(JSON.stringify({report:[],message:'Starting the account browser…'}),job.id,'queued');
  try{if(mapping.profile==='headless-paused')throw Error('Headless runner paused after Walmart human checks. Use the connected desktop account or reopen sign-in from browser setup.');
    if(mapping.profile==='headless'){const client=db.prepare('SELECT name FROM clients WHERE id=?').get(job.target);await headless.start(job.target,client.name);}else await launcher.launch(mapping.profile);}catch(error){
    db.prepare('UPDATE jobs SET state=?,result=? WHERE id=? AND state=?').run('needs-attention',JSON.stringify({report:[],error:error.message}),job.id,'queued');
  }
}
const wakeTimer=setInterval(()=>{if(recoveryMode)return;
  for(const job of db.prepare("SELECT id,target FROM jobs WHERE state='queued' AND target IS NOT NULL").all()){
    if(!waking.has(job.id)){wake(job);continue;}
    if(Date.now()-waking.get(job.id)>120000)db.prepare('UPDATE jobs SET state=?,result=? WHERE id=? AND state=?').run('needs-attention',JSON.stringify({report:[],error:'Chrome did not connect within two minutes. Open the selected profile and check the grocery extension and Walmart sign-in.'}),job.id,'queued');
  }
  for(const id of waking.keys())if(!db.prepare("SELECT id FROM jobs WHERE id=? AND state='queued'").get(id))waking.delete(id);
},5000);
db.exec("CREATE TABLE IF NOT EXISTS cart_lists(client TEXT NOT NULL,id TEXT NOT NULL,quantity INTEGER NOT NULL,PRIMARY KEY(client,id)); CREATE TABLE IF NOT EXISTS account_carts(client TEXT PRIMARY KEY,data TEXT NOT NULL,synced TEXT NOT NULL,completed INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS purchases(id TEXT PRIMARY KEY,client TEXT NOT NULL,created TEXT NOT NULL,data TEXT NOT NULL)");
if(!db.prepare('PRAGMA table_info(account_carts)').all().some(row=>row.name==='last_nonempty'))db.exec('ALTER TABLE account_carts ADD COLUMN last_nonempty TEXT');
if(!db.prepare('PRAGMA table_info(account_carts)').all().some(row=>row.name==='observed_at'))db.exec('ALTER TABLE account_carts ADD COLUMN observed_at INTEGER NOT NULL DEFAULT 0');
function saveCart(client,cart){
  if(!cart||!Array.isArray(cart.lines)||!Number.isFinite(cart.observedAt)||Date.now()-cart.observedAt>120000)return;
  const lines=cart.lines.filter(line=>!line.restricted&&idOK(String(line.id))&&quantityOK(line.quantity)).map(line=>({id:String(line.id),quantity:line.quantity,...(line.offerId?{offerId:line.offerId}:{}),name:String(line.name||'').slice(0,300)}));
  const previous=db.prepare('SELECT completed,last_nonempty,observed_at,data FROM account_carts WHERE client=?').get(client);
  if(previous&&cart.observedAt<=previous.observed_at)return;
  db.prepare('INSERT INTO account_carts(client,data,synced,completed) VALUES(?,?,?,?) ON CONFLICT(client) DO UPDATE SET data=excluded.data,synced=excluded.synced,completed=excluded.completed').run(client,JSON.stringify(lines),new Date().toISOString(),previous?.completed&&lines.length?1:0);
  db.prepare('UPDATE account_carts SET observed_at=? WHERE client=?').run(cart.observedAt,client);
  if(!previous?.completed&&lines.length)db.prepare('UPDATE account_carts SET last_nonempty=? WHERE client=?').run(JSON.stringify(lines),client);
  if(previous?.completed&&lines.length)return;
  queueCartProducts(client,'Walmart',JSON.parse(previous?.data||'[]'),lines,cart.observedAt);
  if(db.prepare("SELECT id FROM jobs WHERE target=? AND state IN ('queued','running')").get(client))return;
  db.prepare('DELETE FROM cart_lists WHERE client=?').run(client);
  for(const line of lines){
    const old=db.prepare('SELECT data FROM products WHERE id=?').get(line.id);
    if(!old)db.prepare('INSERT INTO products VALUES(?,?)').run(line.id,JSON.stringify(product({...line,name:line.name||'Walmart item '+line.id})));
    db.prepare('INSERT INTO cart_lists VALUES(?,?,?)').run(client,line.id,line.quantity);
  }
}
const runnerErrors=new Map();
const runnerTimer=setInterval(()=>{if(recoveryMode)return;
  for(const client of db.prepare("SELECT clients.id,clients.name FROM clients JOIN browser_launchers ON browser_launchers.client=clients.id WHERE profile='headless'").all())headless.start(client.id,client.name).then(()=>runnerErrors.delete(client.id)).catch(error=>runnerErrors.set(client.id,error.message));
},30000);
db.exec('CREATE TABLE IF NOT EXISTS list_defaults(term TEXT PRIMARY KEY,id TEXT NOT NULL,quantity INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS list_rules(trigger TEXT NOT NULL,extra TEXT NOT NULL,mode TEXT NOT NULL,PRIMARY KEY(trigger,extra))');
db.exec("CREATE TABLE IF NOT EXISTS store_list_defaults(store TEXT NOT NULL,term TEXT NOT NULL,id TEXT NOT NULL,quantity INTEGER NOT NULL,PRIMARY KEY(store,term)); CREATE TABLE IF NOT EXISTS app_migrations(name TEXT PRIMARY KEY); INSERT OR IGNORE INTO store_list_defaults SELECT 'Walmart',term,id,quantity FROM list_defaults WHERE NOT EXISTS(SELECT 1 FROM app_migrations WHERE name='store-defaults'); INSERT OR IGNORE INTO app_migrations VALUES('store-defaults');");
const normalizeTerm=require('./web/list-planner').normalize;
for(const [column,type] of [['store',"TEXT NOT NULL DEFAULT 'Walmart'"],['source',"TEXT NOT NULL DEFAULT 'manual'"]])if(!db.prepare('PRAGMA table_info(purchases)').all().some(row=>row.name===column))db.exec('ALTER TABLE purchases ADD COLUMN '+column+' '+type);
db.exec('CREATE TABLE IF NOT EXISTS import_previews(id TEXT PRIMARY KEY,created INTEGER NOT NULL,data TEXT NOT NULL,result TEXT)');
db.exec('CREATE TABLE IF NOT EXISTS shopping_packs(id TEXT PRIMARY KEY,client TEXT NOT NULL,data TEXT NOT NULL)');
db.exec('CREATE TABLE IF NOT EXISTS household_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS account_labels(client TEXT PRIMARY KEY,name TEXT NOT NULL)');
db.exec('CREATE TABLE IF NOT EXISTS household_items(id TEXT PRIMARY KEY,client TEXT NOT NULL,name TEXT NOT NULL); CREATE TABLE IF NOT EXISTS household_variants(client TEXT NOT NULL,store TEXT NOT NULL,product_id TEXT NOT NULL,unit TEXT NOT NULL,group_id TEXT NOT NULL,factor REAL NOT NULL,name TEXT NOT NULL,PRIMARY KEY(client,store,product_id,unit))');
for(const [name,type] of [['kind',"TEXT NOT NULL DEFAULT 'equivalent'"],['note',"TEXT NOT NULL DEFAULT ''"]])if(!db.prepare('PRAGMA table_info(household_items)').all().some(c=>c.name===name))db.exec('ALTER TABLE household_items ADD COLUMN '+name+' '+type);
db.exec('CREATE TABLE IF NOT EXISTS history_archive(id TEXT PRIMARY KEY,data TEXT NOT NULL,archived TEXT NOT NULL,reason TEXT NOT NULL); CREATE TABLE IF NOT EXISTS history_exclusions(id TEXT PRIMARY KEY)');
const read = table => db.prepare(`SELECT data FROM ${table}`).all().map(row => JSON.parse(row.data));
const idOK = id => typeof id === 'string' && /^\d{1,25}$/.test(id);
const quantityOK = quantity => Number.isInteger(quantity) && quantity >= 1 && quantity <= 100;
const product = item => {
  if (!idOK(item.id)) throw Error('Invalid product');
  return { id: item.id, name: String(item.name || `Walmart item ${item.id}`).slice(0,300),
    ...(typeof item.offerId === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(item.offerId) ? {offerId:item.offerId} : {}),
    url: `https://www.walmart.com/ip/${item.id}`, quantity: quantityOK(item.quantity) ? item.quantity : 1 };
};
let learningCache={key:'',value:null};
const preferredStore=()=>db.prepare("SELECT value FROM household_settings WHERE key='preferredStore'").get()?.value||'HEB';
function sharedLearning(){
 const groups=db.prepare('SELECT id,client,name,kind,note FROM household_items').all();const links=db.prepare('SELECT client,store,product_id AS productId,unit,group_id AS groupId,factor,name FROM household_variants').all();
 const carts=db.prepare('SELECT client,id,quantity FROM cart_lists').all();const stamp=db.prepare('SELECT count(*) AS count,max(rowid) AS latest,(SELECT max(id) FROM price_repair_audit) AS repairs FROM purchases').get();const store=preferredStore();
 const key=JSON.stringify({groups,links,carts,stamp,store,day:householdCalendar.today()});
 if(learningCache.key!==key){
  const purchases=db.prepare('SELECT client,created,data,store,source FROM purchases').all().map(row=>({...row,items:JSON.parse(row.data)}));const catalog=new Map();
  for(const purchase of purchases)for(const item of purchase.items){const unit=item.unit||'each';const key=purchase.client+'|'+purchase.store+'|'+item.id+'|'+unit;catalog.set(key,{client:purchase.client,store:purchase.store,productId:item.id,name:item.name,unit});}
  const learned=householdLearning.learn(purchases,carts,groups,links,store,Date.now(),7);learningCache={key,value:{...learned,itemCatalog:[...catalog.values()],groups,links}};
 }
 return learningCache.value;
}
db.exec('CREATE TABLE IF NOT EXISTS pack_dismissals(client TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(client,id))');
function readPacks(){const saved=db.prepare('SELECT data FROM shopping_packs').all().map(row=>({...JSON.parse(row.data),store:JSON.parse(row.data).store||'Walmart'}));const signature=p=>p.client+'|'+p.store+'|'+p.items.map(i=>i.id).sort().join(',');const existing=new Set(saved.map(signature)),hidden=new Set(db.prepare('SELECT client,id FROM pack_dismissals').all().map(p=>p.client+'|'+p.id));return [...saved,...sharedLearning().packs.filter(p=>!existing.has(signature(p))&&!hidden.has(p.client+'|'+p.id))];}
const hebCart=require('./heb-cart')(db);
const productImages=require('./product-images')(db,dataDirectory);
const repairHistoryPrices=require('./history-prices')(db);
const storeTasks=require('./store-tasks')(db);
const receiptProducts=require('./receipt-products')(db,storeTasks,productImages,product);
const purchaseCompletion=require('./purchase-completion')(db);
db.exec('CREATE TABLE IF NOT EXISTS store_prices(client TEXT,store TEXT,id TEXT,data TEXT,PRIMARY KEY(client,store,id))');
function matchedPriceItems(client,limit=20){const shared=sharedLearning(),frequency=new Map();for(const row of db.prepare('SELECT store,data FROM purchases WHERE client=? ORDER BY created DESC LIMIT 100').all(client))for(const item of JSON.parse(row.data)){const link=shared.links.find(v=>v.client===client&&v.store===row.store&&v.productId===item.id);if(link)frequency.set(link.groupId,(frequency.get(link.groupId)||0)+1);}return shared.groups.filter(g=>g.client===client&&g.kind!=='substitute').map(g=>({group:g,variants:shared.links.filter(v=>v.client===client&&v.groupId===g.id&&v.unit==='each')})).filter(g=>g.variants.some(v=>v.store==='HEB')&&g.variants.some(v=>v.store==='Walmart')).sort((a,b)=>(frequency.get(b.group.id)||0)-(frequency.get(a.group.id)||0)).slice(0,limit).flatMap(g=>['HEB','Walmart'].map(store=>{const v=g.variants.find(v=>v.store===store);return {store,id:v.productId,name:v.name};}));}
function routinePriceItems(client,store){const count=new Map();for(const row of db.prepare('SELECT data FROM purchases WHERE client=? AND store=? ORDER BY created DESC LIMIT 50').all(client,store))for(const i of JSON.parse(row.data)){if(!/^\d{1,25}$/.test(i.id))continue;const old=count.get(i.id)||{id:i.id,name:i.name,count:0};old.count++;count.set(i.id,old);}return [...count.values()].sort((a,b)=>b.count-a.count).slice(0,20).map(({id,name})=>({id,name}));}
function queueHistory(client,cycle){return ['Walmart','HEB'].map(store=>storeTasks.enqueue(client,store,'history',cycle));}
const lastTaskWake=new Map();
function queueCartProducts(client,store,before,after,observedAt){const old=new Set(before.map(i=>i.id)),added=after.filter(i=>!old.has(i.id));if(!added.length)return;return receiptProducts.queue(client,store,'cart-'+crypto.createHash('sha256').update(client+'|'+store+'|'+observedAt+'|'+added.map(i=>i.id).sort().join(',')).digest('hex'),added,{priceMaxAge:86400000});}
async function wakeStoreTasks(){if(recoveryMode)return;for(const row of db.prepare("SELECT DISTINCT client FROM store_tasks WHERE state='queued'").all()){if(Date.now()-Date.parse(db.prepare('SELECT seen FROM clients WHERE id=?').get(row.client)?.seen||0)<90000)continue;if(Date.now()-(lastTaskWake.get(row.client)||0)<300000)continue;lastTaskWake.set(row.client,Date.now());const mapping=db.prepare('SELECT profile FROM browser_launchers WHERE client=?').get(row.client);if(mapping&&!mapping.profile.startsWith('headless'))launcher.launch(mapping.profile).catch(()=>{});}}
function weeklyHistoryTick(){if(recoveryMode)return;const client=db.prepare("SELECT value FROM household_settings WHERE key='defaultClientId'").get()?.value;if(!client)return;queueHistory(client,require('./weekly-history').cycle());wakeStoreTasks();}
// One durable cycle per Monday. A missed run is caught up after the PC/server starts.
setTimeout(weeklyHistoryTick,15000);setInterval(weeklyHistoryTick,60000);

function state() {
  const products = read('products');
  const shared=sharedLearning();
  return { recoveryMode,productImages:productImages.state(),packDismissals:db.prepare('SELECT client,id FROM pack_dismissals').all(),hebPreferences:{ripeness:db.prepare("SELECT value FROM household_settings WHERE key='hebRipeness'").get()?.value||'No preference'},currentPrices:db.prepare('SELECT client,store,id,data FROM store_prices').all().map(p=>({...JSON.parse(p.data),client:p.client,store:p.store,id:p.id})),purchaseCompletions:purchaseCompletion.state(),storeTasks:storeTasks.state(),historySchedule:{day:'Monday',hour:2,timeZone:'America/New_York'},...hebCart.state(),products, preferredStore:preferredStore(),householdItems:shared.groups,householdVariants:shared.links,itemCatalog:[...db.prepare('SELECT client,store,id AS productId,name,unit,url FROM saved_store_products').all(),...shared.itemCatalog,...shared.links,...products.map(item=>({client:null,store:'Walmart',productId:item.id,name:item.name,unit:'each'}))], defaultClientId:db.prepare("SELECT value FROM household_settings WHERE key='defaultClientId'").get()?.value||null, packs:readPacks(), listDefaults:db.prepare('SELECT store,term,id,quantity FROM store_list_defaults').all(),listRules:db.prepare('SELECT trigger,extra,mode FROM list_rules').all(), usualSuggestions:shared.suggestions,suggestions:shared.suggestions.filter(item=>item.daysUntil<=3), runnerErrors:Object.fromEntries(runnerErrors), history: read('history').sort((a,b)=>b.startedAt.localeCompare(a.startedAt)),
    list: db.prepare('SELECT client,id,quantity FROM cart_lists').all(),
    carts:db.prepare('SELECT client,synced,completed,(last_nonempty IS NOT NULL AND completed=0) AS canComplete FROM account_carts').all(),
    purchases:db.prepare('SELECT id,client,created,data,store,source FROM purchases ORDER BY created DESC LIMIT 1000').all().map(row=>({...row,items:JSON.parse(row.data),receipt:db.prepare('SELECT subtotal,total,state,checked,source_url FROM purchase_receipts WHERE purchase=?').get(row.id)||null,data:undefined})),
    clients: db.prepare('SELECT id,name,seen,ready,sync_version,cart_error,(SELECT profile FROM browser_launchers WHERE client=clients.id) AS launchProfile FROM clients').all(),
    jobs: db.prepare('SELECT id,created,state,target,(SELECT name FROM clients WHERE clients.id=jobs.target) AS accountName,result FROM jobs ORDER BY created DESC LIMIT 20').all().map(job=>({...job,result:job.result?JSON.parse(job.result):null})) };
}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw Error('JSON required');
  let text = ''; for await (const chunk of req) {text += chunk;if(text.length>2000000)throw Error('Request too large');}
  return JSON.parse(text || '{}');
}
const server = http.createServer(async(req,res)=>{
  const json = (code,data) => {res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try {
    const host = (req.headers.host || '').toLowerCase();
    if (!/^(localhost|127\.0\.0\.1|192\.168\.1\.250|groceries\.local)(:\d+)?$/.test(host)) return json(403,{error:'Unsupported host'});
    const remote = (req.socket.remoteAddress || '').replace(/^::ffff:/,'');
    if (!(remote==='::1'||/^127\.|^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(remote)))return json(403,{error:'Home network only'});
    const origin=req.headers.origin;
    const extension=origin?.startsWith('chrome-extension://');
    if(origin && origin!==`http://${host}` && !extension)return json(403,{error:'Origin not allowed'});
    if(extension){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
    if(recoveryMode&&req.method!=='GET'&&req.method!=='OPTIONS')return json(503,{error:'Recovery preview is read only. Cart updates, browser launches and sync are disabled.'});
    if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET,POST','Access-Control-Allow-Headers':'Content-Type,X-Grocery-Bridge'});res.end();return;}
    const url=new URL(req.url,`http://${host}`);
    if(url.pathname.startsWith('/api/bridge/') && req.headers['x-grocery-bridge']!=='1')return json(403,{error:'Extension bridge required'});
    if(req.method==='POST' && url.pathname==='/api/runner/pause'){
      const data=await body(req);if(!db.prepare("SELECT client FROM browser_launchers WHERE client=? AND profile IN ('headless','headless-paused')").get(String(data.target||'')))throw Error('Unknown headless account');
      db.prepare("UPDATE browser_launchers SET profile='headless-paused' WHERE client=?").run(data.target);await headless.stop(data.target);return json(200,{ok:true});
    }
    if(req.method==='POST' && url.pathname==='/api/runner'){
      const data=await body(req);headless.executable();
      let client=data.target;
      if(client){if(!db.prepare("SELECT client FROM browser_launchers WHERE client=? AND profile IN ('headless','headless-paused')").get(client))throw Error('Unknown headless account');await headless.stop(client);db.prepare("UPDATE browser_launchers SET profile='headless' WHERE client=?").run(client);}
      else{client=crypto.randomUUID();const name=String(data.name||'').trim().slice(0,60);if(!name)throw Error('Enter an account nickname');db.prepare('INSERT INTO clients(id,name,seen,ready) VALUES(?,?,?,0)').run(client,name,new Date(0).toISOString());db.prepare('INSERT INTO browser_launchers VALUES(?,?)').run(client,'headless');}
      const name=db.prepare('SELECT name FROM clients WHERE id=?').get(client).name;
      await headless.start(client,name,true);return json(200,{ok:true,client});
    }
    if(req.method==='GET' && url.pathname==='/api/browsers')return json(200,{profiles:launcher.profiles()});
    if(req.method==='POST' && url.pathname==='/api/browsers'){
      const data=await body(req);
      if(!db.prepare('SELECT id FROM clients WHERE id=?').get(String(data.client||'')))throw Error('Unknown account');
      if(data.profile===null)db.prepare('DELETE FROM browser_launchers WHERE client=?').run(data.client);
      else{
        if(!launcher.profiles().some(profile=>profile.directory===data.profile))throw Error('Choose a Chrome profile with the grocery extension installed');
        if(db.prepare('SELECT client FROM browser_launchers WHERE profile=? AND client<>?').get(data.profile,data.client))throw Error('This Chrome profile is already linked to another account');
        db.prepare('INSERT OR REPLACE INTO browser_launchers(client,profile) VALUES(?,?)').run(data.client,data.profile);
      }
      return json(200,{ok:true});
    }
    if(req.method==='GET'&&url.pathname.startsWith('/api/product-images/')){const match=url.pathname.match(/^\/api\/product-images\/(HEB|Walmart)\/(\d{1,25})$/),photo=match&&productImages.get(match[1],match[2]);if(!photo)return json(404,{error:'Photo not collected yet'});res.writeHead(200,{'Content-Type':photo.mime,'Cache-Control':'public,max-age=86400','X-Content-Type-Options':'nosniff'});return fs.createReadStream(photo.path).pipe(res);}
    if(req.method==='POST'&&url.pathname==='/api/bridge/product-observations'){
      const data=await body(req),client=String(data.clientId||'');if(!db.prepare('SELECT id FROM clients WHERE id=?').get(client)||!['HEB','Walmart'].includes(data.store)||!Array.isArray(data.items)||data.items.length>40)throw Error('Invalid product observations');let photos=0,prices=0;
      for(const item of data.items){if(!/^\d{1,25}$/.test(item.id))continue;if(item.imageUrl&&productImages.observe(data.store,item.id,item.imageUrl))photos++;const p=item.price;if(p&&p.id===item.id&&typeof p.name==='string'&&p.name.length<=300&&Number.isFinite(p.price)&&p.price>0&&p.price<100000&&Math.abs(Date.now()-Date.parse(p.at))<300000){let link;try{link=new URL(p.url);}catch{}if(link?.origin===(data.store==='HEB'?'https://www.heb.com':'https://www.walmart.com')&&link.pathname.endsWith('/'+item.id)){db.prepare('INSERT OR REPLACE INTO store_prices VALUES(?,?,?,?)').run(client,data.store,item.id,JSON.stringify({...p,promotion:typeof p.promotion==='string'?p.promotion.slice(0,300):null,priceUnit:['each','lb','oz','kg','g'].includes(p.priceUnit)?p.priceUnit:'unknown'}));prices++;}}}return json(200,{photos,prices});
    }
    if(req.method==='POST'&&url.pathname==='/api/product-photos/collect'){
      const data=await body(req),client=String(data.client),store=data.store||preferredStore(),limit=Math.min(50,Math.max(1,Number(data.limit)||20));if(!['HEB','Walmart'].includes(store))throw Error('Choose a store');const catalog=[...sharedLearning().itemCatalog,...sharedLearning().links].filter(p=>p.client===client&&p.store===store);const items=[...new Map([...routinePriceItems(client,store),...catalog.map(p=>({id:p.productId,name:p.name}))].map(i=>[i.id,i])).values()].filter(i=>!productImages.get(store,i.id)).slice(0,limit);if(!items.length)return json(200,{count:0});const task=storeTasks.enqueue(client,store,'photos','manual-'+crypto.randomUUID(),{items});wakeStoreTasks();return json(200,{...task,count:items.length});
    }
    if(req.method==='POST'&&url.pathname==='/api/store-prices/compare'){
      const data=await body(req),client=String(data.client),items=matchedPriceItems(client);if(!items.length)throw Error('Save comparable product matches first');const cycle='compare-'+crypto.randomUUID(),tasks=['HEB','Walmart'].map(store=>storeTasks.enqueue(client,store,'prices',cycle,{items:items.filter(i=>i.store===store).map(({id,name})=>({id,name}))}));wakeStoreTasks();return json(200,{tasks,count:items.length});
    }
    if(req.method==='POST'&&url.pathname==='/api/store-prices/check'){

      const data=await body(req),client=String(data.client),store=data.store;const catalog=store==='HEB'?sharedLearning().itemCatalog.filter(p=>p.client===client&&p.store===store).map(p=>({id:p.productId,name:p.name})):read('products');
      const ids=Array.isArray(data.ids)?data.ids:[];if(!ids.length||ids.length>50||new Set(ids).size!==ids.length)throw Error('Choose 1–50 products');const items=ids.map(id=>{const item=catalog.find(i=>i.id===id);if(!item)throw Error('Choose a saved product');return {id:item.id,name:item.name};});
      const task=storeTasks.enqueue(client,store,'prices','manual-'+crypto.randomUUID(),{items});wakeStoreTasks();return json(200,task);
    }
    if(req.method==='POST'&&url.pathname==='/api/bridge/store-price'){
      const data=await body(req),task=db.prepare("SELECT * FROM store_tasks WHERE id=? AND client=? AND state='running' AND kind='prices'").get(data.taskId,data.clientId),price=data.price;if(!task||!JSON.parse(task.payload).items.some(i=>i.id===price?.id))throw Error('Price task expired');
      const url=new URL(price.url),origin=task.store==='HEB'?'https://www.heb.com':'https://www.walmart.com';if(url.origin!==origin||!url.pathname.endsWith('/'+price.id)||!Number.isFinite(price.price)||price.price<=0||price.price>=100000||!Number.isFinite(Date.parse(price.at))||Math.abs(Date.now()-Date.parse(price.at))>300000||typeof price.name!=='string')throw Error('Invalid current price');
      if(price.imageUrl)productImages.observe(task.store,price.id,price.imageUrl);
      db.prepare('INSERT OR REPLACE INTO store_prices VALUES(?,?,?,?)').run(task.client,task.store,price.id,JSON.stringify({...price,promotion:typeof price.promotion==='string'?price.promotion.slice(0,300):null,priceUnit:['each','lb','oz','kg','g'].includes(price.priceUnit)?price.priceUnit:'unknown'}));return json(200,{ok:true});
    }
    if(req.method==='POST'&&url.pathname==='/api/history-sync/start'){const data=await body(req);const client=String(data.client||db.prepare("SELECT value FROM household_settings WHERE key='defaultClientId'").get()?.value||'');const jobs=queueHistory(client,data.force?'manual-'+crypto.randomUUID():require('./weekly-history').cycle());wakeStoreTasks();return json(200,{jobs});}
    if(req.method==='POST'&&url.pathname==='/api/store-tasks/retry'){const data=await body(req);const result=storeTasks.retry(String(data.id));wakeStoreTasks();return json(200,result);}
    if(req.method==='POST'&&url.pathname==='/api/bridge/store-tasks/claim'){const data=await body(req);return json(200,{task:storeTasks.claim(String(data.clientId))});}
    if(req.method==='POST'&&url.pathname==='/api/bridge/store-tasks/result'){const data=await body(req);const result=storeTasks.finish(String(data.clientId),String(data.id),data.result||{},data.complete!==false);const task=db.prepare('SELECT * FROM store_tasks WHERE id=? AND client=?').get(String(data.id),String(data.clientId));if(task?.kind==='history'&&task.state==='finished'&&/^\d{4}-\d{2}-\d{2}$/.test(task.cycle)){const items=[...new Map([...matchedPriceItems(task.client).filter(i=>i.store===task.store),...routinePriceItems(task.client,task.store)].map(i=>[i.id,{id:i.id,name:i.name}])).values()].slice(0,40);const pending=receiptProducts.pending(task.client,task.store),remaining=items.filter(i=>!pending.has(i.id));if(remaining.length)storeTasks.enqueue(task.client,task.store,'prices',task.cycle,{items:remaining});}return json(200,result);}
    if(req.method==='POST'&&url.pathname==='/api/bridge/store-tasks/receipt'){
      const data=await body(req),task=db.prepare("SELECT * FROM store_tasks WHERE id=? AND client=? AND state='running' AND kind='history'").get(String(data.id),String(data.clientId));if(!task)throw Error('History task expired');
      const preview=historyImport.preview({client:task.client,store:task.store,format:'json',text:JSON.stringify({orders:[data.order]})});const order=preview.orders[0];if(!order||order.skip)return json(200,{excluded:true});
      const subtotal=data.order.receiptSubtotal-(task.store==='HEB'?Number(data.order.receiptDiscount||0):0),sum=order.items.reduce((n,i)=>n+(Number.isFinite(i.lineTotal)?i.lineTotal:NaN),0);
      if(!data.order.receiptComplete||!Number.isFinite(data.order.receiptTotal)||data.order.receiptTotal<0||data.order.receiptTotal>=100000||!order.items.every(i=>i.priceSource==='receipt-line-total')||!Number.isFinite(subtotal)||subtotal<0||!Number.isFinite(sum)||Math.abs(Math.round(sum*100)-Math.round(subtotal*100))>1)throw Error('Receipt totals could not be confirmed; this order was not automatically imported');
      let inserted,details={products:0,jobs:[]};db.exec('BEGIN IMMEDIATE');try{inserted=db.prepare("INSERT OR IGNORE INTO purchases(id,client,created,data,store,source) VALUES(?,?,?,?,?,'history-import')").run(order.id,task.client,order.created,JSON.stringify(order.items),task.store).changes;if(inserted)details=receiptProducts.queue(task.client,task.store,order.id,order.items);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
      const result=repairHistoryPrices({client:task.client,store:task.store,order:data.order});purchaseCompletion.reconcile({client:task.client,store:task.store,id:order.id,created:order.created,items:order.items});return json(200,{...result,imported:inserted,productDetailsQueued:details.products});
    }
    if(req.method==='POST' && url.pathname==='/api/bridge/history-prices'){const data=await body(req);return json(200,repairHistoryPrices(data));}
    if(req.method==='POST' && url.pathname==='/api/history-import/preview'){
      const data=await body(req);if(!db.prepare('SELECT id FROM clients WHERE id=?').get(String(data.client||'')))throw Error('Choose a connected account');
      const existing=new Set(db.prepare('SELECT id FROM purchases WHERE client=?').all(data.client).map(row=>row.id));
      const preview=historyImport.preview(data,existing);preview.collectionWarnings=Array.isArray(data.collectionWarnings)?data.collectionWarnings.slice(0,100).map(warning=>String(warning).slice(0,400)):[];preview.incomplete=!!data.incomplete;const id=crypto.randomUUID();
      db.prepare('DELETE FROM import_previews WHERE created<?').run(Date.now()-86400000);
      db.prepare('INSERT INTO import_previews(id,created,data) VALUES(?,?,?)').run(id,Date.now(),JSON.stringify(preview));
      return json(200,{id,...preview});
    }
    if(req.method==='GET' && url.pathname==='/api/history-import/preview'){
      const id=url.searchParams.get('id');const batch=db.prepare('SELECT created,data,result FROM import_previews WHERE id=?').get(String(id||''));
      if(!batch||Date.now()-batch.created>1800000)throw Error('Collection preview expired. Collect history again.');
      return json(200,{id,...JSON.parse(batch.data),committed:!!batch.result});
    }
    if(req.method==='POST' && url.pathname==='/api/history-import/commit'){
      const data=await body(req);const batch=db.prepare('SELECT created,data,result FROM import_previews WHERE id=?').get(String(data.id||''));
      if(!batch||Date.now()-batch.created>1800000)throw Error('Import preview expired. Preview the file again.');
      if(batch.result)return json(200,JSON.parse(batch.result));
      const preview=JSON.parse(batch.data);if(!Array.isArray(data.orders)||!data.orders.length||data.orders.length>1000||data.orders.some(id=>!preview.orders.some(order=>order.id===id&&!order.skip)))throw Error('Choose eligible orders from this preview');
      const selected=new Set(data.orders);let imported=0,duplicates=0;
      db.exec('BEGIN IMMEDIATE');try{
        for(const order of preview.orders.filter(order=>selected.has(order.id)&&!order.skip)){
          if(db.prepare('SELECT id FROM purchases WHERE id=?').get(order.id)){duplicates++;continue;}
          db.prepare('INSERT INTO purchases(id,client,created,data,store,source) VALUES(?,?,?,?,?,?)').run(order.id,preview.client,order.created,JSON.stringify(order.items),preview.store,'history-import');
          if(preview.store==='Walmart')for(const item of order.items)if(idOK(item.id)&&!db.prepare('SELECT id FROM products WHERE id=?').get(item.id))db.prepare('INSERT INTO products VALUES(?,?)').run(item.id,JSON.stringify(product(item)));
          receiptProducts.queue(preview.client,preview.store,order.id,order.items);purchaseCompletion.reconcile({...order,client:preview.client,store:preview.store});imported++;
        }
        const result={imported,duplicates};db.prepare('UPDATE import_previews SET result=? WHERE id=?').run(JSON.stringify(result),data.id);db.exec('COMMIT');wakeStoreTasks();return json(200,result);
      }catch(error){db.exec('ROLLBACK');throw error;}
    }
    if(req.method==='POST'&&url.pathname==='/api/heb/preferences'){const data=await body(req);if(!['No preference','Ready Now','Ready Later'].includes(data.ripeness))throw Error('Choose a ripeness preference');db.prepare("INSERT OR REPLACE INTO household_settings VALUES('hebRipeness',?)").run(data.ripeness);return json(200,{ok:true});}
    if(req.method==='POST' && url.pathname==='/api/preferred-store'){
      const data=await body(req);if(!['Walmart','HEB'].includes(data.store))throw Error('Choose Walmart or H-E-B');db.prepare("INSERT OR REPLACE INTO household_settings VALUES('preferredStore',?)").run(data.store);return json(200,{ok:true});
    }
    if(req.method==='POST' && url.pathname==='/api/household-items'){
      const data=await body(req);if(!db.prepare('SELECT id FROM clients WHERE id=?').get(String(data.client||'')))throw Error('Choose a household account');
      if(data.remove){db.exec('BEGIN IMMEDIATE');try{db.prepare('DELETE FROM household_variants WHERE group_id=? AND client=?').run(String(data.id),data.client);db.prepare('DELETE FROM household_items WHERE id=? AND client=?').run(String(data.id),data.client);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return json(200,{ok:true});}
      const name=String(data.name||'').trim();if(!name||name.length>100)throw Error('Give this household item a name under 100 characters');
      if(!Array.isArray(data.variants)||data.variants.length<2||data.variants.length>20)throw Error('Select 2–20 equivalent store products');
      const catalog=[...sharedLearning().itemCatalog,...read('products').map(item=>({client:null,store:'Walmart',productId:item.id,name:item.name,unit:'each'}))];
      const variants=data.variants.map(raw=>{let item=catalog.find(item=>(!item.client||item.client===data.client)&&item.store===raw.store&&item.productId===raw.productId&&item.unit===raw.unit)||db.prepare('SELECT client,store,product_id AS productId,unit,name FROM household_variants WHERE client=? AND store=? AND product_id=? AND unit=?').get(data.client,String(raw.store),String(raw.productId),String(raw.unit));if(!item&&raw.manual===true&&['Walmart','HEB'].includes(raw.store)&&/^\d{1,25}$/.test(String(raw.productId))&&['each','lb','oz','kg','g'].includes(raw.unit)&&typeof raw.name==='string'&&raw.name.trim()&&raw.name.length<=300)item={client:data.client,store:raw.store,productId:String(raw.productId),unit:raw.unit,name:raw.name.trim()};if(!item)throw Error('Choose a saved product or enter a valid store product and name');const factor=raw.unit==='each'?Number(raw.factor):1;if(!Number.isFinite(factor)||factor<=0||factor>(data.weightBasis===true?100000:1000))throw Error('Use a positive conversion amount within the supported range');return {...item,factor};});
      if(new Set(variants.map(item=>item.unit==='each'?'each':'weight')).size>1&&data.weightBasis!==true)throw Error('For a weight-to-package match, explicitly set grams per package');
      if(new Set(variants.map(item=>item.store+'|'+item.productId+'|'+item.unit)).size!==variants.length)throw Error('A product is listed twice');
      const id=data.id&&db.prepare('SELECT id FROM household_items WHERE id=? AND client=?').get(data.id,data.client)?data.id:crypto.randomUUID();
      for(const item of variants){const old=db.prepare('SELECT group_id FROM household_variants WHERE client=? AND store=? AND product_id=? AND unit=?').get(data.client,item.store,item.productId,item.unit);if(old&&old.group_id!==id)throw Error('A selected product already belongs to another household item. Unlink it first.');}
      const existing=db.prepare('SELECT kind,note FROM household_items WHERE id=? AND client=?').get(id,data.client);const kind=data.kind||existing?.kind||'equivalent',note=String(data.note??existing?.note??'').trim();if(!['equivalent','substitute'].includes(kind)||note.length>600)throw Error('Choose a match type and keep notes under 600 characters');
      db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT OR REPLACE INTO household_items(id,client,name,kind,note) VALUES(?,?,?,?,?)').run(id,data.client,name,kind,note);db.prepare('DELETE FROM household_variants WHERE group_id=? AND client=?').run(id,data.client);for(const item of variants)db.prepare('INSERT INTO household_variants VALUES(?,?,?,?,?,?,?)').run(data.client,item.store,item.productId,item.unit,id,item.factor,item.name);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return json(200,{ok:true,id});
    }
    if(req.method==='POST' && url.pathname==='/api/default-account'){
      const data=await body(req);if(!db.prepare('SELECT id FROM clients WHERE id=?').get(String(data.client||'')))throw Error('Choose a connected household account');
      const name=String(data.name||'').trim();if(!name||name.length>60)throw Error('Use an account name under 60 characters');
      db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT OR REPLACE INTO account_labels VALUES(?,?)').run(data.client,name);db.prepare('UPDATE clients SET name=? WHERE id=?').run(name,data.client);db.prepare("INSERT OR REPLACE INTO household_settings VALUES('defaultClientId',?)").run(data.client);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
      return json(200,{ok:true});
    }
    if(req.method==='POST'&&url.pathname==='/api/packs/dismiss'){
      const data=await body(req),client=String(data.client||''),id=String(data.id||'');if(!db.prepare('SELECT id FROM clients WHERE id=?').get(client)||!/^learned-[a-f0-9]{24}$/.test(id))throw Error('Choose a suggested pack');if(data.undo)db.prepare('DELETE FROM pack_dismissals WHERE client=? AND id=?').run(client,id);else{if(!sharedLearning().packs.some(p=>p.client===client&&p.id===id))throw Error('Suggested pack not found');db.prepare('INSERT OR IGNORE INTO pack_dismissals VALUES(?,?)').run(client,id);}return json(200,{ok:true});
    }
    if(req.method==='POST' && url.pathname==='/api/packs'){

      const data=await body(req);if(!db.prepare('SELECT id FROM clients WHERE id=?').get(String(data.client||'')))throw Error('Choose a household account');
      if(data.remove){db.prepare('DELETE FROM shopping_packs WHERE id=? AND client=?').run(String(data.id||''),data.client);return json(200,{ok:true});}
      const name=String(data.name||'').trim();if(!name||name.length>100)throw Error('Give the pack a name under 100 characters');
      if(!Array.isArray(data.items)||data.items.length<2||data.items.length>30||new Set(data.items.map(item=>item.id)).size!==data.items.length)throw Error('Choose between 2 and 30 different products');
      const store=data.store||'Walmart';if(!['Walmart','HEB'].includes(store))throw Error('Choose a store');const catalog=store==='HEB'?[...sharedLearning().itemCatalog,...sharedLearning().links].filter(p=>p.store==='HEB'&&p.client===data.client).map(p=>({id:p.productId,name:p.name})):read('products');
      const items=data.items.map(item=>{if(!quantityOK(item.quantity))throw Error('Use package quantities from 1 to 100');const saved=catalog.find(p=>p.id===String(item.id));if(!saved)throw Error('Choose a saved '+store+' product');return {id:item.id,name:saved.name,quantity:item.quantity};});
      const id=data.id&&db.prepare('SELECT id FROM shopping_packs WHERE id=? AND client=?').get(data.id,data.client)?data.id:crypto.randomUUID();const pack={id,client:data.client,store,name,items,learned:false};db.prepare('INSERT OR REPLACE INTO shopping_packs VALUES(?,?,?)').run(id,data.client,JSON.stringify(pack));return json(200,{ok:true,id});
    }
    if(req.method==='POST' && url.pathname==='/api/list-preferences'){
      const data=await body(req);const term=value=>{if(typeof value!=='string')throw Error('Enter a grocery name');const clean=normalizeTerm(value);if(!clean||clean.length>100)throw Error('Use a grocery name under 100 characters');return clean;};
      if(data.kind==='default'){
        const key=term(data.term),store=data.store||'Walmart';if(!['Walmart','HEB'].includes(store))throw Error('Choose a store');
        if(data.remove)db.prepare('DELETE FROM store_list_defaults WHERE store=? AND term=?').run(store,key);
        else{const known=store==='Walmart'?db.prepare('SELECT id FROM products WHERE id=?').get(data.id):sharedLearning().itemCatalog.some(p=>p.store==='HEB'&&p.productId===data.id)||sharedLearning().links.some(p=>p.store==='HEB'&&p.productId===data.id);if(!idOK(data.id)||!quantityOK(data.quantity)||!known)throw Error('Choose a saved product and quantity from 1 to 100');db.prepare('INSERT OR REPLACE INTO store_list_defaults VALUES(?,?,?,?)').run(store,key,data.id,data.quantity);}
      }else if(data.kind==='rule'){
        const trigger=term(data.trigger),extra=term(data.extra);if(trigger===extra)throw Error('An association must name a different extra item');
        if(data.remove)db.prepare('DELETE FROM list_rules WHERE trigger=? AND extra=?').run(trigger,extra);
        else{if(!['include','suggest'].includes(data.mode))throw Error('Choose include or suggest');db.prepare('INSERT OR REPLACE INTO list_rules VALUES(?,?,?)').run(trigger,extra,data.mode);}
      }else throw Error('Unknown preference type');
      return json(200,{ok:true});
    }
    if(req.method==='GET' && url.pathname==='/api/health')return json(200,{application:'home-grocery',pid:process.pid,uptime:Math.floor(process.uptime())});
    if(req.method==='GET' && url.pathname==='/api/state')return json(200,state());
    if(req.method==='POST' && ['/api/heb/coupons/check','/api/bridge/heb/coupons/claim','/api/bridge/heb/coupons/result','/api/heb/list','/api/bridge/heb/claim','/api/bridge/heb/cart','/api/bridge/heb/progress','/api/bridge/heb/result'].includes(url.pathname)){const data=await body(req),before=url.pathname==='/api/bridge/heb/cart'?JSON.parse(db.prepare('SELECT data FROM heb_carts WHERE client=?').get(String(data.clientId||''))?.data||'[]'):null;const result=hebCart.handle(url.pathname,data);if(before){const saved=db.prepare('SELECT data,synced FROM heb_carts WHERE client=?').get(data.clientId);if(saved&&Date.parse(saved.synced)===data.observedAt)queueCartProducts(data.clientId,'HEB',before,JSON.parse(saved.data),data.observedAt);}notify();if(['/api/heb/list','/api/heb/coupons/check'].includes(url.pathname)){const mapping=db.prepare('SELECT profile FROM browser_launchers WHERE client=?').get(data.target);if(mapping&&!mapping.profile.startsWith('headless'))launcher.launch(mapping.profile).catch(error=>db.prepare("UPDATE heb_jobs SET state='needs-attention',result=? WHERE id=? AND state='queued'").run(JSON.stringify({report:[],error:error.message}),result.id));}return json(200,result);}
    if(req.method==='POST' && ['/api/list','/api/repeat'].includes(url.pathname)){
      const data=await body(req);const edits=url.pathname==='/api/repeat'?data.items:[data];
      if(!Array.isArray(edits)||!edits.length||edits.length>100||new Set(edits.map(item=>item.id)).size!==edits.length||edits.some(item=>!idOK(item.id)||!Number.isInteger(item.quantity)||item.quantity<0||item.quantity>100))throw Error('Invalid quantities');
      if(!db.prepare('SELECT id FROM clients WHERE id=?').get(String(data.target||'')))throw Error('Choose a Walmart account');
      if(!db.prepare('SELECT sync_version FROM clients WHERE id=?').get(data.target)?.sync_version)throw Error('Reload the grocery extension to enable cart sync');
      const pending=db.prepare("SELECT id,state,data FROM jobs WHERE target=? AND state IN ('queued','running') ORDER BY created,rowid").all(data.target);
      if(pending.length>=100)throw Error('There are already 100 cart updates waiting');
      if(edits.length===1){const last=pending.at(-1);const payload=last&&JSON.parse(last.data);if(last?.state==='queued'&&payload?.action==='set'&&payload.items.length===1&&payload.items[0].id===edits[0].id){payload.items[0].quantity=edits[0].quantity;db.prepare('UPDATE jobs SET data=? WHERE id=? AND state=?').run(JSON.stringify(payload),last.id,'queued');if(edits[0].quantity===0)db.prepare('DELETE FROM cart_lists WHERE client=? AND id=?').run(data.target,edits[0].id);else db.prepare('INSERT OR REPLACE INTO cart_lists VALUES(?,?,?)').run(data.target,edits[0].id,edits[0].quantity);return json(200,{ok:true,id:last.id});}}

      
      const remote=db.prepare('SELECT data FROM account_carts WHERE client=?').get(data.target);
      if(!remote)throw Error('Wait for the first Walmart cart sync before editing');
      const items=edits.map(edit=>{const saved=db.prepare('SELECT data FROM products WHERE id=?').get(edit.id);if(!saved)throw Error('Product not learned');let expected=JSON.parse(remote.data).find(line=>line.id===edit.id)?.quantity||0;for(const job of pending){const payload=JSON.parse(job.data);if(payload.action==='set'){const preceding=payload.items.find(item=>item.id===edit.id);if(preceding)expected=preceding.quantity;}}return {...JSON.parse(saved.data),quantity:edit.quantity,expectedQuantity:expected};});
      const id=crypto.randomUUID();db.prepare('INSERT INTO jobs(id,created,state,data,target) VALUES(?,?,?,?,?)').run(id,new Date().toISOString(),'queued',JSON.stringify({action:'set',items}),data.target);
      db.prepare('UPDATE account_carts SET completed=0 WHERE client=?').run(data.target);
      for(const item of items){if(item.quantity===0)db.prepare('DELETE FROM cart_lists WHERE client=? AND id=?').run(data.target,item.id);else db.prepare('INSERT OR REPLACE INTO cart_lists VALUES(?,?,?)').run(data.target,item.id,item.quantity);}
      notify();setTimeout(()=>wake({id,target:data.target}),2000);return json(200,{ok:true,id});
    }
    if(req.method==='POST' && ['/api/purchase-complete','/api/heb/complete','/api/bridge/purchase-complete'].includes(url.pathname)){
      const data=await body(req),client=String(data.target||data.clientId||''),store=data.store||(url.pathname==='/api/heb/complete'?'HEB':'Walmart');
      if(!db.prepare('SELECT id FROM clients WHERE id=?').get(client))throw Error('Choose a connected account');
      if(db.prepare("SELECT id FROM jobs WHERE target=? AND state IN ('queued','running')").get(client)||db.prepare("SELECT id FROM heb_jobs WHERE client=? AND state IN ('queued','running')").get(client))throw Error('Wait for cart updates to finish');
      const automatic=url.pathname.startsWith('/api/bridge/');
      if(automatic&&(!/^[0-9-]{5,40}$/.test(String(data.orderId||''))||!/(thank.?you|confirmation|checkout\/complete)/i.test(String(data.path||''))))throw Error('A store order confirmation is required');
      const saved=db.prepare('SELECT * FROM '+(store==='HEB'?'heb_carts':'account_carts')+' WHERE client=?').get(client);
      const current=JSON.parse(saved?.data||'[]'),items=current.length?current:JSON.parse(saved?.last_nonempty||'[]');
      const result=purchaseCompletion.mark(client,store,items,{orderId:automatic?String(data.orderId):undefined,method:automatic?'confirmation':'manual'});
      if(result.alreadyCompleted)return json(200,result);
      if(store==='Walmart')db.prepare('DELETE FROM cart_lists WHERE client=?').run(client);
      db.prepare('UPDATE '+(store==='HEB'?'heb_carts':'account_carts')+' SET completed=1 WHERE client=?').run(client);
      storeTasks.enqueue(client,store,'history','checkout-'+result.id);notify();wakeStoreTasks();return json(200,result);
    }
    if(req.method==='POST'&&url.pathname==='/api/purchase-complete/undo'){
      const data=await body(req),store=purchaseCompletion.undo(String(data.target),String(data.id));
      db.prepare('UPDATE '+(store==='HEB'?'heb_carts':'account_carts')+' SET completed=0 WHERE client=?').run(data.target);
      if(store==='Walmart'){const saved=db.prepare('SELECT data FROM account_carts WHERE client=?').get(data.target);for(const item of JSON.parse(saved?.data||'[]'))db.prepare('INSERT OR REPLACE INTO cart_lists VALUES(?,?,?)').run(data.target,item.id,item.quantity);}
      return json(200,{ok:true});
    }
    if(req.method==='POST' && url.pathname==='/api/bridge/cart'){
      const data=await body(req);if(!db.prepare('SELECT id FROM clients WHERE id=?').get(String(data.clientId||'')))throw Error('Unknown browser');db.prepare('UPDATE clients SET cart_error=? WHERE id=?').run(data.error?String(data.error).slice(0,400):null,data.clientId);saveCart(data.clientId,data.cart);return json(200,{ok:true});
    }
    if(req.method==='POST' && url.pathname==='/api/jobs'){
      const data=await body(req);
      if(typeof data.target!=='string'||!db.prepare('SELECT id FROM clients WHERE id=?').get(data.target))throw Error('Choose a connected Walmart account');
      const queued=db.prepare("SELECT id FROM jobs WHERE state IN ('queued','running') AND target=?").get(data.target);if(queued)return json(409,{error:'A cart request is already queued or running'});
      const list=db.prepare('SELECT id,quantity FROM cart_lists WHERE client=?').all(data.target);if(data.action!=='snapshot'&&(!list.length||list.length>100))throw Error('Choose between 1 and 100 products');
      const items=list.map(item=>({...JSON.parse(db.prepare('SELECT data FROM products WHERE id=?').get(item.id).data),quantity:item.quantity}));
      const id=crypto.randomUUID();db.prepare('INSERT INTO jobs(id,created,state,data,target) VALUES(?,?,?,?,?)').run(id,new Date().toISOString(),'queued',JSON.stringify(data.action==='snapshot'?{action:'snapshot',items:[]}:items),data.target);
      notify();
      setTimeout(()=>wake({id,target:data.target}),2000);
      return json(200,{id});
    }
    if(req.method==='POST' && url.pathname==='/api/bridge/sync'){
      const data=await body(req);if(typeof data.clientId!=='string'||data.clientId.length>80)throw Error('Invalid client');
      db.exec('BEGIN IMMEDIATE');try{
        for(const raw of (data.products||[]).slice(0,10000)){const item=product(raw);db.prepare('INSERT OR REPLACE INTO products VALUES(?,?)').run(item.id,JSON.stringify(item));}
        for(const trip of (data.history||[]).slice(0,2000)){
          if(typeof trip.id==='string'&&db.prepare('SELECT id FROM history_exclusions WHERE id=?').get(trip.id))continue;
          if(typeof trip.id!=='string'||!Number.isFinite(Date.parse(trip.startedAt))||!Array.isArray(trip.items))continue;
          const old=db.prepare('SELECT data FROM history WHERE id=?').get(trip.id);
          const items=new Map(old?JSON.parse(old.data).items.map(item=>[item.id,item]):[]);
          for(const raw of trip.items){const item=product(raw);items.set(item.id,{...item,addedAt:raw.addedAt});}
          const clean={id:trip.id,startedAt:trip.startedAt,store:'Walmart',items:[...items.values()]};
          db.prepare('INSERT OR REPLACE INTO history VALUES(?,?)').run(clean.id,JSON.stringify(clean));
        }
        db.prepare('INSERT INTO clients(id,seen,ready,name) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET seen=excluded.seen,ready=excluded.ready,name=excluded.name').run(data.clientId,new Date().toISOString(),data.ready?1:0,db.prepare('SELECT name FROM account_labels WHERE client=?').get(data.clientId)?.name||String(data.accountName||'My Walmart').trim().slice(0,60)||'My Walmart');db.prepare('UPDATE clients SET sync_version=? WHERE id=?').run(data.syncVersion===3?3:0,data.clientId);db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}return json(200,{ok:true});
    }
    if(req.method==='POST' && url.pathname==='/api/bridge/claim'){
      const data=await body(req);if(typeof data.clientId!=='string')throw Error('Client required');
      db.exec('BEGIN IMMEDIATE');let job;try{
        if(!db.prepare('SELECT id FROM clients WHERE id=?').get(data.clientId))throw Error('Connect this browser first');
        job=db.prepare("SELECT id,data FROM jobs WHERE state='queued' AND target=? ORDER BY created,rowid LIMIT 1").get(data.clientId);
        if(job&&!Array.isArray(JSON.parse(job.data))&&db.prepare('SELECT sync_version FROM clients WHERE id=?').get(data.clientId)?.sync_version!==3)job=null;
        if(job)db.prepare("UPDATE jobs SET state='running',client=? WHERE id=? AND state='queued'").run(data.clientId,job.id);
        db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}return json(200,{job:job?{id:job.id,...(Array.isArray(JSON.parse(job.data))?{items:JSON.parse(job.data)}:JSON.parse(job.data))}:null});
    }
    if(req.method==='POST' && url.pathname==='/api/bridge/result'){
      const data=await body(req);const job=db.prepare('SELECT client,state,data,target FROM jobs WHERE id=?').get(data.id);
      if(!job||job.client!==data.clientId)return json(409,{error:'Job does not belong to this browser'});
      if(job.state!=='running')return json(200,{ok:true});
      const results=(data.report||[]).slice(0,100).map(item=>({id:String(item.id||''),name:String(item.name||'').slice(0,300),status:String(item.status||'error'),quantity:Number(item.quantity)||null,detail:String(item.detail||'').slice(0,400)}));
      const clean={report:results,error:data.error?String(data.error).slice(0,400):null};
      const attention=clean.error||results.length!==(Array.isArray(JSON.parse(job.data))?JSON.parse(job.data):JSON.parse(job.data).items).length||results.some(item=>!['added','already-present','updated','removed'].includes(item.status));
      db.prepare('UPDATE jobs SET state=?,result=? WHERE id=?').run(attention?'needs-attention':'finished',JSON.stringify(clean),data.id);saveCart(job.target,data.cart);return json(200,{ok:true});
    }
    if(req.method==='POST' && url.pathname==='/api/bridge/progress'){
      const data=await body(req);const job=db.prepare('SELECT client,state FROM jobs WHERE id=?').get(data.id);
      if(!job||job.client!==data.clientId||job.state!=='running')return json(409,{error:'Job is not running'});
      const report=(data.report||[]).slice(0,100).map(item=>({id:String(item.id||''),name:String(item.name||'').slice(0,300),status:String(item.status||''),quantity:Number(item.quantity)||null}));
      db.prepare('UPDATE jobs SET result=? WHERE id=?').run(JSON.stringify({report}),data.id);return json(200,{ok:true});
    }
    if(req.method==='GET'){
      const files={'/calendar.js':'calendar.js','/product-photos.js':'product-photos.js','/current-prices.js':'current-prices.js','/store-sync-ui.js':'store-sync-ui.js','/usual-list.js':'usual-list.js','/statistics.js':'statistics.js','/statistics-ui.js':'statistics-ui.js','/history-ui.js':'history-ui.js','/':'index.html','/app.js':'app.js','/list-planner.js':'list-planner.js','/planner-ui.js':'planner-ui.js','/style.css':'style.css','/packs-ui.js':'packs-ui.js','/household-items-ui.js':'household-items-ui.js','/history-import-ui.js':'history-import-ui.js','/history-template.csv':'history-template.csv','/history-template.json':'history-template.json'};const file=files[url.pathname];if(!file)return json(404,{error:'Not found'});
      res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.csv')?'text/csv':file.endsWith('.json')?'application/json':'text/html',
        'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'",'Cache-Control':'no-cache'});
      return fs.createReadStream(path.join(__dirname,'web',file)).pipe(res);
    }
    json(404,{error:'Not found'});
  }catch(error){json(400,{error:error.message});}
});
server.listen(port,process.env.HOST||'0.0.0.0',()=>console.log(`Home Grocery: http://localhost:${port} | Home network: http://192.168.1.250:${port}`));
attachEvents(server);
// Keep the existing port for installed extensions. The friendly address serves
// the same app on port 80 and announces itself only on the home LAN interface.
const localName = !process.env.HOST && process.env.GROCERY_ALIAS !== '0' ? require('./local-name').startLocalName(server.listeners('request')[0],attachEvents) : null;
async function shutdown(){clearInterval(wakeTimer);clearInterval(runnerTimer);await headless.stopAll();for(const peer of events.clients)peer.terminate();events.close();await localName?.close();server.close(()=>{db.close();process.exit(0);});}
process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
