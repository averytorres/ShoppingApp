const crypto=require('node:crypto');
const receiptId=(client,store,id)=>'import-'+crypto.createHash('sha256').update(client+'\0'+store+'\0'+id).digest('hex');
module.exports=db=>{
 db.exec('CREATE TABLE IF NOT EXISTS purchase_completions(id TEXT PRIMARY KEY,client TEXT NOT NULL,store TEXT NOT NULL,at TEXT NOT NULL,data TEXT NOT NULL,state TEXT NOT NULL,receipt TEXT,method TEXT NOT NULL)');
 function mark(client,store,items,{orderId,method='manual'}={}){
  if(!db.prepare('SELECT id FROM clients WHERE id=?').get(client)||!['Walmart','HEB'].includes(store))throw Error('Choose a connected account and store');
  const receipt=orderId?receiptId(client,store,orderId):null;
  if(receipt&&db.prepare('SELECT id FROM purchase_completions WHERE client=? AND receipt=?').get(client,receipt))return {ok:true,alreadyCompleted:true};
  const data=JSON.stringify(items);if(!items.length&&!receipt)throw Error('There is no recent cart to mark complete');
  const old=db.prepare("SELECT id FROM purchase_completions WHERE client=? AND store=? AND data=? AND state='awaiting-receipt' AND at>?").get(client,store,data,new Date(Date.now()-600000).toISOString());if(old){if(receipt)db.prepare('UPDATE purchase_completions SET receipt=?,method=? WHERE id=?').run(receipt,method,old.id);return {ok:true,id:old.id};}
  const linked=receipt&&db.prepare('SELECT id FROM purchases WHERE id=?').get(receipt),id=crypto.randomUUID();
  db.prepare('INSERT INTO purchase_completions VALUES(?,?,?,?,?,?,?,?)').run(id,client,store,new Date().toISOString(),data,linked?'linked':'awaiting-receipt',receipt,method);
  return {ok:true,id};
 }
 function reconcile(purchase){
  const pending=db.prepare("SELECT * FROM purchase_completions WHERE client=? AND store=? AND state='awaiting-receipt'").all(purchase.client,purchase.store);
  const exact=pending.filter(p=>p.receipt===purchase.id);let matches=exact;
  if(!exact.length){const ids=new Set(purchase.items.map(i=>i.id));matches=pending.filter(p=>!p.receipt&&Math.abs(Date.parse(p.at)-Date.parse(purchase.created))<=3*86400000).filter(p=>{const old=new Set(JSON.parse(p.data).map(i=>i.id));const common=[...old].filter(id=>ids.has(id)).length;return old.size&&ids.size&&common/old.size>=.8&&common/ids.size>=.8;});}
  if(matches.length===1)db.prepare("UPDATE purchase_completions SET state='linked',receipt=? WHERE id=?").run(purchase.id,matches[0].id);
 }
 function undo(client,id){const row=db.prepare("SELECT * FROM purchase_completions WHERE id=? AND client=? AND state='awaiting-receipt' AND method='manual'").get(id,client);if(!row)throw Error('Only a manual completion waiting for its receipt can be undone');db.prepare("UPDATE purchase_completions SET state='undone' WHERE id=?").run(id);return row.store;}
 const state=()=>db.prepare("SELECT id,client,store,at,state,receipt,method FROM purchase_completions WHERE state='awaiting-receipt' ORDER BY at DESC").all();
 return {mark,reconcile,undo,state};
};
