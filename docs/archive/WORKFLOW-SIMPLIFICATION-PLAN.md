# Hermo: simpler saved-browser and website workflow

Planning baseline: 14 October 2026. The saved-browser, website-panel, Stop/reconnect, output-only and controller-free transport releases are implemented. Companion 0.4.1 immediately connects authorized selected tabs without account-marker confirmation. The current tab binding supersedes the initial marker/controller milestones below; isolated browser identity checks remain separate. See CURRENT-VALIDATION.md for the latest checks.

## 1. Product decision

Make the working, ordinary Chrome + selected website tab + Hermo companion method the default for website connections. Put saved browser setups and saved app connections together in Connections. Keep the current successful ChatGPT execution and response extraction while improving setup, connection controls, and action verification.

I interpret “created workplaces” as named browser setups that can be reused for several app connections. In the interface, call them **Saved browsers** so people can distinguish them from their Hermo workspace, apps, and actions.

The target experience is:

1. Sign in to Hermo and open Connections.
2. Choose a saved browser or create one, then choose an existing app or enter a website.
3. Open that website in ordinary Chrome, click the companion, and paste the **Connect code** into its connection page.
4. Pairing immediately connects the selected tab without account-name detection or confirmation. A small fixed website panel shows **Hermo connected** and **Stop**.
5. Choose Chat/text, Generate media, Read data, Search/extract, Submit/update, or Custom; test it; publish it; use its separate **API key** in an app.

Returning users choose their saved app and reconnect its website tab. They do not recreate the app, browser setup, action, or Google cookie import.

Saved configuration survives browser closure, Hermo restarts, and logout until the user deletes it. Website sign-in can expire independently. Active execution permission ends on Stop, Hermo lock/logout, lost connection, or expiry; saving a setup does not grant endless unattended access.

## 2. What the current implementation tells us

| Current behavior | Required change |
| --- | --- |
| Browser sign-in profiles already persist in encrypted settings, but their picker sends people to Privacy. | Make saved browsers discoverable and reusable directly in Connections. Keep existing data. |
| Normal Chrome sign-in is a Google cookie-import flow with its own consent and password. | Use selected signed-in tabs by default. Keep cookie import as an advanced legacy option. |
| The native launcher uses one dedicated Chrome directory. | Support independently named managed browser directories; preserve the existing directory as a legacy saved browser. |
| Public access forces an anonymous isolated browser and rejects selected Chrome tabs. | Separate account requirements from browser transport and source provenance. Support public weather pages in selected tabs. |
| Pairing requires another workspace password and clears previously saved identity. | Use the authenticated owner session and recent unlock policy; bind the authorized selected tab and exact origin, without requiring profile text. |
| A separate extension controller page owns the connection and polling. | Add website status and Stop around the tested transport first. Do not replace it with an unreliable background loop. |
| Builder and server require inputs, at least two steps, and output/input equality. | Allow zero-input, zero-interaction Read data actions with source and output checks. |
| Only ChatGPT has special continuation behavior. | Keep the selected page by default for all connected-tab actions; navigation must be explicit. |
| The main Disconnect action forgets identity/session and revokes keys. | Separate Stop, Forget account, and Delete with clear consequences. |

The user's successful two-message ChatGPT screenshot establishes that the current personal chat workflow works. It does not establish that every website layout, account, or browser lifecycle is supported.

## 3. Connections interface

### Saved browsers

Show a compact Saved browsers section above saved apps, and the same picker at the start of Connect an app.

Each browser card has a name, browser type, saved date, and Open / Rename / Delete controls. Show app names associated with it. Avoid an “online” claim unless a current companion link actually exists.

Two creation choices:

- **Use my current Chrome browser:** name the browser context after opening the companion. Store a stable extension-context identifier. Do not infer, read, or copy the user's ordinary Chrome profile directory.
- **Create a separate browser:** create a dedicated ordinary Chrome profile managed by Hermo. Open the chosen website directly; the user signs in there personally. Save this browser for reuse.

If no browser is saved, show these choices inline; never send the user to Privacy as a prerequisite. Privacy continues to manage retention, revocation, and advanced legacy sign-in imports.

