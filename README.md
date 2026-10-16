# Hermo — turn website workflows into APIs

**Early access.** Hermo turns a demonstrated website task into a locally hosted REST endpoint and MCP tool. Private connections can use an explicitly selected, already signed-in tab in normal Chrome. Public retrievals can use an anonymous isolated browser; a selected normal Chrome tab uses its current session. React, Motion, Radix Dialog and Recharts provide the interface; Fastify and SQLite run locally. No paid AI plan is required for browser workflows. There is no telemetry.

## Quick start

Requirements: Node.js 24 or newer and npm. The companion uses Chrome 120 or newer. The optional isolated-browser mode needs Playwright Chromium or installed Chrome/Edge; it launches only when requested, not when the runtime starts.

On Windows, clone the repository and start it from PowerShell:

```powershell
git clone https://github.com/PraveenNimilka/Hermo.git
cd Hermo
npm.cmd ci
npm.cmd run build
npm.cmd start
```

Open **http://127.0.0.1:4317** (or your configured `HERMO_PORT`). A new workspace asks you to create a password of at least twelve characters and has no preconfigured accounts. An existing data directory keeps its password, connections and keys. Build the dashboard before starting the runtime on a fresh checkout. On macOS/Linux, use `npm` instead of `npm.cmd` and configure the encryption key described below.

If needed, install the browser with `npx.cmd playwright install chromium`, or set `HERMO_BROWSER_PATH` to a trusted installed Chromium executable. Do not disable Chromium's sandbox. `HERMO_PORT` changes the loopback port; `HERMO_DATA_DIR` changes the data directory. One live runtime owns each data directory through an OS-released SQLite lock; a second process fails with RUNTIME_ALREADY_RUNNING before recovery touches active jobs. If the port is in use, stop the previous Hermo process or choose a different port and data directory. Do not delete a lock file to interrupt a running process.

Windows wraps the encryption key using CurrentUser DPAPI. Other platforms require a secret-manager-provided `HERMO_MASTER_KEY` containing exactly 32 random bytes encoded as base64. Never commit this value. Windows can also use that explicit override; the operator then manages its security. The default `.hermo/` directory is ignored by Git. Backups require the database, its journal when applicable, and the correct encryption-key context; do not move a Windows DPAPI key to another OS user and expect it to decrypt.

## Record, test, publish, call

1. Connect an explicitly authorized website tab with the [Chrome companion](companion/browser/README.md), or create a public managed retrieval connection.
2. Create an action. Record supported controls or select outputs directly for a read-only workflow.
3. Give changing values named inputs and define the output schema and success checks.
4. Run a test against the actual website. Repair missing or invalid outputs before publishing.
5. Publish the tested revision and copy its one-time scoped key. Use the generated API examples or MCP configuration.
6. Inspect each run's verification result and step history. Edit a draft to change a published workflow.

The same engine supports permitted searches, catalogs, dashboards, forms, internal tools and media workflows. A website's authentication, technical behavior and access rules still apply.

## Architecture

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Dashboard | React, TypeScript, Vite | Connections, recording, contracts, testing, documentation and run inspection |
| Local runtime | Node.js, Fastify, SQLite | Scoped authentication, durable queue, versioned workflows, verification, REST and MCP |
| Chrome companion | Manifest V3 | Explicit selected-tab access, bounded DOM commands, connection lifecycle and optional visual preview |
| Managed browser | Local Playwright/Chromium | Authorized GET/HEAD retrieval in a separate local browser session |

The dashboard is not the execution engine. REST and MCP share admission, permissions, workflow revisions and result verification. There are no cloud browser workers or remotely synchronized credentials.

## Independent local runtime and execution health

The dashboard is a control interface. Closing or refreshing it does not stop the Node runtime or published endpoints. Keep the runtime process and computer available. **Connected Chrome** execution also requires its authorized website tab. **Managed local** retrieval uses a separate local browser and a dedicated saved website session, so the original Chrome tab can be closed. **Lock workspace** locks the owner interface and ends companion authority; managed APIs retain their existing scoped-key authorization. Stop the managed connection, pause its workflow or revoke its key to block those calls. There is no cloud execution or background computer wake-up.

`GET /health` reports minimal local process health without owner data. The unlocked overview shows queue depth, connected tabs and the actual authorization expiry. Current companion grants inherit the four-hour owner unlock lease; expiry and runtime/browser restart require unlock and pairing again. Chrome service-worker suspension can recover the same valid idle link through trusted session storage and a recovery alarm. Tokens are not saved to extension local storage or synchronized remotely.

