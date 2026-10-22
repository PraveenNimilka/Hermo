# Production upgrade implementation log

Working assessment: 22 October 2026. Source and executable tests are the authority;
earlier reports are historical evidence, not results for this upgrade.

## Managed browser follow-up

The original partial managed-browser scope below has been extended with complete
encrypted Chromium profile snapshots, explicitly authorized HTTP/WSS action
execution and additional real-site acceptance. See the
[storage/authority design](managed-browser-upgrade.md) and
[current acceptance results](../testing/managed-browser-upgrade.md).
The baseline and milestone entries below retain the original engineering history.

## Baseline

- `npm run build`: passed TypeScript and Vite.
- `npm run check:repo`: passed.
- `npm run test:consumers`: 28 passed.
- `npm test`: 363 tests, 360 passed, 3 failed; 977,616 ms. Two failing
  leaf cases (one parent also counted): obsolete preview-script count and
  a Chrome popup target closed by the recovery UI. Repaired without production
  changes: visual preview 6/6 and actual Chrome reconnect flow 10/10 passed.
- `npm run test:real-world`: passed 20 checks against the permitted Books/Quotes
  sandboxes, including expected negative cases. Disposable state only. Evidence:
  `validation/results/real-world-2026-10-21T20-40-15-100Z.json` (UTC filename).
- Existing dirty source changes from earlier work are preserved. Tests use
  disposable encrypted workspaces; the owner's `.hermo` directory is not a fixture.

## Feature checklist

| Feature | Assessment before this upgrade | Remaining work |
| --- | --- | --- |
| 1. Fresh results/outcomes | Partial; real correlation, completion markers and schema checks exist | Canonical uncertain/timeout lifecycle, receipts, evidence regression coverage |
| 2. Human approval | Partial; durable per-step gates and owner-only decisions exist | Workflow/risk policies, inbox, acceptance coverage |
| 3. Permissions | Partial; frozen origin/action constraints and inspector exist | Enforced publication acknowledgement, version differences, consumer metadata |
| 4. Versions | Partial; immutable SQLite revisions, draft separation, rollback and pinned runs exist | Breaking-change warnings, explicit historical invocation, comparison |
| 5. Managed browser | Partial; independent isolated retrieval, encrypted session snapshots and crash recovery exist | Persistent profiles/locking and supported authenticated mutation path; preserve current restrictions until verified |
| 6. Locator repairs | Partial; semantic locators/manual editing and specific chat repair exist | General observation-only discovery/probe, candidate reasons, explicit repair diff |
| 7. Step editor/waits | Partial; ordered editing, disabled steps and condition waits exist | Stable IDs, additional bounded waits, safe individual probes, error policy |
| 8. Structured JSON | Partial; nested output mappings/schema/coercion exist | Remaining null/coercion/input cases and acceptance coverage |
| 9. Playground/examples | Partial; real scoped execution, polling, scalar form and snippets exist | JSON editor, version selection, TS/MCP and sanitized sharing |
| 10. Reliability | Partial; overview counts and recent history exist | Per-workflow metrics, percentiles, breakdowns, reports and UI |
| 11. Projects | Partial; connection-based projects and safe deletion exist | Individual workflow assignment, descriptions/archive/search and metrics |
| 12. Templates | Missing; executable examples are not portable templates | Inert validated catalog/import/export, authorized draft instantiation and UI |

No feature is marked complete until its acceptance cases pass.

## Implementation order and progress

1. Correctness foundation — verified for the assessed receipt/freshness/retry paths.
2. Safety and permissions — integrated and verified for the assessed policy/inbox paths.
3. Stable published contracts — integrated and verified for the assessed publication, revision and rollback paths.
4. Execution independence — supported encrypted-session lifecycle verified; full Chromium directory persistence remains unsupported.
5. Workflow authoring — verified stable identities, locator repair, bounded waits, structured contracts and responsive authoring.
6. Developer experience — projects, templates, JSON playground and sanitized examples integrated and verified on assessed paths.
7. Observability and release — local health/reporting, review and public-site checks verified. Full regression identified three stale fixtures; all corrected cases pass targeted reruns. One platform privilege check is skipped. See the final assessment for exact results.

