# Configuration

Hermo reads these settings from the environment of its Node.js process.
It does not automatically load `.env` files. Keep credentials out of shell
history, source control, screenshots and workflow defaults.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HERMO_PORT` | `4317` | HTTP port; the server binds to `127.0.0.1`. |
| `HERMO_DATA_DIR` | Checkout's `.hermo/` | SQLite database, encrypted sessions and local browser state. |
| `HERMO_MASTER_KEY` | Windows CurrentUser DPAPI | Override with exactly 32 random bytes encoded as base64. Required outside Windows. Retain the same key for this data directory. |
| `HERMO_BROWSER_PATH` | Playwright Chromium, then installed Chrome/Edge on Windows | Trusted executable for isolated-browser retrieval. |
| `HERMO_NORMAL_BROWSER_PATH` | Installed Chrome/Edge on Windows | Trusted executable for the optional dedicated normal-browser sign-in launcher. This is separate from pairing an existing tab. |
| `HERMO_GOOGLE_CLIENT_ID` | Unset | Optional Google OAuth client for owner workspace sign-in. |
| `HERMO_GOOGLE_CLIENT_SECRET` | Unset | Matching optional OAuth secret. Owner-saved encrypted OAuth configuration takes precedence over environment settings. |

Google workspace sign-in is optional. It is not required to connect a website,
does not sign that website in, and does not provide paid API credits. Follow the
runtime's [Google setup guide](../public/google-setup.html) if you need it.

## Ports and local clients

The companion and runtime both default to `http://127.0.0.1:4317`. Set **Local runtime address** in the companion to your actual
runtime address. Generated documentation uses that running address. Independent
consumer apps accept `--runtime` and must use the same value.

Each live runtime owns one data directory. Use a separate directory and unused
port for a separate instance. Do not remove runtime locks to bypass an active
process. The [installation guide](installation.md) explains startup and backups.

## Data and access

The dashboard's **Privacy** screen manages retention, exports and consumer keys.
Run retention choices are 7, 30 or 90 days. Exports can contain private inputs and
results; they are unencrypted downloads. Keep exports and backups private.
Deletion through retention is logical deletion, not guaranteed forensic erasure.

Keys are scoped to one action, expire after 30 days and can read only their own
runs. Their secrets are shown once. Create a replacement and update consumers
before revoking an old key. Request quotas and the serialized queue are runtime
controls, not independently configurable public deployment settings.

Keep passwords and tokens out of workflow input defaults: defaults are functional
configuration exposed in contracts and exports. Review [Security](../SECURITY.md)
before recording sensitive data. Local encryption does not protect a compromised
OS account, every browser profile file or a downloaded export.

See the [user guide](user-guide.md) for authorization expiry, locking and media
limitations, and [architecture](architecture.md) for the execution boundaries.