Requests are durably accepted with a run ID and serialized to avoid shared-tab interference. Recording and pairing reserve their connection; accepted executions prevent tab replacement and owner navigation. Runs expose step timing, running/verifying phases and structured failure categories. Interrupted executions retain their accepted version and diagnostic history; active submissions are never replayed automatically.

Cancelling or timing out an active companion run invalidates its tab link to stop pending commands. Other queued requests on that link fail explicitly as BROWSER_DISCONNECTED; reconnect before submitting new work. Cancelling an unstarted queued run leaves the link intact. A possibly issued mutation is reported as EXECUTION_OUTCOME_UNKNOWN with its original cause and no automatic retry. Cancellation cannot undo a website change. Use the original idempotency key to retrieve an accepted receipt even if its tab later disconnects.

The architecture audit and remaining release gaps are in [PRODUCTION-READINESS.md](docs/archive/PRODUCTION-READINESS.md). This release adds lightweight projects, an ordered draft editor, immutable published revisions, recursive output schemas and a real consumer-key API playground. See [NEXT-RELEASE-PLAN.md](docs/archive/NEXT-RELEASE-PLAN.md) for the implementation record and [NEXT-RELEASE-VALIDATION.md](docs/archive/NEXT-RELEASE-VALIDATION.md) for verification evidence and limitations.

## Drafts, revisions and execution targets

On an action card, choose **Version history** to inspect published versions or open a working draft. Published definitions and their nonsecret execution configuration are immutable. Editing or testing a draft does not change the active API. Publish only after a verified test of that exact draft and target. Restore an earlier revision into a draft to edit and retest it, or explicitly roll back the active publication to a previously verified revision. Comparisons show safe contract and step metadata; they exclude credentials and recorded literal values.

Accepted runs pin the definition and execution target used at admission. A later publication cannot rewrite queued work or its result schema. Existing endpoint URLs and scoped keys remain valid across revisions. `/versions/1/` is the existing API compatibility route, not a promise that the active workflow is revision 1. New admissions may include `expected_revision`; a mismatch returns `VERSION_CHANGED`. Reusing the original idempotency key retrieves its original accepted receipt even after a newer publication.

The ordered editor supports navigation, fill, click, select, checkbox, element/text/URL waits, per-step timeouts, enable/disable, duplicate, reorder and delete. Locators can use test IDs, exact accessible roles/names, labels and CSS fallback. Ambiguous matches fail explicitly. Readiness is observed before mutation; browser commands are not automatically repeated after an uncertain submission.

Choose an execution target explicitly in the test dialog. Only separately authorized, compatible connections in the same project and exact website origin are offered. The runtime does not transfer a Chrome session into the managed browser. Create and sign into a dedicated managed connection separately when needed. Changing a target clears test evidence and requires a new verified publication. Connections referenced by a draft or historical revision cannot be removed until the referencing workflow is deleted.

Managed local mode retains its existing GET/HEAD-only network policy and does not support website mutations, generation or arbitrary navigation. It restores encrypted dedicated session state, saves verified session updates and starts Chromium only when needed; idle processes shut down. Expired sessions fail and require manual sign-in. Unsupported operations never silently switch runtimes. Global execution concurrency remains one, with a bounded durable queue, rather than parallel browser workers.

## Projects and API playground

Use the workspace picker to create, rename or switch projects. Connections, their workflows, keys and execution history are grouped by project. The migrated Personal workspace preserves existing IDs. Only empty nondefault projects can be deleted. Projects organize this single local owner workspace; they do not add organizations or user roles.

API docs includes a real playground: paste a workflow-scoped consumer key, enter typed inputs and run the published API. The key stays in page memory. The playground uses consumer authentication, validates the published contract, polls the accepted run, displays verified JSON and can cancel a run. Stopping polling does not cancel website work. A lost receipt can be recovered with the same frozen request and idempotency key; an uncertain website outcome is never automatically submitted again.

## Typed workflow contracts

On a **draft** action, open **Test action → Edit workflow steps and extraction**. The inspector supports text, number or boolean inputs, required or optional values, defaults, text choices, trimming, text length and numeric bounds. It shows the steps using each input. The compact scalar contract editor also remains available for compatible existing workflows. Save, run verification again, then publish. To change an existing publication, open a working draft first.

