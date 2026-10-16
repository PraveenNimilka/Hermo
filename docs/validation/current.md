# Current Hermo validation — 16 October 2026

## Real consumer applications and companion polish — latest milestone

Six independent applications now consume actual scoped REST/MCP workflows against
Books to Scrape and Quotes to Scrape. Live runs check dynamic inputs, nested
outputs, missing records, key scope/revocation, idempotency, serialized concurrency,
draft stability, publication, rollback and execution after runtime restart.
All six consumer interfaces passed desktop/mobile checks with real verified data;
the MCP client executed two concurrent calls through the actual protocol.
Actual extension popup pairing on the external catalog also passed published
REST/MCP execution after dashboard/popup closure and explicit failure after the
authorized tab closed.

The Chrome companion uses the existing Hermo logo and shared monochrome styles.
A controlled real Chromium crash exposed a generic error classification; the
runtime now reports managed `BROWSER_DISCONNECTED` without replaying that run.
Existing owner connection/workflow identities, key scopes and encrypted payloads
were checked unchanged. Production build passed.
The final full regression passed **246/246**, with zero failures, cancellations
or skips (710.4 seconds); independent consumer tests passed **22/22**.

See [REAL-WORLD-VALIDATION.md](real-world.md),
[REAL-WORLD-BUGFIXES.md](bugfixes.md) and the
[machine-readable release index](2026-10-16/results/release-summary.json) for
final checks, timestamps, screenshots and genuine external limitations. Private
provider generation and a real model conversation are not certified. The reports
below retain their historical scope; they are not later release test counts.

## Actual website preview and generated-media targeting — historical milestone

Companion **0.7.0** adds an explicit, bounded preview of the actual authorized
Chrome tab while Hermo is in the foreground. The simplified DOM display is now
named Detected fields. Visual sharing requires Enable live preview in the
website's companion popup; Stop preview preserves automation. Recovery does not
silently resume capture, and stale frames are suppressed.

Generated-media outputs use latest-result targeting in supported semantic result
containers. The draft editor includes explicit image/video/audio repair presets;
saving invalidates test evidence while preserving published revisions and keys.
Reload the unpacked extension, refresh/unlock Hermo and reconnect before use.

Runtime activation and preservation checks passed on an existing local workspace. Connection, workflow, key, run and saved-browser identities were preserved.
Details, verification evidence and limits:
[LIVE-PREVIEW-VALIDATION.md](../archive/LIVE-PREVIEW-VALIDATION.md).
Production build and final affected tests **26/26** passed. The broad regression
had 238 passes and one obsolete automatic-screenshot expectation; the corrected
test passes in the final focused run. See the linked report for exact scope.
Product status remains **early access**; private ChatGPT generation still needs
a repaired output selection and a verified test on the actual website.

## Media results and shared control alignment — historical milestone

Image/video/audio/file output hints now persist with the workflow and appear in
REST/OpenAPI/MCP schemas. The real-key API playground and generic action app
display verified images and native media players with explicit anonymous loading,
no autoplay, no key forwarding and no generation retries. Nested/optional media
results and expired/blocked asset states are handled. Dropdown arrow insets,
execution-panel gaps, grid actions and API-key button baselines are consistent.

- Full regression: **219 passed, 0 failed, 0 cancelled, 0 skipped**, 639.2 seconds
  (`work/media-final-full-tests.log`). Final focused contract/playback/layout
  follow-up: **18/18**, 32.8 seconds (`work/media-final-focused-tests.log`).
- TypeScript/Vite build passed; live entry `index-T7sqkc1G.js`. Books to Scrape and
  Quotes to Scrape generated APIs passed again (`work/media-public-tests.log`).
- Runtime activation followed idle/identity checks and a consistent encrypted backup. Existing connections, workflows, keys, runs and saved-browser identities and scopes were preserved. SQLite
  integrity, DPAPI context, workflow payload and live HTTP/auth/CSP checks passed.
- That milestone used companion 0.6.0; current installation uses 0.7.0.
  Generation needs Connected Chrome and a usable website asset URL. Protected,
  expired, blob/canvas or unsupported-codec media may not embed. No private AI
  provider account certification or universal compatibility is claimed.