### Connect an app

The default form asks only for saved browser, website URL, and optional app name. Infer a suggested name from the hostname. Ask whether the website needs an account in plain language. Display the website and replay authorization next to the Connect button.

After creation, show Open website, Copy Connect code, and a short instruction to click the Hermo companion on that website. If it is already paired, continue directly to creating an action instead of generating another app connection.

Keep anonymous isolated browsing in an Advanced section. Its anonymous-source semantics must remain accurate; a selected Chrome tab may contain a signed-in website session even when the action needs no account.

### Returning to an app

The saved app card shows Ready, Stopped, Browser closed, Sign-in needed, or Website changed, with one relevant next action. Reconnect updates the existing connection ID and retains action IDs and published API contracts.

Companion pairing marks the tab Connected immediately, even if the website hides its profile. Runs use its current signed-in account; account names are not pinned. A detected sign-in or challenge blocks a run while preserving a live tab connection. After resolving it in Chrome, retry without account confirmation. Isolated private-browser identity checks remain separate.

## 4. Persistence and migration

Add a versioned `browser_workspaces` model and a nullable reference from app connections. Persist names, browser context identifier, kind, managed profile reference, timestamps, and associated connection IDs. Keep sensitive metadata inside the existing encryption boundary. Runtime tokens and Chrome numeric tab IDs are not permanent connection credentials.

For managed browsers, create profiles under `.hermo/browser-workspaces/<stable-id>`. Resolve and validate every managed path against the allowed directory before creating or deleting it. Keep the existing `.hermo/normal-chrome` directory in place and reference it as the legacy managed browser; migration must not move or reset its session.

Import existing connection and Google-profile metadata into the saved-browser chooser idempotently. Label imported Google session snapshots accurately: a cookie snapshot is not a reusable whole Chrome profile. Do not merge profiles merely because their names match, or assume all legacy snapshots came from the same browser.

Preserve existing SQLite data, encrypted sessions, action IDs, workflow versions, API key hashes, and run history. Retention policies may remove old runs; they must not expire saved browser/app configuration. Take a consistent SQLite backup before schema migration and test rollback. Configuration remains local to the current Hermo installation; this plan does not add cross-device synchronization.

Deleting an app does not delete its shared browser setup. Deleting a saved browser lists affected apps and lets the user distinguish unlinking metadata from deleting a Hermo-managed browser directory. Never delete an ordinary personal Chrome profile.

## 5. Companion pairing and the website panel

### Three credentials with distinct jobs

| Interface label | Credential | Use |
| --- | --- | --- |
| Connect code | Short-lived, one-use `hb_pair_` grant | Pair the selected website tab with a saved Hermo app. |
| Connection session | Internal `hb_session_` token | Authorize bounded browser commands while the link is active. Never shown to the website. |
| API key | Scoped `hm_live_` key | Invoke a published action from the separate consumer app. |

Never ask users to paste a published API key into the website companion. Never place any of these secrets in URLs, website DOM, page JavaScript, logs, or website localStorage.

### Connection page

Clicking the extension on a website captures the exact target tab and origin before opening an extension-owned connection page. That page shows the selected site and a single Connect code field; Enter submits. Prefill the approved localhost workspace address when known. Expired codes offer Get a new code; a wrong tab fails before consuming the grant.

Pairing requires an authenticated Hermo owner, CSRF checks, explicit website authorization, and exact tab/origin checks. Avoid a second password prompt during a valid recent unlock; require reauthentication when the session policy actually requires it. Pair the selected tab to enable execution; validate website readiness before recording and replay. Isolated browsers retain account/source confirmation.

### Fixed website panel

Use a small top-right panel with:

- **Hermo connected** and saved app name.
- Ready / Running / Stopped / Reconnect needed status.
- A clearly reachable **Stop** button.
- Collapse and accessible keyboard controls; position must not cover the website's main submit control.

The panel stays visible throughout the approved connection, including supported same-origin reloads and navigation. It must update to Stopped or Reconnect needed when authority ends, rather than falsely claiming a live connection.

