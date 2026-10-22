# 003: Enforce policy in the existing execution boundary

Status: accepted. No external policy integration is enabled by this decision.

## Context

Hermo must apply the same authority to REST, MCP and browser execution. Its
existing run IDs, step indices, accepted snapshots, one-use companion command
IDs with deadlines, and approval UUIDs already scope execution. Another token
framework or policy daemon would introduce a second lifecycle to reconcile.

## Decision

Keep policy enforcement in the existing local runtime and adapters. Recheck
consumer status, workflow permissions, accepted execution configuration, target
scope, cancellation and deadline at the relevant boundaries. Approval permits
the particular pending step; it does not override changed permissions or extend
the run budget. Unknown or unsupported operations remain rejected.

Do not add OPA, HOL Guard, cloud services or model inference in this phase.
External integration can be reconsidered when it addresses a demonstrated gap
and has a bounded, tested contract. A future external verdict must not bypass
Hermo's ownership, target, deadline or result checks.

## HOL Guard assessment

HOL Guard is a Python product with harness hooks, launch wrappers, a local daemon
and its own SQLite persistence. Its source contains a managed MCP proxy that
interposes on tool calls. That proxy is separate from its read-only
`guard-mcp.v1` evidence server, which exposes `search`, `fetch` and
`get_guard_status`. The evidence server is not a generic action-authorization
endpoint, and direct REST or companion commands are not automatically guarded
by the managed MCP proxy.

The available source demonstrates useful MCP inspection and evidence features,
but integrating its Python runtime, daemon, storage and approval lifecycle is
not justified for Hermo's current local execution requirements. Its portable
GuardPolicy contract is explicitly `v1alpha1`, suitable for interoperability
testing rather than a stability claim.

Research observed PyPI stable release 3.49.0 dated October 17, 2026, and
prerelease 3.50.0a5 dated October 18. Retrieved `main` source metadata was a
cached 3.42.0 snapshot. This assessment is not an audit of an installed version
or a claim that the inspected source matches the current published artifact.
Any future integration must pin and inspect its chosen release first.

## MCP boundary

The current MCP specification separates HTTP authorization from stdio credential
handling and treats tool annotations as untrusted unless the server is trusted.
Hermo's scoped consumer-key checks remain its local application boundary; this
ADR does not claim that those keys implement a general OAuth provider. Do not
forward a caller's token to an unrelated downstream service. Keep browser data
and tool results separate from authority decisions.

The installed SDK's latest supported protocol is `2025-11-25`; acceptance uses
its actual negotiation and Streamable HTTP transport. The newer specification
linked below informed research, not a claim that this runtime implements every
capability in that revision. No protocol version was silently upgraded.

## Primary references

- [OPA integration choices](https://www.openpolicyagent.org/docs/integration)
- [HOL Guard metadata](https://github.com/hashgraph-online/hol-guard/blob/main/pyproject.toml)
- [HOL Guard architecture](https://github.com/hashgraph-online/hol-guard/blob/main/docs/guard/architecture.md)
- [HOL evidence MCP server source](https://github.com/hashgraph-online/hol-guard)
- [HOL managed MCP proxy source](https://github.com/hashgraph-online/hol-guard)
- [GuardPolicy alpha contract](https://github.com/hashgraph-online/hol-guard/blob/main/spec/guard-policy/v1alpha1/README.md)
- [Published HOL Guard releases](https://pypi.org/project/hol-guard/)
- [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [MCP security practices](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices)
