# Hermo: production readiness audit and incremental delivery

Audit date: 15 October 2026. This document distinguishes implemented behavior from planned work. Hermo remains an early-access local product; passing a fixture suite does not certify every website or a public release.

## Latest implementation status

For the 16 October consumer-app acceptance and companion refresh, see
[REAL-WORLD-VALIDATION.md](../validation/real-world.md) and
[REAL-WORLD-BUGFIXES.md](../validation/bugfixes.md). The counts below describe the
earlier milestone, not the current release gate.

The next-release milestone now implements immutable publications and isolated
drafts, revision-pinned accepted runs, history/restore/rollback, ordered step and
locator/wait editing, managed local session/lifecycle recovery, explicitly
authorized execution targets, recursive typed outputs, fresh-result uncertainty,
projects and a real consumer-key playground. The original adapters, endpoint IDs,
scoped keys and encryption are retained. Full regression: **216 passed, 0 failed**;
production build and live public generated APIs passed.

See [NEXT-RELEASE-VALIDATION.md](NEXT-RELEASE-VALIDATION.md) for the current
architecture, migration, verification evidence and remaining limits. The audit
findings and roadmap below describe the earlier baseline. Completed milestones
are not still missing merely because they appear in that historical plan.
Remaining work includes full sensitive-value classification/redaction, installer
and startup packaging, broader adversarial security/authentication and recovery
testing, and independent workflow reassignment across shared connection groups.
Managed execution retains GET/HEAD-only retrieval; it is not a mutation runtime.

## Existing product and architecture

The repository already contains a working website-to-API path. Preserve it.

| Layer | Implementation | Current responsibility |
| --- | --- | --- |
| Dashboard | React 19, TypeScript, Vite, Radix dialogs, Lucide, neutral design tokens | Connection wizard, demonstrated controls, input/output configuration, verification, test/publish, runs, keys and documentation |
| Independent local runtime | `server/index.mjs`, Node 24, Fastify | Owner authentication, consumer authentication, admission, durable queue, scheduling, verification, REST, static dashboard hosting |
| Storage | `server/store.mjs`, built-in SQLite | Encrypted connection/definition/run payloads, hashed consumer keys, audit events; Windows DPAPI or externally supplied master key |
| Browser adapters | `server/connected-browser.mjs`, `server/browser.mjs` | Explicitly paired Chrome tab; optional restricted isolated Playwright browser |
| Companion | `companion/browser`, Chrome MV3 | Exact authorized tab/origin/path access, DOM inspection, controls, scoped commands, fixed status/Stop panel |
| Shared integration surfaces | `server/mcp.mjs`, common `enqueue`, input validation and verifiers | REST and MCP share permission checks, idempotency, run ownership, execution and results |

Data flow: client authentication → workflow/input validation → durable run receipt → local scheduler → authorized browser adapter → observed outputs → assertions → persisted result → polling. The dashboard controls this path; it is not the worker. `npm start` already runs the runtime independently of an open dashboard. There are no cloud browser workers or cloud sessions.

Working capabilities include parameterized strings, text/attribute outputs, output-only reads, six setup guides, asynchronous REST and MCP, idempotent admission, publication gated by a tested content hash, output presence/equality/URL/number/context/changed checks, fresh generated-media checks, revocation, retention, typed deletion dialogs, exact tab authorization, host/origin/CSRF defenses and encrypted local persistence.

## Initial audit findings, with concrete code boundaries

These findings describe the starting implementation. The milestone record below identifies which were corrected; later contract and release gaps remain open.

### Release-blocking reliability gaps

