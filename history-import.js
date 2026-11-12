const crypto=require('node:crypto');
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
const cleanStatus=value=>String(value||'').toLowerCase().trim().replace(/[_-]+/g,' ').replace(/\s+/g,' ');
const completed=new Set(['completed','complete','delivered','fulfilled','picked up']);
const excluded=new Set(['canceled','cancelled','returned','refunded']);
function csv(text){
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else if(!field||quoted)quoted=!quoted;else throw Error('Invalid CSV quoting');}
    else if(!quoted&&c===','){row.push(field);field='';}
    else if(!quoted&&(c==='\n'||c==='\r')){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(Boolean))rows.push(row);row=[];field='';}
    else field+=c;
  }
  if(quoted)throw Error('CSV has an unclosed quoted field');row.push(field);if(row.some(Boolean))rows.push(row);
  const header=rows.shift()?.map(value=>value.replace(/^\uFEFF/,'').trim().toLowerCase());
  const required=['order_id','purchased_at','status','name','quantity'];
  if(!header||required.some(name=>!header.includes(name))||new Set(header).size!==header.length)throw Error('CSV needs order_id, purchased_at, status, name and quantity columns.');
  const orders=new Map();
  for(const values of rows){
    if(values.length!==header.length)throw Error('CSV row has the wrong number of columns');
    const item=Object.fromEntries(header.map((name,index)=>[name,values[index]]));
    let order=orders.get(item.order_id);
    if(!order){order={orderId:item.order_id,purchasedAt:item.purchased_at,status:item.status,items:[]};orders.set(item.order_id,order);}
    if(order.purchasedAt!==item.purchased_at||order.status!==item.status)throw Error('Rows for the same order disagree about its date or status');
    order.items.push({productId:item.product_id,name:item.name,quantity:Number(item.quantity),...(item.unit_price?{unitPrice:Number(item.unit_price)}:{}),status:item.item_status||item.status,unit:item.unit||'each'});
  }
  return [...orders.values()];
}
function preview({client,store,text,format},existing=new Set(),now=Date.now()){
  if(!['Walmart','HEB'].includes(store))throw Error('Choose Walmart or H-E-B');
  if(typeof text!=='string'||text.length>1500000)throw Error('Use a history file under 1.5 MB');
  let orders;if(format==='csv')orders=csv(text);else if(format==='json'){const value=JSON.parse(text);orders=Array.isArray(value)?value:value.orders;}else throw Error('Choose a JSON or CSV file');
  if(!Array.isArray(orders)||orders.length>1000)throw Error('Import up to 1,000 orders at a time');
  const result=[];const seen=new Set();
  for(let index=0;index<orders.length;index++){
    const order=orders[index];const label='Order '+(index+1);const warnings=[];let reason;
    if(!order||typeof order.orderId!=='string'||!order.orderId.trim()||order.orderId.length>200){result.push({label,skip:'Missing order identifier'});continue;}
    const id='import-'+hash(client+'\0'+store+'\0'+order.orderId.trim());
    const date=typeof order.purchasedAt==='string'&&/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(order.purchasedAt)?Date.parse(order.purchasedAt):NaN;
    if(order.orderId.startsWith('FICTIONAL-EXAMPLE-DO-NOT-IMPORT'))reason='Format example, not a real purchase';
    else if(!Number.isFinite(date)||date>now||(order.purchasedAt.length===10&&new Date(date).toISOString().slice(0,10)!==order.purchasedAt))reason='Missing, invalid or future purchase date';
    else if(!completed.has(cleanStatus(order.status)))reason=excluded.has(cleanStatus(order.status))?'Canceled, returned or refunded order':'Order status is not confirmed completed';
    else if(existing.has(id)||seen.has(id))reason='Already imported or repeated in this file';
    if(!Array.isArray(order.items)||order.items.length>500)reason='Missing items or more than 500 items in one order';
    const items=[];
    for(const raw of Array.isArray(order.items)?order.items.slice(0,500):[]){
      if(!raw||excluded.has(cleanStatus(raw.status))){warnings.push('Excluded a canceled, returned or refunded item');continue;}
      if(raw.status&&!completed.has(cleanStatus(raw.status))){warnings.push('Excluded an item with unconfirmed status');continue;}
      const unit=String(raw.unit||'each').toLowerCase();const weighted=['lb','oz','kg','g'].includes(unit);
      if(!weighted&&unit!=='each'){warnings.push('Excluded an item with an unsupported quantity unit');continue;}
      if(typeof raw.name!=='string'||!raw.name.trim()||raw.name.length>300||!Number.isFinite(raw.quantity)||(!weighted&&!Number.isInteger(raw.quantity))||raw.quantity<=0||raw.quantity>(weighted?100000:100)){warnings.push('Excluded an item with missing name or invalid quantity');continue;}
      const publicId=typeof raw.productId==='string'?raw.productId.trim():'';
      const usable=store==='Walmart'?/^\d{1,25}$/.test(publicId):/^[a-zA-Z0-9-]{1,80}$/.test(publicId);
      const item={id:usable?publicId:'unmapped-'+hash(store+'\0'+raw.name.trim().toLowerCase()).slice(0,24),name:raw.name.trim(),quantity:raw.quantity,unit};
      if(!usable)warnings.push(raw.name.trim()+': no usable product ID; retained for history, not cart recommendations');
      if(typeof raw.unitPrice==='number'&&Number.isFinite(raw.unitPrice)&&raw.unitPrice>=0&&raw.unitPrice<100000)item.unitPrice=raw.unitPrice;
      if(Number.isFinite(raw.lineTotal)&&raw.lineTotal>=0&&raw.lineTotal<100000){item.lineTotal=raw.lineTotal;item.unitPrice=raw.lineTotal/raw.quantity;}if(item.unitPrice!==undefined)item.priceSource=['receipt-line-total','receipt-unit-price'].includes(raw.priceSource)?raw.priceSource:'imported';
      if(raw.quantityBasis==='receipt-line')item.quantityBasis='receipt-line';
      items.push(item);
    }
    const merged=new Map();for(const item of items){const key=item.id+':'+item.unit;const previous=merged.get(key);if(previous){const paid=Number.isFinite(previous.unitPrice)&&Number.isFinite(item.unitPrice)?(previous.lineTotal??previous.unitPrice*previous.quantity)+(item.lineTotal??item.unitPrice*item.quantity):null;previous.quantity=Math.round((previous.quantity+item.quantity)*1000000)/1000000;if(paid!==null){previous.lineTotal=paid;previous.unitPrice=paid/previous.quantity;}else{delete previous.unitPrice;delete previous.lineTotal;}if(previous.quantity>(item.unit==='each'?100:100000))reason='Combined product quantity exceeds the supported limit';}else merged.set(key,{...item});}
    if(!items.length&&!reason)reason='No eligible completed items';
    if(!reason)seen.add(id);
    result.push({id,label,created:Number.isFinite(date)?new Date(date).toISOString():null,items:[...merged.values()],warnings,...(reason?{skip:reason}:{})});
  }
  return {client,store,orders:result,eligible:result.filter(order=>!order.skip).length};
}
module.exports={preview,csv};
