# Shared scalar contract milestone validation

Date: 15 October 2026. Scope: milestone 2 of [the production readiness roadmap](PRODUCTION-READINESS.md), following the completed core reliability milestone. This record does not certify public release readiness or every website.

## Implementation

One shared engine module owns scalar input validation, author metadata validation, JSON schemas, browser value conversion and strict output conversion. The dashboard is a consumer of this contract; it is not the executor. Both browser adapters, REST, MCP, OpenAPI and the generic action app retain the same underlying admission, scope and raw outcome checks.

Supported inputs: string, number, boolean, string enums, optional/required, defaults, opt-in trimming, text lengths and numeric bounds. Trimming runs before declared lengths and enum checks. A configured default is validated with the same rules as a request. Omitted defaults are canonicalized before idempotency matching. Numeric `0` and boolean `false` never mean missing.

Supported outputs: flat required text, finite decimal/exponent numbers, exact `true`/`false` booleans and HTTP(S) URLs without credentials. Conversion follows raw correlation/freshness/unit/context verification. Currency, unit, localized or ambiguous text is not silently stripped or coerced. Failed conversion produces a sanitized validation error and no successful result.

The draft editor changes existing field metadata only. Owner/CSRF authorization, expected content hash, connection-idle and no-recording guards protect updates. Existing selectors, frames, steps and origin permissions cannot be supplied through the endpoint. Saving clears test evidence; another verified execution is required before publication. Published/paused contracts are rejected. Old saved definitions and hashes remain unchanged unless a draft is explicitly edited. Scalar exports use `hermo.workflow.v0.2` and `contract_version: "2"`; legacy exports retain `v0.1`.

Omitted optional text actively clears a recorded input. Optional select/check inputs require a valid default; string checkbox defaults must be `true` or `false`. Path parameters remain required safe strings. Correlation checks require an available requested value. These rules prevent stale tab state from becoming an implicit input.

## Verification evidence

- Contract unit tests cover strict types, defaults, trim/length ordering, enums, bounds, unsafe optional controls, fixed path restrictions, correlation, legacy compatibility, raw output verification, strict conversion and MCP/OpenAPI schema parity.
- `tests/typed-workflow.test.mjs` uses real Chrome and an owned local HTML form. It records controls and outputs through Hermo, configures a draft, verifies defaults and omitted text clearing, edits through the actual React dialog, retests, publishes and calls the generated REST and MCP tools. It checks scoped action-contract discovery, typed examples/exports, idempotency and the generic consumer displaying `0` and `false` correctly. Wrong types, unexpected names, stale versions, forged CSRF, selector injection and premature publication are rejected.
- `tests/connected-contract.test.mjs` uses real owner authentication, pairing, guarded command RPC, the connected adapter, queue and persistence. Only companion DOM replies are simulated, explicitly labeled in the test. It proves typed replay, raw equality assertions, clearing omitted text, no operation retry and invalid extraction failure without leaked raw text. It is not a claim of a live vendor website or Chrome extension run.
- Responsive real-Chrome checks cover 1440, 768 and 375 pixel widths, no page overflow, exact accessible editor labels and no JavaScript page errors. Screenshots are retained under `work/typed-contract/`; desktop and phone captures were also visually inspected.
- Independent review caught configured maximum length being checked before trimming and invalid text checkbox defaults. Both were corrected and regression cases added. A visual review caught unequal vertical alignment in adjacent numeric bounds; the grid was corrected.

The final complete regression suite passed **170 tests, 0 failed, 0 cancelled, 0 skipped**, in **545.4 seconds** (`work/typed-contract-full-tests.log`). Command: `node --test --test-concurrency=1 tests/*.test.mjs`. This includes real extension lifecycle, dashboard-closed execution, universal website task families, scoped REST/MCP, authentication/permission boundaries, runtime recovery, storage and the new scalar contract path.

`npm.cmd run build` passes TypeScript and the production Vite build (`work/typed-contract-build.log`). After final CSS alignment/spacing changes, both affected real-Chrome contract and runtime UI tests pass against that build (`work/typed-contract-final-ui.log`). A final contract run with reduced motion and saved element geometry also passes (`work/typed-contract-final-contract.log`). Desktop and phone screenshots are visually inspected. The contract test asserts aligned numeric-bound inputs as well as no page or editor-container horizontal overflow at 1440, 768 and 375 pixels. Final geometry/screenshots: `work/typed-contract/b5ed2f73ca98/`; production entry: `index-C5-7vYCV.js`.

Live external validation passes again on Books to Scrape and Quotes to Scrape (`work/typed-contract-public-tests.log`, timestamped `PUBLIC-INTEGRATION-VALIDATION.json`). Two records per website, dynamic inputs, generated API calls, missing-record failures, scope and revocation use real network responses from permitted practice sites. This also preserves legacy text outputs such as a currency-formatted price.

The existing workspace runtime was restarted on **http://127.0.0.1:4318** without changing its data or encryption context. Public health, dashboard, production editor bundle, companion guide and example apps return 200; the owner overview still returns 401 without authentication. Health reports `dashboard_required: false`, `browser_required: true`. The smoke test does not unlock or read private workspace data (`work/typed-contract-workspace-smoke.json`). Restart revokes live browser authority as designed; the owner must unlock and reconnect the saved tab. Companion remains version **0.5.0**; scalar transport requires no new extension protocol.

Independent review and JavaScript syntax checks pass. `git diff --check` reports no whitespace errors; Git's existing LF/CRLF normalization warnings remain. The earlier focused run passed 17 tests, and the separately run connected-adapter integration passed. Chrome, loopback network tests and production builds used the authorized execution path because the ordinary sandbox denied those operations.

## Remaining boundaries

Lists, nested objects, optional outputs, schema import, immutable published revisions/rollback, arbitrary step CRUD, role/label locator fallback, projects and the integrated API playground remain later work. The current endpoint path is still `/v1/actions/{slug}/versions/1/runs`; it is not a complete revision history API. Type changes require a draft, and there is no new clone/revision UI in this milestone.

Defaults are functional contract configuration visible in API documentation and exports; they are not secret storage. Complete sensitive-input classification/redaction remains a release gate. The runtime/computer/browser must remain available; dashboard closure is supported, while explicit Lock/Stop and authorization expiry revoke browser access. No cloud execution or remote session synchronization was added. Private accounts were not fabricated or certified, and website access restrictions are not bypassed.