1. **Interrupted submissions lose provenance.** Startup replaces active run payloads with a generic retrieval error, discarding accepted version, progress and possible-submission evidence (`server/index.mjs`, startup recovery). Preserve the existing record, distinguish an unknown external outcome, and never replay active submissions automatically.
2. **Recording can race execution.** Recording creation and API admission do not exclude one another over a whole demonstration. Per-command browser locks do not cover that interval. Re-pair and Home can also change a tab between output observations (`index.mjs` admission/recording, `connected-browser.mjs` pairing/navigation).
3. **Abort reasons collapse and affect siblings.** A connected execution abort detaches with connection-wide Stop, cancelling other accepted runs. Separate explicit Stop from interruption, and preserve timeout/cancel/disconnection causes and uncertainty.
4. **One process is assumed but not enforced.** Two processes can use one database; a second startup can recover the first process's active runs. Add exclusive local data-directory ownership before recovery.
5. **MV3 recovery is missing.** Authority exists only in a service-worker Map. An idle heartbeat test does not prove recovery after actual worker termination. Preserve bounded authority in trusted extension session storage, recover idle links, and fail closed on unknown in-flight commands.
6. **Stop can lose a readiness race.** A command waiting for an enabled element can mutate after Stop. Carry cancellation and absolute deadlines through readiness; revalidate live command authority immediately before mutation. An issued browser submission cannot be undone.
7. **Generic completion evidence is too weak.** Ordinary click workflows can accept an old nonempty result. Add correlation/state evidence for action workflows; retain legitimate unchanged read-only values.

### Contract, developer experience and product gaps

- Inputs are required strings; optional/default/number/boolean/enum contracts are absent.
- Outputs are flat required strings; numeric validation does not produce JSON numbers. Lists, nested objects, optional fields and strict conversion need engine work.
- A content hash and draft/published status are present; immutable published revisions, separate editable drafts, history and rollback are absent. `/versions/1` must not be presented as a complete revision system.
- Definition construction is embedded in routes. Export does not yet contain a complete versioned permissions/waits/schema contract.
- Recording captures supported dashboard controls, not arbitrary native interactions performed in Chrome. Scroll and manual navigation are not a complete recording language.
- The builder has no general ordered step CRUD/enable/duplicate editor or explicit configurable wait steps.
- Targeting prefers stable CSS anchors but stores one selector, not independently resolved role/label/context candidates. Missing and ambiguous cases need distinct diagnostics.
- No projects; the current workspace is a single local owner. Add lightweight grouping, without organizations or cloud concepts.
- Runtime readiness is hard-coded in the sidebar; step progress is collected but poorly exposed. There is no dedicated health endpoint or durable step timeline.
- Queue capacity is fixed at 30; scheduling is globally serial. This safely limits API concurrency but does not provide fair per-tab concurrency or queue deadlines.
- Key rotation/usage, integrated general API playground, startup-at-login tooling and release packaging need additional work.
- Large route/UI modules and duplicated adapter loops are maintainability risks. Extract cohesive responsibilities only as verified features require them; do not rewrite working framework code.

## Proposed final architecture

Keep the existing four layers. Evolve narrow shared boundaries:

1. **Versioned workflow contract:** a validated definition independent of React, with typed inputs, ordered step union, locator candidates, waits, extraction/conversion rules, assertions, origins, effect permissions and timeout budget. Migrate old definitions explicitly; keep old endpoints compatible.
2. **Revision store:** stable workflow identity, separate draft, immutable published revisions, explicit current publication pointer, and each accepted run pinned to its revision. Add this before general editing.
3. **Execution service:** admission → queue → adapter → observations → verification → terminal record. One place owns state transitions, idempotency, cancellation, outcome certainty and sanitized diagnostics.
4. **Adapters:** the existing connected Chrome and isolated Playwright adapters expose capabilities and emit sanitized progress. Their permission models remain distinct. No remote JavaScript, fallback account, unrelated tab or cloud worker.
5. **Contract-derived interfaces:** REST, MCP, OpenAPI, examples and playground consume the same schemas and execution service.
6. **Dashboard:** project/workflow management, step editor, test inspector, documentation and runtime health. Closing it has no effect on process lifetime; explicit Lock and Stop still revoke authority.

## Prioritized implementation roadmap

