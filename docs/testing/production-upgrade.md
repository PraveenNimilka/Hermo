# Initial production upgrade assessment

Initial assessment on 22 October 2026; the subsequent managed-profile upgrade and
final verification are recorded in [managed-browser acceptance](managed-browser-upgrade.md).
This initial report is an engineering acceptance report,
not an independent security audit or a guarantee about arbitrary websites.
The [implementation log](../architecture/production-upgrade.md) preserves baseline
failures, changes and milestone evidence. Existing unrelated working-tree changes
were retained. No commit, push, dependency upgrade or cloud deployment was made.

## Feature matrix

| Feature | Assessment | Main implementation and evidence |
| --- | --- | --- |
| 1. Fresh result verification | Implemented for supported mappings | `server/verification*.mjs`, `run-state.mjs`, `execution-receipt.mjs`; correlated evidence, repeated identical outputs with completion proof, stale rejection and uncertain outcomes |
| 2. Human approvals | Implemented | `approval-policy.mjs`, `run-approvals.mjs`, `approval-inbox.mjs`, `src/ApprovalInbox.tsx`; owner-only decisions, expiry, policy gates and restart-safe termination |
| 3. Permissions | Implemented for supported adapters | `workflow-permissions.mjs`, `execution-capabilities.mjs`, publication routes and `WorkflowPermissions.tsx`; exact fingerprint consent, origin/action restrictions, consumer summaries |
| 4. Immutable versions | Implemented | `workflow-revisions.mjs`, `revision-routes.mjs`, `workflow-changes.mjs`, REST/MCP invocation; draft isolation, pinned historical calls, rollback and breaking-change review |
| 5. Managed local browser | Partially implemented | `browser.mjs`, `managed-profile*.mjs`, `ManagedProfile.tsx`; encrypted logical sessions, locking, explicit login, visibility, reset, recovery and independent retrieval. Full Chromium disk profiles and general non-GET/HEAD actions remain unsupported |
| 6. Locator suggestions | Implemented for accessible supported targets | `locator-repair.mjs`, `companion/browser/locator-probe.mjs`, `LocatorRepair.tsx`; observation-only suggestions/probe, expiring node/document binding, explicit locator-only draft repair |
| 7. Step editor and waits | Implemented for declarative operations | `workflow-steps.mjs`, `workflow-waits.mjs`, both adapters and `WorkflowStepEditor.tsx`; stable IDs, protected reordering, bounded waits, cancel/deadline handling and visible timeout continuation |
| 8. Nested JSON | Implemented with explicit bounds | `input-contract.mjs`, `workflow-input.mjs`, `workflow-contract.mjs`, `output-mappings.mjs`, shared DOM extraction; nested input paths, nullable/null/collection output, coercion and recursive schemas |
| 9. Playground/examples | Implemented for local published workflows | `ApiPlayground.tsx`, `api-examples.ts`; selected revisions, typed forms/JSON, recovery, sanitized exports and executable client snippets |
| 10. Reliability | Implemented for retained local history | `workflow-health.mjs`, `health-routes.mjs`, `WorkflowHealth.tsx`; strict receipts, denominators, percentiles, versions, recent runs and sanitized download |
| 11. Projects | Implemented | `projects.mjs`, `Projects.tsx`; transactional legacy migration, independent assignments, descriptions, search, archive and preserved public APIs |
| 12. Templates | Implemented as a bounded portable subset | `workflow-templates.mjs`, `WorkflowTemplates.tsx`; eight catalog archetypes, neutral import/export, explicit configuration and draft-only instantiation |

“Implemented” applies to the supported acceptance paths and limits described
below. A template does not promise compatibility with an unrelated website.

## Architecture

The owner connects and confirms a browser, authors a working draft, verifies its
inputs/outputs, reviews the exact permissions and publishes an immutable SQLite
revision. Draft changes clear draft evidence without rewriting the active API.
REST and MCP resolve the same publication or explicit historical revision, validate
and normalize input, recover an existing idempotent receipt or admit one durable
run, then dispatch through the same lifecycle and verification rules.

Configured approval policies compile into private execution copies. Decisions are
owner-only, single-use and bound to one pending run checkpoint. Keys can invoke,
read or cancel their own scoped runs; they cannot approve. Restart terminates
interrupted work safely rather than repeating possible website submissions.

Connected Chrome acts only in the paired tab. Managed Chromium uses an isolated
context, encrypted session snapshots, per-profile leases and network guards
installed before going online. Managed replay permits GET/HEAD traffic; this is a
network restriction, not proof that a website action has no side effect.

Result verification checks schema, declared evidence and its run/version/time
association before success. Receipts keep legacy polling status compatible while
adding canonical uncertain/timeout outcomes and safe step identities. Historical
success without adequate correlated evidence is reported as uncertain.

## Executed checks

- Production `npm run build`: TypeScript and Vite passed on the integrated build.
- `npm run test:consumers`: **28 passed**.
- `npm run check:repo`: passed for **220 tracked files**; an additional scan of
  current source/tests/docs including new files found **0 issues across 265 files**
  at the time of that scan.