### Milestones 6 and 7 acceptance

Integrated the schema/JSON playground, revision-aware sanitized JavaScript,
TypeScript, Python, cURL and MCP examples; project descriptions, workflow moves,
archive/search/health; and eight structural template archetypes. Template import
is inert and instantiation creates an untested draft only. Neutral exports remove
website targets and private values; unsupported bindings and approval-gate timing
reject export rather than silently changing behavior. Publication always follows
the existing verification and permission-review path.

Added owner-only retained-history reporting with strict receipt classifications,
explicit denominators, nearest-rank percentiles, revision/step breakdowns, recent
safe metadata and sanitized downloads. Reports stream encrypted rows and retain
metadata only, with a 10,000-row route cap. Historical labels, inputs, output values,
arbitrary error text and malformed duration/revision metadata are excluded. No
third-party telemetry was added. Project schema changes are additive and atomic;
fault injection verified rollback and safe retry with unchanged legacy records.

The full suite observed 543 tests: 538 passed, four failures (three leaf fixture
expectations and one parent), one skipped. Corrections explicitly acknowledge
breaking publication changes, document historical JSON contracts and count only
correlated receipts as verified. The combined formerly failing files pass 10/10.
The unavailable Windows file-symlink privilege is the sole skipped check.
Consumer tests pass 28/28; all 20 low-volume Books/Quotes website checks passed.
The integrated build, responsive acceptance, final security follow-ups and source
hygiene checks passed. The whole suite was not repeated after fixture corrections.

Started the updated runtime after a private backup. Health is OK. Read-only
comparison confirmed the owner's existing connections, workflows, keys and
immutable revisions were unchanged. Full Chromium disk-profile persistence and
general managed non-GET/HEAD execution remain deliberately unsupported.

See [final assessment](../testing/production-upgrade.md) for the feature matrix,
architecture, test report, security boundaries, migrations and known limits.

### Milestone 5 impact record

Targets: authoring validation, immutable draft editing, both browser adapters,
companion capabilities, input/output schemas and owner editor. Legacy scalar
requests, routes, missing coercion settings and published revision bytes retain
their existing behavior. New nested browser inputs require an explicit bounded
`value_path` ending in a guaranteed scalar; collections never become text
implicitly. Nullable or potentially missing bindings fail validation. Nested
request object ordering is canonical for idempotency; array ordering remains
significant and historical scalar digest bytes are preserved.

Stable step IDs are assigned when a draft is saved. Legacy editor projections
do not rewrite persisted definitions or immutable publications. Approval selections
follow their protected IDs through reorder/delete; duplicates have distinct IDs
and require review. Receipts and approval metadata expose optional safe IDs.

Locator repair observes an already authorized, open, idle browser. It never opens,
navigates, fills or clicks a website. Suggestions carry expiring owner-only tickets
bound to the saved version, browser, document and node; apply re-probes and edits
only that step's locator fields. Managed probes use an isolated execution world.
Evidence is cleared for the draft; earlier publications remain immutable. Grounded
candidate scores are matching evidence, not estimates of business safety.

Wait strategies now include bounded delay, navigation readiness, typed output
conditions and managed-only GET/HEAD response metadata. Response waits observe
traffic since the last issued action (or invocation startup), including responses
already received before the wait begins; they never repeat requests or read bodies.
Connected Chrome cannot observe network responses and rejects that operation.
All waits honor cancellation and total deadlines. An explicitly continued wait
timeout is recorded as skipped with `WAIT_TIMEOUT_CONTINUED`; permission/auth errors,
total timeouts and cancellation cannot be continued. Final verification is still
mandatory. A stalled connected observation must drain before any further action;
an unacknowledged observation stops the run rather than permitting overlap.

