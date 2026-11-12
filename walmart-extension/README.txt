Home Grocery Helper — Walmart browser extension prototype

INSTALL IN CHROME
1. Open chrome://extensions
2. Enable Developer mode.
3. Click Load unpacked and select this walmart-extension folder.
4. Pin Home Grocery Helper from Chrome's Extensions menu.
5. Reload any Walmart tabs that were already open before installation.

SMALL TEST
Version 0.1.9 raises the previous five-product test limit to 100 products per run.
The popup shows processed/total progress. The instructions below describing 1–5
items remain a suggested small first test, not the current maximum.

1. Sign into Walmart normally in Chrome, and choose your store and pickup/delivery method.
2. Search for pasta (or another ordinary grocery item).
3. Open the extension and click Capture products on this page.
4. Select 1–5 items you do not already have in your cart.
5. Click Add selected items to Walmart. The active tab will visit each product.
6. Reopen the extension for the status, then open the Walmart cart and review it.
Do not navigate the tab during the run. Nothing checks out or submits payment.

LIMITATIONS
Version 0.2.2 adds a live WebSocket notification connection to the household server.
Website submissions wake the extension immediately. The connection reconnects
after server restarts, and uses Chrome-supported 20-second heartbeat messages.
Existing 30-second alarms remain a fallback when the live connection is unavailable.
Reload the extension after upgrading; saved household configuration is retained.

Version 0.2.0 adds the local household website bridge. Household website -> Connect
household syncs public product metadata and shopping history to the configured
home server, and polls every 30 seconds for a shared cart job. The website can
request quantities 1–100 for absent items; existing quantities are preserved.
Jobs are claimed once. Progress and final results return to the website.
Allowed household addresses are localhost/127.0.0.1 or 192.168.1.250 on port 4317.
The server README at the project root contains startup and LAN instructions.

Version 0.1.21 also records confirmed quantity increases from normal Walmart page
clicks. A known cart baseline is required, acquired by loading the cart. Removals,
reductions, existing quantities and failed requests do not count as purchases.
Cached session messages are idempotent. Prior normal clicks are not backfilled.

Version 0.1.20 saves confirmed extension-queue additions as local shopping history,
following the household assumption that sent-to-cart means purchased. Each run
groups products, quantities and addition dates. Existing items, failed/uncertain
adds and skipped items do not become new history. Each confirmed addition is
saved immediately, including partial runs. Repeated recording of the same run
and product is idempotent. Shopping history -> Use this list restores selections
for review; it does not immediately add them. Export shopping history downloads
a JSON backup. History starts from this version: old debug tests and normal
Walmart clicks are not imported. It is local to this Chrome profile, not synced
across home computers. Current cart requests add one of each absent product.

Version 0.1.18 saves only the public update-request endpoint, boolean flags,
feature names and public operation headers. Walmart cart-load responses provide
fresh cart identity and quantities; private cart/session data stay in memory.
Connect Walmart session opens/reloads the normal cart page and reconnects without
changing quantities. Add also attempts this if request mode is cold. Opening cart
during an active queue does not replace the queue's response-confirmed snapshot.
First-time protocol learning still needs ONE normal cart change after upgrading
to this version; earlier versions did not retain the public request format.
After that, reloads/worker restarts should reconnect through cart loading alone.
Live reconnection is unverified. Human checks still require normal user action.

Version 0.1.17 replaces page clicks with direct requests from the extension worker.
Live acceptance from the extension origin is still unverified (the 0.1.16 restore
test ran in the Walmart page). Reload extension and Walmart, make one ordinary
cart change, then choose Show learned products. Select three ordinary products,
including one already in the cart, and Add selected items. Open cart can navigate
immediately while the extension runs. Each response must confirm the requested
offer at quantity 1. Existing quantities are left unchanged. Unknown offers are
skipped. Authentication/bot checks and uncertain responses stop without retry.
Offer IDs/products are saved locally; session cart IDs, payload and headers remain
only in service-worker memory, lost on reload/restart or worker suspension. One
normal cart change refreshes that session. Do not manually edit the cart during
the test: concurrent changes cause an uncertain result. Captured search items with
no learned offer cannot yet be added by request. No checkout/payment requests run.

Version 0.1.15 adds a read-only request experiment. Reload extension and Walmart,
then use Walmart's normal Add button for one ordinary item. Same-origin cart POST
requests made with fetch are observed without changing them. Sanitized structural
diagnostics download automatically as cart-request-*.json. Only product/offer IDs
and quantities retain values; account/cart/session data and other field values are
replaced with type labels. Headers and cookies are never captured. The observer
does not replay requests or bypass checks. A request-based cart runner is not yet
implemented; the next decision depends on observing Walmart's actual protocol.