| Milestone | Deliverable | Verification gate |
| --- | --- | --- |
| 1 — Core reliability | Exclusive runtime ownership; provenance-preserving recovery; typed failure categories/uncertainty; recording/re-pair/interaction guards; durable step observations; truthful health; companion cancellation and worker recovery | Restart after submission, forced worker stop, record/admission races, cancellation versus timeout, sibling isolation, dashboard closed, exact origin and lock/revocation |
| 2 — Shared contract | Central definition validation and compatibility fixtures; typed/default/optional inputs and strict flat output conversion | UI/REST/MCP/OpenAPI parity, old saved definitions, invalid/absent/coercion cases |
| 3 — Revisions and editor | Separate drafts and immutable published versions, publish/rollback; ordered step editor; explicit waits and safe locator candidates | Editing never changes published execution; ambiguous targets fail; repair/retest required |
| 4 — Structured extraction | Lists/nested objects, optional/missing handling, visual mappings and completion evidence | Fresh search/form results, pagination boundaries, missing fields, identical valid outputs |
| 5 — Developer experience | Simple projects; integrated API playground; generated examples and specs; key rotation/usage; richer debugging | New-user connect → extract/record → test → publish → REST/MCP call with no scripts |
| 6 — Release | Packaging, documented standalone startup, optional login startup, real permitted website checks and onboarding | All acceptance criteria, permission/disconnection/security tests, desktop/mobile UX review |

Do not build these simultaneously. Milestones 1 and 2 have been implemented in sequence; their records below distinguish verified behavior from remaining release gaps. Later milestones remain open until their implementation and tests exist.

## Practical UI plan

Preserve black/white surfaces, shared spacing, accessible Radix dialogs, and the existing responsive shell. Replace static readiness with separate process/queue/tab/authorization health. Show accepted, started, running, verifying and terminal states with step durations; show error codes, expected/observed evidence and recovery instructions without exposing field values or selectors in diagnostics.

Next, make **Extract data** and **Record actions** the initial choices. Keep task families as optional guidance. Evolve the wizard into an ordered step workspace: steps at left, selected-step configuration in the center, input/output/test inspector at right; use stacked panels on smaller screens. Show variable usages, resulting JSON types and optional/default rules. API docs/playground must use actual published schemas and actual execution data. No decorative metrics or node canvas.

## Security and reliability release checklist

- [x] Localhost bind; hostile Host/Origin requests rejected; owner CSRF and consumer scope checked.
- [x] API secrets stored as one-way hashes; browser/run payload encryption; no cookie export through consumer APIs.
- [x] Exact authorized tab/origin/path; no arbitrary API-supplied JavaScript or unrestricted navigation.
- [x] REST and MCP share admission, permissions and verification.
- [x] Missing outputs fail; clicks alone are not successful runs; no automatic click retry.
- [x] Exclusive runtime ownership and truthful health validated in this milestone.
- [x] Cancellation/timeout/restart preserve possible side effects and diagnostics.
- [x] Demonstration, tab replacement and API execution cannot interfere through Hermo controls; direct human interaction in Chrome still changes the tab.
- [x] Actual worker termination recovery and Stop readiness races verified.
- [x] Shared scalar input/output schemas, defaults and contract-derived REST/MCP/OpenAPI.
- [ ] Lists/nested or optional outputs, immutable published revisions and general completion evidence.
- [ ] Sensitive-input classification/redaction across recording, test forms, diagnostics and exports. Current encryption is not equivalent to redaction.
- [ ] New-user onboarding, release packaging and complete acceptance review.

## Testing strategy

1. Keep existing tests for record/test/publish/call, universal task families, scoped REST/MCP, verification, media freshness, cookie/credential exclusions, lifecycle and responsive monochrome UI.
2. Add deterministic service-level tests with an injected browser adapter for recovery, queue/state transitions, recording/re-pair races, idempotency after disconnection and sanitized step history. These verify scheduler logic without pretending to prove website behavior.
3. Add real local Chrome extension tests: force worker termination; stop while a disabled control is waiting; expire command authority; close the dashboard; close the selected tab; verify no repeated mutation after uncertain transport.
4. Run TypeScript/production build, the full existing test suite, and desktop/mobile visual checks of changed screens.
5. Reuse explicitly permitted practice websites for live network validation. Do not create external accounts or invent credentials; authenticated vendor sessions require the user's available authorized session and cannot be certified by synthetic fixtures.
6. Preserve failures and exact commands in milestone validation notes. A sandbox preventing Chrome startup is an environment failure; rerun through the authorized browser-test path.

## Accurate operating limits

