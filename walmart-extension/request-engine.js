// Live cart IDs and headers are deliberately held only in service-worker memory.
var CartRequests = (() => {
  let session;
  let observed;
  const snapshot=()=>observed&&Date.now()-observed.observedAt<120000?structuredClone(observed):null;
  let writes = Promise.resolve();
  const ready = () => !!session && Date.now() - session.at < 30 * 60 * 1000;
  // Keep only operation flags and public protocol metadata on disk.
  function protocol(context) {
    const variables = Object.fromEntries(Object.entries(context.payload.variables).filter(([key, value]) => key !== 'input' && typeof value === 'boolean'));
    const input = context.payload.variables.input;
    variables.input = Object.fromEntries(Object.entries(input).filter(([key,value]) => key !== 'cartId' && key !== 'items' && typeof value === 'boolean'));
    if (Array.isArray(input.features)) variables.input.features = input.features.filter(value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value));
    const headers = Object.fromEntries(Object.entries(context.headers || {}).filter(([key,value]) =>
      /^(accept|content-type|x-apollo-operation-name|x-o-gql-query)$/i.test(key) && typeof value === 'string' && value.length <= 200));
    return { url: context.url, payload: { variables }, headers };
  }
  async function restore(snapshot) {
    if(snapshot?.cartId&&Array.isArray(snapshot.lines))observed={lines:snapshot.lines,observedAt:snapshot.observedAt};
    if (!snapshot?.cartId || !Array.isArray(snapshot.lines) || !snapshot.observedAt || Date.now() - snapshot.observedAt > 120000) return false;
    const { cartProtocol } = await chrome.storage.local.get('cartProtocol');
    if (!cartProtocol) return false;
    const payload = structuredClone(cartProtocol.payload);
    payload.variables.input.cartId = snapshot.cartId;
    payload.variables.input.items = [];
    return learn({ url: cartProtocol.url, payload, headers: { ...snapshot.headers, ...cartProtocol.headers },
      lines: snapshot.lines, observedAt:snapshot.observedAt, catalog: [] }, false);
  }
  async function learn(context, rememberProtocol = true) {
    const endpoint = new URL(context.url);
    if (endpoint.origin !== 'https://www.walmart.com' || endpoint.search || endpoint.hash ||
        !/^\/orchestra\/[^/]+\/graphql\/updateItems\/[a-zA-Z0-9_-]+$/.test(endpoint.pathname)) return false;
    if (!context.payload?.variables?.input?.cartId || !Array.isArray(context.lines) || !Array.isArray(context.catalog)) return false;
    const catalog = [...context.catalog, ...context.lines.filter(line => !line.restricted)]
      .filter(item => /^\d+$/.test(String(item.id)) && /^[a-zA-Z0-9-]{1,80}$/.test(item.offerId || ''));
    const learned = { url: endpoint.href, payload: structuredClone(context.payload),
      headers: Object.fromEntries(Object.entries(context.headers || {}).filter(([key]) =>
        !/^(cookie|authorization|proxy-authorization|host|content-length|origin|referer|sec-)/i.test(key))),
      lines: context.lines, catalog, at: Date.now() };
    session = learned;
    observed={lines:context.lines,observedAt:context.observedAt||Date.now()};
    writes = writes.then(async () => {
      const { savedProducts = [] } = await chrome.storage.local.get('savedProducts');
      const merged = new Map(savedProducts.map(item => [item.id, item]));
      catalog.forEach(item => merged.set(String(item.id), { id: String(item.id), offerId: item.offerId,
        name: (item.name || `Walmart item ${item.id}`).slice(0, 300), price: null, quantity: 1,
        url: `https://www.walmart.com/ip/${item.id}` }));
      learned.catalog = [...merged.values()];
      await chrome.storage.local.set({ savedProducts: learned.catalog });
      if (rememberProtocol) await chrome.storage.local.set({ cartProtocol: protocol(context) });
    });
    await writes;
    return true;
  }
  async function add(item, exact=false) {
    const target=item.quantity===undefined?1:item.quantity;
    if(!Number.isInteger(target)||target<(exact?0:1)||target>100)return {status:'unavailable',detail:'Quantity must be between 1 and 100. Nothing sent.'};
    if (!ready()) return { status: 'not-ready', detail: 'Make one normal Walmart cart change to refresh request mode. Nothing sent.' };
    await writes;
    const current = session;
    const existing = current.lines.find(line => String(line.id) === item.id && line.quantity > 0);
    if(exact&&Number.isInteger(item.expectedQuantity)&&(existing?.quantity||0)!==item.expectedQuantity)return {status:'conflict',detail:'Walmart changed since this edit. Refresh and review the cart.'};
    if(exact&&(existing?.quantity||0)===target)return {status:'already-present',quantity:target,detail:'Quantity already matches.'};
    if (existing&&!exact) return { status: 'already-present', quantity: existing.quantity, detail: 'Existing Walmart-confirmed quantity left unchanged.' };
    const product = (exact&&existing)||current.catalog.find(product => String(product.id) === item.id) ||
      (/^\d+$/.test(item.id) && /^[a-zA-Z0-9-]{1,80}$/.test(item.offerId || '') ? item : null);
    if (!product) return { status: 'unavailable', detail: 'Offer ID has not been learned for this product. Nothing sent.' };
    const payload = structuredClone(current.payload);
    payload.variables.input.items = [{ usItemId: product.id, offerId: product.offerId, name: product.name,
      quantity: target, isPharmacyPrescription: false, isQSRItem: false }];
    try {
      const response = await fetch(current.url, { method: 'POST', headers: current.headers, body: JSON.stringify(payload),
        credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(20000) });
      if ([401, 403, 429].includes(response.status)) return { status: 'blocked', httpStatus: response.status,
        detail: 'Walmart rejected the request. Complete sign-in or checks on Walmart. No automatic retry.' };
      const data = await response.json();
      const cart = data?.data?.updateItems;
      const line = cart?.lineItems?.find(row => String(row.product?.usItemId) === product.id && row.product?.offerId === product.offerId);
      if (session !== current) return { status: 'uncertain', detail: 'Another cart change occurred during this request. Check cart quantities.' };
      const confirmed = response.ok && Array.isArray(cart?.lineItems) && !data.errors?.length && (target===0?!line||line.quantity===0:line?.quantity===target) && !cart.operationalErrors?.length;
      if (cart?.lineItems) current.lines = cart.lineItems.map(row => ({ id: String(row.product?.usItemId), offerId: row.product?.offerId, quantity: row.quantity }));
      if(cart?.lineItems)observed={lines:current.lines,observedAt:Date.now()};
      return { status: confirmed ? (target===0?'removed':exact?'updated':'added') : 'uncertain', httpStatus: response.status, quantity: line?.quantity ?? null,
        detail: confirmed ? `Direct request: Walmart confirms quantity ${target}.` : 'Walmart did not confirm the requested quantity. No automatic retry.' };
    } catch { return { status: 'uncertain', detail: 'Cart request failed or timed out. Check the cart before retrying.' }; }
  }
  return { ready, learn, add, set:item=>add(item,true), snapshot, restore, invalidate: () => { session = undefined; observed=undefined; } };
})();
