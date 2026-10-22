# Human approval

In the workflow editor, enable **Pause for owner approval** on an individual
navigate, fill, select, check or click step. Read and wait steps can run earlier.
Approval is optional and is not inferred from a button's label.

The editor also supports a workflow approval policy: keep only explicit step
gates, select step numbers, match configured operation/risk rules, or require
approval for every invocation. Risk is author-declared; page text cannot grant
or suppress approval. Explicit step gates remain required under every policy.
Changing an ordered list under a selected-step policy requires reviewing the
step references again before saving.

Every-invocation policy gates the first enabled step. An output-only workflow
instead pauses before any browser page access with `scope: "invocation"` and
`step: 0`. This is an invocation checkpoint, not an executable browser step.
Approval policies are stored in immutable published revisions; calling an older
revision uses its original policy. Pause the action or revoke the key if that
older authority must no longer be usable.

When the checkpoint is reached, the runtime persists a fresh approval UUID and
pauses before issuing the selected action. Public run status remains `running`,
with `phase: "awaiting_approval"`. Waiting holds the local execution queue and
counts against the run's original timeout. The dashboard can close, but the
runtime must stay running.

## Review and decide

The owner execution inspector displays workflow name/version, run ID, website
origin, operation, recorded role/name when available, input binding, risk class
and expiry. Proposed values are redacted; inspect the live website for the
actual changes. Earlier steps may already have changed website data.

The **Approvals** page collects pending decisions and retained history across
projects. Refresh it to load current requests. Owner-only `GET /studio/approvals`
accepts `view=pending|history`, a bounded `limit`, and the returned opaque `cursor`.
Expiry shown by a read does not itself fabricate a durable decision. The runner
settles expired requests; cancelled and terminal runs cannot be resumed by a late
decision. Consumer keys cannot list this inbox.

Only the authenticated owner can decide, using the owner session and CSRF token:

```http
POST /studio/runs/RUN_ID/approval
Content-Type: application/json
X-Hermo-CSRF: OWNER_CSRF_TOKEN
Cookie: OWNER_SESSION_COOKIE

{"approval_id":"CURRENT_APPROVAL_UUID","decision":"approve"}
```

Use `"reject"` to stop the action. A consumer API key cannot call this owner
route. Never embed owner cookies or CSRF tokens in consumer applications.

The UUID is bound in runtime memory to one run, step, deadline and accepted
context. Decisions are one-use. Expired, cancelled, rejected, replaced or
cross-run approvals cannot authorize execution. Authority and the live target
are rechecked after approval; a surviving CSS selector does not override a
changed recorded role/name. A website can still alter the business meaning of a
control without changing those observable attributes.

## Consumer behavior

REST and MCP return an asynchronous receipt. Poll `/v1/runs/RUN_ID` or MCP
`get_run`; render pending approval and keep waiting. No approval capability is
added to consumer keys. The example `approval-console` application demonstrates
this separation. The owner makes the decision in Hermo.

`approval` contains the latest checkpoint. `approval_history` retains up to 32
checkpoint records with safe context, request/decision timestamps, actor and
wait duration. The supported workflow limit is 32 steps. Sensitive input values,
selectors, cookies and browser transport credentials are excluded from this
history. Context labels themselves are workflow configuration, so avoid putting
secrets in workflow names or recorded accessible names.

## Failure and recovery

- Rejection stops before the protected action and returns `APPROVAL_REJECTED`.
- Expiry keeps the existing timeout code and adds `detail_code: APPROVAL_EXPIRED`.
- Cancellation or revocation invalidates the pending checkpoint.
- Runtime restart fails interrupted work; it does not recreate approval or
  replay a possibly completed mutation.
- If an earlier action may have submitted data, failure can be reported as
  `EXECUTION_OUTCOME_UNKNOWN`. Inspect the website before retrying.

Approval permits a recorded action. It does not prove that the website completed
the requested business operation; output verification must still pass.
