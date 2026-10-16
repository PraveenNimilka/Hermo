# Hermo next release: implementation and verification

Date: 15 October 2026. Product status: **early access**.

## Implementation

The existing React/Fastify/SQLite application and both browser adapters are retained.
The dashboard is a control interface; the Node process owns the durable queue and
executes REST and MCP requests independently of an open dashboard.

Published definitions now live in encrypted immutable revisions with an active
publication pointer. A working draft can be edited, tested, restored from history
and published without changing the live API. Rollback changes only the active
pointer. Accepted runs retain the exact definition, revision and nonsecret target
configuration used at admission. Current authorization and revocation are checked
again before execution. The original endpoint URLs, workflow IDs and scoped keys
remain compatible.

The draft editor provides an ordered timeline, add/duplicate/delete/reorder,
enable/disable, semantic locator candidates, explicit element/text/URL waits,
bounded timeouts, input usage, typed inputs, recursive output mappings and success
checks. Ambiguity fails before mutation. Managed replay waits for hydrated frames
and actionable controls instead of failing immediately on their first absence.

Nested objects and lists share one contract across the DOM extractor, conversion,
verification, REST, OpenAPI and scoped MCP `get_contract`. Required/optional and
nullable fields are explicit. Collection/depth/text limits fail rather than
truncate results. DOM identities improve freshness evidence for newly created
nodes containing identical text; identities are private execution observations.
New search and submission recordings require fresh or input-correlated evidence.
If a submission may have happened but fresh completion cannot be observed, the
run reports `EXECUTION_OUTCOME_UNKNOWN` and is not automatically retried.

Execution targets are explicitly selected from separately authorized compatible
connections on the same origin and project. Selecting a target does not transfer
cookies or authenticate a managed browser. Dedicated managed sessions persist
encrypted state, including verified session rotation, across supported restarts.
Managed Chromium starts lazily, recovers disconnected processes and shuts down
when idle. Existing GET/HEAD and egress restrictions remain enforced. Connected
Chrome retains its selected-tab permissions and MV3 recovery behavior.

Projects group connections and their workflows, keys, runs and documentation.
The project picker and management dialog support creation, rename, switching and
typed deletion of empty projects. Connection moves move their workflow group;
execution-target dependencies cannot be split across projects.

The API playground calls the actual consumer API with a pasted scoped key held
only in memory. It discovers the published schema, validates inputs, submits with
a revision guard and idempotency key, polls status, displays verified JSON,
links run details and supports cancellation. Recovery preserves the original
input/receipt; stopping polling does not cancel an accepted run.

## Persistence and compatibility

- Additive SQLite tables: revisions, publication pointers, draft markers, accepted
  run snapshots, test evidence, projects, connection membership and target references.
- Existing published/paused rows are snapshotted transactionally. Older historical
  runs retain their original provenance; missing revision evidence is not invented.
- Encrypted credentials remain on the current connection and outside revision
  metadata, comparisons, generated schemas, run diagnostics and consumer responses.
- Database foreign keys retain referenced execution targets. Deletion still uses
  typed intent and active-run guards; deleting a workflow removes its references.
- The existing single-runtime database lock remains authoritative. No second
  worker process or cloud session store is introduced.
- Tests use disposable `work/` databases. The real `.hermo` workspace was never
  reset, unlocked or used as a test fixture. A consistent encrypted SQLite backup
  was created before live migration; activation results are recorded below.

## Verification record

Baseline: `npm.cmd test` passed **170/170** before this milestone
(`work/next-baseline-approved-tests.log`).

The first expanded regression run exposed real frame readiness and landscape
layout failures, a wizard freshness-check interaction, two changed internal
observation/error expectations and a fixture shutdown race. These were investigated
and corrected; the initial failing log is retained at `work/next-release-tests.log`.
Tests were not disabled or broadened to accept false success. The updated stale
submission assertion requires an uncertain outcome, the original cause and
`retry_safe: false`; the observation test checks stable/new DOM identities.

- `npm.cmd test`: **216 passed, 0 failed, 0 cancelled, 0 skipped**, 625.9 seconds.
  Full evidence: `work/next-release-final-tests.log`.
- `npm.cmd run build`: TypeScript and Vite production build passed. Final entry:
  `index-bpf0Bjys.js`; neutral shared stylesheet: `index-j5zddeZ6.css`.
  Build evidence: `work/next-release-final-build.log`.
- Focused regression repair run: **28/28** passed, including actual Chrome,
  fresh-result failures, publication and consumer-key playground execution
  (`work/next-release-regression-fixes.log`). Execution-target security checks
  passed again (`work/next-release-target-security.log`). All are included in
  the final full regression above.
- Final UI-only dependency guidance was corrected after the full run: the owner
  overview and test dialog now distinguish the connected-tab lease from managed
  session execution. The final build and responsive browser follow-up cover it:
  `node --test --test-concurrency=1 tests/next-release-ui.test.mjs tests/runtime-ui.test.mjs tests/universal-ui.test.mjs`
  passed **9/9**, with no failures, skips or cancellations (30.8 seconds).
  Evidence: `work/next-release-final-ui-tests.log`.