Nested output mappings retain relative containers, repeated collections, optional
fields and existing bounds. Null-only mappings and explicit scalar legacy/strict
conversion are additive. Strict numeric/boolean/null conversion does not pretend
that DOM text is a native JSON scalar; legacy text conversion remains available.
New companion capabilities are negotiated; old links retain their supported
commands and reject unsupported observations/extraction before dispatch.

Observed checks so far: locator DOM/runtime safety 17/17, combined managed and
connected wait/browser checks 30/30 (89,867 ms), shared wait/receipt/approval tests
26/26, nested input backend/client 16/16, nested REST/MCP acceptance 6/6 with an
explicitly controlled adapter, output conversion plus existing structured browser
regression 36/36. Production TypeScript/Vite build passed. Initial new editor UI
acceptance found ambiguous implicit labels in two controls; explicit accessible
names and subsequent UI checks are in progress. These results are not a final
full-suite or universal website compatibility claim. Additional action deadline,
nested browser binding and combined contract regressions are running.

### Milestone 1 impact record

Targets: `server/run-state.mjs`, runtime run serializers, REST/MCP adapters,
execution details and status presentation. Existing clients poll the legacy
`status` enum and must keep terminating correctly. Keep that enum stable and
expose a separate canonical `execution_status` and versioned execution receipt;
persist explicit `uncertain`/`timed_out` phases for new outcomes. Old terminal
records remain immutable and are interpreted conservatively when read. No API
keys, encrypted inputs, historical results or database tables are rewritten.

Verification: lifecycle unit tests, real-adapter freshness/completion tests,
runtime/REST/MCP receipt integration, existing cancellation/restart/approval tests,
TypeScript/build and full suite. Rollback is a source revert; no destructive data
migration. Production runtime is not restarted while implementation is incomplete.

Integrated milestone 1 changes:

- `server/execution-receipt.mjs`: canonical state interpretation, strict temporal
  evidence gate, versioned input-free receipts, conservative historical reads.
- `server/run-state.mjs`: durable preparing/uncertain/timed_out phases, immutable
  terminal observations, managed DOM actions retain submission uncertainty.
- `server/index.mjs`, `server/mcp.mjs`, `server/api-spec.mjs`: owner/scoped REST
  and MCP receipt reads, additive canonical status, unchanged legacy polling enum.
- `server/verification.mjs`: one trusted observation/verification timestamp avoids
  intermittent millisecond ordering failures.
- Dashboard badges/playground show canonical outcomes; verification/playground
  require explicit website inspection acknowledgment before an unsafe new retry.
- Managed DOM controls no longer advertise read-only/idempotent MCP authority.

Observed verification so far: focused runtime/receipt/lifecycle tests 12/12;
security/polling/approval/receipt regression set 15/15; real-browser completion,
stale output, faults, media and approval set 40/40 (195,400 ms); build passed.
Overlapping sets are not summed as distinct tests. Actual dashboard retry
acceptance passed (1 browser test, 375/1440 px); request fixture deliberately
simulates an issued action and does not claim an actual website mutation.

Preparation for later milestones (not active runtime features yet):
`approval-policy.mjs` (7 unit tests), `workflow-changes.mjs` (12 unit tests),
`workflow-health.mjs` (6 unit tests). These do not complete their roadmap features
until backend/UI integration and acceptance tests pass.

### Milestone 2 impact record

Targets: approval policy validation/compiler, existing step/editor validation,
both adapter entry points, shared runtime callbacks, permission/contract metadata,
owner inbox route and dashboard/editor. Policy compilation must use a private
copy of the accepted immutable definition, retaining its original version hash;
the stored draft/publication cannot be rewritten to reflect calculated gates.
Explicit step gates always win. Ordinary API keys cannot decide approvals.
Unclassified risk is never guessed from page content. Malformed policies fail
before opening a browser or issuing a step. Output-only invocation policies pause
before any selected-page command or managed browser navigation. They use an
explicit invocation approval record rather than inventing a browser step.

