# Managed local browser sessions

An isolated connection uses Hermo's local Playwright/Chromium adapter. It does
not use a personal Chrome tab, companion connection, or cloud browser. Supported
published workflows can run after the dashboard and the original personal Chrome
process close. The local runtime and computer must stay running.

## Login and saved state

Create an isolated connection with exact authorized website origins. Open its
browser and sign in directly on the website. Use **Open desktop browser**
if the website needs an interactive window, then select
and confirm a stable account marker. Hermo saves cookies, local storage and
IndexedDB in the encrypted connection payload. Public sources always start
anonymous and do not reuse account snapshots.

Execution restores a dedicated Chromium disk profile from an encrypted snapshot.
The account marker must match before actions and before returning a verified
result. After successful verification, the adapter saves refreshed session state
back to the same connection. Missing, expired or changed account identity returns
an authentication failure. A browser restart cannot restore a session that the
website itself has expired. Complete sign-in again and reconfirm the connection.

Chromium's full directory, including disk cache, is encrypted between sessions.
Readable working copies exist while Chromium runs and are removed after closure.
Existing saved cookies/local storage/IndexedDB migrate into the first disk profile.
Session-only cookies are retained. Restored tabs are discarded, so tab-specific
session storage is not promised to survive. Browser extensions are not imported.
An abrupt kill recovers the last completed encrypted snapshot, never repeats a
submission and may lose newer browser changes. Protect working files using OS
account and device encryption. See the [storage design and bounds](managed-browser-upgrade.md).

## Network and action compatibility

Contexts start offline. HTTP origin/method guards, WebSocket guards, page handling
and download restrictions are installed before bringing them online. Service
workers are blocked. Existing retrieval workflows allow GET and HEAD requests
only. A workflow explicitly configured for website actions permits submission
methods and WSS to its frozen exact origins. Interactive Studio login retains its
separately authorized website behavior.

Navigate, fill, select, check and click steps can run only where their complete
network and verification path fits its reviewed permissions. POST forms require
website-action permission, a new verification and publication review.
A GET request or a page event handler can still change website data. Approval
gates do not broaden network permissions and do not prove business completion.

Use the workflow execution compatibility/permission review and test the whole
workflow before publishing. Use a separately authorized connected Chrome
connection when a website requires an existing personal tab. Hermo does not
transfer personal Chrome cookies or silently substitute a browser mode.

## Leases, visibility and cleanup

Each managed connection has an in-memory lease and a separate SQLite exclusive
lock in `managed-profile-locks/` under the runtime data directory. Lock files
contain no session state. Different connections have independent locks, while
the same connection cannot be owned concurrently by multiple managers/processes.
SQLite releases its OS lock on process death. Lock paths reject links/junctions,
linked files and arbitrary user-supplied paths; same-privilege filesystem races
remain outside this boundary.

Execution closes the connection's idle Studio context before taking its session
lease. Active Studio operations must finish first. Cancellation and crashes close
the invocation context and release its lease. A disconnected browser is replaced
only for a newly admitted request; a failed or uncertain request is never replayed
automatically. Browser processes close after their idle timeout. Stopping or
locking a connection invalidates pending Studio opens so they cannot navigate
later after a slow launch.

In **Connections → Managed browser**, choose background or visible execution.
This affects the next browser session; it does not expand website permissions.
Settings are locked during accepted executions and recording. Refresh status
after those operations finish. Browser installation diagnostics distinguish a
configured, bundled or system executable without exposing its local path.
If missing, run `npx playwright install chromium`, or configure the trusted
runtime environment's `HERMO_BROWSER_PATH`, then restart Hermo.

## Reset and compatibility

**Reset saved session** requires typing `Reset "CONNECTION NAME"` exactly. The
owner session and CSRF token are required. Reset closes the idle Studio context,
clears that connection's saved login/account marker and imported-profile binding,
returns affected workflows to draft, invalidates test evidence and revokes their
consumer keys. Workflow IDs, slugs, run history and immutable publication history
are retained. Reconfirm the account, verify and publish before issuing new keys.
Other connections and separately saved imported profiles are not deleted.

Reset also rotates a private session authority identifier. A historical
publication bound to the previous identifier cannot resume merely because the
same account is signed in again. Restore it into a draft, retest and publish a
new revision. Workflows using this connection as an alternate execution target
are invalidated as well as workflows recorded directly on it. Owner writes
captured before a connection update are rejected instead of overwriting newer
state; this prevents delayed DNS validation or confirmation from restoring a
reset session. These identifiers are excluded from consumer metadata.

Owner routes:

- `GET /studio/connections/:cid/managed-profile`: sanitized settings/status.
- `POST /studio/connections/:cid/managed-profile`: `{ "visibility": "headless" }`
  or `"visible"`.
- `POST /studio/connections/:cid/managed-profile/reset`:
  `{ "confirmation": "Reset \"CONNECTION NAME\"" }`.

No schema reset is required. Visibility is an optional encrypted payload field;
existing connections default to background execution. Lock databases are additive
and do not alter workflow or API key identifiers. Back up the encrypted database
and its matching master-key material before any application upgrade; protect both.
