# Published contracts and explicit revision invocation

Hermo keeps one editable workflow definition and immutable published snapshots.
Each publication records its input/output contract, steps, verification and
approval configuration, and browser authority. Editing a draft does not rewrite
these snapshots. The active publication pointer selects the default for new
requests; rollback changes that pointer. Accepted runs keep their selected
snapshot, including through a later publication or rollback.

Three identifiers have different meanings:

| Identifier | Meaning |
| --- | --- |
| `/versions/1/` in the existing REST URL | The existing API route version; it follows the active workflow publication. |
| Numeric `revision`, such as `2` | One saved immutable publication of this workflow. |
| `version` string | The saved definition identifier, also used to detect stale draft edits. |

## Scoped consumer REST routes

All routes below require the same workflow-scoped Bearer key. A key does not
authorize another workflow, choose another browser connection, or approve a
protected action.

| Route | Behavior |
| --- | --- |
| `GET /v1/action-revisions` | Returns `{active_revision,revisions}`. Each item contains `revision`, `version`, `created_at`, `execution_mode`, and `active`. |
| `GET /v1/action-contract` | Returns the active publication's contract. |
| `GET /v1/action-contract?revision=2` | Returns that immutable publication's schemas and effective approval requirements without changing the active pointer. |
| `POST /v1/actions/:slug/versions/1/runs` | Admits a new run against the active publication. Optional `expected_revision` guards new admission against an active-publication change. |
| `POST /v1/actions/:slug/revisions/:revision/runs` | Admits a run against the explicitly selected publication. Its body is exactly `{input}`. |
| `GET /v1/runs/:run_id` | Reads a run owned by this key, including its pinned `workflow_revision` and `workflow_version`. |
| `GET /v1/runs/:run_id/receipt` | Reads the versioned execution receipt, including canonical outcome and verification metadata. |

Both admission routes require `Idempotency-Key` and return HTTP 202 with
`{run_id,status_url,reused}`. Poll the returned URL with the same key. Acceptance
does not mean the website action has succeeded. Approval gates, cancellation,
verification, and uncertain-outcome handling use the ordinary execution engine.

Fetch the selected contract before constructing historical input: its defaults,
accepted fields, and result schema may differ from the active publication. The
generated OpenAPI document describes the active schema; its generic historical
route explicitly directs clients to the selected contract's schema.

Illustrative Unix-shell request, after configuring and publishing your own
workflow and key:

```sh
curl 'http://127.0.0.1:4317/v1/action-contract?revision=2' \
  -H 'Authorization: Bearer YOUR_HERMO_KEY'

curl -X POST 'http://127.0.0.1:4317/v1/actions/catalog.lookup/revisions/2/runs' \
  -H 'Authorization: Bearer YOUR_HERMO_KEY' \
  -H 'Idempotency-Key: UNIQUE_ID_FOR_THIS_LOGICAL_REQUEST' \
  -H 'Content-Type: application/json' \
  --data '{"input":{}}'
```

Replace the slug, revision, and input with the selected contract. This example
does not install a workflow or provide a remotely accessible service. A recipient
needs their own runtime and explicitly authorized website connection.

### Recovery and failure boundaries

Retry a lost receipt with the same logical request identifier and the same
input. An explicit revision request cannot reuse an identifier belonging to a
different revision: it returns `IDEMPOTENCY_REVISION_CONFLICT` (409). It does not
silently execute the newer revision. Recovery through the existing active route
still retrieves an already accepted receipt after the active pointer changes.

An unknown revision returns `REVISION_NOT_FOUND` (404). A historical snapshot
without verified publication evidence returns `TEST_REQUIRED` (409). The
revision list is metadata, not a promise that every historical entry is callable.
Paused workflows, expired/revoked keys, and invalidated browser authority still
block invocation. The selected historical connection scope cannot gain origins
that were authorized only after its publication. If its required authority was
revoked, restore the snapshot into a draft, review, retest, and publish it through
the normal owner workflow.

For uncertain website outcomes, inspect the website before authorizing another
logical request. Keeping the same receipt identifier is request recovery; using
a new one can repeat an external action. See
[output verification](../reliability/output-verification.md).

## MCP parity

Connect a Streamable HTTP MCP client to `/mcp` with the same Bearer key. Discover
the actual `action_...` name through `tools/list`; it continues to use the active
publication and its existing `{input,request_id,expected_revision?}` schema.

To select a historical revision, use these tool arguments:

```json
{"name":"get_contract","arguments":{"revision":2}}
```

```json
{"name":"invoke_revision","arguments":{"revision":2,"input":{},"request_id":"UNIQUE_LOGICAL_REQUEST_ID"}}
```

These are `tools/call` parameter objects, not a complete MCP transport handshake.
Use the selected contract to fill `input`, then poll `get_run` with the returned
run ID. `get_execution_receipt` exposes the same canonical execution outcome as
REST. Omitting `revision` from `get_contract` selects the active publication.
`invoke_revision` shares REST's revision, input, idempotency, key, permission,
approval, and verification boundaries. MCP tools cannot approve a paused run.

## Owner publication and rollback review

Owner routes require an unlocked owner session plus the runtime's normal Host,
Origin, and CSRF checks. Consumer keys cannot call these routes.

Before publication, fetch `GET /studio/workflows/:wid/permissions`. After a
verified draft test, send both current `expected_version` and
`permission_fingerprint` to `POST /studio/workflows/:wid/publish`. Missing review
returns `PERMISSION_REVIEW_REQUIRED`; mismatched reviewed state returns
`PERMISSION_REVIEW_CHANGED`. Untested drafts still return `TEST_REQUIRED`.

If that permission response has `changes.breaking: true`, publication also
requires `change_fingerprint: changes.fingerprint` and `accept_breaking: true`.
Otherwise the runtime returns `BREAKING_CONTRACT_REVIEW_REQUIRED`. This separate
acknowledgment covers a changed client contract; a normal permissions checkbox
does not supply it. The dashboard shows field paths and change reasons without
including private field values in the comparison.

For rollback:

1. Read `GET /studio/workflows/:wid/revisions` to obtain `active_revision`.
2. Read `GET /studio/workflows/:wid/revision-diff?from=ACTIVE&to=TARGET`.
3. Review the displayed contract and website-permission changes.
4. Send `{revision: TARGET, expected_active_revision: ACTIVE}` to
   `POST /studio/workflows/:wid/rollback`. When the comparison requires review,
   also send its `change_fingerprint`, `accept_breaking: true` for breaking
   contract changes, and `permissions_reviewed: true` for permission changes.

Missing or stale required acknowledgment returns `ROLLBACK_REVIEW_REQUIRED`.
A changed active revision returns `VERSION_CHANGED`. The target must still have
valid test evidence and compatible browser authority. The UI opens its
confirmation with keyboard focus on Cancel and requires a separate acknowledgment
before applying a reviewed change. Rollback preserves the working definition and
all immutable snapshots; it cannot undo website effects from completed runs.

No database reset or API-key rotation is required for these additive invocation
routes. Existing active-route clients continue working. Owner automation that
previously published with an empty body must now perform the explicit review.
