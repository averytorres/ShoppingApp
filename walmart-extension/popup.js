let products = [];
let selected = [];
const $ = id => document.getElementById(id);
const status = text => { $('status').textContent = text; };
chrome.storage.local.get(['householdUrl','householdStatus','householdAccountName']).then(data=>{
  $('household-account').value=data.householdAccountName||'My Walmart';
  if(data.householdUrl)$('household-url').value=data.householdUrl;
  $('household-status').textContent=data.householdStatus||'Not connected';
});
chrome.storage.local.get('householdLive').then(data=>{if(data.householdLive)$('household-status').textContent+=' · live notifications';});
$('household-connect').onclick=async()=>{
  $('household-status').textContent='Connecting…';
  try{const result=await chrome.runtime.sendMessage({type:'connectHousehold',url:$('household-url').value,accountName:$('household-account').value});$('household-status').textContent=result.error||result.status;}
  catch(error){$('household-status').textContent=error.message;}
};
async function tab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active?.url?.startsWith('https://www.walmart.com/')) throw new Error('Open a Walmart tab first.');
  return active;
}
function render() {
  $('products').replaceChildren();
  products.forEach(product => {
    const row = document.createElement('label');
    const check = document.createElement('input'); check.type = 'checkbox'; check.value = product.id;
    check.checked = selected.includes(product.id);
    check.onchange = async () => {
      selected = [...document.querySelectorAll('input:checked')].map(el => el.value);
      await chrome.storage.local.set({ selected });
      $('fill').textContent = `Add selected items to Walmart (${selected.length})`;
      status(selected.length ? `${selected.length} selected. Click Add selected items to start.` : 'Check at least one item to add.');
    };
    const text = document.createElement('span'); text.textContent = product.name;
    const price = document.createElement('small'); price.textContent = product.price ? `$${product.price} observed · 1 item` : 'Price checked at Walmart · 1 item';
    text.append(price); row.append(check, text); $('products').append(row);
  });
  $('fill').textContent = `Add selected items to Walmart (${selected.length})`;
}
async function report() {
  const { run, automaticLog } = await chrome.storage.local.get(['run', 'automaticLog']);
  if (automaticLog) $('automatic-log').textContent = automaticLog.error || `Automatic log: ${automaticLog.state || 'requested'} — Downloads/${automaticLog.filename}`;
  $('report').replaceChildren();
  if (!run) return;
  if (run.running) status(`Processed ${run.report.length} of ${run.total || '?'} items by direct request. You can open the cart now.`);
  else if (run.report.length) {
    const added = run.report.filter(item => item.status === 'added').length;
    const present = run.report.filter(item => item.status === 'already-present').length;
    const skipped = run.report.filter(item => ['not-on-page', 'unavailable'].includes(item.status)).length;
    const pending = Math.max(0, (run.total || run.report.length) - run.report.length);
    const uncertain = run.report.filter(item => ['uncertain', 'error', 'blocked'].includes(item.status)).length;
    status(`${added} added; ${present} already in cart; ${skipped} skipped; ${uncertain} need checking; ${pending} not attempted. Review item results below.`);
  }
  run.report.forEach(item => {
    const p = document.createElement('p'); p.textContent = `${item.name || 'Run'}: ${item.status}. ${item.detail || ''}`; $('report').append(p);
  });
  $('fill').disabled = run.running;
  if (run.historyError) status(run.historyError);
}
async function renderHistory() {
  const { shoppingHistory = [] } = await chrome.storage.local.get('shoppingHistory');
  $('history-list').replaceChildren();
  if (!shoppingHistory.length) {
    const text = document.createElement('p'); text.textContent = 'No shopping history yet. Successfully added items will appear here automatically.';
    $('history-list').append(text); return;
  }
  shoppingHistory.forEach(trip => {
    const card = document.createElement('article'); card.className = 'history-trip';
    const heading = document.createElement('h3');
    heading.textContent = new Date(trip.startedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const summary = document.createElement('p'); summary.textContent = `${trip.store} · ${trip.items.length} products · ${trip.items.reduce((total,item) => total + item.quantity, 0)} units`;
    const list = document.createElement('ul');
    trip.items.forEach(item => { const li = document.createElement('li'); li.textContent = `${item.quantity} × ${item.name}`; list.append(li); });
    const repeat = document.createElement('button'); repeat.textContent = 'Use this list';
    repeat.onclick = async () => {
      products = trip.items.map(item => ({ ...item })); selected = products.map(item => item.id);
      await chrome.storage.local.set({ products, selected }); render();
      status('Past items selected below. Uncheck any you don’t need, then click Add selected items. Nothing has been added yet.');
      $('history-panel').hidden = true; $('history-toggle').setAttribute('aria-expanded', 'false');
    };
    card.append(heading, summary, list, repeat); $('history-list').append(card);
  });
}
$('history-toggle').onclick = async () => {
  $('history-panel').hidden = !$('history-panel').hidden;
  $('history-toggle').setAttribute('aria-expanded', String(!$('history-panel').hidden));
  if (!$('history-panel').hidden) await renderHistory();
};
$('history-export').onclick = async () => {
  const { shoppingHistory = [] } = await chrome.storage.local.get('shoppingHistory');
  const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, store: 'Walmart', shoppingHistory }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `shopping-history-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('capture').onclick = async () => {
  try {
    const active = await tab();
    const result = await chrome.tabs.sendMessage(active.id, { type: 'capture' });
    if (result.error) throw new Error(result.error);
    products = result.products; selected = []; await chrome.storage.local.set({ products, selected }); render(); status(`Captured ${products.length} products. Check the items you want; nothing added yet.`);
  } catch (error) { status(error.message); }
};
$('saved').onclick = async () => {
  const { savedProducts = [] } = await chrome.storage.local.get('savedProducts');
  products = savedProducts; selected = [];
  await chrome.storage.local.set({ products, selected }); render();
  const request = await chrome.runtime.sendMessage({ type: 'requestStatus' });
  status(products.length + ' learned products. ' + (request.ready ? 'Request mode is ready.' : 'Use Connect Walmart session.'));
};
$('connect').onclick = async () => {
  try {
    const active = await tab(); status('Connecting from Walmart’s cart page…');
    const result = await chrome.runtime.sendMessage({ type: 'connectSession', tabId: active.id });
    status(result.ready ? 'Walmart session connected. Your saved list is ready.' : result.detail);
  } catch (error) { status(error.message); }
};
$('fill').onclick = async () => {
  try {
    const active = await tab();
    const ids = [...document.querySelectorAll('input:checked')].map(el => el.value);
    if (!ids.length || ids.length > 100) throw new Error('Select between 1 and 100 items. Nothing has been added.');
    const result = await chrome.runtime.sendMessage({ type: 'fill', tabId: active.id, sourceUrl: active.url, items: products.filter(p => ids.includes(p.id)) });
    if (result.error) throw new Error(result.error);
    status('Queue saved. Sending direct cart requests; you can open the cart now.');
  } catch (error) { status(error.message); }
};
$('cart').onclick = async () => {
  try {
    const active = await tab();
    const result = await chrome.runtime.sendMessage({ type: 'openCart', tabId: active.id });
    if (result.error) throw new Error(result.error);
    if (result.queued) status('Cart will open automatically when this run finishes. Keep this shopping page open.');
    else window.close();
  } catch (error) { status(error.message); }
};
$('request-test').onclick = async () => {
  $('request-test').disabled = true;
  try {
    const active = await tab();
    const { run } = await chrome.storage.local.get('run');
    if (run?.running) throw new Error('Wait until the normal cart run finishes.');
    status('Testing the cart request without clicking or navigating…');
    const result = await chrome.tabs.sendMessage(active.id, { type: 'requestTest' });
    status(`${result.status}: ${result.detail}`);
  } catch (error) { status(error.message); }
  finally { $('request-test').disabled = false; }
};
$('download').onclick = async () => {
  const { run, automaticLog, cartObservations } = await chrome.storage.local.get(['run', 'automaticLog', 'cartObservations']);
  if (!run && !cartObservations?.length) { status('No run or cart request recorded yet.'); return; }
  const url = URL.createObjectURL(new Blob([JSON.stringify({ ...run, automaticLog: automaticLog || null, cartObservations: cartObservations || [] }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url;
  link.download = `walmart-helper-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
chrome.storage.local.get(['products', 'selected']).then(data => { products = data.products || []; selected = data.selected || []; render(); report(); });
chrome.storage.onChanged.addListener(changes => {
  if (changes.run || changes.automaticLog) report();
  if (changes.shoppingHistory && !$('history-panel').hidden) renderHistory();
});

async function collectionStatus(){const {historyCollection}=await chrome.storage.local.get('historyCollection');$('collection-status').textContent=historyCollection?(historyCollection.store||'Store')+' · '+historyCollection.orders+' orders · '+historyCollection.message+(historyCollection.incomplete?' Partial collection: '+(historyCollection.warnings||[]).join(' '):''):'';$('collect-history').disabled=!!historyCollection?.running;}
$('collect-history').onclick=async()=>{try{const [active]=await chrome.tabs.query({active:true,currentWindow:true});const result=await chrome.runtime.sendMessage({type:'collectPurchaseHistory',tabId:active.id,store:$('collection-store').value,startPage:Number($('history-start-page').value)});if(result.error)throw Error(result.error);$('collection-status').textContent='Reading history in a separate tab. You can close this popup.';}catch(error){$('collection-status').textContent=error.message;}};
collectionStatus();chrome.storage.onChanged.addListener(changes=>{if(changes.historyCollection)collectionStatus();});

const collectionStore=new URL(location.href).searchParams.get('store');if(['Walmart','HEB'].includes(collectionStore)){$('collection-store').value=collectionStore;$('history-import-controls').open=true;$('history-import-controls').scrollIntoView();}else chrome.tabs.query({active:true,currentWindow:true}).then(([tab])=>{if(tab?.url?.startsWith('https://www.heb.com/'))$('collection-store').value='HEB';});

$('audit-receipt').onclick=async()=>{const button=$('audit-receipt');button.disabled=true;try{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});$('receipt-audit-status').textContent='Checking received items and receipt subtotal…';const result=await chrome.runtime.sendMessage({type:'auditReceipt',tabId:tab.id});if(result.error)throw Error(result.error);$('receipt-audit-status').textContent=result.receiptVerified?'Verified '+result.total+' received item rows against the receipt subtotal.':(result.warnings||[]).join(' ')||'Receipt not yet verified.';}catch(error){$('receipt-audit-status').textContent=error.message;}finally{button.disabled=false;}};

chrome.tabs.query({active:true,currentWindow:true}).then(([tab])=>{if(/^https:\/\/www\.walmart\.com\/orders\/\d+|^https:\/\/www\.heb\.com\/my-account\/order-history\//.test(tab?.url||'')){$('history-import-controls').open=true;$('audit-receipt').scrollIntoView({block:'center'});}});
