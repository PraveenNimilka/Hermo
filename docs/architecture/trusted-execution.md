# Trusted execution

Hermo turns an owner-tested website workflow into a local REST action and MCP
tool. Its execution boundary is the local runtime: consumers request a published
action, while the runtime checks authority, performs recorded steps and verifies
the result. Closing the dashboard does not stop accepted work.

## Components and authority

| Component | Responsibility |
| --- | --- |
| Fastify runtime | Authenticate owners and consumer keys, validate contracts, admit runs and enforce execution policy. |
| SQLite store | Persist encrypted run payloads, accepted snapshots, immutable publications and audit observations. |
| Global serialized queue | Execute one run at a time across connections, with a bounded admission queue. |
| Selected Chrome tab | Replay permitted actions through the explicitly paired Manifest V3 companion. |
| Managed local browser | Run Playwright retrieval in an isolated connection under the existing network policy. |
| REST and MCP | Present the same admission, ownership, cancellation and verified-result behavior. |

The selected-tab companion uses `activeTab` and `scripting` for website access.
It has no production `debugger` permission and does not attach a CDP browser
driver. It uses the selected website's existing session without copying cookies.
CDP attachment in disposable test harnesses is separate from this product path.

The managed browser is an active runtime, not a proposed replacement. Its network
policy permits GET/HEAD retrieval and blocks other methods and WebSockets. DOM
interaction does not broaden that policy; a website can still attach side effects
to a GET request. There is no automatic fallback between the selected tab and a
managed connection or between accounts.

## Run lifecycle

1. Validate the action-scoped consumer key, published workflow, bounded inputs,
   execution configuration and admission idempotency key.
2. Persist the accepted run and frozen workflow/connection snapshot together;
   return a run ID for polling.
3. Dispatch through the global queue and check current authority against that
   snapshot. Later draft edits or publication changes do not rewrite it.
4. Execute supported, bounded steps. Repeat permission and target checks at
   execution boundaries, including after an approval wait.
5. Extract and normalize declared output fields, then apply freshness, settling
   and configured verification checks.
6. Publish a result only after success. Otherwise retain a typed failure or an
   explicitly uncertain outcome.

Runs use `queued`, `running`, `verifying`, `succeeded`, `failed` and `cancelled`.
An owner checkpoint remains a `running` run with phase `awaiting_approval`, so
existing polling clients continue to work. The approval wait holds the global
queue and counts against the original execution budget.

Authority already has concrete bindings: run ID, step index, accepted snapshot,
the companion's one-use command ID and deadline, and a one-use approval UUID.
Owner routes require authentication and CSRF protection; a consumer key cannot
approve its own work. These bindings remain the basis for enforcement rather
than introducing a second token or capability system.

## Interruption and uncertainty

Cancellation revokes authority for pending work; it cannot undo a website change.
A dispatched companion command may outlive its caller. Its bounded tombstone
holds the tab until acknowledgement or the original deadline, rejects mutation
reauthorization, and discards a late reply. An unacknowledged mutation is not
automatically repeated.

On runtime restart, interrupted `running` and `verifying` runs fail explicitly.
Persisted queued work must pass current checks before it executes. Approval
authority and a partially executed mutation are not silently reconstructed.
Admission idempotency prevents duplicate acceptance; it is not a claim of
exactly-once effects at an external website.

Manifest V3 workers can stop unexpectedly and lose globals. The companion uses
its existing session recovery and reconciles the server's bounded commands;
pairing, owner leases and command expiry still constrain execution. See the
[Chrome lifecycle documentation](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

## Output and observation boundaries

Website content is data, including text that resembles instructions. Output
mapping accepts a restricted declarative format, not executable scripts or
arbitrary schemas. Shared normalization provides the same declared types through
REST and MCP. Progress observations describe operations, timing and outcomes;
they do not require copying browser text, selectors or field values into the
execution journal.

Freshness and settling checks establish observed evidence, not universal proof
of a website's business outcome. Missing acknowledgement after a possible
submission remains uncertain even if a button click succeeded.

## Guarded transitions and verification

The run-state module enforces legal transitions and ordered step observations.
Conditional SQLite updates refuse terminal overwrites. Success requires the
verifying phase, completed/skipped steps, valid timestamped evidence for the
accepted version and strict validation of the converted result. Adapter output
cannot overwrite runtime-owned provenance. Existing status codes stay compatible;
additive diagnostic details identify nested output failures.

Output mappings support typed constraints, row checks, uniqueness and typed
cross-field comparisons. An optional explicit completion marker permits an
identical result only when its configured marker value changes after the final
action and remains stable across extraction. It does not replace fresh asset
requirements for generated media or prove arbitrary website business outcomes.

See [output verification](../reliability/output-verification.md),
[permissions](../security/workflow-permissions.md),
[human approval](../security/human-approval.md) and
[verification evidence](../testing/verification-report.md).

## Decisions

- [Local orchestration](decisions/001-local-orchestration.md)
- [Output contracts](decisions/002-output-contracts.md)
- [Policy integration](decisions/003-policy-integration.md)

See the [architecture overview](../architecture.md) and
[security model](../../SECURITY.md) for the surrounding product boundaries.
