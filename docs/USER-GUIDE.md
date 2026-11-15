# Using Home Grocery

[Home and download](../README.md) · [Troubleshooting](TROUBLESHOOTING.md) · [Backup and recovery](../BACKUP-RECOVERY.txt)

## Set up the hosting PC

Use Windows 10/11 x64 and desktop Google Chrome 120 or newer. Install once on a
PC that can stay awake and signed into Windows. The installer bundles Node and
dependencies; you do not need a developer setup.

1. [Download the installer](https://github.com/averytorres/ShoppingApp/releases/latest/download/Install-Home-Grocery.exe). No GitHub account is required.
2. Run it, enter a household name, and choose H-E-B or Walmart as the main store.
3. Choose whether to start quietly at Windows sign-in. Allow private-network
   access if phones or other computers will use the website; Windows asks for
   administrator approval for that option.
4. Continue with the browser connection guide that opens when the server is ready.

The installer is unsigned, so Windows may show an unknown-publisher or SmartScreen
warning. It does not silently install a browser extension or sign into stores.
Keep an existing source installation if you already use one: the installer refuses
to replace another server on port 4317 and does not migrate its data.

## Connect Chrome and your store accounts

1. On the hosting PC, open `chrome://extensions` in your shopping Chrome profile.
2. Turn on **Developer mode**, choose **Load unpacked**, and select the helper
   folder shown in the connection guide. **Start → Home Grocery → Chrome extension
   folder** also opens it. For a source checkout, select its `walmart-extension` folder.
3. Reload any store tabs that were open before the helper was installed.
4. Sign into your intended H-E-B and/or Walmart account in this Chrome profile.
   Complete store human checks yourself. Never enter store passwords into Home Grocery.
5. Open **Home Grocery Helper** from Chrome's Extensions menu. Expand **Household
   website**, keep `http://127.0.0.1:4317`, enter a recognizable account nickname,
   and choose **Connect household**.
6. In Home Grocery's **Settings → Connected accounts**, link the account to the
   matching Chrome profile if you want the server to open that profile for cart work.
   Choose the intended default account and main store in the settings provided.

Nicknames label browser connections; they do not change or verify store logins.
For a second person's store accounts, use another Chrome profile, sign into the
right stores there, install the helper, and give its connection a different nickname.
Walmart can need one ordinary cart change to learn its request format initially.

The helper uses desktop Chrome. It cannot be installed in normal mobile Chrome;
your phone uses the website and the helper on the PC performs store operations.
Browser windows or temporary store tabs may appear. Headless Walmart is not the
working route because of repeated store human checks.

## Open the website on your devices

On the host, use **Start → Home Grocery → Open Home Grocery**, or open
http://127.0.0.1:4317. Reopen the connection guide at http://127.0.0.1:4317/install.

On a phone or laptop on the same private network, open **http://groceries.local**.
If that name does not resolve, use a numbered address from the connection guide.
The other device does not need Node or the Chrome helper. Keep the PC awake and
signed in; store syncing also needs its connected Chrome profile and store session.

## Bring in purchase history

Use the helper's **Import past store purchases** section to collect H-E-B or
Walmart history from the signed-in profile. Review the destination account and
receipts in the website before accepting a manual import. Import the other store
too if you want shared purchase patterns across stores.

The server checks both stores on **Monday at 2 a.m. America/New_York**, with
catch-up after downtime. It skips already captured, verified receipts and collects
new or incomplete information. **Settings → History sync** lets you request a
check and see progress. Store sign-in or a human check can interrupt collection.
The server owns this schedule; no development chat or coding app needs to stay open.

Receipt prices, discounts, weight quantities and order totals describe actual
purchases. Storefront prices are separate dated observations. Adding something
to a cart alone does not establish a completed purchase for spending or habits.

## Plan a shop

Choose the account and store at the top first. The account must be connected to
the Chrome profile signed into the store account you intend to use.

### Check suggestions or make a draft

**Check before your next shop** groups recent suggestions by grocery type. Use
Previous/Next or **Show all** to browse. Older habits and items needing a product
choice are separate. Expand **Why this item?** to see purchase-date and timing evidence.

Choose **Suggest a shopping list** to review a draft. Frequent recent purchases can start selected even when their timing varies.
The draft uses your last 16 shopping dates and reduces the priority of older habits.
It starts with at most 30 items; products needing a match and substitute products
stay optional. Review what you have at home and change any product or quantity. Select a category
or individual items, adjust quantities, then accept/send the reviewed selection.
Use **Starting selection → Focused** for up to five stronger repeat-purchase
suggestions, or **Broader** for up to thirty starting items. Focused ranking
combines recent purchase frequency, restock timing and similar earlier baskets.
Changing this setting updates the checkboxes but keeps your quantity edits;
the other items remain available to select. It is a starting list, not a claim
that those items are missing from your home.
The draft preserves your edits if background data changes and tells you when its
evidence needs another look. Suggested quantities are starting amounts, not inventory.
Counts start from your most recent purchase day's amount, rounded to the selected
store's whole package size. Products sold by weight start at one item/package;
the store determines final weight. Review and adjust these counts before sending.

If you already have enough, open **We have enough** and skip the item for a week
or choose a date. It stays out of automatic suggestions and price-drop alerts
until then. Matching cross-store products are paused for the same account too.
Use the paused-items panel to resume it early. Explicit saved lists can still
include the item for your review.

### Paste a family member's list

In **Lists**, paste short requests such as one item per line:

```text
milk
bread
3 avocado
butter
```

Known requests are prefilled from saved choices first, then purchase history and
reviewed cross-store matches. A matching saved product can be suggested when no
purchase evidence exists yet; its reason says so. Unknown or ambiguous requests
can still need a product choice. Suggestions are editable and do not send items
automatically.

Review the chosen store product for every request, including size, quantity and
any extras. Save what a term means if you want that product to be the usual choice
for this store. Under **Settings → Usual items & extras**, define associations
such as “when butter is requested, suggest papaya.” Extras can start unchecked
or included according to the association you choose.

After reviewing, use **Save this list for next time** and a name such as
“Dad's weekly groceries.” The saved list keeps the original terms, chosen products,
quantities and included/unchecked choices. Open **Saved household lists** to load
it later. Loading a list does not send items automatically: review, then send.

### Browse products and packs

Saved products come from learned products and history; they are not the whole
store catalog. Search covers the saved catalog, not just the current page.
Choose a grocery category, use page controls, or choose **Show all**.

**Shopping packs** offers repeatedly co-purchased groups and your custom named
packs. Preview the contents, select all or some, and review quantities. Buying
items together before does not prove you need every item now.

## Review the cart and finish at the store

The cart and checkout link follow the selected store. Quantity controls change
that account's store cart; weighted products usually use item/package counts,
with final weights determined by the store. Read the quantity explanation shown.
Category and item checkboxes in the cart select items for **bulk removal**;
checkout includes all items that remain in the store cart.

Watch the status beside checkout: pending changes and coupon checks need time.
**Cart ready to review** means the displayed cart confirmation is current, not
that an order has been placed. If a run needs attention, check the product-level
message and the actual store cart before retrying. Store-side changes also sync
back to Home Grocery, but updates are not guaranteed instantaneous.

For unavailable products, review the alternatives offered in place. They come
from saved products and reviewed matches. Compare size, unit price and the
quantity proposed; optionally remember your choice. Dietary notes use product
names only: verify ingredients and allergens on the retailer label yourself.
Choosing a replacement inside a draft changes the draft until you send it.

For H-E-B, the helper checks and clips available coupons for cart products. You
can choose **Check coupons now** to recheck. Review conditions and expiry when
provided. A clipped coupon is not a guaranteed discount; changing quantities or
products can affect eligibility. No qualifying products are added automatically.

Follow **Review & checkout on H-E-B/Walmart**, inspect the final products,
substitutions, prices, discounts and fulfillment options, then check out normally
on that store. Home Grocery does not submit payment. The optional after-checkout
completion action is not a receipt; later receipt imports update purchase history.

## Understand patterns and savings

**Spending & habits** uses full receipt totals, including recorded taxes, fees
and tips, for average weekly spending. The selected time period affects spending
and displayed products. Habit estimates can also use older available purchase dates.
One or two purchases are limited evidence, and variable timing is not a reliable
restock schedule. Expand evidence before drawing conclusions.

Suggestions and day-based labels update as time passes; returning to the page
resumes refreshing. An in-progress draft stays a review snapshot. Prices update
through browsing, cart activity and existing sync checks, not continuous live polling.

The price-drop watch looks for fresh drops of at least **5% and $0.10** on products
bought on at least three recent purchase dates. It uses comparable observed or
last-paid prices and shows recorded offer conditions and expiry where available.
An empty watch does not mean every store price has been checked. Product matches
and package-size ratios can be reviewed and edited in Settings.

## When cart checks pause

After 10 minutes without anyone using Home Grocery, automatic cart checks sleep. Opening the website, returning to its tab, or interacting with it wakes the checks for the household, including when you use a phone. Leaving a page open without using it does not keep the checks awake.

Walmart resumes its cart checks while you use the website. H-E-B checks once when the household wakes, then continues to use store events and requested changes rather than periodic cart reloads. Changes made directly at a store while Home Grocery sleeps may appear only after you return.

Queued cart changes, explicit sync requests, and the Monday 2 a.m. Eastern history sync still run while idle. The helper keeps a lightweight connection to your local server so it can receive that work. Your hosting PC must be awake, and the helper must be available and signed into the stores.

## Update, back up, or uninstall

Run a newer installer to update. It preserves household data and verifies a
database/photo backup first. Reload the helper at `chrome://extensions` after an
update. Updates are manual. Installer data is under
`%LOCALAPPDATA%\HomeGrocery\data`; program files are separate under
`%LOCALAPPDATA%\Programs\HomeGrocery`.

For manual backups and recovery, follow [Backup and recovery](../BACKUP-RECOVERY.txt).
Uninstall through Windows Settings → Apps or the Home Grocery Start-menu shortcut;
your household data and backups are retained. Remove the helper separately in Chrome.

For a problem, see [Troubleshooting](TROUBLESHOOTING.md). For source development,
see [Contributing](../CONTRIBUTING.md).


## Choose the suggestion method

Settings → Shopping suggestions defaults to **Category + cycle**. It combines grocery category and restock timing for purchases roughly every one to four weeks, using history from both stores. The standard draft starts with up to 15 items; review the choices and edit quantities before sending anything.

Choose **Previous method** in the same menu to roll back immediately. This preserves your purchase history, saved products, preferences, shopping lists and store carts. The choice is remembered after a server restart.

Suggestions refresh in the background when the purchase history or day changes. While they update, the page shows their progress. If the local trainer is unavailable, the application clearly reports that it is using the previous method.

### Hosting-PC trainer setup

The new method uses a local Python trainer; trained household models stay in the private data folder. This PC has been configured separately. On another host, install Python 3.12 and run `setup-recommendations.ps1` from the program folder once, then click **Update suggestions** in Settings. For a custom household-data location, pass `-DataDirectory` (or set `GROCERY_DATA_DIR`) to that script. The script creates an isolated environment and installs the pinned requirements; an internet connection is needed for that setup. Existing Node-only installations can continue using **Previous method**.

Historical tests verify that the implementation matches the tested model; they do not establish 90% future accuracy.
