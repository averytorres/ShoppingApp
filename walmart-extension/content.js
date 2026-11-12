(() => {
  function safeSend(message){try{if(!chrome.runtime?.id)return Promise.resolve({});return chrome.runtime.sendMessage(message);}catch(error){return Promise.reject(error);}}

  window.addEventListener('message', event => {
    if (event.source === window && event.origin === location.origin && event.data?.source === 'home-grocery-cart-snapshot') {
      safeSend({ type: 'cartSnapshot', snapshot: event.data.snapshot }).catch(() => {});
      return;
    }
    if (event.source === window && event.origin === location.origin && event.data?.source === 'home-grocery-live-cart') {
      safeSend({ type: 'liveCartContext', context: event.data.context }).catch(() => {});
      return;
    }
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'home-grocery-cart-observer') return;
    safeSend({ type: 'cartObservation', entry: event.data.entry }).catch(() => {});
  });
  let panel;
  let audioContext;
  let latestProgress;
  // A page gesture lets Chrome enable the optional completion chime.
  document.addEventListener('pointerdown', () => {
    try { audioContext ||= new AudioContext(); audioContext.resume().catch(() => {}); } catch {}
  }, { once: true });
  function showProgress(run, live = false) {
    if (!run) return;
    if (latestProgress && (run.startedAt < latestProgress.startedAt ||
      (run.startedAt === latestProgress.startedAt && run.events.length < latestProgress.events.length))) return;
    latestProgress = run;
    if (panel && !panel.host.isConnected) panel = null;
    if (!panel) {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647';
      const root = host.attachShadow({ mode: 'closed' });
      const box = document.createElement('section');
      box.style.cssText = 'font:14px system-ui;color:#172b42;background:white;border:2px solid #075ed1;border-radius:12px;padding:16px;width:300px;box-shadow:0 4px 24px #0003';
      box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
      const title = document.createElement('strong');
      const text = document.createElement('p'); text.style.margin = '8px 0';
      const bar = document.createElement('progress'); bar.style.width = '100%';
      const close = document.createElement('button'); close.textContent = 'Dismiss';
      close.onclick = () => { host.remove(); panel = null; };
      box.append(title, text, bar, close); root.append(box); document.documentElement.append(host);
      panel = { host, title, text, bar };
    }
    const processed = run.report.filter(item => item.id).length;
    const added = run.report.filter(item => item.status === 'added').length;
    const present = run.report.filter(item => item.status === 'already-present').length;
    const skipped = run.report.filter(item => ['not-on-page', 'unavailable'].includes(item.status)).length;
    const pending = Math.max(0, run.total - processed);
    const uncertain = run.report.filter(item => ['uncertain', 'error', 'blocked'].includes(item.status)).length;
    const stage = run.events.at(-1);
    const current = stage?.productId ? ` · working on item ${processed + 1}` : ' · preparing shopping list';
    const needsAttention = skipped || pending || run.report.some(item => ['blocked', 'uncertain', 'error'].includes(item.status));
    panel.title.textContent = run.running ? 'Updating your Walmart cart…' : needsAttention ? 'Cart run finished — review needed' : 'Your cart is updated';
    panel.text.textContent = run.running ? `${processed} of ${run.total} processed${current} · ${added} added` : `${added} added · ${present} already in cart · ${skipped} skipped · ${uncertain} need checking · ${pending} not attempted`;
    if (!run.running && uncertain) panel.text.textContent += ' · Open the extension to review the stopped item. Check its cart quantity before retrying.';
    panel.bar.max = run.total || 1; panel.bar.value = processed;
    if (!run.running && live) {
      const key = `grocery-helper-finished-${run.startedAt}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
      try {
        audioContext ||= new AudioContext();
        if (audioContext.state === 'running') {
          (needsAttention ? [523.25, 392] : [783.99, 1046.5]).forEach((frequency, i) => {
            const start = audioContext.currentTime + i * 0.42;
            [1, 2.76].forEach((ratio, harmonic) => {
              const gain = audioContext.createGain();
              gain.gain.setValueAtTime(0.001, start);
              gain.gain.linearRampToValueAtTime(harmonic ? 0.035 : 0.18, start + 0.012);
              gain.gain.exponentialRampToValueAtTime(0.001, start + 0.85);
              gain.connect(audioContext.destination);
              const tone = audioContext.createOscillator(); tone.frequency.value = frequency * ratio; tone.connect(gain);
              tone.start(start); tone.stop(start + 0.9);
            });
          });
        }
      } catch {}
      // Exact cart only: never reload checkout or interrupt a form there.
      if (/^\/cart\/?$/.test(location.pathname)) {
        panel.text.textContent += ' · Refreshing cart…';
        setTimeout(() => location.reload(), 1600);
      }
    }
  }
  const syncProgress = () => safeSend({ type: 'getProgress' })
    .then(response => showProgress(response?.run, true)).catch(() => {});
  syncProgress();
  // Recover missed messages during navigation and reject late, stale snapshots.
  setInterval(syncProgress, 1500);
  const visible = el => !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
  const label = el => normalize(el.getAttribute('aria-label') || el.textContent);
  const productId = href => {
    try {
      let url = new URL(href, location.origin);
      if (url.pathname.startsWith('/sp/track')) url = new URL(url.searchParams.get('rd'));
      return url.origin === location.origin ? url.pathname.match(/\/ip\/(?:.*\/)?(\d+)\/?$/)?.[1] : null;
    } catch { return null; }
  };
  function startingButtons(id, includeQuantity = false) {
    if (productId(location.href) === id) return [...document.querySelectorAll('button')].filter(b => visible(b) && isPrimary(b));
    const found = new Set();
    for (const link of document.querySelectorAll('a[href]')) {
      if (productId(link.href) !== id || !visible(link)) continue;
      for (let card = link.parentElement; card && card !== document.body; card = card.parentElement) {
        const ids = new Set([...card.querySelectorAll('a[href]')].map(a => productId(a.href)).filter(Boolean));
        if (ids.size !== 1 || !ids.has(id)) break;
        const buttons = [...card.querySelectorAll('button')].filter(b => visible(b) && !b.disabled &&
          (/^Add to cart(?: - |$)/i.test(label(b)) || (includeQuantity && /(?:Increase quantity|Decrease quantity).*Current Quantity [1-9]/i.test(label(b)))));
        if (buttons.length) { buttons.forEach(b => found.add(b)); break; }
      }
    }
    return [...found];
  }
  const isPrimary = b => {
    const title = normalize([...document.querySelectorAll('h1')].find(visible)?.textContent);
    const name = label(b);
    return !b.disabled && (/^Add to cart$/i.test(name) ||
      (title && name.toLowerCase() === `Add to cart - ${title}`.toLowerCase()));
  };
  const diagnostics = () => ({
    productId: location.pathname.match(/\/ip\/(?:.*\/)?(\d+)\/?$/)?.[1] || null,
    readyState: document.readyState,
    humanCheck: blocked(),
    buttons: [...document.querySelectorAll('button')]
      .filter(b => /add to cart|quantity|added to cart/i.test(`${label(b)} ${b.textContent}`))
      .slice(0, 40).map(b => ({ label: label(b).slice(0, 180), text: normalize(b.textContent).slice(0, 180), visible: visible(b), disabled: b.disabled }))
  });
  const blocked = () => /Robot or human\?|confirm that you.re human|verify you are human/i.test(document.body.innerText);
  function capture() {
    const products = new Map();
    const currentId = location.pathname.match(/\/ip\/(?:.*\/)?(\d+)\/?$/)?.[1];
    const title = [...document.querySelectorAll('h1')].find(visible)?.textContent.trim();
    if (currentId && title) {
      products.set(currentId, { id: currentId, name: title, price: null, url: `https://www.walmart.com/ip/${currentId}`, quantity: 1 });
      return [...products.values()];
    }
    for (const link of document.querySelectorAll('a[href]')) {
      if (!visible(link)) continue;
      let url = new URL(link.href);
      if (url.pathname.startsWith('/sp/track')) {
        try { url = new URL(url.searchParams.get('rd')); } catch { continue; }
      }
      if (url.origin !== location.origin) continue;
      const id = url.pathname.match(/\/ip\/(?:.*\/)?(\d+)\/?$/)?.[1];
      if (!id) continue;
      const heading = link.querySelector('h2,h3,h4');
      const raw = label(link) || heading?.textContent.trim();
      if (!raw || raw.length < 8 || /^(Options|Sign in)/i.test(raw)) continue;
      const price = raw.match(/(?:Price(?: Now)?|current price|\$)\s*\$?(\d+\.\d{2})/i)?.[1];
      const name = raw.replace(/,?\s*Price\s.*$/i, '').trim();
      let card = link.parentElement;
      let cartLabel = null;
      for (let depth = 0; card && depth < 5; depth++, card = card.parentElement) {
        const adds = [...card.querySelectorAll('button')].filter(b => visible(b) && /^Add to cart - /i.test(label(b)));
        if (adds.length === 1) { cartLabel = label(adds[0]); break; }
        if (adds.length > 1) break;
      }
      if (!products.has(id) || price) products.set(id, { id, name, cartLabel, price: price || null, url: `https://www.walmart.com/ip/${id}`, quantity: 1 });
    }
    return [...products.values()];
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message.type === 'initializeSession') {
      const requestId = crypto.randomUUID();
      const receive = async event => {
        if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'home-grocery-session-result' || event.data.requestId !== requestId) return;
        clearTimeout(timeout); window.removeEventListener('message', receive);
        try {
          const result = event.data.context ? await safeSend({ type: 'liveCartContext', context: event.data.context }) :
            event.data.snapshot ? await safeSend({ type: 'cartSnapshot', snapshot: event.data.snapshot }) : { ready: false };
          reply(result);
        } catch { reply({ ready: false }); }
      };
      const timeout = setTimeout(() => { window.removeEventListener('message', receive); reply({ ready: false }); }, 3000);
      window.addEventListener('message', receive);
      window.postMessage({ source: 'home-grocery-session-request', requestId }, location.origin);
      return true;
    }
    if (message.type === 'requestTest') {
      const requestId = crypto.randomUUID();
      const receive = event => {
        if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'home-grocery-request-result' || event.data.requestId !== requestId) return;
        clearTimeout(timeout); window.removeEventListener('message', receive); reply(event.data.result);
      };
      const timeout = setTimeout(() => {
        window.removeEventListener('message', receive); reply({ status: 'uncertain', detail: 'Request-test bridge timed out. Check the cart before retrying.' });
      }, 25000);
      window.addEventListener('message', receive);
      window.postMessage({ source: 'home-grocery-request-test', requestId }, location.origin);
      return true;
    }
    if (message.type === 'progress') { showProgress(message.run, true); reply({ received: true }); return; }
    if (message.type === 'capture') {
      reply(blocked() ? { error: 'Walmart is asking for a human check. Complete it in the tab, then capture again.' } : { products: capture() });
    }
    if (message.type === 'addOne') {
      const execute = async () => {
      const observations = [];
      if (blocked()) { reply({ status: 'blocked', detail: 'Complete the Walmart human check, then retry.', diagnostics: diagnostics() }); return; }
      if (message.visibleOnly && startingButtons(message.productId, true).some(b => /Current Quantity [1-9]/i.test(label(b)))) {
        reply({ status: 'already-present', detail: 'This product has a cart quantity control. Left its quantity unchanged.', diagnostics: diagnostics() }); return;
      }
      const starting = message.visibleOnly ? startingButtons(message.productId) : [];
      const matches = b => message.visibleOnly ? starting.includes(b) : isPrimary(b);
      if (message.visibleOnly && !starting.length) {
        reply({ status: 'not-on-page', detail: 'Could not identify this product’s Add button on the starting page. No product pages were opened.', diagnostics: diagnostics() }); return;
      }
      // DOM hydration may continue after the browser reports the page as loaded.
      for (let attempt = 0; attempt < 20; attempt++) {
        const sample = diagnostics();
        if (attempt === 0 || attempt === 19) observations.push({ at: new Date().toISOString(), ...sample });
        if (blocked() || [...document.querySelectorAll('button')].some(b => visible(b) && matches(b))) break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      const respond = result => reply({ ...result, diagnostics: { observations, final: diagnostics() } });
      if (blocked()) { respond({ status: 'blocked', detail: 'Complete the human check in Walmart, then retry remaining items.' }); return; }
      const buttons = [...document.querySelectorAll('button')].filter(visible);
      // A product-page primary action has an exact label. Never click recommendation cards.
      const candidates = buttons.filter(matches);
      // Search pages can repeat a product in multiple cards. Each starting-page
      // candidate was already bound to the requested product ID; identical
      // action labels are equivalent, so click only the first one once.
      const equivalent = message.visibleOnly && candidates.length > 1 &&
        candidates.every(b => label(b) === label(candidates[0]));
      const primary = candidates.length === 1 || equivalent ? candidates[0] : null;
      observations.push({ at: new Date().toISOString(), requestedProductId: message.productId || null,
        matchingButtonCount: candidates.length, equivalentDuplicates: equivalent,
        matchingLabels: candidates.map(label).slice(0, 10) });
      const quantity = !message.visibleOnly && buttons.find(b => /(?:Increase quantity|Current Quantity|Decrease quantity)/i.test(label(b)));
      if (quantity || !primary) { respond({ status: quantity ? 'already-present' : 'unavailable', detail: quantity ? 'Quantity control found; left unchanged to avoid duplicates.' : `Found ${candidates.length} enabled Add to cart buttons matching this product. See the diagnostic log.` }); return; }
      const beforeLabels = new Set(buttons.map(label));
      const hadConfirmation = /Added to cart/i.test(document.body.innerText);
      primary.click();
      let attempts = 0;
      const timer = setInterval(() => {
        attempts++;
        const text = document.body.innerText;
        const controls = [...document.querySelectorAll('button')].filter(visible);
        const confirmed = controls.some(b => !beforeLabels.has(label(b)) && /(?:Increase quantity|Decrease quantity).*Current Quantity 1/i.test(label(b))) || (!hadConfirmation && /Added to cart/i.test(text));
        if (confirmed || blocked() || attempts >= 16) {
          clearInterval(timer);
          respond({ status: blocked() ? 'blocked' : confirmed ? 'added' : 'uncertain', detail: confirmed ? 'Walmart displayed an added-to-cart confirmation or quantity control.' : 'Could not confirm addition; inspect the cart before retrying.' });
        }
      }, 500);
      };
      execute().catch(() => reply({ status: 'error', detail: 'Product interaction failed. No automatic retry was attempted.', diagnostics: diagnostics() }));
      return true;
    }
  });
})();
