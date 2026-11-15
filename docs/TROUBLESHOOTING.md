# Troubleshooting Home Grocery

[Home and download](../README.md) · [User guide](USER-GUIDE.md) · [Backup and recovery](../BACKUP-RECOVERY.txt)

## The installer says port 4317 is already in use

An existing Home Grocery source installation or another application is using the
port. Setup refuses to replace it. If your current household site works, keep
using it; you do not need the installer. Installation does not migrate an old
household database into a new location. Ask the maintainer before moving data.

## Windows shows an unknown publisher

The installer is currently unsigned. The published release includes a SHA-256
checksum so the downloaded file can be compared with the release. Download only
from this repository's release page and follow your own Windows/device policy.
Store passwords are never needed by the installer. Chrome helper approval is
separate from installing the server.

## The download is missing or GitHub shows 404

The download button points to the latest published Windows installer. If a download
is unavailable, open the Releases page and check for an available installer;
downloading the source-code ZIP is not the same as downloading the installer.

## “Cannot reach the household server” or “Failed to fetch”

1. On the hosting PC, use **Start → Home Grocery → Open Home Grocery**. For an
   existing source/scheduled-task installation, check its configured server task instead. The source launcher can run invisibly through `start-groceries-hidden.vbs`; the configured task on the hosting PC retries failures and checks every minute for a stopped launcher. No visible console needs to stay open.
2. Check http://127.0.0.1:4317 on that PC. Keep it awake and signed into Windows.
3. If localhost works but your phone does not, put both devices on the same
   private home network. A guest Wi-Fi network may isolate devices.
4. Open http://127.0.0.1:4317/install on the PC and try a numbered address shown
   there on your phone. That address may change when the PC changes networks.
5. If private-network access was not enabled, rerun the installer and choose its
   network option. Canceling Windows approval leaves localhost available but may
   prevent other devices from connecting.

Do not expose the service using router port forwarding. It is designed for a
trusted private LAN and does not provide separate website-user authentication.

## groceries.local does not open, but the numbered address works

Your device or network may not resolve the local name, or port 80 may already be
in use. Use the numbered address with port 4317 from the host's connection guide.
You can keep using that address; it reaches the same household server. Local-name
conflicts can cause a different advertised name. Avoid running multiple household
servers with the same friendly name on one network.

## The website opens, but the helper is offline

1. Open the intended Chrome profile on the hosting PC and check
   `chrome://extensions`. Home Grocery Helper should be enabled.
2. If its files were updated, choose **Reload** there, then reload the store tabs.
3. In the helper, expand **Household website**, set `http://127.0.0.1:4317`, and
   choose **Connect household**.
4. Check the account selected in Home Grocery. A different Chrome profile can
   belong to a different account nickname.
5. If automatic Chrome opening is wanted, link the matching profile in
   **Settings → Connected accounts**.

The PC server and the Chrome store connection are separate. The website can be
reachable while Chrome is closed, signed out, or waiting on a store check.

## Walmart or H-E-B asks for sign-in or a human check

Open the retailer in the connected shopping Chrome profile, sign in privately,
and complete the check yourself. Return to Home Grocery and read the current
status before retrying a failed operation. Walmart may need one normal cart
change if the helper has never learned its request format.

Repeated headless Walmart checks are a known limitation. Use the regular desktop
Chrome helper; switching to an invisible browser does not resolve these checks.

## Cart changes are slow or need attention

Check the status near checkout and recent cart activity. “Changes still syncing”
means work is queued or running; “Checking coupons” is a separate H-E-B step.
Wait for confirmation before editing the same items in both places. Avoid
repeatedly sending the same list while an update is active.

If an operation fails, review its message and the actual store cart. An
interrupted result can be uncertain; do not assume every requested change failed.
Resolve unavailable products or account/session problems, then retry only what
is needed. Opening checkout does not mean the sync has finished. Home Grocery
never submits the order or payment.

If an item is in the wrong account, verify both the selected nickname and the
actual store login in its Chrome profile. A nickname does not switch retailer logins.

## A product, suggestion, or photo is missing

- Search and category filters apply to the saved catalog. Use Previous/Next or
  Show all; the app does not have every product sold by either retailer.
- Check the account and selected store. Store catalogs and carts are separate.
- Look in paused items if someone chose **We have enough**. Resume the item if needed.
- Suggestions need completed purchase evidence. Older habits, uncertain patterns,
  products needing a match, and products already in the cart may appear separately
  or not be suggested.
- Browsing, history imports and cart discoveries can collect new photos/prices.
  **Settings → Product photos** can request missing photos. Keep the helper
  connected; unavailable photos remain placeholders.

## Prices or coupons differ at checkout

Displayed store prices are dated observations, not guaranteed live quotes.
Receipt prices record what was paid and should not be replaced by a storefront
price. Review package sizes, weight units and check dates before comparing.

For H-E-B, use **Check coupons now** after changing the cart. Check minimum
quantity/spend, expiry and other requirements. A saved coupon may be ineligible
or may not apply to a substitution. Confirm the final discount at the store.
Name-based dietary notes are not ingredient or allergen verification.

## History sync did not run, or habits seem wrong

Check **Settings → History sync**, the selected account, and store sign-ins.
The schedule is Monday 2 a.m. America/New_York and catches up after downtime;
it still needs the host and connected store browser. Verified receipts are
skipped on routine runs. Request a manual check if collection was interrupted.

On **Spending & habits**, check the date range and store filter. Purchase habits
can use older history even when spending is filtered to a shorter period.
Adding to a cart is not a completed purchase. Review the underlying receipt and
product matches before changing a match or usual product. An open draft preserves
your choices and can ask for review when its evidence changes.

## After updating, the site and helper behave differently

Reload Home Grocery Helper at `chrome://extensions`, reload open store tabs, and
refresh the website. Do not install a second copy of the helper over a different
folder unless you intend to create a separate connection.

For a source checkout, restart its configured server launcher after server-code
changes. Installer users can use the Start menu's **Stop Home Grocery**, then
**Open Home Grocery**. A code rollback is different from restoring household data.

## What to include when asking for help

Describe the store, action, displayed error, whether localhost works, and whether
the helper is connected. Include the release/helper version and the relevant
sync status. A screenshot can help after removing account names, addresses and
purchase details you do not want to share.

Do not post databases, backups, browser profiles, passwords, cookies or tokens.
Diagnostic logs can contain product details, timing and shopping actions; review
them privately before sharing. Maintainers should use fictional data to reproduce
problems. For recovery, follow [Backup and recovery](../BACKUP-RECOVERY.txt).
