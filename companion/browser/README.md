# Selected Chrome tab companion 0.7.0

Requires Chrome 120 or later. Load this directory using chrome://extensions > Developer mode > Load unpacked in the Chrome profile where you use the website. When updating, reload Hermo's extension, then reconnect the saved website tab. This companion is separate from the optional Google-cookie import extension under companion/chrome.

## Connect

1. Create a Connect code for the saved website in Hermo.
2. Open the companion on that exact website tab, paste the code, authorize the selected tab, and press Connect selected tab. The default runtime address is `http://127.0.0.1:4318`; expand **Local runtime address** only if you use a different local port.
3. Close the popup. The fixed website panel immediately shows **Hermo connected** and **Stop**. Hermo finishes pairing automatically; no account name/email detection or confirmation is required.
4. Record the task, select its outputs, test, and publish. Put the published action's hm_live_ API key in your consumer app, never in the companion popup.

Runs use the account currently signed in to the selected tab. Profile names are not pinned. Sign-in or verification must be completed personally on the website before recording or running; a detected sign-in failure keeps a live connection available so you can sign in and retry. Reloading the same website preserves active authority. Stop, tab closure, leaving its approved scope, workspace lock, owner expiry or a lost link ends access. Saved apps/actions remain. A transmitted form submission cannot be recalled by cancellation.

The default transport lives in the extension background worker and opens no controller tab. A 30-second Chrome alarm can wake a suspended worker. Scoped authority survives worker suspension only in the same browser session and within the runtime's authorization lease. Runtime restart, Chrome restart, an expired lease or revoked permission requires explicit reconnection. Idle network failures retry briefly; an uncertain in-flight command ends access and is never replayed automatically. Stop aborts readiness waits before a control is operated; an already submitted website change cannot be recalled. Each mutation also checks the active runtime command authorization immediately before execution. The optional separate controller remains an advanced diagnostic fallback. Show connected tab focuses the exact existing website tab.

## Supported website tasks

Chat/text, media generation, read-only data, search/extraction, form submission/update, and custom tasks use the same website engine. Visible top-level and open-shadow controls and bounded text/asset links are supported. Inputs bind only when filled through Hermo's recorded controls. For chat, select latest submitted text and the completed reply; fresh/settled checks prevent returning a previous reply. Generated media links must be new for the run and fully loaded. Ordinary read-only values can remain unchanged. Cross-origin frames, closed shadow roots, files, canvas-only data and browser-internal pages require another integration.

The generic consumer app is /workflow-data.html; the chat consumer is /workflow-chat.html. Keys/history remain in page memory and only verified completed results are displayed. Website changes can require reselecting controls/outputs; existing action IDs are retained by explicit draft repair where supported.

## Permission boundaries

The extension uses activeTab, scripting, alarms and extension-owned storage, plus tabCapture and offscreen for separately authorized visual preview. Loopback Hermo is its only permanent host permission and network destination. Active grants are restricted to trusted extension contexts in chrome.storage.session; tokens never enter page DOM or persistent chrome.storage.local. Chrome clears session storage when the browser session ends. No cookies/passwords, website storage, history, all-websites access, debugger, fingerprint modification or remote script is used. Each command checks exact tab ID, origin and scoped path; local access is restricted to the owned sandbox. Credential/challenge pages cannot supply successful run results.

An account name is not required or verified in normal-tab mode. The optional isolated browser and legacy Google import retain their separate account checks. Third-party sessions, permissions and limits still apply. This does not promise compatibility with every layout or remove website verification. See /connected-browser.html and SECURITY.md.

## Structured outputs and explicit waits

Companion 0.6.0 advertises optional `workflow_waits` and `structured_outputs` capabilities while retaining protocol 2. Older paired companions can continue their legacy scalar workflows; using a new wait or recursive extraction mapping requires reloading this extension and reconnecting the selected tab. Hermo reports `COMPANION_UPDATE_REQUIRED` before dispatching an unsupported command.

Output mappings support strict strings, numbers, booleans and HTTP(S) URLs, nested objects, and repeating lists. Child selectors are relative to their selected container or row. Lists preserve DOM order and duplicates, default to at least one row, and never truncate silently: configure `minItems: 0` for legitimate empty results and `maxItems` up to 100. Optional missing fields are omitted; nullable missing fields are returned as null. Present invalid values fail validation. No currency/unit guessing or fabricated defaults are applied.

Extraction is limited to four nested levels, 64 mapping nodes, 2,000 extracted nodes, 4,096 characters per text value and 128 KiB total text. Connected mode supports the selected top-level document; nested frames remain unsupported. Closed shadow roots, canvas-only data, inaccessible frames and file contents are not extracted. Attributes are limited to src, href, poster, alt and download; resolved URL attributes must be HTTP(S) without credentials.

A `changed` check compares text, collection counts and document-local DOM node identity. Re-reading the same DOM cannot mark a prior value fresh. Replacing the selected DOM node can establish a fresh observation even when the text is identical. This observes website changes; it does not independently prove a server-side submission succeeded. Use explicit expected confirmation or input correlation for important outcomes.

## Actual website preview (0.7.0)

On the paired website tab, open the companion and click **Enable live preview**. This uses Chrome tabCapture and an offscreen document to sample the exact tab while it is in the background. Return to Hermo's **Website** view; **Detected fields** remains a separate simplified inspection. The preview is view-only: use recorded controls for workflow interactions. No audio, cookies, saved frame history, or visible controller tab is involved. Stop preview preserves automation authority.

Visual capture is limited to one tab and a 15-minute lease, capped by the owner lease; two minutes without frame requests stops it autonomously. A full reload/worker recovery never resumes capture. Tab closure, out-of-scope navigation, disconnect and authorization expiry stop capture. Sign-in/challenge pages cannot deliver frames to the dashboard. Frames are requested only by the authenticated owner's preview route, never by consumer API keys.

Generated image/video/audio result streams use latest-result targets where the DOM explicitly identifies an assistant response or result log. Temporary image IDs are not reused across generations. Ordinary catalog assets keep their selected targets. To repair an existing draft, use Output mappings / Result targeting / Latest image result, then save, verify and publish. This does not convert protected/blob/canvas media into portable URLs.