Inbox indexes are additive and idempotent; history stays in existing encrypted
run payloads, preserving restart-safe termination and retention cascades. Paging
must reach older events beyond overview limits without unbounded decryption.
All owner session, CSRF, Host and Origin hooks remain in force. Verification:
policy/inbox units, real-browser owner/REST/MCP gate tests, existing approval
security and migration tests, responsive UI tests, typecheck/build. Rollback is
a source revert; added indexes are harmless and no saved data is reset.

Integrated milestone 2 evidence:

- Policy runtime test: 5 passed, actual managed browser and controlled website.
  Rejection causes zero mutations; approval performs one; REST/MCP metadata agree;
  published policy remains unchanged after draft edits.
- Inbox/policy unit suites: 12 passed; history paging reaches old events beyond
  the overview cap, credentials and values are excluded, expired events are not
  fabricated into durable decisions by a read.
- Actual dashboard policy/inbox test: 1 passed, desktop/mobile, keyboard-safe
  confirmation, rejection then approved execution and history.
- Reviewed-publication security test: 1 passed. Untested drafts, missing/stale
  permission acknowledgment and mismatched breaking-change acknowledgment fail;
  old encrypted publication snapshots remain unchanged.
- Existing revision/workflow/security integration set: 21 passed after updating
  owned fixture clients to explicitly review their configured permissions.

Publication now requires `expected_version` and `permission_fingerprint` even
for the first tested version. This intentionally strengthens the owner-only
publication contract; existing consumer API routes and keys are unaffected.
Intentional breaking schema replacements also require the exact current
`change_fingerprint` plus `accept_breaking: true`. Normal dashboard review sends
these only after the appropriate acknowledgment. Fixture automation explicitly
acknowledges its own configured changes; direct negative requests remain tested.

Additional milestone 2 acceptance: output-only managed invocation tests passed
8 cases, including rejection, absent callbacks, cancellation, expiry and restart;
the connected-tab case verifies zero page commands before approval. Policies with
enabled steps gate the first enabled step and preserve later explicit gates.

### Milestone 3 impact record

Targets: immutable revision resolution, scoped REST/MCP admission, permission and
schema comparison, publication/rollback review, API schema and playground. Existing
`/versions/1` routes retain their API contract version meaning and invoke the active
publication. Explicit `/revisions/:revision` calls select a tested immutable
snapshot; accepted runs retain their exact revision across publication and restart.
Idempotency recovery never admits an extra execution; a request identifier already
bound to a different explicit revision returns a conflict.

Integrated: revision discovery and selected contracts, `invoke_revision` MCP tool,
playground revision selection and pinned recovery, recursive contract comparison,
separate breaking-change consent, and fingerprint-bound rollback authorization.
Historical revisions retain their original approval policies. A stronger new
publication does not retrofit historical snapshots; pause the action or revoke its
key to end access to them. Private selectors and stored credentials are excluded
from consumer metadata.

Observed acceptance: five sequential integration/UI tests passed (23,658 ms):
approval inbox, publication/rollback consent, revision playground, workflow safety
and immutable revision runtime. These include actual disposable Chromium at
375/1440 px and controlled runtime adapters. OpenAPI revision tests passed 2/2.
The combined core approval/revision/example regression passed 32/32 (91,060 ms), after an
in-progress OpenAPI edit briefly caused a syntax error; that syntax error was
corrected and syntax/spec checks passed. This is not a full-suite passing claim.
See [published contracts](published-contracts.md) for owner-client migration and
exact public route semantics.

### Milestone 4 impact record

Targets: managed session lifecycle, per-connection leases, owner visibility/reset
controls, browser installation diagnostics and authenticated recovery acceptance.
Saved cookies, local storage and IndexedDB remain encrypted session snapshots.
No personal Chrome profile or credentials are imported automatically. Full durable
Chromium user-data directories are not enabled: Chromium writes readable website
storage/cache in them, so adding them without an encrypted-volume design would
weaken the current durable-storage boundary. This limitation remains explicit;
logical encrypted session profiles must not be described as full disk profiles.