Render with isolated styles and a dedicated extension UI root. Exclude the whole panel from snapshots, recording, identity checks, output extraction, and streaming detection. This is essential: the panel's **Stop** button must not make chat extraction think an assistant is still generating.

Panel controls send authenticated extension messages bound to the original tab, origin, and connection generation. Website scripts must not be able to issue commands or access secrets by fabricating a page event.

### Transport and browser lifecycle

First release: retain the working extension controller transport, open it without stealing focus, and control it through the website panel. Explain its lifetime in the companion connection page. Closing it ends the active link without forgetting the saved setup.

Add an event-driven extension bridge for status, Stop, and reinjection where permission remains valid. Chrome's [activeTab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) gives temporary access after a user gesture and can continue across same-origin navigation. Cross-origin navigation requires new authorization.

Removing the controller tab entirely is a later transport milestone. Chrome [service workers can terminate when idle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle); replacing a page with a perpetual worker loop is not a persistence solution. A replacement must pass idle, sleep/wake, restart, update, and reconnection tests before adoption. Do not invent an offscreen-document purpose just to keep polling alive.

Use site-specific optional permissions only if needed for an explicitly requested restore feature. Do not request access to every website. Browser restart restores saved metadata, not stale execution authority or a previously used numeric tab ID.

## 6. Stop, forget, and delete

**Stop** immediately prevents new commands, revokes the current link, and cancels queued/running work for that connection. It keeps the browser signed in, saved browser/app setup, selected-tab setup, action definitions, and API keys. Calls while stopped receive an actionable connection-stopped response. Reconnecting does not silently resume cancelled work.

**Forget account** removes Hermo's saved identity/session evidence and invalidates affected keys and verification. Explain that this does not necessarily sign the user out of the website in Chrome.

**Delete app** removes the app connection and its associated actions/keys after showing the consequences. Shared browsers remain available. Browser deletion has its own explicit scope.

If a website submission was already issued, Stop cannot undo it. Record submission uncertainty distinctly and never automatically resend a prompt, order, or other external mutation to recover a missing response.

## 7. General website execution

Generalize the execution contract, not ChatGPT's selectors. Preserve the proven rich-editor filling, prompt normalization, single-submit behavior, fresh-response correlation, completion checks, and actual output extraction.

At connection/recording time, inspect capabilities: visible controls and output containers, accessible DOM/open shadow roots, origin/page scope, account requirements, and known unsupported surfaces. Prefer semantic labels/roles and stable attributes; use recorded structural selectors as a fallback with ambiguity checks. Choose the latest user message and assistant reply within the recorded conversation container, without assuming numbered message positions or mandatory provider role attributes.

For chat, keep the current conversation by default. Do not navigate to a homepage, click New chat, or open another conversation unless that behavior was explicitly recorded. Associate a new response with the submitted prompt and a fresh turn; unchanged text can still be valid when a new turn was actually created. Never manufacture `prompt_echo` from the input.

For non-chat tasks, record only necessary operations. Distinguish reading the current page from explicitly navigating or refreshing. Validate declared URL scope, including deliberately supported query parameters, instead of assuming every website works at a bare homepage URL.

Provider adapters may improve ChatGPT, Claude, or other specific sites after testing them. They remain scoped implementations, not a universal fallback that guesses a Send control. Cross-origin frames, closed shadow DOM, canvas-only outputs, restricted browser pages, and ambiguous controls require clear unsupported/recovery states until implemented and tested.

Ordinary Chrome preserves the user's normal website session and avoids unnecessary automated-browser setup. It cannot guarantee that every site will permit automation or never show verification. If a sign-in or challenge appears, pause, let the user handle it on the website, then recheck the source and resume only with valid permission.

## 8. Action types and output-only support

Start action creation with three choices:

| Type | User provides | Default verification |
| --- | --- | --- |
| Chat | Prompt field, submit control, submitted-message and reply containers | Actual prompt echo, fresh correlated completed reply, source/account checks. |
| Read data | One or more output fields; optional explicit refresh/navigation | Correct source/context, nonempty settled output, selected data-format rules. |
| Custom | Needed interactions, optional inputs, selected outputs | Source checks plus suitable per-output rules; input equality only when meaningful. |