Detailed implementation, limits, exact commands, screenshots and activation:
[MEDIA-PREVIEW-VALIDATION.md](../archive/MEDIA-PREVIEW-VALIDATION.md). Earlier sections below
are historical. Product status remains **early access**.

## Revisions, editor and independent execution — historical milestone

The next release adds immutable publications, separate editable drafts,
history/compare/restore/rollback, exact accepted-run snapshots, semantic step
editing and waits, explicit authorized execution targets, managed-browser session
recovery, recursive typed outputs, projects and a real consumer-key API playground.
The existing React/Fastify/SQLite architecture and connected Chrome path remain.

- Complete regression: **216 passed, 0 failed, 0 cancelled, 0 skipped**, 625.9 seconds
  (`work/next-release-final-tests.log`). TypeScript/Vite production build passed;
  final entry: `index-bpf0Bjys.js`.
- Actual Chrome tests cover dashboard/popup closure, worker recovery, selected-tab
  recording, publication, REST/MCP, cancellation, fresh-result failure and managed
  session restart. Live Books to Scrape and Quotes to Scrape APIs passed separately.
- Desktop/tablet/phone/landscape checks cover the neutral UI and important states.
  Final built-UI follow-up: **9/9** passed (`work/next-release-final-ui-tests.log`).
- An encrypted backup preceded runtime migration. Existing connections, workflows, keys, runs and saved-browser identities were preserved; key scopes, encrypted definitions and DPAPI
  context are unchanged. SQLite integrity and public/owner-auth HTTP checks passed.
  Evidence: `work/next-release-live-runtime-validation.json`.
- Companion 0.6.0 introduced the required waits and structured extraction. Current installation uses 0.7.0.

Detailed implementation, migration, exact checks and remaining release work:
[NEXT-RELEASE-VALIDATION.md](../archive/NEXT-RELEASE-VALIDATION.md). Product status remains
**early access**. Managed local execution permits supported retrievals only;
submissions/generation require Connected Chrome. Historical validation sections
below describe their own milestones and do not supersede this result.

## Shared scalar contracts — historical milestone

Milestone 2 adds strict scalar inputs, enums, optional/default behavior, bounds and required flat typed outputs, with a draft contract editor and shared REST/MCP/OpenAPI rules. Saving a draft contract preserves recorded targets and permissions, invalidates test evidence and requires retesting; published/paused contracts are protected. Existing all-text definitions remain compatible. Numeric `0`, boolean `false` and omitted text clearing are verified through real Chrome and generated APIs.

- Complete regression: **170 passed, 0 failed, 0 cancelled, 0 skipped**, 545.4 seconds (`work/typed-contract-full-tests.log`).
- TypeScript/production build passed; both final desktop/tablet/phone contract and runtime UI checks passed (`work/typed-contract-final-ui.log`). Reduced-motion contract geometry also passed (`work/typed-contract-final-contract.log`). Production entry: `index-C5-7vYCV.js`.
- Live generated APIs for Books to Scrape and Quotes to Scrape passed again (`work/typed-contract-public-tests.log`, current `../archive/PUBLIC-INTEGRATION-VALIDATION.json`).
- Runtime restart preserved encrypted data; health/dashboard/guide/apps passed and the owner overview remained protected. That milestone used companion 0.5.0.

Detailed implementation and checks for that earlier milestone: [SCALAR-CONTRACT-VALIDATION.md](../archive/SCALAR-CONTRACT-VALIDATION.md). Audit, architecture and roadmap: [PRODUCTION-READINESS.md](../archive/PRODUCTION-READINESS.md). Revisions, the step editor, projects and nested/list/optional outputs were subsequently implemented in the latest milestone above.

## Core reliability — historical milestone, 15 October 2026

The complete audit, architecture, gaps, security checklist, UI plan and prioritized roadmap are in [PRODUCTION-READINESS.md](../archive/PRODUCTION-READINESS.md). Milestone 1 adds exclusive runtime ownership, provenance-preserving interrupted-run recovery, recording/pairing/execution guards, safe cancellation and shutdown, actual MV3 worker recovery, mandatory command guards, durable step evidence and truthful monochrome runtime/run UI. Existing workspace data and routes are preserved.