The local runtime process and computer must remain running. Browser tasks require an authorized available tab and a valid website session. Closing the dashboard is supported; explicit Lock ends access. Current companion authority inherits the owner's bounded unlock lease (four hours), and runtime/browser restart may require unlock and pairing. Surface the actual expiry. Website layout changes, cross-origin frames, closed shadow roots, canvas-only interfaces, CAPTCHA/MFA, browser policies and website terms limit support. Local endpoints are not publicly accessible. No cloud execution, credential sync, billing, marketplace or autonomous browser agent is planned in this phase.

## Milestone 1 implementation record

Implemented incrementally without changing the existing workflow schema, REST paths, key scope, SQLite data or framework:

- A separately held SQLite lock establishes one live runtime per data directory before key initialization or recovery. Abrupt-process-exit tests verify automatic ownership release.
- The optional isolated browser launches lazily. Starting the local API runtime and using the companion no longer launches an unused browser. Concurrent starts, late launch cancellation and Stop/Lock during pending connection startup are tested; late contexts cannot resume navigation.
- `server/run-state.mjs` preserves interrupted run inputs/version/progress, records sanitized step timing, distinguishes verification from actions, and reports uncertain external outcomes without replay.
- Recording startup and the whole demonstration exclude new API admission. Accepted runs exclude owner navigation, controls and tab replacement. Pairing consumes codes and reserves the physical tab before awaiting closure, then rechecks ownership and authority. Stop/Lock cannot complete a pending pair afterward.
- Companion 0.5.0 requires command guards. Trusted session storage and recovery alarms restore a suspended idle service worker; an unknown in-flight command disconnects without replay. Stop and absolute deadlines cover readiness and reauthorization waits.
- The overview and sidebar report actual process/queue/lease health. Run/test dialogs show durable steps, durations, verification and safe errors in the existing neutral design.
- Closing an authenticated React dashboard was tested in real Chrome, followed by a scoped REST call that returned freshly changed website data while the dashboard stayed closed.
- Shutdown revokes work before HTTP draining and flushes companion long polls. A queued execution cannot start while the runtime is closing, and unstarted durable work survives the close.

For safety, cancellation or timeout of an **active companion run** invalidates that live tab link. Other accepted requests on the link fail as disconnected, with their own records; they are not silently cancelled or replayed. Reconnect before submitting new work. Cancelling an unstarted queued request does not invalidate the link. This conservative behavior is exposed in the guide and README, and covered by the connected-timeout test.

Detailed commands, results, visual evidence and remaining release gates are recorded in [CORE-RELIABILITY-VALIDATION.md](CORE-RELIABILITY-VALIDATION.md). This milestone fixes audit findings 1–6. General fresh-completion evidence for arbitrary mutation workflows (finding 7), immutable revisions, projects, the full editor and release packaging remain open. Scalar contracts are implemented in milestone 2 below.

## Milestone 2 implementation record

- `server/workflow-contract.mjs` validates scalar metadata independently of React. Request inputs support strict JSON strings/numbers/booleans, string enums, required/optional/default behavior, trimming and bounds. Defaults are validated and normalized before admission and idempotency matching.
- Both local adapters stringify scalars only at the browser boundary, clear omitted optional text fields, and convert observed outputs to required flat JSON scalars after existing raw-evidence verification. Numeric or boolean zero values remain valid. Invalid output conversion persists an explicit failure without a result.
- The owner-only draft contract endpoint accepts metadata for existing fields, requires the expected content hash, excludes recording/accepted execution, preserves locators and permissions, and clears previous publication evidence. Published and paused actions are rejected. Legacy saved definitions are not migrated or rehashed automatically.
- The dashboard exposes a neutral, accessible draft contract editor with input usages, typed test controls, optional/default behavior and mandatory retesting. Documentation, examples, OpenAPI, MCP discovery and the generic action app use actual declared types. The all-text chat example is explicitly restricted to compatible contracts.
- Scalar exports have a format marker; this does not implement immutable revisions. Inputs remain scalar and outputs remain flat/required. No project grouping, arbitrary step editing, runtime replacement, cloud execution or dependency migration was introduced.

Commands, outcomes, responsive screenshots and remaining boundaries are recorded in [SCALAR-CONTRACT-VALIDATION.md](SCALAR-CONTRACT-VALIDATION.md).
