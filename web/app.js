(() => {
  let previous, account;
  let timer;
  function toast(text, attention=false) {
    let box=document.getElementById('sync-toast');
    if(!box){box=document.createElement('aside');box.id='sync-toast';box.setAttribute('role','status');box.setAttribute('aria-live','polite');document.body.append(box);}
    box.replaceChildren();box.hidden=false;box.style.borderColor=attention?'#a66316':'#264d3e';
    const message=document.createElement('span');message.textContent=text;
    const close=document.createElement('button');close.textContent='Dismiss';close.onclick=()=>{box.hidden=true;clearTimeout(timer);};
    box.append(message,close);clearTimeout(timer);if(!attention)timer=setTimeout(()=>box.hidden=true,8000);
  }
  window.SyncFeedback={toast,update(state,selected){
    const active=state.jobs.filter(j=>j.target===selected&&['queued','running'].includes(j.state));
    let progress=document.getElementById('sync-progress');
    if(active.length){
      if(!progress){progress=document.createElement('aside');progress.id='sync-progress';progress.setAttribute('role','status');progress.setAttribute('aria-live','polite');document.body.append(progress);}
      const running=active.some(j=>j.state==='running'),processed=active.reduce((n,j)=>n+(j.result?.report||[]).filter(i=>i.id).length,0);
      const text=running?'Updating Walmart cart… '+processed+' items processed'+(active.length>1?' · '+active.length+' requests pending':''):'Waiting for your account browser…';
      if(progress.dataset.message!==text){progress.replaceChildren();const label=document.createElement('span');label.textContent=text;const bar=document.createElement('progress');bar.setAttribute('aria-label','Cart sync in progress');progress.append(label,bar);progress.dataset.message=text;}
      progress.hidden=false;
    }else if(progress)progress.hidden=true;
    if(previous&&account===selected){
      const done=state.jobs.filter(j=>j.target===selected&&['finished','needs-attention'].includes(j.state)&&previous.jobs.some(old=>old.id===j.id&&!['finished','needs-attention'].includes(old.state)));
      const changed=JSON.stringify(state.list.filter(x=>x.client===selected).sort((a,b)=>a.id.localeCompare(b.id)))!==JSON.stringify(previous.list.filter(x=>x.client===selected).sort((a,b)=>a.id.localeCompare(b.id)));
      if(done.length){const attention=done.some(j=>j.state==='needs-attention');toast(attention?'Walmart sync needs attention. Check the cart request details.':'Walmart cart sync complete.',attention);}
      else if(changed&&!state.jobs.some(j=>j.target===selected&&['queued','running'].includes(j.state))){toast('Walmart cart changes synced to your grocery list.');}
    }
    previous=state;account=selected;
  }};
})();