Send actual JSON scalars: `{"input":{"quantity":0,"enabled":false,"category":"books"}}`. Strings such as `"0"` are not numbers. REST, MCP, OpenAPI, documentation and the generic action app derive their types from the same rules. Defaults apply before validation, persistence and idempotency matching. Existing all-text definitions keep their behavior until explicitly edited.

An omitted optional text-field input actively clears the recorded field, preventing reuse of a previous request's text. Optional select/checkbox inputs require a valid default. Recorded URL parameters remain required safe text; inputs used by equality verification must be required or have a default. Defaults are functional configuration included in API documentation and workflow exports: do not put passwords or tokens in defaults.

Outputs support text, number, boolean, URL, nested objects and lists. Configure relative selectors inside an object or repeated row, required/optional and nullable fields, attributes and list limits in the editor. Missing optional fields are omitted; explicitly nullable missing fields can be null. Invalid present values still fail. Numeric extraction accepts a complete finite decimal or exponent value; it does not strip currency symbols, units or thousands separators. Boolean extraction accepts `true` or `false`; URL extraction requires an absolute HTTP(S) URL without credentials. Keep text for values such as `28 °C` or `$149.99` unless the website exposes a separate numeric field. Extraction is bounded to depth 4, 64 mapping nodes, 100 rows per list and 128 KiB of text; limits fail explicitly instead of truncating data into a successful result.

Scalar exports are identified as `hermo.workflow.v0.2` with `contract_version: "2"`; legacy exports retain `v0.1`. Contract format and immutable publication revision are separate identifiers. REST, OpenAPI and the scoped MCP `get_contract` tool expose the recursive output schema. See [SCALAR-CONTRACT-VALIDATION.md](docs/archive/SCALAR-CONTRACT-VALIDATION.md) for the earlier scalar milestone.

## Three-app integration lab

Open `/examples.html` or choose **Integration lab** in the workspace sidebar. Authorize the local examples, choose **Build & verify APIs**, then run order, shipment and stock lookups. All three applications call real generated consumer APIs using encrypted server-held keys. See [INTEGRATION-LAB.md](docs/integration-lab.md) for the workflow and security boundaries.

## Independent API consumer apps

[`validation-apps/`](validation-apps/README.md) contains six runnable clients:
catalog exploration, website change detection, nested JSON extraction, MCP tools,
a paginated records dashboard and a bounded reliability lab. They use published
workflow-scoped APIs, with no database or private Studio access. Start one with
`node validation-apps/start.mjs product-search --runtime http://127.0.0.1:4317`,
then supply your verified workflow endpoint and scoped key. Use the port of your
running Hermo instance. Their [live acceptance report](docs/validation/real-world.md)
includes real website results, lifecycle checks and screenshots.

## Use your existing signed-in Chrome tab

The connection card distinguishes **Tab offline**, **Stopped**, and **Connected**. Authorized companion pairing immediately connects the selected tab; no detected name/email or account confirmation is required. Runs use whichever website account is currently signed in to that tab. The card's remove button permanently deletes that connection, its actions/keys and run history after a review dialog; active runs must finish or be cancelled first. Website sign-in remains in Chrome.

With companion 0.7.0, an open connected-browser panel refreshes detected fields without reloading the website. Showing the actual website appearance requires explicit **Enable live preview** in the website tab’s companion popup. Field fills and clicks wait for enabled controls and a redraw; API replay never automatically repeats a click. Chat recordings expose stable latest-message outputs for both author-role and turn-role markup. Capture `prompt_echo` and `response`, then verify `prompt_echo` equals `prompt`.

Companion tabs do not require account markers, including websites with hidden profile information. Each run checks the exact paired website and that the page is ready; sign-in or verification blocks results until resolved in Chrome. The paired tab remains connected while its scoped link is active, so retrying after sign-in needs no account confirmation. Isolated private browsers still use a selected account marker. For an existing draft with `prompt`, `prompt_echo` and `response`, its test dialog offers **Repair this chat recording**. Review and authorize the change to keep the action ID while replacing extra clicks with **Fill → Send** in the selected conversation. When the original ChatGPT recording contains separate submitted-message and reply branches under Conversation, repair retains that observed structure, selects the latest matching turn and reads the whole reply container. It does not replace those recorded selectors with attributes absent from that page, and repeated repairs retain the original structure. This structural reader uses the existing companion commands; no new extension version is required. Other ChatGPT recordings use detected or previously supported latest-message selectors; other sites need detected or previously recorded supported latest-message outputs. Repair only reads the current page and changes the draft; it does not navigate, fill or send. Repair clears verification, refuses published actions and active runs, and requires a fresh completed reply and verified test before publication.