The supported managed replay path continues to enforce approved exact origins,
GET/HEAD-only network traffic, blocked service workers and blocked WebSockets.
Session reset must preserve workflow IDs/publication history while invalidating
their saved account authority and consumer keys. Leases must survive concurrent
manager attempts and release on process death, cancellation and browser failure.
Required checks: lock/process tests, owner/CSRF/busy guards, actual authenticated
Chrome session reuse/expiry/restart, isolation, cancellation/crash and responsive UI.

Integrated so far: `managed-profile.mjs` owner lifecycle routes and executable
diagnostics, `managed-profile-locks.mjs` per-connection SQLite leases, adapter
offline-before-guards startup, lease transfer from idle Studio, visibility and
resource cleanup, and `ManagedProfile.tsx` owner controls. Settings are additive
encrypted payload fields; reset clears only the selected connection's saved
session/binding, revokes its affected keys and preserves workflow history.

Observed checks: existing managed startup/session/approval/completion set 36/36
(92,231 ms); updated startup/spec checks 9/9; managed controls UI 1/1 at 375/1440 px.
The UI uses a controlled engine to exercise real owner routes and encrypted-store
changes; it does not prove actual website authentication. Actual authenticated
Chromium runtime/session tests passed 10/10, including alternate execution-target
revocation. The combined session/owner-race/profile/revision/companion regression
passed 27/27 (23,394 ms). Browser compatibility, real Chromium crash/cancellation/
timeout recovery and ordinary workflows passed 23/23 (142,214 ms). A further
connected-tab, publication/revision and managed-UI regression passed 21/21
(124,316 ms). These overlapping sets are not distinct totals. Pure lease
tests passed all supported cases; symlink/hard-link checks can be skipped when
the Windows account/sandbox does not permit creating those links. A separate
unrestricted test run covered actual junction/hard-link rejection.
See [managed browser](managed-browser.md) for supported behavior and limitations.

Reset additionally rotates a private session authority binding and clears test
evidence for both directly recorded workflows and alternate execution targets.
Old historical authority does not revive after reconfirming the same account.
Connection writes check the captured encrypted payload/status and reject stale
updates. Deterministic DNS/confirmation interleavings prove a reset cannot be
overwritten by an earlier owner request. Consumers cannot see this private
binding. Existing connections keep their original authority until explicit reset;
no credentials, workflows or API keys are rewritten during startup migration.

`npm run check:repo` passed (220 tracked files; not an untracked-file audit).
`npm run test:consumers` passed 28/28 after rerunning with loopback networking;
the sandbox-only run had EACCES loopback errors rather than application failures.
The latest production UI build passed. Visible execution launch configuration is
tested without displaying an actual headed window; no claim of a manual window
interaction test is made.

### Milestone 5 impact record

Targets: shared step validation/editor, recording creation, repair, ordered editor
controls, approval selection mapping and execution metadata. Optional step IDs
must not rewrite immutable publications or legacy hashes. Editor reads project
missing IDs without persisting them; explicit saves and new recordings assign
stable IDs. Reordering retains IDs, duplication creates a new ID, and numbered
approval selections follow their original protected steps. Deletion cannot move
a gate onto another step silently. Preserve one-based API step numbers and add
identity metadata only where recorded. Validation/approval/runtime/editor tests
must cover legacy definitions as well as new IDs before extending locator repair.

## Privacy and operational boundaries

Fastify uses sanitized public errors and does not log request bodies. Inputs,
outputs, browser storage and accepted workflow snapshots are encrypted at rest.
Owner privacy export intentionally includes run inputs/results; ordinary API run
responses omit inputs. Approval context redacts proposed values. Workflow export
is owner-only and redacts fixed form values; it must not be presented as a safe
public-sharing format. New reports/examples must exclude output values, cookies,
keys and media capability URLs by construction. External checks are opt-in and
must distinguish actual network observations from local fixture evidence.