let state={products:[],history:[],list:[],jobs:[],clients:[]};
let browserProfiles=[];
let selectedAccount='';
let defaultAccountApplied=false;
const $=id=>document.getElementById(id);
const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
const notice=(text,kind='message')=>{$('notice').hidden=false;$('notice').textContent=text;$('notice').dataset.kind=kind;};
async function api(url,data){const response=await fetch(url,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw Error(result.error);return result;}
const quantityEdits=new Map();let storeChangePending=false;
const quantityKey=(id,account=selectedAccount,store=state.preferredStore)=>account+'|'+store+'|'+id;
const cartQuantity=(id,fallback)=>quantityEdits.get(quantityKey(id))?.quantity??fallback;
const pendingQuantityCount=()=>[...quantityEdits.values()].filter(edit=>edit.account===selectedAccount&&edit.store===state.preferredStore).length;
function paintQuantity(edit){if(edit.account!==selectedAccount||edit.store!==state.preferredStore)return;for(const row of document.querySelectorAll('#list .list-item'))if(row.dataset.productId===edit.id){const input=row.querySelector('.stepper input');if(input)input.value=edit.quantity;for(const button of row.querySelectorAll('.stepper button')){const label=button.getAttribute('aria-label')||'';if(label.startsWith('Increase '))button.disabled=edit.quantity>=100;if(label.startsWith('Decrease '))button.disabled=edit.quantity<=0;}}window.renderShoppingTools?.();}
async function setQuantity(id,quantity){
 try{
  if(!selectedAccount)throw Error('Choose a household account first.');if(!Number.isInteger(quantity)||quantity<0||quantity>100)throw Error('Use whole item/package quantities from 0 to 100.');
  const key=quantityKey(id),existing=quantityEdits.get(key);if(existing){existing.quantity=quantity;paintQuantity(existing);return existing.promise;}
  const edit={id,quantity,account:selectedAccount,store:state.preferredStore};quantityEdits.set(key,edit);paintQuantity(edit);
  edit.promise=(async()=>{try{let sent;do{sent=edit.quantity;await api(edit.store==='HEB'?'/api/heb/list':'/api/list',{id,quantity:sent,target:edit.account});await refresh();}while(edit.quantity!==sent);return true;}catch(error){notice('Could not confirm this cart change: '+error.message+' Check the cart before retrying.');return false;}finally{quantityEdits.delete(key);await refresh();window.renderShoppingTools?.();}})();return edit.promise;
 }catch(error){notice(error.message);return false;}
}
function adjustQuantity(id,delta,fallback){const current=cartQuantity(id,fallback),quantity=Math.max(0,Math.min(100,current+delta));if(quantity!==current)return setQuantity(id,quantity);}
async function changeStore(store,announce=false){
 if(storeChangePending)return;storeChangePending=true;for(const id of ['shop-store','preferred-store'])$(id).disabled=true;
 try{await api('/api/preferred-store',{store});await refresh(true);if(announce)notice('Main store updated. Existing carts were not changed.');}
 catch(error){await refresh(true);$('shop-store').value=$('preferred-store').value=state.preferredStore||'HEB';notice(error.message);}
 finally{storeChangePending=false;for(const id of ['shop-store','preferred-store'])$(id).disabled=false;}
}
function hebLines(source=state,client=selectedAccount){const saved=source.hebCarts?.find(c=>c.client===client);const lines=saved?.completed?[]:structuredClone(saved?.lines||[]);for(const job of (source.hebJobs||[]).filter(j=>j.client===client&&['queued','running'].includes(j.state)).reverse())for(const item of job.items){const old=lines.find(l=>l.id===item.id);if(old)old.quantity=item.quantity;else lines.push({...item});}return lines.filter(l=>l.quantity>0);}
function storeProducts(){return state.preferredStore==='HEB'?[...new Map((state.itemCatalog||[]).filter(i=>i.store==='HEB'&&i.client===selectedAccount).map(i=>[i.productId,{id:i.productId,name:i.name,offerId:true}])).values()]:state.products;}
function selectedLines(source=state,client=selectedAccount){return state.preferredStore==='HEB'?hebLines(source,client):(source.allLines||source.list).filter(l=>l.client===client);}
function updateCartCounts(lines=selectedLines()){
 const products=lines.filter(line=>line.quantity>0).length,items=lines.reduce((sum,line)=>sum+Math.max(0,Number(line.quantity)||0),0);
 const text=products+' '+(products===1?'product':'products')+' · '+items+' '+(items===1?'item':'items');
 $('list-count').textContent=text;$('top-cart-count').textContent=text;
}
function renderStoreCart(){
 const heb=state.preferredStore==='HEB',name=heb?'H-E-B':'Walmart';$('shop-store').value=state.preferredStore||'HEB';$('plan-send').textContent='Send reviewed items to '+name;$('checkout-link').href=heb?'https://www.heb.com/cart':'https://www.walmart.com/cart';$('checkout-link').textContent='Review & checkout on '+name+' ↗';$('cart-store-label').textContent='LIVE '+name.toUpperCase()+' CART';$('cart-heading').firstChild.textContent=name+' cart ';$('cart-description').textContent='Changes here update the selected account’s '+name+' cart.'+(heb?' Quantities count items or packages; final weights are set by H-E-B.':'');$('completion-question').textContent='Finished checking out on '+name+'?';$('send').hidden=heb;
 if($('heb-progress'))$('heb-progress').hidden=true;if(!heb)return;const lines=hebLines(),jobs=(state.hebJobs||[]).filter(j=>j.client===selectedAccount);updateCartCounts(lines);$('list').replaceChildren();if(!lines.length)$('list').append(node('p','Your H-E-B cart is empty. Choose saved products or browse H-E-B.','fine'));
 for(const item of lines){const row=node('div',undefined,'list-item');row.dataset.productId=item.id;row.append(productPhoto('HEB',item.id,item.name,true),node('p',item.name));const controls=node('div',undefined,'stepper');const minus=node('button','−'),amount=node('input'),plus=node('button','+'),remove=node('button','Remove','remove');minus.setAttribute('aria-label','Decrease '+item.name);plus.setAttribute('aria-label','Increase '+item.name);amount.type='number';amount.min=1;amount.max=100;amount.value=cartQuantity(item.id,item.quantity);plus.disabled=Number(amount.value)>=100;amount.setAttribute('aria-label','Item count for '+item.name);minus.onclick=()=>adjustQuantity(item.id,-1,item.quantity);plus.onclick=()=>adjustQuantity(item.id,1,item.quantity);amount.onchange=()=>setQuantity(item.id,Number(amount.value));remove.onclick=()=>setQuantity(item.id,0);controls.append(minus,amount,plus,remove);row.append(controls);$('list').append(row);}
 const saved=state.hebCarts?.find(c=>c.client===selectedAccount);if(previousHebState?.client===selectedAccount){const completed=jobs.find(j=>['finished','needs-attention'].includes(j.state)&&previousHebState.active.includes(j.id));if(completed)window.SyncFeedback?.toast(completed.state==='finished'?'H-E-B cart sync complete.':'H-E-B sync needs attention. See recent cart activity.',completed.state!=='finished');else if(saved?.synced!==previousHebState.synced&&!jobs.some(j=>['queued','running'].includes(j.state)))window.SyncFeedback?.toast('H-E-B cart changes synced.');}previousHebState={client:selectedAccount,synced:saved?.synced,active:jobs.filter(j=>['queued','running'].includes(j.state)).map(j=>j.id)};$('complete').disabled=!lines.length||!!saved?.completed||jobs.some(j=>['queued','running'].includes(j.state));$('jobs').replaceChildren();for(const job of jobs.slice(0,5)){const row=node('div',undefined,'job');row.append(node('strong',job.state==='running'?'Updating H-E-B cart…':job.state==='queued'?'H-E-B update queued':job.state==='finished'?'H-E-B cart updated':'H-E-B needs attention'),node('span',(job.result?.report?.length||0)+' / '+job.items.length+' processed'));if(job.result?.error)row.append(node('p',job.result.error));$('jobs').append(row);}
 $('account-status').textContent=saved?'H-E-B cart checked '+new Date(saved.synced).toLocaleTimeString():'Open your signed-in H-E-B cart in the PC browser to connect.';
 const active=jobs.find(j=>['queued','running'].includes(j.state));let progress=$('heb-progress');if(!progress){progress=node('p',undefined,'fine');progress.id='heb-progress';$('list').before(progress);}progress.hidden=!active;if(active){progress.replaceChildren(node('span',(active.state==='queued'?'Waiting for H-E-B browser…':'Updating H-E-B cart…')+' '+(active.result?.report?.length||0)+' / '+active.items.length));const bar=node('progress');bar.max=active.items.length;bar.value=active.result?.report?.length||0;bar.setAttribute('aria-label','H-E-B cart update progress');progress.append(bar);}
}
let selectedCategory='All',productPage=0,showAllProducts=false,productFilterSignature='';
function pageControls(host,{label,page,pages,all,onPage,onAll}){
 if(pages<=1)return;
 const nav=node('nav',undefined,'collection-pagination');nav.setAttribute('aria-label',label+' pages');
 if(!all){const previous=node('button','Previous','secondary'),next=node('button','Next','secondary'),status=node('span','Page '+(page+1)+' of '+pages,'fine');previous.disabled=page===0;next.disabled=page>=pages-1;previous.onclick=()=>onPage(page-1);next.onclick=()=>onPage(page+1);status.setAttribute('aria-live','polite');nav.append(previous,status,next);}
 const toggle=node('button',all?'Use pages':'Show all','text-button');toggle.setAttribute('aria-label',(all?'Use pages for ':'Show all ')+label);toggle.onclick=onAll;nav.append(toggle);host.append(nav);
}
const categoryFor=item=>{
 const name=item.name.toLowerCase();
 if(/\b(hemorrhoid|hydrocortisone|lidocaine|anti-itch|vitamins?|supplement|tablets?|capsules?|antibiotic|ointment|first aid|shampoo|conditioner|toothpaste|toothbrush|deodorant|cotton swabs|q-tips|lotion|sunscreen|body wash|hand soap|razors?|bandages?)\b/.test(name))return 'Health & personal care';
 if(/\b(cat|dog|pet)\b.*\b(food|treats|litter)\b/.test(name))return 'Pet supplies';
 if(/\b(wipes|bleach|detergent|toilet paper|paper towels|trash bags|cleaner|dish soap)\b/.test(name))return 'Household';
 if(/\b(frozen|ice cream|popsicles?)\b/.test(name))return 'Frozen';
 if(/\b(juice|coffee|tea|soda|sparkling water|coconut water|drinking water|bottled water)\b/.test(name))return 'Drinks';
 if(/\b(chips|crackers|cookies|candy|chocolate|popcorn|snack|granola bars|almonds|peanuts|pistachios|cashews|walnuts|pecans|nuts|trail mix)\b/.test(name)&&!/chocolate milk/.test(name))return 'Snacks & sweets';
 if(/\b(?:corn on the cob|(?:fresh .*|sweet )?cob corn)\b/.test(name))return 'Produce';
 if(/\b(?:condensed|evaporated) milk\b|\bgoya\b.*\bcoconut milk\b/.test(name))return 'Pantry';
 if(/\b\d+(?:\.\d+)?\s*oz\s+can\b/.test(name))return 'Pantry';
 if(/\b(canned|chick[ -]?peas|garbanzo|lentils|beans|pasta|macaroni|rice|cereal|flour|sugar|oil|sauce|soup|peanut butter|vinegar|salt|seasoning|spice)\b/.test(name))return 'Pantry';
 if(/\b(beef|chicken|pork|turkey|bacon|sausage|salmon|shrimp|fish)\b/.test(name))return 'Meat & seafood';
 if(/\bkraft\s+singles\b/.test(name))return 'Dairy & eggs';
 if(/\b(milk|butter|eggs?|cheese|mozzarella|cheddar|parmesan|feta|gouda|brie|paneer|queso|yogurt|cream)\b/.test(name))return 'Dairy & eggs';
 if(/\b(bread|tortillas?|bagels?|buns?|rolls)\b/.test(name))return 'Bakery';
 if(/\b(bananas?|papaya|apples?|avocados?|romaine|salad blend|mushrooms?|lettuce|tomato(?:es)?|onions?|potatoes|potato|blueberries|blackberries|raspberries|strawberries|grapes|cucumbers?|beets|watermelon|cantaloupe|celery|cilantro|carrots?|cauliflower|eggplant|mango(?:es)?|plums?|peach(?:es)?|spinach|kale|mandarins|lemons|broccoli|cabbage|ginger|peppers?|pineapple|honeydew|pomegranate)\b/.test(name))return 'Produce';
 return 'Other';
};
const productCategories=['All','Produce','Dairy & eggs','Bakery','Meat & seafood','Frozen','Pantry','Drinks','Snacks & sweets','Household','Health & personal care','Pet supplies','Other'];
const categoryIcons={'Dairy & eggs':'◔','Bakery':'◒','Produce':'❧','Meat & seafood':'◇','Frozen':'❄','Pantry':'▤','Drinks':'◡','Snacks & sweets':'◒','Household':'⌂','Health & personal care':'+','Pet supplies':'◇','Other':'○'};
function renderProducts(){
 const heb=state.preferredStore==='HEB';const catalog=heb?[...new Map((state.itemCatalog||[]).filter(item=>item.store==='HEB'&&item.client===selectedAccount).map(item=>[item.productId,{id:item.productId,name:item.name}])).values()]:state.products;
 $('favorites-heading').firstChild.textContent=heb?'Saved H-E-B products ':'Saved Walmart products ';$('product-count').textContent=catalog.length;$('search').placeholder=heb?'Search saved H-E-B products…':'Search Walmart products…';
 const query=$('search').value.toLowerCase().trim();
 const matching=catalog.filter(item=>item.name.toLowerCase().includes(query));
 const categories=productCategories;const filterKey=state.preferredStore+'|'+selectedAccount+'|'+query+'|'+selectedCategory;if(filterKey!==productFilterSignature){productFilterSignature=filterKey;productPage=0;showAllProducts=false;}
 $('categories').replaceChildren();
 for(const category of categories){const count=category==='All'?matching.length:matching.filter(item=>categoryFor(item)===category).length;if(!count&&category!=='All'&&category!==selectedCategory)continue;const button=node('button',category+' '+count);button.classList.toggle('active',category===selectedCategory);button.setAttribute('aria-pressed',String(category===selectedCategory));button.onclick=()=>{selectedCategory=category;renderProducts();};$('categories').append(button);}
 $('products').replaceChildren();const items=matching.filter(item=>selectedCategory==='All'||categoryFor(item)===selectedCategory).sort((a,b)=>categories.indexOf(categoryFor(a))-categories.indexOf(categoryFor(b))||a.name.localeCompare(b.name));
 productPage=Math.min(productPage,Math.max(0,Math.ceil(items.length/24)-1));
 const productStart=showAllProducts?0:productPage*24,shown=showAllProducts?items:items.slice(productStart,productStart+24);
 if(!items.length){const empty=node('div',catalog.length?'No products match these filters.':heb?'Import your H-E-B purchase history to build this view.':'Your saved products will appear when a Walmart browser connects.','empty');if(catalog.length){const clear=node('button','Clear filters','secondary');clear.onclick=()=>{$('search').value='';selectedCategory='All';renderProducts();};empty.append(document.createElement('br'),clear);}else{const connect=node('button','Connect an account','secondary');connect.onclick=()=>showView('setup');empty.append(document.createElement('br'),connect);}$('products').append(empty);return;}
 for(const category of categories.slice(1)){
  const grouped=shown.filter(item=>categoryFor(item)===category);if(!grouped.length)continue;
  const group=node('section',undefined,'product-group');group.append(node('h3',category+' · '+grouped.length));const grid=node('div',undefined,'products');
  for(const item of grouped){
   const card=node('article',undefined,'product'),icon=node('span',categoryIcons[category],'product-icon');icon.setAttribute('aria-hidden','true');card.append(productPhoto(state.preferredStore,item.id,item.name),node('h3',item.name));
   const price=(state.currentPrices||[]).find(p=>p.client===selectedAccount&&p.store===state.preferredStore&&p.id===item.id);
   if(price)card.append(node('p','$'+price.price.toFixed(2)+' · store price checked '+new Date(price.at).toLocaleDateString()+(Date.now()-Date.parse(price.at)>86400000?' · check again before buying':''),'fine'));
   const check=node('button',price?'Update price':'Check current price','text-button');check.onclick=async()=>{try{await api('/api/store-prices/check',{client:selectedAccount,store:state.preferredStore,ids:[item.id]});notice('Price check queued. See progress in Settings.');await refresh();}catch(e){notice(e.message);}};card.append(check);
   if(heb){const amount=hebLines().find(l=>l.id===item.id)?.quantity||0;const add=node('button',amount?'Add another · '+amount+' in cart':'+ Add to H-E-B');add.onclick=()=>adjustQuantity(item.id,1,amount);card.append(add);}else{const inCart=state.list.find(line=>line.id===item.id);const add=node('button',!item.offerId?'Set up on Walmart':inCart?'Add another · '+inCart.quantity+' in cart':'+ Add to Walmart');add.disabled=!item.offerId;add.onclick=()=>adjustQuantity(item.id,1,state.list.find(line=>line.id===item.id)?.quantity||0);if(!item.offerId)card.append(node('p','Open this product on Walmart and use the helper to save it before adding it here.','fine'));card.append(add);}window.decorateShoppingProduct?.(card,item);grid.append(card);
  }group.append(grid);$('products').append(group);
 }
 const summary=node('p','Showing '+(productStart+1)+'–'+(productStart+shown.length)+' of '+items.length+' saved products. Search or choose a category to narrow the list.','fine');$('products').append(summary);
 pageControls($('products'),{label:'saved products',page:productPage,pages:Math.ceil(items.length/24),all:showAllProducts,onPage:value=>{productPage=value;renderProducts();$('favorites-heading').scrollIntoView({block:'start',behavior:'smooth'});},onAll:()=>{showAllProducts=!showAllProducts;productPage=0;renderProducts();}});
}
let showAllSuggestions=false,suggestionPage=0,suggestionScope='';
let previousHebState;
const expandedSuggestionReasons=new Set(),suggestionAmounts=new Map();
const expandedSuggestionArchives=new Set();
function renderSuggestions(){
 const scope=selectedAccount+'|'+state.preferredStore;if(scope!==suggestionScope){suggestionScope=scope;suggestionPage=0;showAllSuggestions=false;}
 const host=$('suggestions');host.replaceChildren();
 const all=(state.suggestions||[]).filter(item=>item.client===selectedAccount&&item.store===state.preferredStore&&!ShoppingAssist.isSnoozed(state,item)&&!selectedLines().some(line=>line.id===item.id));
 const rank=(a,b)=>Number(!!b.recommended)-Number(!!a.recommended)||(b.nextShopScore||0)-(a.nextShopScore||0)||Number(ShoppingGuidance.group(a)!=='regular')-Number(ShoppingGuidance.group(b)!=='regular')||Math.abs(a.daysUntil)-Math.abs(b.daysUntil)||a.name.localeCompare(b.name);
 const current=all.filter(item=>!item.needsMatch&&ShoppingGuidance.group(item)!=='older').sort(rank);
 const older=all.filter(item=>!item.needsMatch&&ShoppingGuidance.group(item)==='older').sort(rank),unmatched=all.filter(item=>item.needsMatch).sort(rank);
 if(!all.length){host.append(node('p','No purchase patterns to check right now. You can browse saved products below.','fine'));return;}
 suggestionPage=Math.min(suggestionPage,Math.max(0,Math.ceil(current.length/8)-1));
 const suggestionStart=showAllSuggestions?0:suggestionPage*8,shown=showAllSuggestions?current:current.slice(suggestionStart,suggestionStart+8);
 host.append(node('p','Showing '+(shown.length?suggestionStart+1:0)+'–'+(suggestionStart+shown.length)+' of '+current.length+' recent items by grocery type · '+(state.preferredStore==='HEB'?'H-E-B':'Walmart'),'suggestion-summary'));
 if(!current.length)host.append(node('p','No recent purchase patterns to check. Older habits and products needing a choice are below.','fine'));
 const renderCategories=(items,parent)=>{
  for(const category of productCategories.slice(1)){
   const grouped=items.filter(item=>categoryFor(item)===category).sort(rank);if(!grouped.length)continue;
   const section=node('section',undefined,'suggestion-category');section.dataset.category=category;
   const heading=node('h3',category==='Pantry'?'Canned goods & pantry':category,'suggestion-category-heading');heading.append(node('span',String(grouped.length),'suggestion-category-count'));section.append(heading);parent.append(section);
   for(const item of grouped){
  const row=node('div',undefined,'suggestion-row'),info=node('div',undefined,'suggestion-info');
  info.append(node('strong',item.name));if(item.matchKind==='substitute')info.append(node('small',item.matchNote||'Alternative product: review the type and quantity.','fine'));
  const days=HouseholdCalendar.elapsed(item.lastPurchasedDay??Date.parse(item.lastPurchasedAt.slice(0,10)));
  const timing=days===0?'Bought today':days===1?'Bought yesterday':'Bought '+days+' days ago';
  info.append(node('span',timing+' · typical gap '+item.intervalDays+' days','suggestion-meta'),node('small','Bought on '+item.purchaseCount+' dates in the past year','reason-summary'));
  const kind=ShoppingGuidance.group(item),label=kind==='older'?'Older habit · '+ShoppingGuidance.reliabilityLabel(item):kind==='match'?'Choose product first':(kind==='alternative'?'Alternative · ':'')+ShoppingGuidance.reliabilityLabel(item);
  const badge=node('span',label,'suggestion-due');badge.dataset.timing=ShoppingGuidance.group(item)==='regular'?'soon':'uncertain';info.append(badge);
  const detail=node('details',undefined,'suggestion-reason');detail.append(node('summary','Why this item?'),node('p','Based on '+item.purchaseCount+' purchase days within the last year from '+(item.sources||[]).map(store=>store==='HEB'?'H-E-B':store).join(' and ')+'. '+ShoppingGuidance.reliabilityLabel(item)+'. '+(item.gapCount?'Observed gaps range from '+item.minGap+' to '+item.maxGap+' days. ':'')+(item.recommendationReason?item.recommendationReason+' ':'')+'This estimates timing, not what you have at home. '+ShoppingGuidance.quantityNote(item)));const reasonKey=selectedAccount+'|'+item.store+'|'+(item.householdItemId||item.id||item.name);detail.open=expandedSuggestionReasons.has(reasonKey);detail.ontoggle=()=>{if(detail.isConnected){if(detail.open)expandedSuggestionReasons.add(reasonKey);else expandedSuggestionReasons.delete(reasonKey);}};info.append(detail);if(item.id&&window.snoozeControl)info.append(window.snoozeControl(item));window.decorateShoppingProduct?.(info,item);
  const actions=node('div',undefined,'suggestion-actions');
  if(item.needsMatch){const match=node('button','Choose product','secondary');match.onclick=()=>{showView('setup');showSettingsTab('settings-matches');};actions.append(match);}
  else if(item.store==='HEB'){
   actions.append(node('span',item.unit==='each'?'Start: '+ShoppingGuidance.startingAmount(item)+(ShoppingGuidance.startingAmount(item)===1?' item/pack':' items/packs'):'Start: 1 item/package · sold by weight','suggestion-amount'));
   const add=node('button','+ Add','secondary');add.setAttribute('aria-label','Add '+item.name+' to H-E-B cart');add.onclick=()=>setQuantity(item.id,Math.max(hebLines().find(l=>l.id===item.id)?.quantity||0,item.unit==='each'?Math.min(100,item.quantity):1));actions.append(add);
  }else{
   const quantity=node('input');quantity.type='number';quantity.min=1;quantity.max=100;const amountKey=selectedAccount+'|'+item.store+'|'+item.id;quantity.value=suggestionAmounts.get(amountKey)??ShoppingGuidance.startingAmount(item);quantity.oninput=()=>suggestionAmounts.set(amountKey,quantity.value);quantity.setAttribute('aria-label','Suggested quantity for '+item.name);
   const add=node('button','+ Add','secondary');add.disabled=!state.products.find(product=>product.id===item.id)?.offerId;add.setAttribute('aria-label','Add '+item.name+' to Walmart cart');add.onclick=async()=>{if(await setQuantity(item.id,Number(quantity.value)))suggestionAmounts.delete(amountKey);};actions.append(quantity,add);
   if(add.disabled)actions.append(node('small','Connect product on Walmart first','fine'));
  }
  row.append(productPhoto(item.store,item.id,item.name,true),info,actions);section.append(row);
   }
  }
 };
 renderCategories(shown,host);
 pageControls(host,{label:'recent items',page:suggestionPage,pages:Math.ceil(current.length/8),all:showAllSuggestions,onPage:value=>{suggestionPage=value;renderSuggestions();host.closest('section')?.scrollIntoView({block:'start',behavior:'smooth'});},onAll:()=>{showAllSuggestions=!showAllSuggestions;suggestionPage=0;renderSuggestions();}});
 for(const [key,title,items] of [['older','Older habits',older],['match','Choose a product first',unmatched]]){
  if(!items.length)continue;const details=node('details',undefined,'suggestion-archive'),openKey=selectedAccount+'|'+state.preferredStore+'|'+key;details.dataset.archive=key;details.open=expandedSuggestionArchives.has(openKey);details.append(node('summary',title+' · '+items.length));
  details.ontoggle=()=>{if(details.isConnected){if(details.open)expandedSuggestionArchives.add(openKey);else expandedSuggestionArchives.delete(openKey);}};
  renderCategories(items,details);host.append(details);
 }
}
let recommendationChanging=false;
function renderRecommendationSettings(){
 const select=$('recommendation-method');if(!select)return;const method=state.recommendationMethod||'category-cycle',status=state.recommendationStatus?.clients?.[selectedAccount],updating=method==='category-cycle'&&status?.status==='updating';
 if(document.activeElement!==select||recommendationChanging)select.value=method;select.disabled=recommendationChanging;
 $('recommendation-status').textContent=method==='date-based'?'Using the previous suggestion method.':updating?'Updating category + cycle suggestions…':status?.status==='error'?'Using the previous method for now. Category + cycle needs setup on the hosting PC. Run setup-recommendations.ps1 there, then choose Update suggestions.':status?.ready?(status.learning?'Category + cycle is learning your usual restocks.':'Category + cycle is ready. Automatic suggestions focus on your 1–4-week purchases.'):'Your purchase history will be used as it becomes available.';
 $('recommendation-refresh').disabled=recommendationChanging||updating;$('build-usual').disabled=updating||recommendationChanging||!!window.usualDraftBusy?.();
}
async function changeRecommendationMethod(refreshOnly=false){
 if(recommendationChanging)return;recommendationChanging=true;const method=refreshOnly?(state.recommendationMethod||'category-cycle'):$('recommendation-method').value;renderRecommendationSettings();
 try{await api('/api/recommendations/method',{method,refresh:refreshOnly});await refresh(true);notice(method==='date-based'?'Previous suggestion method restored.':'Category + cycle selected. Your shopping list and carts were not changed.');}catch(error){notice(error.message);}finally{recommendationChanging=false;renderRecommendationSettings();}
}
$('recommendation-method').onchange=()=>changeRecommendationMethod();$('recommendation-refresh').onclick=()=>changeRecommendationMethod(true);
function render(){
 const householdTag=document.querySelector('.brand small');if(householdTag)householdTag.textContent=state.householdName||'A little less to remember.';
 if(state.recoveryMode&&!$('recovery-banner')){const banner=node('aside','Recovery preview · read only. Cart updates, browser launches and sync are disabled.','panel');banner.id='recovery-banner';banner.setAttribute('role','status');document.querySelector('main').prepend(banner);}

 const previous=(!defaultAccountApplied&&state.defaultClientId)||$('account').value||localStorage.getItem('walmartAccount');
 if(state.clients.length)defaultAccountApplied=true;
 $('account').replaceChildren();
 for(const client of state.clients){const option=node('option',client.name+(client.id===state.defaultClientId?' · Default':''));option.value=client.id;$('account').append(option);}
 if(state.clients.some(client=>client.id===previous))$('account').value=previous;
 selectedAccount=$('account').value;
 renderRecommendationSettings();
 const allLines=state.allLines||state.list;state.allLines=allLines;state.list=allLines.filter(line=>line.client===selectedAccount);
 const account=state.clients.find(client=>client.id===$('account').value);
 $('account-status').textContent=!account?'Connect a desktop browser to add an account.':Date.now()-Date.parse(account.seen)<90000?'Account browser connected.':account.launchProfile==='headless-paused'?'Headless runner paused after human checks.':account.launchProfile?'Chrome will open automatically when you send a list.':'Account browser offline. Link its Chrome profile under Connect a browser for automatic opening.';
 const online=!!account&&Date.now()-Date.parse(account.seen)<90000;$('connection').textContent=online?'● Store helper connected':'○ Store helper offline';$('product-count').textContent=state.products.length;
 $('preferred-store-title').textContent=state.preferredStore==='HEB'?'H-E-B':'Walmart';$('preferred-store-link').href=state.preferredStore==='HEB'?'https://www.heb.com/':'https://www.walmart.com/';$('preferred-store-link').textContent='Browse '+(state.preferredStore==='HEB'?'H-E-B':'Walmart')+' ↗';$('preferred-store').value=state.preferredStore||'HEB';
 $('browser-setup').replaceChildren();$('headless-accounts').replaceChildren();
 for(const client of state.clients){
  const advanced=['headless','headless-paused'].includes(client.launchProfile);const row=node('article',undefined,'connected-account');row.append(node('h3',client.name));
  row.append(node('p',client.launchProfile==='headless-paused'?'Paused':Date.now()-Date.parse(client.seen)<90000?'Connected to the household server':'Not currently connected','fine'));
  if(advanced){const actions=node('div',undefined,'account-actions');const pause=node('button','Pause runner');pause.disabled=client.launchProfile==='headless-paused';pause.onclick=async()=>{try{await api('/api/runner/pause',{target:client.id});notice('Headless runner paused.');await refresh();}catch(error){notice(error.message);}};const signIn=node('button','Open sign-in window');signIn.onclick=async()=>{try{await api('/api/runner',{target:client.id});notice('Sign-in window opened. Close it when finished to resume headless mode.');}catch(error){notice(error.message);}};actions.append(signIn,pause);row.append(actions);$('headless-accounts').append(row);continue;}
  const label=node('label','Open this PC Chrome profile for cart requests');const select=node('select');select.setAttribute('aria-label','Chrome profile for '+client.name);const manual=node('option','Open Chrome manually');manual.value='';select.append(manual);
  for(const profile of browserProfiles){const option=node('option',profile.name+' ('+profile.directory+')');option.value=profile.directory;select.append(option);}select.value=client.launchProfile||'';
  select.onchange=async()=>{try{await api('/api/browsers',{client:client.id,profile:select.value||null});notice('Browser launch setting saved.');await refresh();}catch(error){notice(error.message);await refresh();}};label.append(select);row.append(label);$('browser-setup').append(row);
 }
 renderSuggestions();
 if(window.renderPlannerSettings)window.renderPlannerSettings();
 if(window.renderImportAccounts)window.renderImportAccounts();
 if(window.renderPacks)window.renderPacks();
 if(window.renderHouseholdItems)window.renderHouseholdItems();
 renderProducts();updateCartCounts(state.list);$('list').replaceChildren();
 if(!state.list.length)$('list').append(node('p','Your Walmart cart is empty. Add a few favorites.','fine'));
 for(const line of state.list){const product=state.products.find(item=>item.id===line.id)||{id:line.id,name:line.name||'Saved store product'};const row=node('div',undefined,'list-item');row.dataset.productId=line.id;row.append(productPhoto('Walmart',product.id,product.name,true),node('p',product.name));const controls=node('div',undefined,'stepper');
 const minus=node('button','−');minus.setAttribute('aria-label',`Decrease ${product.name}`);minus.onclick=()=>adjustQuantity(line.id,-1,line.quantity);
 const amount=node('input');amount.type='number';amount.min=1;amount.max=100;amount.value=cartQuantity(line.id,line.quantity);amount.setAttribute('aria-label',`Quantity for ${product.name}`);amount.onchange=()=>setQuantity(line.id,Number(amount.value));
 const plus=node('button','+');plus.setAttribute('aria-label',`Increase ${product.name}`);plus.disabled=cartQuantity(line.id,line.quantity)>=100;plus.onclick=()=>adjustQuantity(line.id,1,line.quantity);const remove=node('button','Remove','remove');remove.onclick=()=>setQuantity(line.id,0);controls.append(minus,amount,plus,remove);row.append(controls);$('list').append(row);}
 const cart=state.carts?.find(cart=>cart.client===selectedAccount);
 $('account-status').removeAttribute('title');
 if(account?.cart_error){$('account-status').title=account.cart_error;$('account-status').textContent=account.cart_error.startsWith('Chrome is closed.')?'Cart checks paused · send a site change to reconnect.':account.cart_error;}
 else if(state.runnerErrors?.[selectedAccount])$('account-status').textContent=state.runnerErrors[selectedAccount];
 else if(cart?.completed)$('account-status').textContent='Purchase marked complete. Waiting for Walmart to show an empty cart before importing again.';
 else if(cart)$('account-status').textContent+=' Last cart check: '+new Date(cart.synced).toLocaleTimeString();
 $('complete').disabled=(!state.list.length&&!cart?.canComplete)||state.jobs.some(job=>job.target===selectedAccount&&['queued','running'].includes(job.state));
 $('send').disabled=!account||state.jobs.some(job=>job.target===account.id&&['queued','running'].includes(job.state));
 $('jobs').replaceChildren();for(const job of state.jobs.filter(job=>job.target===selectedAccount).slice(0,5)){const card=node('div',undefined,'job');const labels={queued:'Waiting for your browser',running:'Updating Walmart cart…',finished:'Cart request complete','needs-attention':'Cart request needs attention'};card.append(node('strong',(job.accountName?job.accountName+' · ':'')+(labels[job.state]||job.state)),node('span',new Date(job.created).toLocaleString()));if(job.result){const results=node('ul');for(const item of job.result.report||[])results.append(node('li',`${item.name}: ${item.status}${item.quantity?' ('+item.quantity+')':''}`));if(job.result.message)results.append(node('li',job.result.message));if(job.result.error)results.append(node('li',job.result.error));card.append(results);} $('jobs').append(card);}
 renderStoreCart();window.renderStoreSync?.();window.renderPurchaseHistory?.();window.renderStatistics?.();window.renderShoppingTools?.();
 $('cart-history').replaceChildren();if(!state.history.length)$('cart-history').append(node('div','No past cart additions recorded.','empty'));
 for(const trip of state.history){const card=node('article');card.append(node('h2',new Date(trip.startedAt).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})),node('p',`${trip.items.length} products · Walmart`));const list=node('ul');for(const item of trip.items)list.append(node('li',`${item.quantity} × ${item.name}`));const repeat=node('button','Add these to my list');repeat.onclick=async()=>{try{if(state.preferredStore==='HEB')throw Error('This past cart is from Walmart. Select Walmart before repeating it.');await api('/api/repeat',{target:selectedAccount,items:trip.items.map(item=>({id:item.id,quantity:item.quantity}))});await refresh();showView('shop');notice('Past items sent to the selected Walmart cart.');}catch(error){notice(error.message);}};card.append(list,repeat);$('cart-history').append(card);}
 window.refreshUsualDraftTiming?.();
}
let lastStateCheckedAt=null;
let refreshPromise;
function refresh(force=false){
 if(refreshPromise)return force===true?refreshPromise.then(()=>refresh(true)):refreshPromise;
 refreshPromise=(async()=>{try{[state,{profiles:browserProfiles}]=await Promise.all([api('/api/state'),api('/api/browsers')]);lastStateCheckedAt=new Date();state.allLines=state.allLines||state.list||[];state.list=state.allLines.filter(line=>line.client===selectedAccount);if(force===true||!state.clients.some(client=>client.id===selectedAccount)||!document.querySelector('.stepper input:focus, #suggestions input:focus, .pack-item input:focus, .replacement-panel input:focus, .replacement-panel select:focus, select:focus'))render();else{if(!document.activeElement?.closest('#list'))renderStoreCart();else updateCartCounts();if(!document.activeElement?.closest('#suggestions'))renderSuggestions();window.renderStoreSync?.();window.renderPurchaseHistory?.();if(!document.activeElement?.closest('#packs-view'))window.renderPacks?.();window.renderShoppingTools?.();}renderRecommendationSettings();window.refreshUsualDraftTiming?.();window.renderStatistics?.();window.refreshProductPhotos?.();window.SyncFeedback?.update(state,selectedAccount);if($('notice').dataset.kind==='connection'){$('notice').hidden=true;$('notice').textContent='';delete $('notice').dataset.kind;}}catch(error){notice('Cannot reach the household server: '+error.message,'connection');}finally{refreshPromise=null;}})();return refreshPromise;
}
function showView(view){
 if(!['shop','cart','lists','packs','history','stats','setup'].includes(view))view='shop';
 for(const name of ['shop','cart','lists','packs','history','stats','setup'])$(name+'-view').hidden=name!==view;
 document.querySelectorAll('.main-nav [data-view]').forEach(button=>{button.classList.toggle('active',button.dataset.view===view);if(button.dataset.view===view)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
 document.title=({shop:'Shop',cart:'Live cart',lists:'Paste a list',packs:'Shopping packs',history:'Purchase history',stats:'Spending & habits',setup:'Settings'}[view])+' · Home Grocery';
 if(view==='cart')$('cart-details').open=true;
 if(location.hash!=='#'+view)history.replaceState(null,'','#'+view);
}
window.addEventListener('hashchange',()=>showView(location.hash.slice(1)));
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{showView(button.dataset.view);if(button.classList.contains('cart-shortcut')){$('cart-details').open=true;$('cart-heading').scrollIntoView({block:'start'});}else window.scrollTo({top:0,behavior:'instant'});});showView(location.hash.slice(1));$('search').oninput=renderProducts;
$('send').onclick=async()=>{try{await api('/api/jobs',{target:$('account').value,action:'snapshot'});notice('Checking the selected account’s Walmart cart…');await refresh();}catch(error){notice(error.message);}};
$('complete').onclick=async()=>{try{await api(state.preferredStore==='HEB'?'/api/heb/complete':'/api/purchase-complete',{target:selectedAccount});notice('Marked complete. Waiting for the store receipt before updating spending. The store cart was not changed.');await refresh();}catch(error){notice(error.message);}};
$('runner-setup').onclick=async()=>{try{const name=$('runner-name').value.trim();if(!name)throw Error('Enter an account nickname');await api('/api/runner',{name});notice('A separate grocery browser is opening for Walmart sign-in. Make one normal cart change there to connect request mode.');await refresh();}catch(error){notice(error.message);}};
$('account').onchange=()=>{localStorage.setItem('walmartAccount',$('account').value);render();};
$('server-url').textContent=location.origin;refresh();setInterval(()=>{if(!document.hidden)refresh();},1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
window.addEventListener('focus',refresh);

const phoneLayout=window.matchMedia('(max-width:720px)');
$('cart-details').open=!phoneLayout.matches;
phoneLayout.addEventListener('change',event=>{$('cart-details').open=!event.matches;});

$('shop-store').onchange=()=>changeStore($('shop-store').value);
function showSettingsTab(id,focus=false){
 const buttons=[...document.querySelectorAll('[data-settings-jump]')];
 if(!buttons.some(button=>button.dataset.settingsJump===id))id='settings-shopping';
 for(const button of buttons){const active=button.dataset.settingsJump===id;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;button.classList.toggle('active',active);$(button.dataset.settingsJump).hidden=!active;if(active&&focus)button.focus();}
 $('settings-produce').hidden=id!=='settings-shopping';
 localStorage.setItem('settingsTab',id);
}
const settingsNav=document.querySelector('.settings-nav');
settingsNav.setAttribute('role','tablist');
for(const button of settingsNav.querySelectorAll('[data-settings-jump]')){
 const id=button.dataset.settingsJump,panel=$(id);button.id='tab-'+id;button.setAttribute('role','tab');button.setAttribute('aria-controls',id);panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',button.id);
 // Replace the section disclosure with a heading, keeping nested editors collapsible.
 const disclosure=panel.querySelector(':scope > details');
 if(disclosure){const summary=disclosure.querySelector(':scope > summary'),heading=node('h2',summary.textContent);summary.replaceWith(heading);disclosure.replaceWith(...disclosure.childNodes);}
 button.onclick=()=>showSettingsTab(id);
 button.onkeydown=event=>{const tabs=[...settingsNav.querySelectorAll('[role=tab]')],index=tabs.indexOf(button);let next;if(event.key==='ArrowRight')next=(index+1)%tabs.length;if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;if(event.key==='Home')next=0;if(event.key==='End')next=tabs.length-1;if(next!==undefined){event.preventDefault();showSettingsTab(tabs[next].dataset.settingsJump,true);}};
}
showSettingsTab(localStorage.getItem('settingsTab')||'settings-shopping');
