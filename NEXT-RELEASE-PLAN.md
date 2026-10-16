# Hermo next release implementation record

Request date: 15 October 2026. Status: implemented milestone; early access.

## Baseline and dependency map

The React dashboard controls owner-authenticated `/studio` routes. REST and MCP
share admission, the durable SQLite queue, the scheduler, browser adapters and
output verification. The independent Node process owns SQLite exclusively.
The companion controls one explicitly paired Chrome tab. The existing isolated
Playwright adapter launches lazily and replays retrieval-only HTTP requests in
per-execution browser contexts, restoring encrypted per-connection storage state.
It is already independent of the original tab; it is not a general mutation runtime.

Existing worktree changes are preserved. Tests use separate `work/` directories;
the real `.hermo` workspace must not be reset, unlocked or used as a test fixture.

Baseline commands: `npm.cmd test` and `npm.cmd run build`. Restricted-sandbox
Vite realpath and Chrome launch failures are environmental; approved reruns and
their actual results are recorded below when complete.

## Incremental implementation order

1. Immutable encrypted revisions, active publication pointers, safe legacy
   migration, isolated drafts, history/restore/rollback, revision-pinned admission.
2. Verify popup closure/worker recovery, extend the existing local browser with
   explicit mode capabilities and session/lifecycle controls. No Chrome cookie import.
3. Draft-only ordered editor, supported waits, safe locators, repair and retesting.
4. Fresh observation and request-specific completion evidence, uncertain outcomes.
5. Structured extraction and contract-derived schemas.
6. Real authenticated API playground and lightweight projects.
7. Complete regression, browser, security, responsive UI and documentation checks.

## Revision change impact record

Targets: workflow resolution/admission, publication, MCP schema discovery,
OpenAPI/contract discovery, queue dispatch, owner draft routes and revision UI.
Consumers: existing `/v1/actions/:slug/versions/1/runs`, consumer keys, owner
verification, saved workflow definitions, run polling, example clients and tests.

Compatibility: keep workflow table layout/IDs, keys and old endpoint identity;
add revision/publication tables without rewriting historical run payloads. Existing
published definitions are snapshotted transactionally. New accepted executions
record exact content hash, revision and frozen nonsecret execution configuration.
An edited draft cannot change a published schema or queued consumer execution.
Legacy historical runs retain their original provenance without inferred revisions.

Security: owner session/CSRF and optimistic concurrency required for draft and
rollback operations; publication requires verified draft hash; no stored cookie or
secret copied into revision metadata or public responses. Current authorization
and revocation remain mandatory at execution. No fallback browser or origin.

Verification: storage migration/restart/immutability tests, REST/MCP revision
pinning and rollback tests, existing full suite, production build and desktop/mobile
history/restore UI checks. Changes are additive; no destructive data rollback.

## Actual results

The milestone implements immutable revisions and pinned admission, draft-only
ordered editing, semantic targeting and waits, managed session/lifecycle and
explicit execution targets, fresh/uncertain outcomes, recursive typed outputs,
lightweight projects and the real scoped-key playground.

`npm.cmd test`: **216 passed, 0 failed, 0 cancelled, 0 skipped**. TypeScript/Vite
production build and live generated APIs for Books to Scrape and Quotes to Scrape
passed. Real Chrome tests cover MV3 recovery, popup/dashboard closure, REST/MCP,
editing/publication, authentication failures and responsive layouts.

Full implementation, persistence details, evidence paths, activation instructions
and unfinished release work: [NEXT-RELEASE-VALIDATION.md](NEXT-RELEASE-VALIDATION.md).
Managed execution remains retrieval-only; connected-tab submissions retain their
permissions and availability requirements. This is not universal production
certification. Independent workflow moves, full sensitive-input classification,
installer/startup packaging and broader security/recovery exercises remain open.
