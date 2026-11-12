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
async function setQuantity(id,quantity){try{await api(state.preferredStore==='HEB'?'/api/heb/list':'/api/list',{id,quantity,target:selectedAccount});await refresh();}catch(error){notice(error.message);}}
function hebLines(source=state,client=selectedAccount){const saved=source.hebCarts?.find(c=>c.client===client);const lines=saved?.completed?[]:structuredClone(saved?.lines||[]);for(const job of (source.hebJobs||[]).filter(j=>j.client===client&&['queued','running'].includes(j.state)).reverse())for(const item of job.items){const old=lines.find(l=>l.id===item.id);if(old)old.quantity=item.quantity;else lines.push({...item});}return lines.filter(l=>l.quantity>0);}
function storeProducts(){return state.preferredStore==='HEB'?[...new Map((state.itemCatalog||[]).filter(i=>i.store==='HEB'&&i.client===selectedAccount).map(i=>[i.productId,{id:i.productId,name:i.name,offerId:true}])).values()]:state.products;}
function selectedLines(source=state,client=selectedAccount){return state.preferredStore==='HEB'?hebLines(source,client):(source.allLines||source.list).filter(l=>l.client===client);}
function renderStoreCart(){
 const heb=state.preferredStore==='HEB',name=heb?'H-E-B':'Walmart';$('shop-store').value=state.preferredStore||'HEB';$('plan-send').textContent='Send reviewed items to '+name;$('checkout-link').href=heb?'https://www.heb.com/cart':'https://www.walmart.com/cart';$('checkout-link').textContent='Review & checkout on '+name+' ↗';$('cart-store-label').textContent='LIVE '+name.toUpperCase()+' CART';$('cart-heading').firstChild.textContent=name+' cart ';$('cart-description').textContent='Changes here update the selected account’s '+name+' cart.'+(heb?' Quantities count items or packages; final weights are set by H-E-B.':'');$('completion-question').textContent='Finished checking out on '+name+'?';$('send').hidden=heb;
 if($('heb-progress'))$('heb-progress').hidden=true;if(!heb)return;const lines=hebLines(),jobs=(state.hebJobs||[]).filter(j=>j.client===selectedAccount);$('list-count').textContent=lines.length;$('top-cart-count').textContent=lines.length;$('list').replaceChildren();if(!lines.length)$('list').append(node('p','Your H-E-B cart is empty. Choose saved products or browse H-E-B.','fine'));
 for(const item of lines){const row=node('div',undefined,'list-item');row.append(productPhoto('HEB',item.id,item.name,true),node('p',item.name));const controls=node('div',undefined,'stepper');const minus=node('button','−'),amount=node('input'),plus=node('button','+'),remove=node('button','Remove','remove');minus.setAttribute('aria-label','Decrease '+item.name);plus.setAttribute('aria-label','Increase '+item.name);amount.type='number';amount.min=1;amount.max=100;amount.value=item.quantity;amount.setAttribute('aria-label','Item count for '+item.name);minus.onclick=()=>setQuantity(item.id,item.quantity-1);plus.onclick=()=>setQuantity(item.id,item.quantity+1);amount.onchange=()=>setQuantity(item.id,Number(amount.value));remove.onclick=()=>setQuantity(item.id,0);controls.append(minus,amount,plus,remove);row.append(controls);$('list').append(row);}
 const saved=state.hebCarts?.find(c=>c.client===selectedAccount);if(previousHebState?.client===selectedAccount){const completed=jobs.find(j=>['finished','needs-attention'].includes(j.state)&&previousHebState.active.includes(j.id));if(completed)window.SyncFeedback?.toast(completed.state==='finished'?'H-E-B cart sync complete.':'H-E-B sync needs attention. See recent cart activity.',completed.state!=='finished');else if(saved?.synced!==previousHebState.synced&&!jobs.some(j=>['queued','running'].includes(j.state)))window.SyncFeedback?.toast('H-E-B cart changes synced.');}previousHebState={client:selectedAccount,synced:saved?.synced,active:jobs.filter(j=>['queued','running'].includes(j.state)).map(j=>j.id)};$('complete').disabled=!lines.length||!!saved?.completed||jobs.some(j=>['queued','running'].includes(j.state));$('jobs').replaceChildren();for(const job of jobs.slice(0,5)){const row=node('div',undefined,'job');row.append(node('strong',job.state==='running'?'Updating H-E-B cart…':job.state==='queued'?'H-E-B update queued':job.state==='finished'?'H-E-B cart updated':'H-E-B needs attention'),node('span',(job.result?.report?.length||0)+' / '+job.items.length+' processed'));if(job.result?.error)row.append(node('p',job.result.error));$('jobs').append(row);}
 $('account-status').textContent=saved?'H-E-B cart checked '+new Date(saved.synced).toLocaleTimeString():'Open your signed-in H-E-B cart in the PC browser to connect.';
 const active=jobs.find(j=>['queued','running'].includes(j.state));let progress=$('heb-progress');if(!progress){progress=node('p',undefined,'fine');progress.id='heb-progress';$('list').before(progress);}progress.hidden=!active;if(active){progress.replaceChildren(node('span',(active.state==='queued'?'Waiting for H-E-B browser…':'Updating H-E-B cart…')+' '+(active.result?.report?.length||0)+' / '+active.items.length));const bar=node('progress');bar.max=active.items.length;bar.value=active.result?.report?.length||0;bar.setAttribute('aria-label','H-E-B cart update progress');progress.append(bar);}
}
let selectedCategory='All',productLimit=24,productFilterSignature='';
const categoryFor=item=>{
 const name=item.name.toLowerCase();
 if(/\b(hemorrhoid|hydrocortisone|lidocaine|anti-itch|vitamins?|supplement|tablets?|capsules?|shampoo|conditioner|toothpaste|toothbrush|deodorant|cotton swabs|q-tips|lotion|sunscreen|body wash|hand soap|razors?|bandages?)\b/.test(name))return 'Health & personal care';
 if(/\b(cat|dog|pet)\b.*\b(food|treats|litter)\b/.test(name))return 'Pet supplies';
 if(/\b(wipes|bleach|detergent|toilet paper|paper towels|trash bags|cleaner|dish soap)\b/.test(name))return 'Household';
 if(/\b(frozen|ice cream|popsicles?)\b/.test(name))return 'Frozen';
 if(/\b(juice|coffee|tea|soda|sparkling water|coconut water|drinking water|bottled water)\b/.test(name))return 'Drinks';
 if(/\b(chips|crackers|cookies|candy|chocolate|popcorn|snack|granola bars)\b/.test(name)&&!/chocolate milk/.test(name))return 'Snacks & sweets';
 if(/\b(canned|beans|pasta|macaroni|rice|cereal|flour|sugar|oil|sauce|soup|peanut butter|vinegar|salt|seasoning|spice)\b/.test(name))return 'Pantry';
 if(/\b(beef|chicken|pork|turkey|bacon|sausage|salmon|shrimp|fish)\b/.test(name))return 'Meat & seafood';
 if(/\b(milk|butter|eggs|cheese|yogurt|cream)\b/.test(name))return 'Dairy & eggs';
 if(/\b(bread|tortillas?|bagels?|buns?|rolls)\b/.test(name))return 'Bakery';
 if(/\b(bananas?|papaya|apples?|avocados?|lettuce|tomato(?:es)?|onions?|potatoes|potato|blueberries|blackberries|raspberries|strawberries|grapes|cucumbers?|beets|watermelon|cantaloupe|celery|cilantro|carrots?|cauliflower|eggplant|mango|mandarins|lemons|broccoli|cabbage|ginger|peppers?|pineapple|honeydew|pomegranate)\b/.test(name))return 'Produce';
 return 'Other';
};
const productCategories=['All','Produce','Dairy & eggs','Bakery','Meat & seafood','Frozen','Pantry','Drinks','Snacks & sweets','Household','Health & personal care','Pet supplies','Other'];
const categoryIcons={'Dairy & eggs':'◔','Bakery':'◒','Produce':'❧','Meat & seafood':'◇','Frozen':'❄','Pantry':'▤','Drinks':'◡','Snacks & sweets':'◒','Household':'⌂','Health & personal care':'+','Pet supplies':'◇','Other':'○'};
function renderProducts(){
 const heb=state.preferredStore==='HEB';const catalog=heb?[...new Map((state.itemCatalog||[]).filter(item=>item.store==='HEB'&&item.client===selectedAccount).map(item=>[item.productId,{id:item.productId,name:item.name}])).values()]:state.products;
 $('favorites-heading').firstChild.textContent=heb?'Saved H-E-B products ':'Saved Walmart products ';$('product-count').textContent=catalog.length;$('search').placeholder=heb?'Search saved H-E-B products…':'Search Walmart products…';
 const query=$('search').value.toLowerCase().trim();
 const matching=catalog.filter(item=>item.name.toLowerCase().includes(query));
 const categories=productCategories;const filterKey=state.preferredStore+'|'+selectedAccount+'|'+query+'|'+selectedCategory;if(filterKey!==productFilterSignature){productFilterSignature=filterKey;productLimit=24;}
 $('categories').replaceChildren();
 for(const category of categories){const count=category==='All'?matching.length:matching.filter(item=>categoryFor(item)===category).length;if(!count&&category!=='All'&&category!==selectedCategory)continue;const button=node('button',category+' '+count);button.classList.toggle('active',category===selectedCategory);button.setAttribute('aria-pressed',String(category===selectedCategory));button.onclick=()=>{selectedCategory=category;renderProducts();};$('categories').append(button);}
 $('products').replaceChildren();const items=matching.filter(item=>selectedCategory==='All'||categoryFor(item)===selectedCategory).sort((a,b)=>categories.indexOf(categoryFor(a))-categories.indexOf(categoryFor(b))||a.name.localeCompare(b.name));
 const shown=items.slice(0,productLimit);
 if(!items.length){const empty=node('div',catalog.length?'No products match these filters.':heb?'Import your H-E-B purchase history to build this view.':'Your saved products will appear when a Walmart browser connects.','empty');if(catalog.length){const clear=node('button','Clear filters','secondary');clear.onclick=()=>{$('search').value='';selectedCategory='All';renderProducts();};empty.append(document.createElement('br'),clear);}else{const connect=node('button','Connect an account','secondary');connect.onclick=()=>showView('setup');empty.append(document.createElement('br'),connect);}$('products').append(empty);return;}
 for(const category of categories.slice(1)){
  const grouped=shown.filter(item=>categoryFor(item)===category);if(!grouped.length)continue;
  const group=node('section',undefined,'product-group');group.append(node('h3',category+' · '+grouped.length));const grid=node('div',undefined,'products');
  for(const item of grouped){
   const card=node('article',undefined,'product'),icon=node('span',categoryIcons[category],'product-icon');icon.setAttribute('aria-hidden','true');card.append(productPhoto(state.preferredStore,item.id,item.name),node('h3',item.name));
   const price=(state.currentPrices||[]).find(p=>p.client===selectedAccount&&p.store===state.preferredStore&&p.id===item.id);
   if(price)card.append(node('p','$'+price.price.toFixed(2)+' · store price checked '+new Date(price.at).toLocaleDateString()+(Date.now()-Date.parse(price.at)>86400000?' · check again before buying':''),'fine'));
   const check=node('button',price?'Update price':'Check current price','text-button');check.onclick=async()=>{try{await api('/api/store-prices/check',{client:selectedAccount,store:state.preferredStore,ids:[item.id]});notice('Price check queued. See progress in Settings.');await refresh();}catch(e){notice(e.message);}};card.append(check);
   if(heb){const amount=hebLines().find(l=>l.id===item.id)?.quantity||0;const add=node('button',amount?'Add another · '+amount+' in cart':'+ Add to H-E-B');add.onclick=()=>setQuantity(item.id,amount+1);card.append(add);}else{const inCart=state.list.find(line=>line.id===item.id);const add=node('button',!item.offerId?'Set up on Walmart':inCart?'Add another · '+inCart.quantity+' in cart':'+ Add to Walmart');add.disabled=!item.offerId;add.onclick=()=>setQuantity(item.id,(state.list.find(line=>line.id===item.id)?.quantity||0)+1);if(!item.offerId)card.append(node('p','Open this product on Walmart and use the helper to save it before adding it here.','fine'));card.append(add);}grid.append(card);
  }group.append(grid);$('products').append(group);
 }
 const summary=node('p','Showing '+shown.length+' of '+items.length+' saved products. Search or choose a category to narrow the list.','fine');$('products').append(summary);if(shown.length<items.length){const more=node('button','Show 24 more products','secondary');more.onclick=()=>{productLimit+=24;renderProducts();};$('products').append(more);}
}
let showAllSuggestions=false;
let previousHebState;
const expandedSuggestionReasons=new Set();
function renderSuggestions(){
 const host=$('suggestions');host.replaceChildren();
 const all=(state.suggestions||[]).filter(item=>item.client===selectedAccount&&item.store===state.preferredStore&&!selectedLines().some(line=>line.id===item.id));
 const current=all.filter(item=>!item.needsMatch&&ShoppingGuidance.group(item)!=='older').sort((a,b)=>Number(b.confidence==='established')-Number(a.confidence==='established')||Math.abs(a.daysUntil)-Math.abs(b.daysUntil));
 const older=all.filter(item=>!current.includes(item)).sort((a,b)=>Date.parse(b.lastPurchasedAt)-Date.parse(a.lastPurchasedAt));const suggested=showAllSuggestions?[...current,...older]:current;
 if(!all.length){host.append(node('p','No routine items to check right now. You can browse saved products below.','fine'));return;}
 if(!suggested.length)host.append(node('p','No recent purchase patterns to check. Older habits are available below if you want to review them.','fine'));
 const summary=node('p',(showAllSuggestions?suggested.length+' suggestions, including older habits and items needing a match':current.length+' recent items to check')+' · '+(state.preferredStore==='HEB'?'H-E-B':'Walmart'),'suggestion-summary');host.append(summary);
 let previousGroup;for(const item of suggested.slice(0,showAllSuggestions?undefined:8).sort((a,b)=>ShoppingGuidance.groups.findIndex(g=>g.id===ShoppingGuidance.group(a))-ShoppingGuidance.groups.findIndex(g=>g.id===ShoppingGuidance.group(b)))){const group=ShoppingGuidance.groups.find(g=>g.id===ShoppingGuidance.group(item));if(previousGroup!==group.id){host.append(node('h3',group.title,'suggestion-group-heading'));previousGroup=group.id;}
  const row=node('div',undefined,'suggestion-row'),info=node('div',undefined,'suggestion-info');
  info.append(node('strong',item.name));if(item.matchKind==='substitute')info.append(node('small',item.matchNote||'Alternative product: review the type and quantity.','fine'));
  const days=HouseholdCalendar.elapsed(item.lastPurchasedDay??Date.parse(item.lastPurchasedAt.slice(0,10)));
  const timing=days===0?'Bought today':days===1?'Bought yesterday':'Bought '+days+' days ago';
  info.append(node('span',timing+' · typical gap '+item.intervalDays+' days','suggestion-meta'));
  const label=ShoppingGuidance.timingLabel(item);
  const badge=node('span',label,'suggestion-due');badge.dataset.timing=ShoppingGuidance.group(item)==='regular'?'soon':'uncertain';info.append(badge);
  const detail=node('details',undefined,'suggestion-reason');detail.append(node('summary','Why this item?'),node('p','Based on '+item.purchaseCount+' purchase days within the last year from '+(item.sources||[]).map(store=>store==='HEB'?'H-E-B':store).join(' and ')+'. '+ShoppingGuidance.reliabilityLabel(item)+'. '+(item.gapCount?'Observed gaps range from '+item.minGap+' to '+item.maxGap+' days. ':'')+'This estimates timing, not what you have at home. '+ShoppingGuidance.quantityNote(item)));const reasonKey=selectedAccount+'|'+item.store+'|'+(item.householdItemId||item.id||item.name);detail.open=expandedSuggestionReasons.has(reasonKey);detail.ontoggle=()=>{if(detail.isConnected){if(detail.open)expandedSuggestionReasons.add(reasonKey);else expandedSuggestionReasons.delete(reasonKey);}};info.append(detail);
  const actions=node('div',undefined,'suggestion-actions');
  if(item.needsMatch){const match=node('button','Choose product','secondary');match.onclick=()=>{showView('setup');const section=$('settings-matches');section.querySelector('details').open=true;section.scrollIntoView({block:'start',behavior:'smooth'});};actions.append(match);}
  else if(item.store==='HEB'){
   actions.append(node('span',item.unit==='each'?'Start: '+ShoppingGuidance.startingAmount(item)+' items/packages':'Start: 1 item/package · sold by weight','suggestion-amount'));
   const add=node('button','+ Add','secondary');add.setAttribute('aria-label','Add '+item.name+' to H-E-B cart');add.onclick=()=>setQuantity(item.id,Math.max(hebLines().find(l=>l.id===item.id)?.quantity||0,item.unit==='each'?Math.min(100,item.quantity):1));actions.append(add);
  }else{
   const quantity=node('input');quantity.type='number';quantity.min=1;quantity.max=100;quantity.value=ShoppingGuidance.startingAmount(item);quantity.setAttribute('aria-label','Suggested quantity for '+item.name);
   const add=node('button','+ Add','secondary');add.disabled=!state.products.find(product=>product.id===item.id)?.offerId;add.setAttribute('aria-label','Add '+item.name+' to Walmart cart');add.onclick=()=>setQuantity(item.id,Number(quantity.value));actions.append(quantity,add);
   if(add.disabled)actions.append(node('small','Connect product on Walmart first','fine'));
  }
  row.append(productPhoto(item.store,item.id,item.name,true),info,actions);host.append(row);
 }
 if(all.length>8||older.length){const toggle=node('button',showAllSuggestions?'Show recent routine items':'Show all '+all.length+' suggestions, including older habits','secondary suggestion-toggle');toggle.setAttribute('aria-expanded',String(showAllSuggestions));toggle.onclick=()=>{showAllSuggestions=!showAllSuggestions;renderSuggestions();};host.append(toggle);}
}
function render(){
 if(state.recoveryMode&&!$('recovery-banner')){const banner=node('aside','Recovery preview · read only. Cart updates, browser launches and sync are disabled.','panel');banner.id='recovery-banner';banner.setAttribute('role','status');document.querySelector('main').prepend(banner);}

 const previous=(!defaultAccountApplied&&state.defaultClientId)||$('account').value||localStorage.getItem('walmartAccount');
 if(state.clients.length)defaultAccountApplied=true;
 $('account').replaceChildren();
 for(const client of state.clients){const option=node('option',client.name+(client.id===state.defaultClientId?' · Default':''));option.value=client.id;$('account').append(option);}
 if(state.clients.some(client=>client.id===previous))$('account').value=previous;
 selectedAccount=$('account').value;
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
 renderProducts();$('list-count').textContent=state.list.length;$('top-cart-count').textContent=state.list.length;$('list').replaceChildren();
 if(!state.list.length)$('list').append(node('p','Your Walmart cart is empty. Add a few favorites.','fine'));
 for(const line of state.list){const product=state.products.find(item=>item.id===line.id);if(!product)continue;const row=node('div',undefined,'list-item');row.append(productPhoto('Walmart',product.id,product.name,true),node('p',product.name));const controls=node('div',undefined,'stepper');
 const minus=node('button','−');minus.setAttribute('aria-label',`Decrease ${product.name}`);minus.onclick=()=>setQuantity(line.id,line.quantity-1);
 const amount=node('input');amount.type='number';amount.min=1;amount.max=100;amount.value=line.quantity;amount.setAttribute('aria-label',`Quantity for ${product.name}`);amount.onchange=()=>setQuantity(line.id,Number(amount.value));
 const plus=node('button','+');plus.setAttribute('aria-label',`Increase ${product.name}`);plus.onclick=()=>setQuantity(line.id,line.quantity+1);const remove=node('button','Remove','remove');remove.onclick=()=>setQuantity(line.id,0);controls.append(minus,amount,plus,remove);row.append(controls);$('list').append(row);}
 const cart=state.carts?.find(cart=>cart.client===selectedAccount);
 $('account-status').removeAttribute('title');
 if(account?.cart_error){$('account-status').title=account.cart_error;$('account-status').textContent=account.cart_error.startsWith('Chrome is closed.')?'Cart checks paused · send a site change to reconnect.':account.cart_error;}
 else if(state.runnerErrors?.[selectedAccount])$('account-status').textContent=state.runnerErrors[selectedAccount];
 else if(cart?.completed)$('account-status').textContent='Purchase marked complete. Waiting for Walmart to show an empty cart before importing again.';
 else if(cart)$('account-status').textContent+=' Last cart check: '+new Date(cart.synced).toLocaleTimeString();
 $('complete').disabled=(!state.list.length&&!cart?.canComplete)||state.jobs.some(job=>job.target===selectedAccount&&['queued','running'].includes(job.state));
 $('send').disabled=!account||state.jobs.some(job=>job.target===account.id&&['queued','running'].includes(job.state));
 $('jobs').replaceChildren();for(const job of state.jobs.filter(job=>job.target===selectedAccount).slice(0,5)){const card=node('div',undefined,'job');const labels={queued:'Waiting for your browser',running:'Updating Walmart cart…',finished:'Cart request complete','needs-attention':'Cart request needs attention'};card.append(node('strong',(job.accountName?job.accountName+' · ':'')+(labels[job.state]||job.state)),node('span',new Date(job.created).toLocaleString()));if(job.result){const results=node('ul');for(const item of job.result.report)results.append(node('li',`${item.name}: ${item.status}${item.quantity?' ('+item.quantity+')':''}`));if(job.result.message)results.append(node('li',job.result.message));if(job.result.error)results.append(node('li',job.result.error));card.append(results);} $('jobs').append(card);}
 renderStoreCart();window.renderStoreSync?.();window.renderPurchaseHistory?.();window.renderStatistics?.();
 $('cart-history').replaceChildren();if(!state.history.length)$('cart-history').append(node('div','No past cart additions recorded.','empty'));
 for(const trip of state.history){const card=node('article');card.append(node('h2',new Date(trip.startedAt).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})),node('p',`${trip.items.length} products · Walmart`));const list=node('ul');for(const item of trip.items)list.append(node('li',`${item.quantity} × ${item.name}`));const repeat=node('button','Add these to my list');repeat.onclick=async()=>{try{if(state.preferredStore==='HEB')throw Error('This past cart is from Walmart. Select Walmart before repeating it.');await api('/api/repeat',{target:selectedAccount,items:trip.items.map(item=>({id:item.id,quantity:item.quantity}))});await refresh();showView('shop');notice('Past items sent to the selected Walmart cart.');}catch(error){notice(error.message);}};card.append(list,repeat);$('cart-history').append(card);}
}
let lastStateCheckedAt=null;
let refreshPromise;
function refresh(force=false){
 if(refreshPromise)return force===true?refreshPromise.then(()=>refresh(true)):refreshPromise;
 refreshPromise=(async()=>{try{[state,{profiles:browserProfiles}]=await Promise.all([api('/api/state'),api('/api/browsers')]);lastStateCheckedAt=new Date();if(force===true||!document.querySelector('.stepper input:focus, #suggestions input:focus, .pack-item input:focus, select:focus'))render();else{if(!document.activeElement?.closest('#list'))renderStoreCart();else $('top-cart-count').textContent=selectedLines().length;if(!document.activeElement?.closest('#suggestions'))renderSuggestions();window.renderStoreSync?.();window.renderPurchaseHistory?.();if(!document.activeElement?.closest('#packs-view'))window.renderPacks?.();}window.refreshUsualDraftTiming?.();window.renderStatistics?.();window.SyncFeedback?.update(state,selectedAccount);if($('notice').dataset.kind==='connection'){$('notice').hidden=true;$('notice').textContent='';delete $('notice').dataset.kind;}}catch(error){notice('Cannot reach the household server: '+error.message,'connection');}finally{refreshPromise=null;}})();return refreshPromise;
}
function showView(view){
 if(!['shop','lists','packs','history','stats','setup'].includes(view))view='shop';
 for(const name of ['shop','lists','packs','history','stats','setup'])$(name+'-view').hidden=name!==view;
 document.querySelectorAll('.main-nav [data-view]').forEach(button=>{button.classList.toggle('active',button.dataset.view===view);if(button.dataset.view===view)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
 document.title=({shop:'Shop',lists:'Paste a list',packs:'Shopping packs',history:'Purchase history',stats:'Spending & habits',setup:'Settings'}[view])+' · Home Grocery';
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

$('shop-store').onchange=async()=>{try{await api('/api/preferred-store',{store:$('shop-store').value});await refresh(true);}catch(error){notice(error.message);}};
document.querySelectorAll('[data-settings-jump]').forEach(button=>button.onclick=()=>{const section=$(button.dataset.settingsJump);const detail=section.querySelector(':scope > details');if(detail)detail.open=true;section.scrollIntoView({block:'start',behavior:'smooth'});});
