const setupElement=id=>document.getElementById(id);
async function checkSetup(){
 try{
  const [stateResponse,installationResponse]=await Promise.all([fetch('/api/state'),fetch('/api/installation')]);
  if(!stateResponse.ok||!installationResponse.ok)throw Error('Server is not ready');
  const state=await stateResponse.json(),installation=await installationResponse.json();
  const connected=(state.clients||[]).filter(client=>Date.now()-Date.parse(client.seen)<90000);
  setupElement('setup-status').textContent=connected.length?'Server running · '+connected.length+' account browser'+(connected.length===1?'':'s')+' connected. Continue shopping when ready.':'Your household server is running. Connect the Chrome helper below to finish setup.';
  setupElement('extension-folder').value=installation.extensionFolder||'Open this guide on the hosting PC to see its helper folder.';
  setupElement('copy-extension').disabled=!installation.local;
  setupElement('helper-url').value='http://127.0.0.1:'+installation.port;
  setupElement('network-addresses').replaceChildren();
  for(const address of installation.addresses){const row=document.createElement('li'),link=document.createElement('a');link.href=address;link.textContent=address;row.append(link);setupElement('network-addresses').append(row);}
 }catch{setupElement('setup-status').textContent='Cannot reach Home Grocery. Use Open Home Grocery in the Windows Start menu, then try again.';}
}
for(const [button,input]of [['copy-extension','extension-folder'],['copy-helper','helper-url']])setupElement(button).onclick=async()=>{
 try{await navigator.clipboard.writeText(setupElement(input).value);setupElement('copy-status').textContent='Copied. Paste it into the Chrome setup step above.';}catch{setupElement(input).focus();setupElement(input).select();setupElement('copy-status').textContent='Select the text above and copy it.';}
};
checkSetup();setInterval(checkSetup,5000);