ChatGPT prompt contracts created or repaired with `prompt_echo` verification remove outer whitespace before hashing, saving and sending the input. Internal whitespace and line breaks are preserved, and blank prompts are rejected before Send. Verification still compares the independently observed submitted message to that exact normalized input. The test form uses a multiline field so saved line breaks are visible. Other recorded contracts retain their original exact input semantics.

After publishing a chat action with `prompt` input and `response` output, open `/workflow-chat.html` on your configured runtime origin and configure its action ID and generated `hm_live_` key. Keys stay in page memory; responses come from the recorded action's verified asynchronous API result. The same action API connects recorded tasks from other websites without a provider-specific plan connector.

For supported chat-layout troubleshooting, open the extension on the conversation tab, expand **Inspect chat layout**, click **Inspect chat layout**, then **Copy diagnostics**. This explicitly requested read-only report includes bounded samples of the selected output text and message structure. It does not send, pair, change the current connection or export cookies/storage/account-sidebar/form values. Close and reopen the unpacked extension popup after source updates to load the inspection control; a fresh pairing code is not needed for inspection. The report must come from the actual failing tab before its fixture coverage can establish that specific layout's compatibility.

Sign in normally to the target website in Chrome. In Hermo choose **Connections → Connect app**, choose a saved browser and website. Existing connections offer **Connect your website tab**. Confirm authorization to generate a ten-minute, one-use pairing code.

Load the separate extension from **`companion/browser`** using Chrome's Developer mode and **Load unpacked**. Open it on the target website tab, enter the local workspace address and code, and choose **Connect selected tab**. Close the popup after connecting; its fixed panel and Stop button stay on the website. The default flow opens no extra tab. Hermo automatically finishes pairing and shows **Connected**. **Check tab connection** is an optional recovery check, not an account-confirmation step. Record, verify and publish through the existing action builder. **Show connected tab** focuses that existing tab instead of opening a new profile.

This mode copies no cookies or passwords and requires no Google or paid-plan connector. The normal tab uses Chrome's own session and networking. Recorded actions can submit forms or change website data; review their effects before sharing a key. API calls require Hermo unlocked, the connected website tab open and active-tab permission. Sign-in, MFA and verification remain manual. After cross-origin login, return to the website and invoke the extension again to renew permission. See [`public/connected-browser.html`](public/connected-browser.html) for complete installation and limits.

## Universal task setup

Choose one of five common task families or Custom. These are setup guides for the same website engine, not provider adapters. Select text, values, loaded media URLs or download links as outputs. Verify presence, URL validity, changed results, numbers/units, expected text or correlation with a requested input. Read-only values may legitimately remain unchanged; generated asset links must be fresh for this run.

New actions save a maximum run time between 15 and 300 seconds. Media defaults to 180 seconds. The included generic action app at `/workflow-data.html` on your configured runtime origin discovers the action's inputs and outputs from its scoped key, follows that wait budget and displays verified text and explicit asset links. It never auto-downloads remote files. Blob/data/canvas-only results cannot be exported as portable URLs; select a website download link where available.

Use the normal Chrome companion for generation and form submissions. Isolated replay deliberately remains retrieval-only and rejects those setup types with a clear recovery instruction. Reload companion **0.7.0** after this update, then reconnect the saved website tab.


## Image, video and audio API results

Record the website's prompt and Generate control using Connected Chrome, then
select its finished image, video, audio or download URL as an output. Test and
publish normally. REST and MCP return the verified asset URL in `result`; the
Hermo key authorizes this workflow. Existing website permissions, sign-in,
generation limits and costs still apply.

New media captures declare their media kind automatically. In **Edit workflow
steps and extraction → Output mappings → Media preview**, choose Image, Video,
Audio or Download link for an existing or opaque CDN URL. Nested lists can contain
media URL fields too. Save the draft, verify and publish a new revision; the live
API stays unchanged until publication. OpenAPI and MCP expose the kind using
`x-hermo-media-type` on the output's URI schema.

