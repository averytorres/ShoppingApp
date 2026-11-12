(() => {
  let preview;let previewVersion=0,commitBusy=false;
  function syncCommitControls(){for(const id of ['import-preview','import-account','import-store','import-file','import-commit'])$(id).disabled=commitBusy;for(const input of $('import-review').querySelectorAll('input'))input.disabled=commitBusy;}
  let importStoreApplied=false;
  const message=text=>{$('import-status').textContent=text;};
  window.renderImportAccounts=()=>{
    if(!importStoreApplied&&state.preferredStore){$('import-store').value=state.preferredStore;importStoreApplied=true;}
    const previous=$('import-account').value||selectedAccount;$('import-account').replaceChildren();
    for(const client of state.clients){const option=node('option',client.name);option.value=client.id;$('import-account').append(option);}
    if(state.clients.some(client=>client.id===previous))$('import-account').value=previous;
  };
  function display(result){
    preview=result;$('import-review').replaceChildren();
    message((result.incomplete?'Partial collection · ':'')+result.eligible+' completed orders eligible. Confirm the destination account, dates, products and quantity units before importing.');
    for(const warning of result.collectionWarnings||[])$('import-review').append(node('p',warning,'fine'));
    for(const order of result.orders){
      const card=node('article',undefined,'plan-row');const label=node('label',order.label+(order.created?' · '+new Date(order.created).toLocaleDateString(undefined,{timeZone:'UTC'}):''));
      if(!order.skip){const checked=node('input');checked.type='checkbox';checked.checked=true;checked.value=order.id;checked.setAttribute('aria-label','Import '+order.label);label.prepend(checked);}card.append(label);
      if(order.skip)card.append(node('p','Skipped: '+order.skip));
      for(const item of order.items||[]){const amount=item.unit&&item.unit!=='each'?item.quantity+' '+item.unit+' · ':item.quantity+' × ';card.append(node('p',amount+item.name+(Number.isFinite(item.unitPrice)?' · $'+item.unitPrice.toFixed(2)+' / '+(item.unit||'each'):'')));}
      for(const warning of new Set(order.warnings||[]))card.append(node('p',warning,'fine'));
      $('import-review').append(card);
    }
    $('import-commit').hidden=!result.eligible||result.committed;
    if(result.committed)message('This collection was already imported.');
  }
  function invalidate(){previewVersion++;preview=null;$('import-commit').hidden=true;$('import-review').replaceChildren();message('Preview this file for the selected account and store.');}
  $('import-account').onchange=invalidate;$('import-store').onchange=()=>{importStoreApplied=true;invalidate();};$('import-file').onchange=invalidate;
  $('import-preview').onclick=async()=>{
    if(commitBusy)return;
    const version=++previewVersion;const chosenFile=$('import-file').files[0];$('import-preview').disabled=true;preview=null;$('import-commit').hidden=true;$('import-review').replaceChildren();
    try{
      const file=chosenFile;if(!file)throw Error('Choose a history file first.');if(file.size>1500000)throw Error('Use a file under 1.5 MB.');
      const format=file.name.toLowerCase().endsWith('.csv')?'csv':file.name.toLowerCase().endsWith('.json')?'json':null;if(!format)throw Error('Choose a JSON or CSV file.');
      const client=$('import-account').value,store=$('import-store').value;
      const result=await api('/api/history-import/preview',{client,store,format,text:await file.text()});
      if(version!==previewVersion||chosenFile!==$('import-file').files[0]||client!==$('import-account').value||store!==$('import-store').value)throw Error('The destination changed. Preview again.');display(result);
    }catch(error){message(error.message);}finally{$('import-preview').disabled=false;}
  };
  $('import-commit').onclick=async()=>{
    if(commitBusy)return;commitBusy=true;syncCommitControls();
    try{
      if(!preview||preview.client!==$('import-account').value||preview.store!==$('import-store').value)throw Error('Preview the current account and store again.');
      const orders=[...$('import-review').querySelectorAll('input:checked')].map(input=>input.value);if(!orders.length)throw Error('Select at least one eligible order.');
      const result=await api('/api/history-import/commit',{id:preview.id,orders});
      window.SyncFeedback?.toast('Purchase history updated: '+result.imported+' orders imported.');message(result.imported+' purchases imported; '+result.duplicates+' duplicates skipped. No cart changes were made.');preview=null;$('import-commit').hidden=true;await refresh();
    }catch(error){message(error.message);}finally{commitBusy=false;syncCommitControls();}
  };
  window.renderImportAccounts();
  const collectedId=new URL(location.href).searchParams.get('import');
  if(collectedId)(async()=>{const version=previewVersion;try{
    const result=await api('/api/history-import/preview?id='+encodeURIComponent(collectedId));const available=await api('/api/state');if(version!==previewVersion||commitBusy)return;
    $('import-account').replaceChildren();for(const client of available.clients){const option=node('option',client.name);option.value=client.id;$('import-account').append(option);}
    importStoreApplied=true;$('import-account').value=result.client;$('import-store').value=result.store;showView('history');$('import-preview').closest('details').open=true;display(result);
    history.replaceState(null,'',location.pathname+'#history');
  }catch(error){message(error.message);}})();
})();
