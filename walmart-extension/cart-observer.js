// Runs in Walmart's page world. Observation only: never changes or repeats a request.
(() => {
  const originalFetch = window.fetch;
  let count = 0;
  let lastRemoval;
  let experimentBusy = false;
  let latestContext;
  let latestSnapshot;
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'home-grocery-session-request') return;
    const context = latestContext && Date.now() - latestContext.observedAt <= 120000 ? latestContext : null;
    const snapshot = latestSnapshot && Date.now() - latestSnapshot.observedAt <= 120000 ? latestSnapshot : null;
    window.postMessage({ source: 'home-grocery-session-result', requestId: event.data.requestId, context, snapshot }, location.origin);
  });
  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'home-grocery-request-test') return;
    const requestId = event.data.requestId;
    const respond = result => {
      window.postMessage({ source: 'home-grocery-request-result', requestId, result }, location.origin);
      publish({ at: new Date().toISOString(), experiment: 'restore-one-removed-item', ...result });
    };
    if (experimentBusy) { respond({ status: 'busy', detail: 'A request test is already running.' }); return; }
    if (!lastRemoval) { respond({ status: 'not-ready', detail: 'On this page, remove one ordinary item using Walmart’s own Remove button first. Do not refresh afterward.' }); return; }
    experimentBusy = true;
    const template = lastRemoval;
    lastRemoval = null; // Never automatically repeat an uncertain mutation.
    try {
      const payload = structuredClone(template.payload);
      payload.variables.input.items = [{ ...template.item, quantity: 1 }];
      const response = await originalFetch(template.url, { ...template.init, method: 'POST', body: JSON.stringify(payload), credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(20000) });
      const data = await response.json();
      const cart = data?.data?.updateItems;
      const line = cart?.lineItems?.find(row => String(row.product?.usItemId) === String(template.item.usItemId) && row.product?.offerId === template.item.offerId);
      const confirmed = response.ok && !data.errors?.length && line?.quantity === 1 && !cart.operationalErrors?.length;
      respond({ status: confirmed ? 'added' : 'uncertain', httpStatus: response.status,
        productId: template.item.usItemId, quantity: line?.quantity ?? null,
        detail: confirmed ? 'Walmart response confirms quantity 1. Refresh the cart to see it.' : 'Request was not confirmed. Check the cart before retrying.' });
    } catch {
      respond({ status: 'uncertain', detail: 'Request failed or timed out. Check the cart; no automatic retry was made.' });
    } finally { experimentBusy = false; }
  });
  function shape(value, key = '', depth = 0) {
    if (depth > 9) return '[depth limit]';
    if (value === null) return null;
    if (Array.isArray(value)) return value.slice(0, 3).map(item => shape(item, key, depth + 1));
    if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 60)
      .map(([name, item]) => [name, shape(item, name, depth + 1)]));
    // Only public product identifiers and item quantities retain their values.
    // Cart IDs, addresses, account data, headers, tokens and all other values do not.
    if (/^(?:itemId|productId|usItemId|offerId|quantity)$/i.test(key) &&
        (typeof value === 'number' || (typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value)))) return value;
    return `[${typeof value}]`;
  }
  function publish(entry) {
    window.postMessage({ source: 'home-grocery-cart-observer', entry }, location.origin);
  }
  window.fetch = function(input, init) {
    const responsePromise = originalFetch.apply(this, arguments);
    // Keep the original promise and arguments untouched; diagnostics run separately.
    (async () => {
      let url;
      try { url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href); } catch { return; }
      const method = String(init?.method || input?.method || 'GET').toUpperCase();
      if (url.origin !== location.origin || !['POST', 'GET'].includes(method)) return;
      if (!/cart|addItems|updateItems/i.test(url.pathname)) return;
      let body = init?.body;
      if (body === undefined && input instanceof Request) {
        // Used Request bodies may no longer be clonable; skip rather than interfere.
        try { body = await input.clone().text(); } catch { return; }
      }
      if (method === 'POST' && (typeof body !== 'string' || body.length > 1000000)) return;
      let payload;
      try { payload = method === 'GET' ? { variables: JSON.parse(url.searchParams.get('variables') || '{}') } : JSON.parse(body); } catch { return; }
      const operation = typeof payload.operationName === 'string' ? payload.operationName : '';
      if (!/cart|addItems|updateItems/i.test(url.pathname + ' ' + operation)) return;
      count++;
      const entry = { at: new Date().toISOString(), transport: 'fetch', method,
        // Endpoint segments can contain cart/session IDs: replace UUIDs and long opaque segments.
        endpoint: url.pathname.split('/').map(part => /^[a-f0-9-]{24,}$/i.test(part) || part.length > 80 ? '[opaque]' : part).join('/'),
        operation: /^[a-zA-Z][a-zA-Z0-9_]{0,80}$/.test(operation) ? operation : null,
        requestShape: shape(payload) };
      try {
        const response = await responsePromise;
        entry.httpStatus = response.status;
        const data = await response.clone().json();
        const loadedCart = data.data?.mergeAndGetCart || data.data?.cart;
        if (response.ok && !data.errors?.length && loadedCart?.id && Array.isArray(loadedCart.lineItems)) {
          latestSnapshot = { cartId: loadedCart.id, observedAt: Date.now(), headers: Object.fromEntries(new Headers(init?.headers).entries()),
            lines: loadedCart.lineItems.map(row => ({ id: String(row.product?.usItemId), offerId: row.product?.offerId,
              name: row.product?.name, quantity: row.quantity, restricted: !!(row.isPharmacyPrescription || row.isQSRItem || row.product?.isQSRItem) })) };
          latestContext = null;
          window.postMessage({ source: 'home-grocery-cart-snapshot', snapshot: latestSnapshot }, location.origin);
        }
        const cart = data.data?.updateItems;
        if (/\/graphql\/updateItems\//.test(url.pathname) && response.ok && !data.errors?.length && cart && init && typeof init.body === 'string') {
          const previousLines = latestContext?.lines || latestSnapshot?.lines;
          const catalog = (payload.variables?.input?.items || []).filter(item => !item.isPharmacyPrescription && !item.isQSRItem)
            .map(item => ({ id: String(item.usItemId), offerId: item.offerId, name: item.name }));
          const lines = (cart.lineItems || []).map(row => ({ id: String(row.product?.usItemId), offerId: row.product?.offerId,
            name: row.product?.name, quantity: row.quantity, restricted: !!(row.isPharmacyPrescription || row.isQSRItem || row.product?.isQSRItem) }));
          const additions = previousLines && !cart.operationalErrors?.length ? lines.filter(line => !line.restricted).map(line => {
            const previous = previousLines.find(old => old.id === line.id && old.offerId === line.offerId);
            return { id: line.id, name: line.name, quantity: line.quantity - (previous?.quantity || 0), status: 'added' };
          }).filter(item => Number.isInteger(item.quantity) && item.quantity > 0) : [];
          latestContext = { url: url.href, payload, observedAt: Date.now(),
            headers: Object.fromEntries(new Headers(init.headers).entries()), catalog, lines,
            additions, activityAt: new Date().toISOString() };
          latestSnapshot = null;
          window.postMessage({ source: 'home-grocery-live-cart', context: latestContext }, location.origin);
        }
        if (/\/graphql\/updateItems\//.test(url.pathname) && response.ok && !data.errors?.length &&
            payload.variables?.input?.items?.length === 1 && init && typeof init.body === 'string') {
          const item = payload.variables.input.items[0];
          if (item.quantity === 0 && /^\d+$/.test(String(item.usItemId)) && item.offerId &&
              !item.isPharmacyPrescription && !item.isQSRItem && data.data?.updateItems) {
            // Live request context stays only in this page's closure, never storage/logs.
            lastRemoval = { url: url.href, payload: structuredClone(payload), item: structuredClone(item),
              init: { headers: new Headers(init.headers), mode: init.mode, cache: init.cache } };
          }
        }
        entry.responseShape = shape(data);
      } catch { entry.responseUnavailable = true; }
      if (count <= 20 && (/updateItems|addItems/i.test(operation+' '+url.pathname)||entry.httpStatus>=400)) publish(entry);
    })().catch(() => {});
    return responsePromise;
  };
})();