- Final complete regression: **154 passed, 0 failed, 0 cancelled, 0 skipped**, 521.8 seconds (`work/production-core-final-tests.log`).
- TypeScript/Vite build passed. Actual Chrome worker restart, Stop readiness, dashboard-closed REST, record/test/publish/REST/MCP, security boundaries and desktop/tablet/phone UI checks passed.
- Books to Scrape and Quotes to Scrape live generated APIs passed again; `../archive/PUBLIC-INTEGRATION-VALIDATION.json` contains current timestamped results. No private vendor account certification is claimed.
- Runtime activation and health/dashboard/guide HTTP checks passed at that milestone, which used companion 0.5.0.

Detailed evidence, the corrected initial mock failure and remaining release gates: [CORE-RELIABILITY-VALIDATION.md](../archive/CORE-RELIABILITY-VALIDATION.md). Earlier sections below are historical; they do not supersede this milestone's version or limits.

## Immediate selected-tab connection — historical milestone, 15 October 2026

Companion **0.4.1** pairing immediately marks an authorized website tab **Connected**, without account-name/email detection or confirmation. Hidden profiles and changing profile text no longer block recording, replay or draft repair. Runs use whichever account is currently signed in to the paired tab; exact source, website readiness and output verification remain. A detected sign-in/challenge fails without returning a successful result but preserves a still-live tab link, allowing retry after signing in without re-pairing. Same-origin reload and popup closure retain authority; Stop, scope loss, tab closure, owner expiry/lock, restart or lost transport end it. Isolated private-browser and optional legacy Google import identity checks remain.

The built UI completes pairing automatically, retries transient preview/completion failures and keeps a fresh code pending until consumed, even when an older link is already live. Companion panel immediately shows Connected and Stop, with no default extra controller tab. Documentation and consent copy disclose current-account use. Black/white tokens and dashboard alignment remain unchanged.

- Final `npm.cmd test`: **134 passed, 0 failed, 0 cancelled, 0 skipped**, 500.3 seconds. Evidence: `work/no-account-full-tests.log`.
- Actual Chrome automatic-pairing/private universal follow-up: **14 passed**, covering all six action families, owner UI code generation, popup pairing, automatic callback recovery, automatic/manual pending-code guards, publication, REST/MCP, consumers and sign-in recovery. Evidence: `work/no-account-auto-pair-tests.log`.
- Targeted connected-browser: **18 passed**; targeted runtime/transport/lifecycle group: **24 passed**. Full rerun includes final assertions and changes.
- TypeScript/Vite production build and final source/whitespace checks pass. Independent read-only review found no remaining blocker after recovery fixes.
- Runtime restart preserved existing setup, workflows, keys and runs; home, chat and connection-guide checks passed. That milestone used companion 0.4.1 and removed selected-tab account selection.

The first full attempt passed 122 checks but exposed a new fixture setup error: the popup was invoked while the owner UI tab was active. Focusing the intended website corrected the test without relaxing any permission check; the final complete rerun is green. These are owned/disposable website fixtures, not an authenticated live Gemini certification. See [TAB-CONNECTION-VALIDATION.md](../archive/TAB-CONNECTION-VALIDATION.md).

## Monochrome alignment — historical milestone, 14 October 2026

The selected design direction uses black and white with neutral grays, replacing the previous blue accent. Action metadata is grouped with a gap; variable-length cards have aligned footers. Shared grid/form/dialog spacing, saved-browser control grouping and narrow top bars were corrected. All six main screens, unlock, consumer apps and companion UI use the neutral treatment while website images keep their colors.

Production build passes; UI suite **7/7**, management **1/1**, companion/Stop checks **2/2** pass. Desktop/tablet/phone/landscape checks and 39 screenshots include actual recording/verification/publication, deletion, keyboard focus, no horizontal overflow and neutral-color assertions. No backend/auth/data contracts changed; saved workspace remains. The milestone’s built dashboard was served successfully. See [UI-ALIGNMENT-VALIDATION.md](../archive/UI-ALIGNMENT-VALIDATION.md).


