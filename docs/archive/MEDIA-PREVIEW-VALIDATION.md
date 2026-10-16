# Verified media results and control alignment

15 October 2026. Hermo remains early access.

## Implemented behavior

The existing local browser workflow engine, scoped REST/MCP authentication,
generation freshness checks and asynchronous run polling are retained. A media
workflow records the website's input and Generate control, waits for its finished
asset and returns a verified URL. It does not call a hidden provider API or grant
an AI subscription through a Hermo key.

New media captures persist an explicit `media_type` (image, video, audio or file)
and URL type. The existing ordered output editor can set the kind for older or
opaque asset URLs, including fields inside objects and lists. Strict URL
conversion rejects nonportable schemes and embedded credentials. REST contracts,
immutable publications, OpenAPI and MCP share the same output metadata through
the `x-hermo-media-type` schema extension. No data migration is needed and old
published definitions are not rewritten.

The API playground and generic action app now display image previews and native
video/audio players. Preview loading is explicit, with no autoplay, no workflow
retry and no automatic download. Each asset appears once in the consumer view;
complete structured JSON remains in an expandable section. Optional/nested
outputs are validated instead of being rejected by the old scalar-only viewer.

Cross-origin previews use anonymous CORS and no-referrer. The Hermo key stays in
page memory, is cleared from its input and is not forwarded to asset hosts.
There is no server-side media proxy, credential export, blob conversion, remote
JavaScript execution or new extension permission. The page CSP allows HTTPS
image/media loads; script/connect/frame/object restrictions remain intact.
Known local/private literal URLs and non-HTTPS external preview URLs are rejected.

Dropdowns now share a neutral chevron with a fixed 12px right inset, 40px text
clearance and native keyboard behavior. Forced-colors mode retains native arrows.
The execution-browser select has a readable maximum width and matching action
inset. Field margins no longer double grid gaps; grid action buttons retain their
content width. The API-key button aligns to the input using grid rows rather than
a guessed top margin. Desktop/mobile button wrapping and output-field spacing
retain Hermo's existing black/white/gray design tokens.

## Verification

- Production build: `npm.cmd run build` passed TypeScript and Vite. Evidence:
  `work/media-preview-build.log`. Final entries: `index-T7sqkc1G.js` and
  `index-G5XmKq48.css`.
- Alignment pass: `node --test --test-concurrency=1 tests/next-release-ui.test.mjs tests/runtime-ui.test.mjs tests/universal-ui.test.mjs tests/management-ui.test.mjs`
  passed **10/10**, before the media additions (`work/control-alignment-ui-tests.log`).
- Media playback/security: `node --test tests/media-results.test.mjs` passed
  **2/2** (`work/media-playback-security.log`). Tests use real Chrome and a real
  scoped-key workflow with owned image, WebM, WAV and file fixtures; the separate
  external CDN transport is intercepted and explicitly a fixture. Assertions
  cover actual image rendering, video playback, audio metadata, nested media,
  typed REST/MCP metadata, no pre-click external traffic, no forwarded key/cookie/
  referrer, no extra execution on preview, expired-asset errors, mobile overflow
  and API-key button geometry. An invalid header-only generated test WebM was
  replaced with a valid repository-owned 663-byte VP8 fixture; production playback
  checks were retained.
- Recorded generation: `node --test --test-concurrency=1 tests/media-results.test.mjs tests/universal-runtime.test.mjs`
  passed **17/17** (`work/media-generation-focused.log`). The actual companion
  records image/video Generate controls, verifies new URLs, publishes keys and
  executes through REST/MCP. Other universal task families and stale-generation
  rejection continue to pass.
- Exact execution-panel geometry at 1440, 768 and 375px, plus publication,
  project switching and the scoped-key playground passed in the **3/3** focused
  run (`work/media-preview-focused.log`). Screenshots:
  `work/next-release-ui/428940acfea0/`.
- Final focused run on the tightened HTTP-only schema and final UI build:
  `node --test --test-concurrency=1 tests/media-results.test.mjs tests/workflow-contract.test.mjs tests/next-release-ui.test.mjs tests/runtime-ui.test.mjs`
  passed **18/18**, 32.8 seconds (`work/media-final-focused-tests.log`). Final
  screenshots: `work/media-results/d3d9ff793a47/` and
  `work/next-release-ui/9c31a8a18dad/`. Desktop and phone images were inspected.
- Live permitted website APIs passed with two inputs each for Books to Scrape and
  Quotes to Scrape (`npm.cmd run test:public`, `work/media-public-tests.log`,
  `PUBLIC-INTEGRATION-VALIDATION.json`). These establish ordinary retrieval
  compatibility, not authenticated AI-provider generation compatibility.
- Full regression: `npm.cmd test` passed **219/219**, **0 failed, 0 cancelled,
  0 skipped**, 639.2 seconds (`work/media-final-full-tests.log`). This includes
  the new media playback/security, actual companion video-generation and exact
  control-geometry checks alongside the existing runtime/browser/API suites.
  The final HTTP-only schema annotation was additionally checked in the 18-test
  focused follow-up above. `git diff --check` and changed module syntax checks pass.

## Live activation and data preservation

The updated independent runtime is running at **http://127.0.0.1:4318**. Its
known process identity and zero active executions were checked before restart.
A consistent encrypted backup was created at
`.hermo/before-media-update-20261015T164751142.sqlite` before the new runtime opened
the data store. A PowerShell quoting error in the first idle-check attempt
stopped that attempt before any process was interrupted; the corrected file-based
check passed. No workspace reset, password use or signed-in website testing occurred.

The current **3 connections, 3 workflows, 14 keys, 38 runs and 1 saved browser**
are preserved, including changes made since the previous milestone. Hash checks
verify unchanged resource identities, API-key hashes/scopes/expiry/revocation,
encrypted workflow definitions and DPAPI context. SQLite integrity and foreign
keys pass. Existing publications/drafts are not rewritten to add media hints.

Health, dashboard, companion guide, consumer apps and new shared media/chevron
assets return HTTP 200; the owner overview returns HTTP 401 without a session.
The running server supplies the expected media CSP and serves the final build.
Evidence: `work/media-live-runtime-validation.json`,
`work/media-runtime.stdout.log`, `work/media-workspace-preservation.json`.

Refresh Hermo, unlock the workspace and reconnect the intended Chrome tab after
restart. Companion remains **0.6.0**; no additional permissions are required.
To add a media hint to an older workflow: open a draft, select the output's Media
preview type, verify and publish it. Use API docs' playground or the action app
with its scoped key, then choose Load preview on a verified result.

## Limits

Preview is separate from workflow verification: an expired or blocked asset can
fail to load after its URL was successfully observed. The viewer reports this
without claiming a downloaded result or repeating generation. HTTPS/CORS, codec,
site access and signed-link expiry still apply. Direct website links use that
browser's normal session when opened. `blob:`, data URLs, canvas-only results,
HLS/DASH streaming playlists and protected media are not converted or proxied.
Managed execution remains retrieval-only; generation requires Connected Chrome.
Private provider accounts have not been used or certified. No universal website
compatibility, persistence of third-party assets or independent security audit is
claimed. Existing local workspace data is not used by these tests.
