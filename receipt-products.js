// Receipt data remains the source of purchased amounts and paid costs.
// Separate background reads fill missing storefront photos/current prices.
module.exports=(db,tasks,images,toProduct)=>{
 db.exec('CREATE TABLE IF NOT EXISTS saved_store_products(client TEXT NOT NULL,store TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,unit TEXT NOT NULL,url TEXT NOT NULL,PRIMARY KEY(client,store,id))');
 function pending(client,store){const ids=new Set();for(const row of db.prepare("SELECT payload FROM store_tasks WHERE client=? AND store=? AND kind IN ('prices','photos') AND state IN ('queued','running')").all(client,store))for(const item of JSON.parse(row.payload).items||[])ids.add(item.id);return ids;}
 function queue(client,store,receipt,items,{priceMaxAge=Infinity}={}){
  const waiting=pending(client,store),unique=new Map();
  for(const item of items){if(!/^\d{1,25}$/.test(item.id))continue;if(store==='Walmart'&&!db.prepare('SELECT id FROM products WHERE id=?').get(item.id))db.prepare('INSERT INTO products VALUES(?,?)').run(item.id,JSON.stringify(toProduct(item)));
   db.prepare("INSERT INTO saved_store_products VALUES(?,?,?,?,?,?) ON CONFLICT(client,store,id) DO UPDATE SET name=excluded.name,unit=CASE WHEN saved_store_products.unit!='each' AND excluded.unit='each' THEN saved_store_products.unit ELSE excluded.unit END").run(client,store,item.id,item.name,item.unit||'each',store==='HEB'?'https://www.heb.com/product-detail/item/'+item.id:'https://www.walmart.com/ip/'+item.id);
   if(waiting.has(item.id))continue;const price=db.prepare('SELECT id,data FROM store_prices WHERE client=? AND store=? AND id=?').get(client,store,item.id);
   const fresh=!!price&&(priceMaxAge===Infinity||Date.now()-Date.parse(JSON.parse(price.data).at)<priceMaxAge);if((!images.get(store,item.id)&&!images.pending?.(store,item.id))||!fresh)unique.set(item.id,{id:item.id,name:item.name});
  }
  const list=[...unique.values()],jobs=[];for(let offset=0;offset<list.length;offset+=20)jobs.push(tasks.enqueue(client,store,'prices','receipt-products-'+receipt+'-'+offset,{items:list.slice(offset,offset+20),reason:'new-products'}));return {products:list.length,jobs};
 }
 return {queue,pending};
};