Read data permits `inputs: {}`, zero interaction steps, and at least one output. No dummy prompt, fake click, or fake equality verifier. API requests can use `{ "input": {} }`, retaining the current request envelope. Apply the same contract to owner testing, published runs, exports, generated documentation, and MCP tools.

Introduce versioned verification rules: nonempty text, number parsing, required unit/context, and equals-input when that input exists. Keep old equality rules backward compatible. Centralize validation and result verification for connected and isolated engines. Classify pure reads as retrieval; classify actual website mutations according to their behavior, not solely their browser mode.

For a weather example, select the location label, temperature, condition, and optional humidity. Verify the location and unit and that the data is present/parseable. Return the time Hermo observed the page; distinguish that from a provider's update time. Reading the same temperature twice is valid. A fresh observation must not require the value to change, and does not prove that the weather provider itself has just updated its data.

Wait for required outputs to render and settle within a bounded timeout. If required data is absent, return which field is missing and a repair action. Do not declare success because a click occurred or because an old unrelated output remains on the page.

## 9. Consumer app and API experience

Keep the current working chat app. Open it with action and input/output names prefilled from the published contract, so users mainly paste the API key and click Use this action.

Add a generic Read data consumer with a **Read data** button and labelled results. Hide message entry for zero-input actions. For parameterized reads, generate fields from the action contract. Resolve metadata through a key-scoped contract endpoint if needed; keys stay in consumer memory by default and are never placed in the launch URL.

Keep idempotency and strict request schemas. Serialize execution per connected tab; reject incompatible concurrent bindings rather than allowing overlapping fills/clicks. Stop and disconnect must invalidate outstanding command generations. Retrying a read can be explicit; retrying an uncertain submission must not be automatic.

## 10. Errors and recovery people can understand

| State | User-facing next step |
| --- | --- |
| Browser or controller closed | Open saved app and reconnect its tab. |
| Hermo locked or session expired | Unlock Hermo; reconnect existing app. |
| Connect code expired or already used | Generate another code for this saved app. |
| Wrong website/tab | Open the named site and invoke the companion there. |
| Website sign-in/verification required | Complete it personally in Chrome, then Check again. |
| Website account changed | Companion runs use its current signed-in account. Isolated browsers require confirmation and renewed verification. |
| Layout changed or output missing | Highlight the missing field; reselect it without recreating the app. |
| Unsupported surface | Explain the unsupported frame/control and available alternatives. |
| Submission outcome unknown | Show that a submission may have occurred; ask the user to inspect before sending again. |
| Companion incompatible | Show the needed companion version before any website action; provide update/reload instructions. |

Add a protocol version and advertised capabilities to the handshake. The server must not send unsupported commands. Advance extension versions when behavior changes, and show app/companion versions in diagnostics. An old extension should fail preflight clearly instead of submitting a prompt and later failing output extraction.

## 11. Implementation order

### Phase 1 — Preserve data and simplify Connections

Implement saved-browser storage/migration, reuse picker, native profile launcher, and simplified connection form. Separate account requirement, source context, and browser transport. Introduce Stop separately from destructive account forgetting. Preserve existing connected ChatGPT behavior behind regression tests.

Primary files: `server/store.mjs`, `server/browser-profiles.mjs`, `server/normal-chrome.mjs`, `server/index.mjs`, `src/main.tsx`, `src/BrowserProfiles.tsx`, `src/ConnectedTab.tsx`, and service/types modules.

Exit gate: existing setups/actions survive migration and server restart; users can connect from Connections without visiting Privacy; Stop preserves configuration and prevents execution.

### Phase 2 — Connection page and website panel

Add explicit Connect code terminology, trusted pairing page, compatible protocol handshake, website panel, status bridge, Stop propagation, and overlay exclusions. Keep the tested controller transport. Test reload/origin changes, immediate tab connection without a profile marker, and readiness checks before execution.

