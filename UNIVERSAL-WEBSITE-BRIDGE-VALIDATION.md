# Universal website bridge and dashboard validation

14 October 2026. This update implements the universal website task model in [the plan](UNIVERSAL-WEBSITE-BRIDGE-PLAN.md) and the shared interface direction in [the design system](design-system/hermo/MASTER.md).

## Implemented

- Removed the direct ChatGPT-plan connector, exclusive server routes, callback exception, keys and example/setup assets. Ordinary recorded website chat and Google workspace authentication remain. Historical encrypted settings are retained without a live reader; existing owner data was not deleted.
- Added five task families plus Custom: chat/text, media generation, data reads, search/extraction, form submissions and custom tasks. These use the same website recording/execution engine. Isolated replay remains retrieval-only; generation and submissions receive a clear instruction to use normal Chrome.
- Media outputs capture loaded HTTP(S) asset/download URLs and descriptions or filenames. Source queries, including signed asset parameters, are preserved. URLs with credentials and nonportable blob/data/file schemes are rejected. The app shows explicit links without fetching or auto-downloading assets.
- New actions save a bounded 15–300 second execution budget; media defaults to 180 seconds. REST contracts communicate this budget to consumer apps. Status polling has a separate bounded allowance while REST/MCP run admission stays 60 requests/minute. Rate failures include Retry-After.
- Verification waits for selected completed results. Generated assets must be fresh relative to the destination page before the recorded task, and previously visible gallery URLs cannot qualify as new generation. Decreasing message counts cannot prove freshness. Unchanged valid read-only values remain supported. Missing outputs, changed accounts, stale assets and incomplete tasks fail explicitly; uncertain submission is never automatically repeated.
- Redesigned the main six screens and builder with neutral surfaces, one blue accent, compact navigation, readable forms, real data and reusable tokens. Added the browser→recorded task→API flow, accessible field names/hints, skip link, keyboard focus restoration, typed-name alert dialogs, reduced motion and an accessible real-data activity table.
- Companion 0.4.0 retains direct pairing, persistent website panel and Stop without an extra controller tab.

## Installed design guidance

All requested sources are installed under `.agents/skills`: UI UX Pro Max, Anthropic Frontend Design, and UI Skills baseline UI, accessibility and motion performance. All installed SKILL.md files were read; pinned source/frontmatter/file checks and local searches passed. No existing skill or project configuration was overwritten.

The optional UI UX Pro Max CLI dependency download failed with ECONNRESET. Its inspected upstream Codex generator and validated copy fallback installed the usable skill, including real data/scripts. Exact revisions and checks: `work/design-skills-installation.md` and `work/design-skills-inventory.json`.

Visual references studied: [Linear](https://linear.app/), [Trigger observability](https://trigger.dev/product/observability-and-monitoring), [n8n executions](https://docs.n8n.io/build/understand-workflows/understand-executions/view-all-executions). The user's restrained dashboard brief takes priority over irrelevant catalog landing-page suggestions.

## Verification evidence

- Production TypeScript/Vite build passes. Final entry: `index-DR6fiBcw.js`, styles `index-DkZzxp7V.css`.
- Production browser UI check passes 5 tests, including all six screens at 1440, 768, 375 and 844×390 landscape; six task choices; no page overflow/unlabeled visible controls; focus trapping/restoration; exact-name deletion; actual sandbox input/search/output recording, 180 second budget persistence, verification and API publication. Screenshots and machine checks: `work/universal-ui/46d648ee7176/evidence.json` (31 screenshots from the final build).
- Real public websites pass `npm run test:public`: two Books to Scrape records and two Quotes to Scrape authors, changed results, missing-record failure, anonymous replay, scope isolation, encrypted keys, revocation and OpenAPI input pattern. Current secret-free results: `PUBLIC-INTEGRATION-VALIDATION.json`.
- Production Chrome extension tests record, verify, publish and call all six task families using owned synthetic sites. Media also runs through MCP and the generic consumer app. Coverage includes asset queries, URL checks, exact idempotency, stale assets, pre-existing gallery URLs, navigation baselines and no repeated generation.
- Main server restarted at `http://127.0.0.1:4318`; saved workspace remains configured. Final assets/companion guide return200, removed provider pages404, unauthenticated scoped API401. Restart ends temporary permissions; unlock and reconnect the saved website when ready.
- First complete regression run: 129/130 passed. The sole failure was a new synthetic test using an invalid action ID containing an underscore; it was corrected to a valid ID, and targeted REST/MCP polling plus isolated-mode checks now pass 2/2. The final complete rerun passes **130/130**, with zero failures, cancellations or skips, in 498.5 seconds. Exact command: `npm test`; log: `work/universal-green-tests.log`. The initial fixture mistake was not an application failure and was not hidden by weakening assertions.

## Scope and practical limits

Tests use disposable owner credentials, databases and Chrome profiles; no personal provider accounts, paid media services or user passwords were used. Main `.hermo` was never reset. Verification proves observed source/account and selected output checks, not arbitrary business truth.

Visible DOM controls, open shadow roots, selected text and portable media links are supported. Cross-origin frames in connected mode, closed shadow roots, canvas-only results, local blobs, uploads, CAPTCHA/MFA and website restrictions may require manual steps or another integration. Saved browser/action configuration remains until deletion; website sessions and API keys can expire separately. No claim of universal error-free access is made.