Use **API docs → API playground** or `/workflow-data.html` with your generated
scoped key to view results. Image previews and video/audio players load only
after you choose **Load preview**. Players have controls and do not autoplay.
Loading a preview never executes the workflow again. JSON and direct asset links
remain available. Your Hermo key is never appended to asset URLs or forwarded to
their hosts; cross-origin previews request media anonymously without a referrer.

Only portable HTTPS assets (plus local sandbox fixtures) can be embedded. Sites
may block anonymous embedding through CORS, require their own login, use expiring
signed links or expose only `blob:`/canvas/HLS results. Those cannot be made
portable by a Hermo key. The UI reports unavailable previews and keeps a link to
open the asset on its website. Hermo does not proxy, store, refresh or download
media automatically, transfer website cookies, bypass access controls or guarantee
every provider's format. Media support is verified with owned deterministic
fixtures, not private image/video provider accounts.

## Project design guidance

Interface work uses guidance from [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill), [Anthropic Frontend Design](https://github.com/anthropics/skills/tree/main/skills/frontend-design), and [UI Skills](https://github.com/ibelick/ui-skills). Locally installed skill packages are development tools and are excluded from this repository. The redesign reuses React, local Inter fonts, Lucide, Radix and the existing routes, with black-and-white surfaces, neutral status labels and consistent spacing.

## One website workflow, one generated API

Hermo connects to websites through the browser workflow you record, verify and publish. It does not offer a separate ChatGPT-plan authorization or direct provider-response endpoint. A saved website action receives the same scoped `hm_live_` consumer key, documented REST endpoint and MCP contract as actions for other websites. Workspace Google sign-in identifies the Hermo owner and remains separate from website connections.

## Live public websites

Open `/public-examples.html` to generate and consume APIs for **Books to Scrape** and **Quotes to Scrape**, real externally hosted practice websites whose operator explicitly permits automation. The lab records parameterized page reads, checks another record, publishes scoped keys and calls the consumer endpoints. These sites contain demonstration data; they are not private provider accounts. Missing records fail without a successful result. Run `npm.cmd run test:public` for a fresh live-network verification; it uses disposable local data and saves a secret-free `docs/archive/PUBLIC-INTEGRATION-VALIDATION.json` report.

To create your own public retrieval, choose **Connect app → Public website · anonymous reads**, open the website and **Confirm public source**. In the action builder, expand **Read a parameterized public page**, provide a template such as `https://books.toscrape.com/catalogue/{book}/index.html`, parameter `book` and example `a-light-in-the-attic_1000`. This creates a URL-derived record output. Select additional visible text outputs, require the record output to equal the input, verify a different record, and publish. Parameters occupy one whole path segment and permit only letters, numbers, underscores and hyphens. Isolated public replay starts without imported account cookies or storage. A selected Chrome tab uses its current website session.

## Google workspace sign-in

Open `/google-setup.html` for the complete Google Cloud client setup. Register a **Web application** OAuth client with the exact redirect URI shown in **Privacy**; for the default port it is `http://127.0.0.1:4317/oauth/google/callback`. Unlock with your existing password, open **Privacy**, enter the client ID and secret locally and confirm your workspace password to **Save Google configuration**. The client secret is encrypted on this device, never returned to the browser and excluded from exports. Then link your own Google account in normal Chrome or Edge. The linked account can subsequently unlock Hermo; the password remains a recovery option. Alternatively set `HERMO_GOOGLE_CLIENT_ID` and `HERMO_GOOGLE_CLIENT_SECRET` privately in the server environment and restart; saved local configuration takes precedence.

Google sign-in identifies the Hermo owner. It does **not** transfer Google browser cookies, log the isolated browser into other apps or bypass verification. No Google access/refresh/ID tokens are persisted. Signed identity verification, state, browser-bound one-use cookies, PKCE and nonce checks protect the flow. Actual Google consent must be completed by you with your registered client; automated protocol tests are not evidence that live Google authorization succeeded.

## Your first end-to-end integration

1. Choose **Try the sandbox**, then **Try the Northstar sandbox → Continue**.
2. Choose **Sign in to sandbox**, select **Alex Morgan · Northstar Supplies**, and **Confirm this account**. All account details and orders are synthetic.
3. Choose **Create action**. Name it `Order lookup`, with action ID `orders.lookup`.
4. In the demonstration, fill **Order ID** with `ORD-2041`, keep **Make this an API input** checked and parameter `order_id`, then choose **Fill field → Search orders**.
5. Open **Outputs**. Select `ORD-2041` and add it as `order_id`; select `Shipped` and add it as `status`.
6. Choose **Define verification**. Require output `order_id` to equal input `order_id`, confirm this is a retrieval task, and **Save & test action**.
7. Test `ORD-2042`. The fresh browser should return `{"order_id":"ORD-2042","status":"Processing"}` with account and output checks. Publish the API.
8. Save the key displayed once. **API docs** provides the URL, examples, OpenAPI download, workflow export and MCP instructions. **Runs** shows actual execution results; **Privacy** manages retention and key revocation.

If the sandbox's sessions expire after a server restart, reconnect and confirm the account again. Existing workflow definitions remain stored. A failed run requires review; it never returns a fabricated successful result.

## Calling the API

Use a backend, command-line client, or same-origin application on this computer. Hermo rejects cross-origin browser requests and binds to loopback; a cloud app cannot directly call this URL.

```powershell
$hermoKey = Read-Host 'Hermo consumer key'
$headers = @{ Authorization = "Bearer $hermoKey"; 'Idempotency-Key' = [guid]::NewGuid().ToString() }
$body = @{ input = @{ order_id = 'ORD-2043' } } | ConvertTo-Json -Depth 3
$receipt = Invoke-RestMethod 'http://127.0.0.1:4317/v1/actions/orders.lookup/versions/1/runs' -Method Post -Headers $headers -ContentType 'application/json' -Body $body
do {
  Start-Sleep -Milliseconds 1000
  $run = Invoke-RestMethod $receipt.status_url -Headers @{ Authorization = "Bearer $hermoKey" }
} while ($run.status -in @('queued','running','verifying'))
if ($run.status -eq 'succeeded') { $run.result } else { $run.error }
```

Save and reuse the same idempotency header when retrying admission of the same request. Changing the input while retaining that header returns a conflict. Idempotency is scoped to the key and action and lasts while the run record is retained. It does not promise exactly-once external effects.

MCP uses authenticated Streamable HTTP POST at `/mcp` on your configured runtime origin (default `http://127.0.0.1:4317/mcp`). A scoped key exposes its workflow tool, `get_contract`, `get_run`, and `cancel_run`. For example, `action_orders_lookup` takes `{ "input": { "order_id": "ORD-2041" }, "request_id": "stable-request-id" }`. Configuration varies by client; a client must support HTTP and Authorization headers. This is not a stdio MCP server.

## What is supported

- Public HTTPS websites whose origins you explicitly authorize; one exception is the built-in synthetic localhost portal.
- Connected Chrome provides opt-in visual preview and separate detected controls. Isolated connection setup additionally supports pointer clicks, scrolling, keyboard input, navigation, reload and popup-tab selection. Recording uses supported semantic controls rather than arbitrary screenshot coordinates.
- **Open desktop browser** transfers the current Studio session into a visible, isolated Chromium window for direct manual interaction. Its network policy remains enforced; your regular Chrome profile is not read or imported. This remains an automation-controlled browser and does not guarantee vendor verification acceptance.
- Visible text inputs, rich-text editors, buttons, links, native selects and checkboxes; scoped frame and open-shadow support varies by adapter. Up to 12 recorder steps, 32 editor steps and 8 top-level typed output mappings per action; mappings can contain bounded nested objects and lists.
- Explicit supporting-domain approvals and redacted network diagnostics. Changing origins revokes affected keys and requires actions to be tested again.
- Review common sign-in/display services for Gemini, ChatGPT and Claude as a visible list before explicitly approving exact domains. Login redirects can be retried at their original destination after approval.
- A Google login popup is tracked separately and offers **Continue in Google sign-in tab**. Preview reads, **Retry this tab**, reload and reconnect reconcile existing saved domain approvals. **Refresh preview** captures the isolated view without reloading the website. Connected Chrome has a separate opt-in visual-sharing flow described below.
- **Privacy → Your Google browser sign-in** saves a manually authenticated Google website session encrypted on this device. Choose that saved session explicitly for private connections; public sources remain anonymous. It is separate from Google workspace OAuth and Chrome Sync. See [GOOGLE-BROWSER.md](docs/google-browser.md) for setup, reuse, removal and provider restrictions.
- If Google refuses the automated browser, **Normal Chrome sign-in** opens a dedicated ordinary Chrome profile with no Playwright/CDP attached. The optional local companion explicitly transfers only Google cookies using a password-protected, one-use ten-minute import code. See [companion/README.md](companion/README.md). Normal Chrome uses its own network/storage; the imported state is a draft sign-in aid, not a guarantee that a provider will accept it.
- Error, challenge and detected login pages cannot be confirmed as accounts; browser errors keep a useful redacted destination instead of showing `null/`.
- Manual parameter binding and output selection, immutable saved definitions, exact output/input checks, selected-tab origin/readiness checks and isolated account-text checks.
- Fresh isolated browser contexts for replay, durable serialized jobs, configurable 15–300-second execution budgets, cancellation, scoped expiring/revocable keys and per-key rate limits.
- Runtime analytics, encrypted sessions/workflow values/run payloads, credential-excluding workflow exports, 7/30/90-day completed-run retention and metadata-only audit events.

## Current limitations

The isolated engine supports deterministic **retrieval** and filters replay to GET/HEAD without WebSockets. The selected-tab engine replays approved DOM controls in normal Chrome with ordinary networking, including form effects; it is not a network sandbox. Top-level text inputs, open-shadow controls, native selects, checkboxes, clicks and bounded text outputs are supported. Cross-origin frames, files, closed shadow roots, canvas-only controls and interactions requiring trusted physical input remain unsupported in this mode. Neither mode guarantees universal website compatibility.

See [BROWSER-COMPATIBILITY.md](docs/browser-compatibility.md) for blank-page troubleshooting, domain approvals and the observed ChatGPT/Claude verification screens.

No CAPTCHA solving, OAuth account brokerage, file inputs, automatic schema inference, automatic repairs, workflow import, cloud relay, public hosting or multi-user tenancy is implemented. UI changes fail for human review. Selected-tab actions can have external effects, and cancellation cannot recall transmitted traffic. Companion authority binds an exact selected tab/origin, not a specific website account. Isolated account verification is a user-selected text marker, not cryptographic proof of vendor identity. Checks establish output correlation; they cannot prove business truth, freshness of every asynchronous field or completion of arbitrary AI generation.

Hermo records and verifies tasks on the website you connect. The same bridge handles supported chat/text, media generation, data reads, search/extraction, form submission and custom tasks. Website permissions, authentication, availability and usage limits still apply; the bridge cannot bypass a site's own restrictions.

## Verification and security

```powershell
npm.cmd test
npm.cmd run test:e2e
npm.cmd run build
npm.cmd audit
```

See [CURRENT-VALIDATION.md](docs/validation/current.md) and [REAL-WORLD-VALIDATION.md](docs/validation/real-world.md) for dated verification scope and remaining gaps, and [REAL-WORLD-BUGFIXES.md](docs/validation/bugfixes.md) for release findings. Historical reports retain their original test scope; they are not evidence that a later change passed. [SECURITY.md](SECURITY.md) describes the trust boundaries. This is an early-access product for local evaluation, with no independent security certification. Do not expose its port publicly or use unreviewed workflows for sensitive production operations.

## Code layout

`src/` contains the interface; `server/index.mjs` the local control plane, job worker and REST API; `browser.mjs` isolated recording/replay; `network.mjs` the policy proxy; `store.mjs` encryption and persistence; `mcp.mjs` scoped MCP; `sandbox.mjs` the synthetic portal; `tests/` security and real-browser integration tests.

Hermo-authored code is MIT licensed. Included third-party code and assets retain the terms in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Interface and third-party assets

The visual refresh, generated hermit-crab logo prompt, React Bits adaptations, and local typography are documented in [BRAND-DESIGN.md](docs/design/brand.md). Hermo project code is MIT licensed; React Bits component code retains its MIT + Commons Clause conditions and Inter retains its OFL license under `licenses/`. These third-party terms are not replaced by the project license.

### Actual connected website preview

Reload companion **0.7.0**, reconnect, then open it on the authorized website tab and select **Enable live preview**. Hermo's **Website** view shows the real tab appearance while another tab is active; **Detected fields** is the separate simplified view. Use the Interact controls to record actions. No audio or extra visible controller tab. Visual sharing is opt-in, one tab at a time, expires after 15 minutes or two minutes without requests, and never automatically restarts after worker recovery. **Stop preview** preserves the website's automation connection.

For an existing missing generated-media output, open its draft / Edit workflow steps and extraction / Output mappings / Result targeting / Latest image/video/audio result. Save, retest and publish. These targets follow new response elements instead of a temporary asset ID. Freshness, loading, URL and schema verification remain required; private provider generation is not certified.