## Universal bridge and dashboard — historical milestone, 14 October 2026

Hermo now uses five common website task families plus Custom, through the same recorded browser engine. The direct ChatGPT-plan connector and exclusive routes/assets are removed. Ordinary recorded chat, Google workspace sign-in, saved browsers/actions/keys, scoped REST/MCP, typed-name deletion and direct companion pairing remain.

Media URLs/descriptions/download links, destination-page freshness baselines, existing-gallery rejection, configured 15–300 second budgets, useful failure reasons and separate bounded status-polling allowances are implemented. Isolated replay stays retrieval-only and clearly directs generation/submission tasks to normal Chrome. Companion **0.4.0** retains the fixed website Stop panel with no extra default controller tab.

All three requested design skill sources are installed and verified project-locally. The six main screens and builder use shared neutral/blue tokens, compact layouts, readable fields, real data, keyboard/focus handling and reduced motion. The browser-task-to-tested-API transformation is explicit.

Final `npm test`: **130 passed, 0 failed, 0 cancelled, 0 skipped**, 498.5 seconds. Final `npm run build` passes. Actual Books to Scrape and Quotes to Scrape pass; all six owned fixture task families are recorded, verified, published and called over REST, with media additionally exercised over MCP and the generic consumer app. Final production UI tests cover 1440, 768, 375 and 844×390 landscape, with 31 screenshots and actual recording/publication. Runtime activation preserved existing configuration. This milestone used companion 0.4.0.

See [UNIVERSAL-WEBSITE-BRIDGE-VALIDATION.md](../archive/UNIVERSAL-WEBSITE-BRIDGE-VALIDATION.md) for installation details, exact evidence and limits. No personal provider accounts or paid media services were used by automated tests. Visible DOM/portable links are supported; website verification and unsupported surfaces may need manual handling.


## Workflow refinement — historical milestone, 14 October 2026

Companion **0.3.0** pairs directly from the selected website popup without an extra controller tab. Management screens now use exact named deletion confirmation, action/API-key deletion, bounded history, specific action documentation and less duplicate onboarding. Inspection separates account identity, primary controls, chat messages and data fields; stale account selections are rejected. Cancellation/unwinding and browser-removal races are guarded.

Final `npm test`: **113 passed, 0 failed, 0 cancelled, 0 skipped**, 387.4 seconds. Final `npm run build` passed. Actual Books to Scrape and Quotes to Scrape integrations passed, including separately selected inline date/location data after fixing a refinement regression. Production desktop/mobile screenshots were inspected. Runtime activation preserved existing configuration. This milestone used companion 0.3.0. See [refinement evidence and update instructions](../archive/WORKFLOW-REFINEMENT-VALIDATION.md).

## Previous saved-browser release - 14 October 2026

Companion **0.2.0** implements saved-browser reuse in Connections, a trusted connection page and fixed website Stop panel, Stop/reconnect without losing action keys, and output-only actions with unit/context checks. Production build and the final **96-test suite passed**. Books to Scrape and Quotes to Scrape live generated APIs passed again. Preservation checks matched workflow contracts and key scopes to a pre-migration backup. See [complete validation and update instructions](../archive/WORKFLOW-SIMPLIFICATION-VALIDATION.md). Older entries below describe earlier releases and their observations.

## Earlier connection and extraction milestones — historical summary

These entries summarize earlier development evidence. They do not certify current private-provider compatibility or supersede the latest milestone above.

