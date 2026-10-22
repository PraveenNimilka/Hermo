# Installation

Hermo runs on your computer. Its Node.js process hosts both the dashboard and the
local API; closing the dashboard does not stop that process.

## Requirements

- Node.js **24 or newer** and npm. Git is optional if you download and extract the ZIP.
- Chrome **120 or newer** for the selected-tab companion.
- Playwright Chromium for isolated-browser retrieval. An installed compatible
  Chromium browser can also be selected through `HERMO_BROWSER_PATH`.

The release checks currently run on Windows. The Unix commands below describe
the supported configuration paths in the code; macOS and Linux have not received
the same end-to-end release verification. The dedicated normal-browser launcher
also has Windows-specific automatic browser discovery.

## Install and start

Read the [Hermo License](../LICENSE) before installing. Personal and internal
business use is free under its terms; source modification and redistribution
have separate restrictions. Earlier MIT grants and third-party terms remain intact.

### One-click Windows start

1. Install Node.js 24 or newer, including npm, from [nodejs.org](https://nodejs.org/).
2. Clone the repository or download and fully extract its ZIP to a writable folder.
3. Double-click **[Start Hermo.cmd](../Start%20Hermo.cmd)**.

The launcher installs dependencies from the lockfile when required, builds the
dashboard, starts Hermo, and opens its loopback address after `/health` reports
ready. It requires internet access for the initial dependency installation. It
does not download Node.js, require administrator access, change system settings,
or install the Chrome companion. Keep the launcher window open; Ctrl+C stops
the runtime it started. Closing the dashboard alone does not stop your APIs.

The launcher defaults to port 4317 and respects existing `HERMO_PORT`,
`HERMO_DATA_DIR`, and encryption-key environment settings. It never resets the
workspace or generates a replacement for a configured encryption key. If Hermo
already responds at that address, it opens that existing runtime without
installing, rebuilding, or starting another process; check the displayed workspace.
Stop the existing runtime normally before upgrading. A different service using
the port produces an error rather than being stopped or silently changing ports.

For a terminal start without opening a browser, use
`node scripts/start-hermo.mjs --no-open`. Run with `--help` for a summary.
Selected-tab workflows need no Playwright browser download. To enable isolated
retrieval, separately run `npx.cmd playwright install chromium`.

### Manual start

Windows PowerShell:

```powershell
git clone --branch v0.1.0-beta.2 https://github.com/PraveenNimilka/Hermo.git
cd Hermo
npm.cmd ci
npx.cmd playwright install chromium
npm.cmd run build
npm.cmd start
```

macOS or Linux:

```sh
git clone --branch v0.1.0-beta.2 https://github.com/PraveenNimilka/Hermo.git
cd Hermo
npm ci
npx playwright install chromium
# Supply the same persisted encryption key on every start; see below.
export HERMO_MASTER_KEY='YOUR_PERSISTED_32_BYTE_BASE64_KEY'
npm run build
npm start
```

Replace the master-key placeholder before starting. Keep Chromium's sandbox
enabled. Installing Playwright Chromium is only needed for isolated-browser
tasks; selected-tab execution uses the Chrome tab you authorize.

Open [http://127.0.0.1:4317](http://127.0.0.1:4317). A fresh workspace asks you to
create and confirm a password of at least 12 characters. There are no preset
accounts. An existing data directory retains its password, workflows and keys.

The default data directory is `.hermo/` inside this checkout. Build before the
first start: `npm start` launches the runtime but does not compile the dashboard.
The terminal must stay running. Stop it with Ctrl+C when you intend to stop APIs.
Hermo does not install a login service or promise automatic startup.

## Encryption key

On Windows, Hermo creates `master.dpapi` in its data directory and protects its
key with Windows CurrentUser DPAPI. Use the same Windows account to reopen it.

Other platforms require `HERMO_MASTER_KEY`: exactly **32 random bytes encoded as
base64**, provided by a secret manager or your process environment. Create it
once and retain it securely. Generating a different key on each launch prevents
access to previously encrypted data. Windows can also use this override; if you
choose it, you are responsible for retaining and protecting that key.

Do not put the key, browser profiles, backups or workspace databases in Git.
Hermo does **not** automatically load `.env` files.

## Match the companion address

1. Open `chrome://extensions` in the Chrome profile containing your website.
2. Enable **Developer mode**, choose **Load unpacked**, and select the
   repository's `companion/browser` directory.
3. In Hermo, create a website connection and choose **Create Connect code**.
4. Open the extension on that website's tab. Expand **Local runtime address**
   and enter the address printed by your running Hermo process.
5. Paste the code, check the companion's **I authorize reading this tab and
   replaying my workflows** checkbox, and choose **Connect selected tab**.

If the companion was reinstalled, moved or opened in a different Chrome profile,
open that app's connection setup in Hermo and create a fresh Connect code.
Entering it in the intended browser rebinds **that app** by default. Its actions
and API keys stay saved; other apps keep their existing browser connections.
No second reconnect checkbox is required. Finish active work before reconnecting.
Reloading the same extension in place normally preserves its identity.

The advanced **Reconnect after reinstalling the companion** control resets an
entire saved browser binding. Use it only when you intend to stop and reconnect
all websites attached to that saved browser, after reviewing its acknowledgment.

The runtime and a newly installed companion both default to **4317**. If you use
a custom port, set the companion to the same address. Existing saved addresses
are retained. The code is temporary, one-use authority;
it is not an API key. Normal-tab connections need no account-name confirmation.

Use `companion/browser` for connected-tab workflows. The optional Google-cookie
import extension lives separately under `integrations/google-session-extension`.
See the [companion guide](../companion/browser/README.md) or the
[Google import guide](../integrations/google-session-extension/README.md).

## Change the port or data location

Set environment variables in the terminal that starts Hermo:

```powershell
$env:HERMO_PORT = '4318'
$env:HERMO_DATA_DIR = 'D:\HermoData'
npm.cmd start
```

```sh
export HERMO_PORT=4318
export HERMO_DATA_DIR="$HOME/.local/share/hermo"
npm start
```

The Unix example still requires your persisted `HERMO_MASTER_KEY`. Set the
companion address to the new port. Selecting an empty data directory creates a
different workspace; it does not move or reset your existing workspace.

Only one runtime can own a data directory. `RUNTIME_ALREADY_RUNNING` means
another process owns it. Stop that process normally, or use a separate directory
and unused port for a separate workspace. Do not remove lock files to bypass it.

See [configuration](configuration.md) for the remaining settings. The runtime
binds to `127.0.0.1`; publishing a workflow does not publish a public web service.

## Back up and upgrade

1. Finish or cancel active work, inspect any uncertain website submissions, then
   stop the runtime normally. Close any dedicated browser profile stored in that
   data directory before copying it.
2. Copy the **entire data directory** to a private backup outside the checkout.
   Keep the database, any SQLite journal files and its encryption-key context.
   Retain an external master key separately in your secret manager.
3. Update the checkout using your normal reviewed Git workflow. Run `npm ci`
   and `npm run build` again, using `npm.cmd` on PowerShell if required.
4. Start with the same data directory, port and encryption-key context. Reload
   the unpacked companion in `chrome://extensions` and reconnect website tabs.
5. Check `/health`, unlock the dashboard, and test an existing workflow.

Do not delete `.hermo/`, create a new password over an existing workspace, or
substitute a new encryption key to troubleshoot an upgrade. A DPAPI backup is
bound to its Windows user context; copying it to another account is not a
portable recovery method. There is no verified automatic downgrade procedure.

Continue with the [end-to-end walkthrough](getting-started.md), then consult the
[user guide](user-guide.md) for the complete workflow reference.
