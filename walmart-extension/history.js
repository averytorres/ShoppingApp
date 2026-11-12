// Shopping history follows the household rule: confirmed cart additions count
// as purchases. No checkout, account data, or session context is recorded.
var ShoppingHistory = (() => {
  let pending = Promise.resolve();
  function record(runId, result, at = new Date().toISOString()) {
    const work = pending.catch(() => {}).then(async () => {
      if (result.status !== 'added' || !/^\d+$/.test(String(result.id)) || !Number.isInteger(result.quantity) || result.quantity < 1) return;
      const { shoppingHistory = [], savedProducts = [] } = await chrome.storage.local.get(['shoppingHistory', 'savedProducts']);
      const history = structuredClone(shoppingHistory);
      let trip = history.find(trip => trip.id === runId);
      if (trip?.items.some(item => item.id === String(result.id))) return;
      if (!trip) { trip = { id: runId, store: 'Walmart', startedAt: Number.isFinite(Date.parse(runId)) ? runId : at, recordedAs: 'confirmed-cart-additions', items: [] }; history.unshift(trip); }
      const product = savedProducts.find(product => product.id === String(result.id));
      trip.items.push({ id: String(result.id), name: String(result.name || product?.name || `Walmart item ${result.id}`).slice(0, 300),
        quantity: result.quantity, addedAt: at, ...(product?.offerId ? { offerId: product.offerId } : {}),
        url: `https://www.walmart.com/ip/${result.id}` });
      trip.updatedAt = at;
      await chrome.storage.local.set({ shoppingHistory: history });
    });
    pending = work;
    return work;
  }
  return { record };
})();