Version 0.1.14 supersedes background-tab execution, which failed to confirm clicks
in live testing. It processes the saved queue on the existing shopping page.
Open cart during a run queues navigation until processing ends, rather than
interrupting the additions. No duplicate worker tab is created. Keep the source
page open until completion. The queue and automatic diagnostic logs remain.

Version 0.1.12 adds a floating progress panel on the shopper's Walmart tab and an
extension badge. Completion shows added/existing/skipped/pending counts. If that
tab is on /cart it refreshes once after completion, restoring the summary afterward.
Checkout pages are never refreshed. A short completion chime is attempted; Chrome
may block audio until you interact with the Walmart page. Visual cues work without
audio. Only the originating shopping tab gets the panel and automatic refresh.

Version 0.1.11 saves the selected queue before acknowledging Add, then loads a
copy of the starting URL in an inactive worker tab. Open cart navigates the user's
current tab immediately while the worker continues. Refresh the cart after the
run to see later additions. Completed worker tabs close automatically; a blocked
or uncertain run leaves its worker open for inspection. Keep Chrome running.
Queue/progress survive closing the popup; automatic restart after closing Chrome
or reloading the extension is not implemented. Incomplete queues stay in storage
for diagnosis, without silently retrying uncertain additions. Products that only
appeared after scrolling or dynamically changing the original page may not exist
in its URL's new copy; missing items are explicitly skipped.

Version 0.1.10 recognizes existing quantities on product cards and leaves them
unchanged. It continues past already-present, missing, and unavailable products;
human checks, errors and uncertain actions still stop the run. Summary counts
distinguish added, already present, skipped and unattempted products.

Version 0.1.6 supersedes the navigation fallback: all additions stay on the starting
page. Product-card buttons are resolved using Walmart product IDs in their links,
not cached labels. A missing or ambiguous button stops the run without navigation.

Version 0.1.5 first tries the exact product-specific Add button captured from a
search/recommendation card on the current page. Recapture products after upgrading
to enable this path. If that button is absent it falls back to the product page.
Uncertain actions stop the run; they are never automatically retried on another page.
Removed the fixed 1.5-second post-load and 1-second post-item waits.

This is an unverified extension prototype. The earlier live browser test succeeded,
but this extension itself still needs testing in Chrome after manual installation.
It captures rendered product links rather than a complete catalog. It adds one per
product, stops on ambiguous results, and leaves existing quantity controls unchanged.
Walmart can still show human checks. Complete those yourself; inspect the cart before
retrying an uncertain result. There is no CAPTCHA bypass or background catalog crawler.
No pickup time is reserved by this extension.

PRIVACY
Version 0.1.3 automatically downloads a uniquely timestamped JSON log after each
completed or failed cart run to Home Grocery Helper/logs under Chrome's configured
Downloads location. The downloads permission supports this. No save dialog is
requested. Chrome/organization download policies may still block a download.
The manual Download diagnostic log button remains available as a fallback.
Automatic download does not automatically share the log with this chat.

Version 0.1.2 adds Download diagnostic log. After a failed run, download the JSON
and share it for diagnosis. It records the latest run's stages, UTC timestamps,
product IDs/names, and up to 40 cart/quantity button labels with visibility and
disabled state. It does not record full pages, account details, cookies or tokens.
Logs stay in local extension storage until you explicitly download/share them.

Product selections and run results stay in this Chrome profile's local extension
storage. There is no external server, analytics, password collection, cookie access,
or automatic purchase. Permissions apply only to www.walmart.com.

The shared household website and weekly history are not built yet. This prototype
tests the browser-side integration first.

0.2.3: Household account routing
Under Household website, set the Walmart account nickname and reconnect. Use one Chrome profile per Walmart account. The household website now selects the destination profile explicitly; other profiles cannot claim that request. The nickname is a manual label for the signed-in session, not a Walmart login switch.

0.2.4: Background launch uses Chrome no-startup-window and background permission. The extension opens an unfocused minimized window if no normal browser window exists. Reload the extension once to activate this behavior. Human checks still need manual attention.

0.3.0: Account-specific two-way live cart sync, periodic cart reads, exact quantity updates with conflict checks, and separate manual purchase-completion history on the website. Reload the extension once. Idle reads may refresh a cart tab; shopping and checkout tabs are left alone. The headless browser loads this same extension in its own saved profile.
