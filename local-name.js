const http = require('node:http');
const ciao = require('@homebridge/ciao');

function startLocalName(handler, onServer) {
  const address = require('./network-config').addresses()[0];
  if (!address) { console.warn('groceries.local: no private home-network address is available; localhost remains available.'); return { close: async()=>{} }; }
  let responder;
  const alias = http.createServer(handler);
  onServer?.(alias);
  alias.on('error', error => console.warn(`groceries.local: port 80 could not start (${error.code}); port 4317 remains available.`));
  alias.listen(80, '0.0.0.0', async () => {
    try {
      responder = ciao.getResponder();
      const service = responder.createService({ name:'Home Grocery', hostname:'groceries', type:'http', port:80,
        disabledIpv6:true, restrictedAddresses:[address], txt:{path:'/'} });
      service.on('hostname-change', hostname => console.warn(`Local hostname changed to ${hostname}; check for a naming conflict.`));
      await service.advertise();
      console.log(`Friendly home-network address: http://${service.getHostname().replace(/\.$/,'')}`);
    } catch(error) { console.warn(`groceries.local announcement failed: ${error.message}`); }
  });
  return { close: async () => { if(responder)await responder.shutdown();alias.close(); } };
}
module.exports = { startLocalName };