- Authoring runtime/contracts: **57 passed**, including real managed/connected
  browser observations, nested scalar bindings and deadline behavior.
- Authoring safety subset: **38 passed**; locator DOM/runtime safety: **17 passed**.
- Projects: **3 backend/migration tests**, **1 transaction-fault recovery test**
  and **1 actual Chromium UI test** passed.
- Templates: **4 API/security tests** and **1 actual Chromium UI test** passed;
  unsupported protected-wait export is separately checked after review.
- Playground: **3 generator/JSON tests** and **2 Chromium UI/revision tests** passed.
  Exact generated JavaScript, transpiled TypeScript, Python and cURL executed
  against a controlled local recipient. MCP example JSON was parsed; server tool
  semantics are exercised by revision/MCP integration tests.
- Health: **6 aggregation tests**, **1 owner API test** and **1 Chromium UI test**
  passed, including malformed metadata redaction and downloaded-report consistency.
- UI checks use the actual built dashboard at **375 px and 1440 px**, with keyboard,
  consent, validation, overflow and page-error assertions. Controlled adapter tests
  are labeled accordingly; they do not claim live provider compatibility.
- `npm run test:real-world`: **20 checks passed** on Books to Scrape and Quotes to
  Scrape: 15 successful runs, one expected missing-record failure and four HTTP
  rejection checks. Also covered immutable draft edits, revision 2, rollback,
  idempotency and runtime restart without the original browser. Evidence:
  `validation/results/real-world-2026-10-22T07-31-12-392Z.json` (ignored local file).
- Full `npm test`: **543 tests, 538 passed, 4 failed, 1 skipped**, 1,144,989 ms.
  The failures were three stale fixture expectations plus a counted parent:
  publication without the newly required breaking-change consent, historical
  OpenAPI input limited to scalar values, and dashboard counts treating unproven
  historical success as verified. Corrected those fixtures without weakening
  production safeguards. Combined rerun of the affected files: **10 passed,
  0 failed**, 14,010 ms. No known failing cases remain; the whole 19-minute suite
  was not repeated after these fixture-only corrections. The skipped file-symlink
  lock check requires a Windows privilege unavailable to this account; junction,
  hardlink, process-death and other locking checks passed.
- Final targeted health/template/migration follow-up: **6 passed**. An additional
  health API test verifies metadata normalization and the streamed 10,000-run cap.

The updated production runtime started successfully on `127.0.0.1:4317` after a
private backup outside the checkout. `/health` returned `status: ok`. Read-only
comparison against that backup confirmed all existing connection, workflow,
API-key and immutable-revision rows remained byte-for-byte unchanged after startup.

Windows sandbox restrictions blocked some browser launches and Vite filesystem
access. The same commands ran with normal approved host access. Those initial
environmental failures are not passing checks. Baseline fixture failures and
subsequent repairs remain recorded in the implementation log.

## Security and migration

New authority remains behind existing loopback, owner session, origin and CSRF
checks. Consumer paths retain workflow/key scoping. No secrets are copied into
approval/permission previews or shareable examples. Health/reporting allowlists
metadata and excludes raw website data. Locator repair rechecks saved hash,
connection binding, ticket expiry and document/node identity before saving.
It neither executes an action nor changes immutable history.

Project migration adds `project_metadata` and `workflow_projects` plus indexes in
one transaction. Missing workflow assignments inherit their connection's project.
Descriptions stay encrypted. A real SQLite fault-injection test verifies rollback,
retry and unchanged legacy ciphertext/IDs; it does not claim process-kill testing.
Profile settings and session-generation bindings are additive encrypted fields.
Reset explicitly invalidates dependent evidence/keys; ordinary upgrades and
organizational moves preserve keys, workflow identifiers and routes.

Back up the entire stopped runtime data directory and matching encryption-key
context before upgrade. Preserve SQLite journal files. Use the same port/data/key
context on restart. See [backup and recovery](../installation.md#back-up-and-upgrade).
No automatic downgrade or key substitution is supported.

## Limits

- Full persistent Chromium user-data directories would persist readable website
  storage/cache and are not enabled. Persistent encrypted logical sessions are
  supported; full disk-profile behavior must not be inferred.
- Managed non-GET/HEAD traffic and WebSockets remain blocked. Workflows requiring
  those capabilities need an explicitly authorized connected tab. Authentication,
  CAPTCHA, quotas and provider restrictions are never bypassed.
- Connected framed targets, closed shadow trees, cross-tab browsing and network
  response observation are unsupported. Locator evidence cannot prove business
  meaning; owners must review the actual website before consent.
- Template export is structural, with scalar inputs and nested output shapes.
  Unsupported bindings or gate timing reject export. Pagination is finite Load
  more, not an arbitrary loop or aggregate across replaced pages.
- Shared examples omit constraint literals and use synthetic values; users must
  review the recipient's contract. Localhost sharing does not expose a runtime.
- Reliability uses retained records, reports missing history and small samples,
  and does not establish statistical reliability or independent certification.
- Local hostile processes with the same OS privileges, abrupt power loss, all
  operating systems and remote Node 24 CI were not exhaustively verified.
