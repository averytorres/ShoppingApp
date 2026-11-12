# Windows installer developer guide

For installation and everyday shopping, use the [user guide](../docs/USER-GUIDE.md).
For source development and the release checklist, see [Contributing](../CONTRIBUTING.md).

Build on Windows x64 using a supported OpenJS-signed Node runtime and npm:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File installer\Build.ps1
```

Output: `dist/Install Home Grocery.exe` and `dist/SHA256SUMS.txt`. Build fetches
the matching official Node license and installs package-lock dependencies in a
temporary folder. The installer needs no network connection or separate Node
installation. Windows 10/11 x64, Windows PowerShell 5.1 and .NET Framework 4.x are
required. The bundled Node executable retains its OpenJS signature and license.

Run the EXE, enter a household name, choose H-E-B or Walmart, and select startup
and private-network access preferences. The browser connection guide opens when
the server is ready. Chrome's Developer mode / Load unpacked approval and store
sign-in remain manual until the helper is published in the Chrome Web Store.
Never enter store passwords into setup or the household website.

Program files: `%LOCALAPPDATA%\Programs\HomeGrocery`.
Household data: `%LOCALAPPDATA%\HomeGrocery\data` (separate from program files).
No development database, receipts, cached photos, profiles, credentials, logs,
local operational notes or Git history are included. Sample import templates
contain fictional examples only. Build outputs are ignored by Git.

The Startup shortcut runs the server quietly when the user signs into Windows.
Keep this PC awake and signed in. The server manages weekly history sync on
Monday at 2 a.m. America/New_York; store syncing still needs the connected Chrome
profile. This installer does not bypass store human checks or enable headless
shopping. Phones only need the website.

Only the optional firewall step requests administrator approval. Rules allow
this installed Node executable on Private networks, from the local subnet, on
TCP 4317/80 and UDP 5353. No Public-profile rules or router changes are made.
Canceling approval keeps localhost available. To retry network setup, rerun the
installer. Uninstall leaves inert program-scoped firewall rules in place; an
administrator can remove “Home Grocery TCP/UDP <installation ID>” if desired.

Updates are manual: run a newer installer. Setup checks payload hashes, stops
only its own server, verifies a database/photo backup, and retains a code rollback
copy until the updated server passes a health check. Household data and initial
preferences are retained. Code rollback does not reverse schema migrations; use
the verified backup for data recovery. Reload the helper after updating. An
existing source installation on port 4317 is detected and never replaced,
migrated or stopped automatically.

Windows Settings > Apps or Start > Home Grocery > Uninstall removes the program,
startup shortcut and its shortcuts, preserving household data and backups.
Remove the helper separately in Chrome. Start > Home Grocery > Stop stops the
server; Open starts it again.

The installer is unsigned, so SmartScreen may show an unknown-publisher warning.
Code signing and Chrome Web Store publication remain distribution work. This is
a household service without per-user website authentication: use a trusted
private LAN, not public hosting or port forwarding.

Isolated verification supports `Setup.ps1 -Silent -TestInstall` with separate
InstallRoot, DataRoot and nonproduction Port. Test mode binds loopback and skips
startup, registry, shortcuts and firewall. Do not use it as a user installation.