Primary files: `companion/browser/manifest.json`, popup/controller modules and pages, new bridge/panel modules, `commands.mjs`, `inspect.mjs`, and `server/connected-browser.mjs`.

Exit gate: one paste + Enter pairs the intended tab; panel stays accurate; Stop works from both website and Hermo; no panel text contaminates chat outputs.

### Phase 3 — Read data and shared verification

Introduce action types, zero-input/zero-step recording, versioned verifier schemas, shared verification for both engines, output-only consumer, and updated API/MCP contracts. Preserve existing chat and equality definitions without republishing unchanged actions.

Primary files: builder in `src/main.tsx`, recording/API routes, workflow-input and verification modules, `server/browser.mjs`, `server/connected-browser.mjs`, `server/mcp.mjs`, and consumer files.

Exit gate: a zero-input weather action publishes and returns verified data through owner test, API, consumer, and MCP; unchanged valid output passes.

### Phase 4 — Compatibility and release

Add generic continuation, descriptor repair, scoped site adapters where justified, lifecycle recovery, diagnostic improvements, and actual target-site checks. Consider a controller-free transport only as a separately validated change.

Exit gate: all regression and acceptance tests pass; supported-site claims match real evidence. Missing capabilities are surfaced before submission.

## 12. Required acceptance tests

1. **Existing-data migration:** all saved setups, ChatGPT action IDs/contracts, key hashes, and history remain; repeated migration is safe; rollback restores the prior schema/data.
2. **Reuse:** close/restart Hermo and Chrome; saved browsers/apps remain; reconnect without Privacy or another cookie import.
3. **Browser separation:** two managed browser setups have separate sessions; current-browser mode never copies or deletes personal Chrome data.
4. **Pairing:** correct, expired, reused, wrong-origin, wrong-tab, and expired-owner codes behave correctly; stale tab IDs cannot bind a new unrelated tab.
5. **Account handling:** selected tabs connect without detected profile text and use their current website session. Hidden/changed profile names do not require confirmation. Sign-in pages block replay until ready without dropping a live tab. Isolated browser account changes retain their existing invalidation policy.
6. **Stop:** from website and Hermo, queued commands cease, late commands/replies cannot revive a link, saved configuration survives, and Chrome stays signed in. Already-issued submissions are not resent.
7. **Panel:** remains correct through same-origin navigation, reload, collapsed state, scrolling, narrow screens, and keyboard use; is excluded from identity, output, recording, and streaming checks.
8. **Chat regression:** send two different prompts in the same selected conversation; both real replies return. Repeat a prompt and receive the new turn's response. Keep the existing normalization tests and never synthesize an echo.
9. **Output-only:** zero inputs and zero interaction steps save, verify, publish, and execute. An unchanged temperature succeeds; missing location/unit/output fails appropriately; unrelated earlier content cannot satisfy the contract.
10. **Transport parity:** connected and isolated reads use equivalent verifier rules, while anonymous isolated sources remain anonymous.
11. **Compatibility:** old companion preflight stops unsupported execution; ambiguous controls, iframe limitations, sign-in, challenges, and network loss produce actionable states.
12. **Consumer/API/MCP:** chat continues working; Read data hides message entry; scoped keys cannot invoke another action; idempotency prevents duplicate submission; secrets never enter host-page DOM, URLs, or diagnostics.

Run `npm run build` and `npm test`, plus the companion/browser integration checks appropriate to the changed modules. Use synthetic fixtures for failure and lifecycle cases, then test the real supported websites in ordinary Chrome. Record actual observations separately from fixture results. Do not disturb the working personal setup or send live prompts merely to validate this plan.

## 13. Definition of done

A new user can save a browser and connect a website from Connections, paste one Connect code in the companion, see accurate website status and Stop, and publish either a chat or output-only action. A returning user reuses the same saved app and browser. Configuration survives restarts; active authority stops reliably; real replies/data reach the consumer app. Website sign-in, verification, layout changes, and unsupported capabilities have clear recovery rather than misleading success.

The release target is a simpler, tested workflow with durable setup and dependable controls. No browser integration can promise that every third-party website will always allow execution or keep an unchanged layout.
