const {preview}=require('./history-import');
module.exports=db=>{
 db.exec('CREATE TABLE IF NOT EXISTS purchase_receipts(purchase TEXT PRIMARY KEY,checked TEXT NOT NULL,subtotal REAL,items_total REAL,state TEXT NOT NULL,source_url TEXT);');
 if(!db.prepare('PRAGMA table_info(purchase_receipts)').all().some(c=>c.name==='diagnostic'))db.exec('ALTER TABLE purchase_receipts ADD COLUMN diagnostic TEXT');
 if(!db.prepare('PRAGMA table_info(purchase_receipts)').all().some(c=>c.name==='total'))db.exec('ALTER TABLE purchase_receipts ADD COLUMN total REAL');
 if(!db.prepare('PRAGMA table_info(purchase_receipts)').all().some(c=>c.name==='discount'))db.exec('ALTER TABLE purchase_receipts ADD COLUMN discount REAL');
 db.exec('CREATE TABLE IF NOT EXISTS price_repair_audit(id INTEGER PRIMARY KEY,purchase TEXT NOT NULL,at TEXT NOT NULL,before_data TEXT NOT NULL,updated_rows INTEGER NOT NULL)');
 return data=>{
  if(!db.prepare('SELECT id FROM clients WHERE id=?').get(String(data.client||'')))throw Error('Unknown household account');
  const normalized=preview({client:data.client,store:data.store,format:'json',text:JSON.stringify({orders:[data.order]})});
  const order=normalized.orders[0];if(!order)throw Error('Invalid completed order');if(order.skip)return {updated:0,excluded:true,warnings:[]};
  const saved=db.prepare("SELECT data,created FROM purchases WHERE id=? AND client=? AND store=? AND source='history-import'").get(order.id,data.client,data.store);if(!saved)return {updated:0,notImported:true};
  if(saved.created.slice(0,10)!==order.created.slice(0,10))throw Error('Receipt date does not match imported order');
  const items=JSON.parse(saved.data);let updated=0;const warnings=[];
  if(data.order.receiptComplete===true&&Number.isFinite(data.order.receiptSubtotal)){
    const paid=order.items.every(i=>Number.isFinite(i.lineTotal)&&i.priceSource==='receipt-line-total')?order.items.reduce((n,i)=>n+i.lineTotal,0):null;
    const discount=data.store==='HEB'&&Number.isFinite(data.order.receiptDiscount)?data.order.receiptDiscount:0;
    const verified=discount>=0&&discount<=data.order.receiptSubtotal&&paid!==null&&Math.abs(Math.round(paid*100)-Math.round((data.order.receiptSubtotal-discount)*100))<=1;
    const sourceUrl=data.store==='Walmart'?'https://www.walmart.com/orders/'+encodeURIComponent(data.order.orderId)+(data.order.storePurchase?'?storePurchase=true':''):'https://www.heb.com/my-account/order-history/'+encodeURIComponent(data.order.orderId);
    db.prepare('INSERT OR REPLACE INTO purchase_receipts(purchase,checked,subtotal,items_total,state,source_url,diagnostic) VALUES(?,?,?,?,?,?,?)').run(order.id,new Date().toISOString(),data.order.receiptSubtotal,paid,verified?'verified':'needs-review',sourceUrl,JSON.stringify({items:order.items,rawItems:data.order.items.map(({productId,name,quantity,unit,lineTotal,unitPrice,priceSource,status})=>({productId,name,quantity,unit,lineTotal,unitPrice,priceSource,status}))}));
    if(Number.isFinite(data.order.receiptTotal)&&data.order.receiptTotal>=0&&data.order.receiptTotal<100000)db.prepare('UPDATE purchase_receipts SET total=? WHERE purchase=?').run(data.order.receiptTotal,order.id);
    db.prepare('UPDATE purchase_receipts SET discount=? WHERE purchase=?').run(discount,order.id);
    if(verified){
      const replacement=JSON.stringify(order.items);
      if(replacement!==saved.data){db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT INTO price_repair_audit(purchase,at,before_data,updated_rows) VALUES(?,?,?,?)').run(order.id,new Date().toISOString(),saved.data,order.items.length);db.prepare('UPDATE purchases SET data=? WHERE id=?').run(replacement,order.id);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
      return {updated:replacement===saved.data?0:order.items.length,priced:order.items.length,total:order.items.length,receiptVerified:true,warnings:[]};
    }
    warnings.push('Received-item totals do not yet reconcile with the receipt subtotal; saved prices and quantities were preserved.');
    return {updated:0,priced:items.filter(i=>Number.isFinite(i.unitPrice)).length,total:items.length,receiptVerified:false,warnings};
  }
  for(const item of items){const matches=order.items.filter(x=>x.id===item.id&&x.unit===item.unit&&Math.abs(x.quantity-item.quantity)<.000001);if(matches.length!==1||!Number.isFinite(matches[0].unitPrice)){warnings.push(item.name+': receipt price or quantity could not be verified');continue;}const price=matches[0];if(!['receipt-line-total','receipt-unit-price'].includes(price.priceSource)){warnings.push(item.name+': price has no receipt provenance');continue;}if(item.unitPrice===price.unitPrice&&item.lineTotal===price.lineTotal)continue;item.unitPrice=price.unitPrice;item.priceSource=price.priceSource;if(Number.isFinite(price.lineTotal))item.lineTotal=price.lineTotal;updated++;}
  if(updated){db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT INTO price_repair_audit(purchase,at,before_data,updated_rows) VALUES(?,?,?,?)').run(order.id,new Date().toISOString(),saved.data,updated);db.prepare('UPDATE purchases SET data=? WHERE id=?').run(JSON.stringify(items),order.id);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
  return {updated,priced:items.filter(x=>Number.isFinite(x.unitPrice)).length,total:items.length,warnings};
 };
};