| Milestone | Recorded validation | Result and boundary |
| --- | --- | --- |
| Chat input normalization and structural extraction | 87 tests passed; focused 11-test normalization check | Outer whitespace is normalized only for opted-in contracts; internal whitespace is preserved. Independent observed-input correlation remains mandatory. Private-provider success was not established. |
| Chat message structure and continuity | Earlier suites of 71–83 tests passed | Owned Chrome fixtures cover message layouts without role attributes, complete reply containers, repeated prompts, one semantic Send and preservation of conversation context. |
| Account selector and connection lifecycle | Earlier suites of 57–77 tests passed | Fixtures cover changing profile markup, page-depth limits, popup closure, reconnect, scope denial and owner lock. Selected-tab account confirmation was subsequently removed; these older identity-check requirements are historical. |
| Rich editor and separate chat consumer | Earlier suites of 59–62 tests passed | Real extension tests use owned rich-editor fixtures, asynchronous consumer polling and keys held in page memory. Personal website sessions were not certified. |
| Workspace Google OAuth | Earlier 47-test suite and signed-token tests passed | Owned consent fixtures cover browser-bound state, PKCE, signature/claim checks, callback redirects and CSRF. Actual Google consent requires a developer's registered client. |
| Legacy Google-cookie import | Six protocol tests passed at the early milestone | Synthetic state covers domain permissions, denied transfer, encryption and one-use codes. It does not prove downstream provider acceptance. |
| Removed direct-provider connector | Historical owned-fixture protocol checks | The provider-specific connector was later removed. It is not a current feature or setup path. |

An early private-provider investigation observed missing-output and input-correlation failures. Repairs preserve recorded semantic targets, invalidate test evidence and require a fresh successful test before publication. Owned fixtures reproduce these failure classes; successful fixtures are not presented as proof that a personal provider workflow passed.

Earlier UI checks covered the neutral interface, a 390px viewport, a single startup indicator and no overlapping busy layer. Preview behavior evolved after the early manual-only milestone; current connected-tab visual sharing is explicit and bounded. See [LIVE-PREVIEW-VALIDATION.md](../archive/LIVE-PREVIEW-VALIDATION.md).

## Actual public website integrations

`node scripts/verify-public.mjs` passed against **Books to Scrape** and **Quotes to Scrape**, real externally hosted practice websites. Their operator explicitly permits automation: https://sites.toscrape.com/ . These websites contain demonstration data, not private production accounts.

The complete path was exercised: public connection → record parameterized page → select text outputs → verify another record → publish scoped key → call consumer API → poll verified result. Tests covered two records per site, missing-record failure without a result, cookie-free public replay, encrypted server-held keys, no keys in UI payloads, traversal rejection, wrong-action keys, cross-key run isolation, revocation and OpenAPI constraints.

Results and timestamps: `../archive/PUBLIC-INTEGRATION-VALIDATION.json`. The demo UI also returned fresh verified book and author results; no console errors were captured. Screenshot: `screenshots/live-website-results.jpg`.

The separate demo contains five generated APIs: two public sites and three independently authenticated synthetic portals. Its catalogs and keys are excluded from the deliverable.

## Reproducing the checks

Use the startup instructions in [README.md](../../README.md). Choose an unused loopback port and a separate data directory for disposable validation; run one runtime per data directory. Test credentials and generated scoped keys must be created locally and excluded from reports. Tests must not reset an existing owner workspace.

The default source startup uses port 4317 unless HERMO_PORT is set. Configure an OAuth client's callback using the exact origin shown by the running workspace. Port-scoped cookies prevent separate test instances from replacing each other's owner sessions.

## Remaining limits

Google workspace OAuth does not establish that an automation-controlled website browser is accepted by Google or another provider. Optional normal-Chrome sign-in imports require personal authorization; their downstream provider acceptance remains unverified.

Google workspace authentication does not transfer Google cookies or automatically log connected websites in. The separate private browser feature requires personal Google sign-in and explicit encrypted session saving/reuse; see `../google-browser.md`. Search-engine selection does not create provider sessions. Anonymous observations in `../archive/PUBLIC-BROWSER-CHECK.json` showed Google's login form reachable, while ChatGPT and Claude presented HTTP 403 verification gates. No completed private Google login, CAPTCHA acceptance or provider AI generation is claimed.

Isolated replay allows GET/HEAD retrieval. Selected-tab replay uses ordinary Chrome networking and can execute approved DOM actions with external effects, but is not whole-profile access or a universal AI adapter. The earlier direct ChatGPT-plan connector was removed; current workflows use the shared browser execution engine. Actual personal provider acceptance and Google verification remain unverified. Websites can change, expire sessions, reach quotas or reject access. No zero-error or universal compatibility guarantee is made.

No independent security audit or completed external review is claimed.