Live public verification: `npm.cmd run test:public` passed against **Books to
Scrape** and **Quotes to Scrape**. Each generated API verified two distinct inputs;
missing records failed without a successful result. Also checked anonymous replay,
encrypted keys, traversal rejection, cross-workflow scope, run isolation,
revocation and OpenAPI path constraints. Evidence:
`work/next-release-public-tests.log` and `PUBLIC-INTEGRATION-VALIDATION.json`.
These are permitted public practice websites, not private provider accounts.

The browser suites exercise actual Chrome, including MV3 worker restart,
dashboard closure, recording, publication, REST/MCP, disconnection and Stop.
Transport fixtures are separately labeled; they do not stand in for live extension
or private website certification. UI validation covers desktop, tablet, phone and
landscape layouts, accessible names, neutral colors, focus and overflow. New editor,
revision and playground screenshots are saved under `work/next-release-ui/`.
The final-build screenshots are in `work/next-release-ui/adb52ad797de/`, covering
1440, 768 and 375 pixel widths. They were visually inspected alongside the
automatic overflow, keyboard-focus, accessible-name and monochrome checks.

## Live workspace activation

Started the verified build as an independent hidden Node process at
**http://127.0.0.1:4318**. No existing listener or website tab was replaced.
The original `.hermo` database was backed up consistently, including committed
WAL contents, to `.hermo/before-next-release-20261015T154359106.sqlite` while
holding its existing runtime ownership lock. No password was requested or used.

Post-migration verification preserves **3 connections, 3 workflows, 11 API keys,
36 runs and 1 saved browser**. SHA-256 comparisons confirm unchanged resource IDs,
API key hashes/scopes/expiry/revocation, encrypted workflow definitions and DPAPI
key context. SQLite integrity and foreign-key checks passed. Three existing
publications now have immutable revision records; historical runs were not
assigned invented revision snapshots. The Personal workspace groups existing data.

Health, dashboard, companion guide and both consumer apps return HTTP 200 and
serve `index-bpf0Bjys.js`. The owner overview returns HTTP 401 without authentication.
Evidence: `work/next-release-live-runtime-validation.json` and
`work/next-release-runtime.stdout.log`. Actual private website replay remains
unverified; startup does not unlock the owner workspace or reconnect Chrome.

## Remaining boundaries and release work

- **Early access, not universal production certification.** Live authenticated
  Google/Gemini/ChatGPT/Claude sign-in has not been tested with user credentials.
  CAPTCHA, MFA, provider restrictions and unsupported UI technologies remain real.
- Managed mode supports authorized retrievals only. Website submissions/generation
  need Connected Chrome. It does not inherit personal Chrome cookies, run on a
  powered-off computer or continue after the Node runtime stops.
- Connected Chrome grants retain the existing owner-unlock lease. Lock, expiry,
  browser restart or loss of permission can require unlock and pairing again.
  Lock protects the owner interface and companion authority. Managed APIs remain
  authorized by scoped keys; Stop, pause or revoke explicitly to block those calls.
- The queue remains globally serialized. No distributed or parallel browser worker
  infrastructure, cloud execution or automatic non-idempotent retries are shipped.
- Existing legacy recordings remain compatible; they are not silently rewritten
  to add stronger freshness assertions. Review their success conditions explicitly.
  DOM replacement is evidence of new observation, not proof of external business
  completion; choose request correlation and confirmation checks for that purpose.
- The editor supports the documented operation/locator subset, not arbitrary
  scripts, cross-origin frame execution in the companion, or a general node canvas.
  Managed frames retain their existing scoped support.
- Project moves operate on a connection and its workflows together. Individual
  workflow reassignment across shared connection groups is not exposed.
- Mapping attributes are the supported text/link/media attributes, not arbitrary
  browser data. Formatted numbers require an explicit numeric source or text output.
- Full sensitive-value classification/redaction, independent security review,
  adversarial auth/egress fuzzing, broad website benchmarks, installer/service
  packaging, optional OS login startup and backup/recovery drills remain release work.
  Encryption at rest does not make saved test inputs or outputs safe to share.
- No skill installations were needed during this continuation. The existing local
  design/accessibility guidance was retained and the surgical optimizer workflow
  was used to preserve working interfaces and existing worktree changes.

## Running the update

The updated runtime is already running on port **4318** with the same `.hermo`
data directory. For future updates: `npm.cmd run build`, then restart the single
existing runtime with its same `HERMO_PORT` and `HERMO_DATA_DIR`; do not launch a
second process on the same store. This continuation did not close signed-in tabs.
Reload the unpacked companion **0.6.0** in `chrome://extensions`, unlock Hermo and
reconnect the intended website tab to use new waits and structured extraction.
Compatible scalar workflows negotiate their existing capabilities; unsupported
commands fail with `COMPANION_UPDATE_REQUIRED` instead of being ignored.

Use **Version history → Open draft**, **Test action → Edit workflow steps and
extraction**, verify, then **Publish draft revision**. API docs always reflects
the active publication. Keep the original idempotency key when recovering a lost
receipt and inspect the website before retrying an uncertain outcome.
