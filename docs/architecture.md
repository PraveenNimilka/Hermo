# Architecture

Hermo has one independent local Node.js runtime. The React dashboard controls
it; the dashboard does not execute or keep published workflows alive.

| Component | Location | Responsibility |
| --- | --- | --- |
| Dashboard | `src/` | Projects, connections, recording, draft editing, testing, documentation and run inspection. |
| Runtime | `server/index.mjs` | Fastify routes, owner and consumer authentication, loopback binding and process startup. |
| Persistence | `server/store.mjs` | SQLite configuration, encrypted payloads, workflow revisions, keys, jobs and history. |
| Workflow engine | `server/index.mjs`, `server/run-state.mjs`, `server/workflow-steps.mjs`, contract modules | Admission, scheduling, validation, step execution and outcome verification. |
| Selected-tab adapter | `server/connected-browser.mjs`, `companion/browser/` | Explicitly authorized commands against the paired Chrome tab. |
| Isolated adapter | `server/browser.mjs`, `server/network.mjs` | Local Playwright retrieval with restricted network access. |
| Integration contracts | `server/api-spec.mjs`, `server/mcp.mjs` | Generated OpenAPI and scoped MCP tools using the same execution path. |

## Request lifecycle

1. A consumer presents an action-scoped key and an idempotency key.
2. The runtime validates the published contract, inputs and execution authority.
3. It persists a run and its accepted immutable revision, then returns HTTP 202.
4. The serialized durable queue admits work without concurrent tab mutation.
5. The selected adapter performs bounded, permitted workflow steps.
6. Output extraction, freshness and success checks verify the observed result.
7. The consumer polls the run for a verified result or explicit failure.

REST and MCP share permissions and verification. Neither accepts arbitrary
JavaScript or unrestricted browser commands through a consumer key. A successful
click alone does not make a workflow successful. An uncertain submission is
reported without automatically repeating it.

## Drafts and publications

Draft editing invalidates test evidence. Publication requires a successful test
of that definition and execution target. Published revisions are immutable;
editing a draft does not change the active API. Accepted runs keep their snapshot
when the owner publishes or rolls back a newer revision. `/versions/1/` is the
REST compatibility path, separate from the publication revision number.

## Browser lifecycle

Selected-tab execution uses the existing Chrome session without importing its
cookies. Authority is tied to a paired tab, permitted website and owner lease.
The companion uses Manifest V3 session recovery; it does not assume a permanently
running service worker. Restart or expired authority requires explicit pairing.
Interrupted mutations are not resumed automatically.

Isolated execution uses a dedicated local browser and separately saved session.
Its policy permits GET/HEAD retrieval, not arbitrary website mutations. There is
no automatic fallback from a missing tab into another account or browser mode.

Closing the dashboard or companion popup leaves the runtime running. Closing
the paired website tab makes that adapter unavailable. Stopping the runtime
stops APIs. On restart, interrupted active jobs fail explicitly; queued jobs
must pass current authorization and publication checks before resuming.

## Boundaries

There are no cloud workers, remote credential synchronization or public hosting
services. Projects organize one local owner's resources; they are not separate
tenants. The server binds to loopback and applies owner/consumer authentication
and origin restrictions. Local encryption and key hashing are not a substitute
for device security or an independent security review.

See [Security](../SECURITY.md) for the detailed threat model and the
[user guide](user-guide.md) for operational behavior.
