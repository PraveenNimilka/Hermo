# 001: Keep orchestration in the local runtime

Status: accepted.

## Context

Hermo already has a local Fastify runtime, SQLite persistence, a bounded global
queue and two browser adapters. Website actions can produce effects before an
acknowledgement arrives. Restarting a process or retrying a Promise cannot prove
whether those effects occurred.

## Decision

Keep the existing serialized queue and SQLite store. Strengthen state changes
with conditional updates and bounded durable observations in the current run
model. Preserve accepted snapshots, admission idempotency, per-step observations,
approval deadlines and explicit interruption outcomes. Do not recover uncertain
mutations by replaying them.

The selected-tab adapter continues to use the companion's `activeTab` and
`scripting` access. The managed adapter continues to use local Playwright under
its retrieval network policy. Neither is replaced by a cloud browser or an
nondeterministic action planner. Disposable test harnesses may use CDP; production selected-tab
execution does not require that attachment or permission.

## Alternatives and consequences

| Option | Assessment |
| --- | --- |
| Temporal | Its history/replay model is useful design guidance, but a service and worker architecture are unnecessary for the current single-machine queue. |
| In-process Promise queue | Can limit concurrency but does not replace persisted run ownership, state transitions or recovery policy. No additional queue library is needed. |
| BullMQ | Adds another queue backend and operational lifecycle without a current distributed-worker requirement. |
| Puppeteer | A local deterministic browser alternative, but adding another driver does not improve the existing adapter boundary by itself. |
| Stagehand or browser-use | Local browser support is available, but model-driven action discovery is outside the deterministic execution requirement. |

Serialization favors clear ownership and predictable mutation order over
parallel throughput. An approval wait blocks other connections as well. SQLite
transactions can make local transitions atomic; they cannot atomically commit a
website action. State and journal changes must preserve existing REST/MCP status
and result contracts.

## Primary references

- [SQLite transactions](https://sqlite.org/lang_transaction.html)
- [Temporal execution and replay](https://docs.temporal.io/workflow-execution)
- [BullMQ](https://docs.bullmq.io/)
- [Playwright CDP limitations](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)
- [Puppeteer connection API](https://pptr.dev/api/puppeteer.puppeteernode.connect)
- [Stagehand local browser configuration](https://docs.stagehand.dev/v3/configuration/browser)
- [browser-use source and execution model](https://github.com/browser-use/browser-use)
