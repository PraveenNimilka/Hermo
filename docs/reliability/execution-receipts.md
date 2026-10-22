# Execution states and receipts

Existing run endpoints retain their `status` values so polling clients continue
to stop correctly. The additive `execution_status` and persisted `phase`
distinguish `preparing`, `awaiting_approval`, `uncertain` and `timed_out`.
In the legacy field, preparation/approval are `running`, and uncertain/timeouts
are terminal `failed`. An explicit cancellation remains `cancelled`; its error
can still report an unknown website outcome. Never retry based on status alone.

The complete canonical states are `queued`, `preparing`, `running`,
`awaiting_approval`, `verifying`, `succeeded`, `failed`, `uncertain`, `cancelled`
and `timed_out`. Unknown submissions are not counted as verified success.
There is no automatic replay of uncertain actions.

Use `GET /v1/runs/{run_id}/receipt` with the same scoped API key, or MCP
`get_execution_receipt` with `{ "run_id": "..." }`, for the versioned
`hermo.execution.v1` envelope. Owner tooling can read
`GET /studio/runs/{run_id}/receipt` under normal session authorization.

Receipts include execution/workflow IDs, pinned published version and revision,
canonical status, browser mode, queue/execution/total timing, verification
summary, step outcomes and diagnostic codes. They omit request inputs, selectors
and arbitrary error messages. Output is included only for evidence-backed success.

New successful executions require observation after completed steps, verification
after observation, and finalization after verification, in addition to adapter
freshness/settling and schema checks. The runtime owns execution/version
association. Timestamps alone do not prove that a business operation committed;
authors must configure meaningful completion, freshness and context checks.

Historical terminal records are not rewritten. If a historical receipt lacks
execution-bound, version-matching, temporally consistent evidence and completed
step timestamps, its new receipt says `uncertain`, verification `unrecorded`,
and omits output. The legacy run endpoint continues to show its recorded data.

Five minutes is a maximum configurable execution budget, never a mandatory
verification delay. Adapters return once the selected output is ready and settled.
Approvals consume the same total budget. Cancellation cannot undo website changes.

No database schema or encryption-key migration is required for this addition.
New phases live in the existing encrypted payload. Existing IDs, key hashes,
publication snapshots and legacy response contracts are preserved.
