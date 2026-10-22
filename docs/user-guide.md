# User guide

Hermo turns a website workflow into a locally callable API. The interface calls
these workflows **actions**. A published action contains recorded steps, named
inputs, output mappings and checks that must pass before a result is returned.

Start with the [installation guide](installation.md). Use websites and accounts
you are authorized to automate; complete sign-in, MFA and verification yourself.

## 1. Choose a project and connection

Select a project with **Current project**. Projects group this local workspace's
connections, actions, keys and history; they are not separate user accounts.

For your existing website session:

1. Sign in normally to the website in Chrome.
2. In Hermo, open **Connections → Connect app**. Choose or save a browser, enter
   the website URL and a connection name, and select the appropriate account
   access option. Keep **Use a tab in normal Chrome** as the browser mode.
3. Review and authorize the connection, then choose **Continue**.
4. Expand **Connect your website tab**, authorize the selected-tab access and
   choose **Create Connect code**.
5. Open the Hermo companion on that exact website tab. Match its local runtime
   address to Hermo, paste the code, check its separate **I authorize reading
   this tab and replaying my workflows** checkbox, and choose **Connect selected tab**.
6. Wait for **Connected**. You can close the popup. Keep the website tab open.

There is no account-name/email detection or confirmation requirement in this
mode. Runs use whichever account is currently signed in to the authorized tab.
**Check tab connection** is a recovery check, not an account-confirmation step.
The normal flow opens no controller tab.

For a public, read-only website, choose **No — read the website without an
account**, expand **Advanced browser options**, and select **Use an isolated
browser**. Review the loaded page and choose **Confirm public source**. Public
managed runs use anonymous sessions. Retrieval workflows allow GET/HEAD only;
website-action workflows can submit HTTP requests and use secure sockets after
verification and permission review. There is no silent fallback to signed-in
Chrome. Private managed connections retain dedicated encrypted disk profiles and
have separate manual sign-in and identity checks.

## 2. Demonstrate the action

Choose **Actions → Create action** and select the connection. Under **What
should this action do?**, choose the closest task: **Chat and text**, **Generate
media**, **Read data**, **Search and extract**, **Submit and update**, or
**Custom**. These choices guide setup; the recorded steps define the behavior.

Give the action a name and a stable **API action ID**, such as `catalog.lookup`.
Choose **Start demonstration**.

- For data already visible, use **Outputs** and select the values directly.
  There is no need to add unnecessary clicks.
- For interactive workflows, use **Interact**. Fill a detected field, select an
  option or apply a checkbox, then operate the required website controls.
- Check **Make this an API input**, give the value a **Parameter name**, and use
  **Fill field**, **Select option** or **Apply selection** to record the binding.
  Typing directly in Chrome does not create an input binding in Hermo.
- Use **Read a parameterized public page** when the target uses page/path
  navigation. Replace one complete path segment with a named placeholder such
  as `{record}`; use **Navigate & bind record**. Do not invent a search field
  that the target website does not have.

Recording performs real website actions. A recorded Submit or Generate control
can change data or consume the website's allowance immediately.

## 3. Select outputs and verification

In **Outputs**, select the actual result, provide an **Output name**, and choose
**Add output**. Capture the result rather than unrelated navigation text. Then
choose **Define verification**.

Choose checks appropriate to the task: presence, a usable URL, changed output,
number/unit, expected text, or a match to the requested input. A read-only value
may legitimately stay unchanged. A submitted task needs evidence tied to this
run, such as its confirmation or an input-correlated result. A successful click
is not proof that the task completed.

For supported chat layouts, capture **Latest submitted message** as
`prompt_echo` and **Latest assistant response** as `response`; check that
`prompt_echo` matches the `prompt` input. Other websites need their own actual
result targets and success checks.

Select **Maximum run time**, review the execution authorization, and choose
**Save & test action**. The initial recording creates text inputs; you can refine
their types in the draft editor.

## 4. Refine the draft and test

In **Test action**, expand **Edit workflow steps and extraction**. The ordered
editor lets you inspect locators, change step settings, add explicit waits,
reorder or disable steps, and edit inputs and output mappings. Prefer element,
text or URL waits over guessed delays. Missing or ambiguous targets fail.

Inputs support strings, numbers and booleans, required/optional values, defaults,
text choices and bounds. The editor shows where inputs are used. Send JSON
numbers and booleans as those types, not strings. Keep secrets out of defaults:
defaults are included in contracts and exports.

Omitting an optional text input without a default clears its recorded field.
Optional select and checkbox inputs need a valid default, so replay never reuses
an earlier request's selection accidentally.

Outputs support strings, numbers, booleans, URLs, nested objects and lists.
Use relative selectors inside a repeated row or container. Configure optional
or nullable fields deliberately. A missing optional value may be omitted; an
invalid present value still fails. Numeric extraction does not guess how to
strip currency symbols or units: keep those fields as text unless a separate
numeric value exists. List and extraction size limits fail rather than silently
truncating a successful response.

Choose **Save draft**, select the **Authorized execution connection**, enter
test inputs, and run the test. Inspect the step statuses, timings, extracted
output and verification evidence. Repair missing outputs before publishing.
Changing the draft or execution target requires a new verified test.

For a step that submits, deletes, purchases or updates data, select **Pause for
owner approval before this step** in the step editor and save the draft. You
choose the checkpoints; Hermo cannot infer every website side effect from a
button label. Fills, selections and navigation can also trigger changes, so put
the checkpoint before the first action whose effect needs your approval.

Earlier lookup/wait steps continue automatically. At a checkpoint, the run
shows **Awaiting owner approval** in **Test action** or **Runs**. Inspect the
website and recorded target, choose **Review approval**, then **Approve this
step**, or choose **Reject step**. Each decision applies once to that run and
step. Targets and browser authority are checked again before continuing.
Rejection, cancellation, expiry, Stop or revocation prevents later actions;
earlier effects cannot be undone. Waiting consumes the total run timeout
(at most 300 seconds) and holds the current single-worker local queue.

A permission preview is a static review, not an executable dry run. Replaying
only the early steps would still perform their real website actions. A missing
or ambiguous locator fails. When recorded role/name or label metadata exists,
a mismatched target also fails instead of falling back to a differently named
control. Legacy CSS-only recordings have no saved semantic identity; a unique
CSS match can change meaning and should be repaired and retested.

Compatible chat drafts also offer **Repair this chat recording** in the test
dialog. Review its authorization before replacing the recording with Fill and
Send steps and latest-message outputs. Repair clears verification; test a fresh,
completed reply before publishing.

## 5. Publish and call the API

For nested input/output editing, explicit scalar input paths, bounded waits and
observation-only locator repairs, see [Structured workflows](architecture/structured-workflows.md).
For project assignment, structural templates, JSON playground requests and
sanitized reliability reports, see [Developer workflows](developer-workflows.md).

After a successful test, inspect **Review workflow permissions**: browser
connection, allowed origins, enabled steps, dynamic inputs, output targets,
approval checkpoints and safety limits. Check the acknowledgment, then choose
**Publish API**. The dashboard submits the reviewed definition and permission
fingerprint; a changed draft or browser scope requires another review. API docs
also shows the currently published revision's permissions.

When a draft changes the API contract, review **Changes from the live version**
and acknowledge the separate breaking-change checkbox before publishing. Normal
website permission consent alone does not accept a change that can affect clients.

Copy the one-time scoped key
and endpoint. The API is local to the running runtime; a key is not public
hosting and does not remove the website's access requirements.

**API docs** provides the published schema, cURL/JavaScript/Python examples,
**Download OpenAPI**, and an API playground. Enter a consumer key in the
playground to call the same public interface as your application. The key stays
in the page's memory.

The following PowerShell example is illustrative: replace the action ID,
`input` fields and key with your own published contract. It is not a built-in
workflow or a preconfigured successful result.

```powershell
$endpoint = 'http://127.0.0.1:4317/v1/actions/catalog.lookup/versions/1/runs'
$key = 'YOUR_HERMO_KEY'
$headers = @{
  Authorization = "Bearer $key"
  'Idempotency-Key' = [guid]::NewGuid().ToString()
}
$body = @{ input = @{ search_query = 'laptop' } } | ConvertTo-Json
$receipt = Invoke-RestMethod -Method Post -Uri $endpoint -Headers $headers `
  -ContentType 'application/json' -Body $body
Invoke-RestMethod -Uri $receipt.status_url -Headers @{ Authorization = "Bearer $key" }
```

Equivalent cURL admission for a Unix shell:

```sh
curl -X POST 'http://127.0.0.1:4317/v1/actions/catalog.lookup/versions/1/runs' \
  -H 'Authorization: Bearer YOUR_HERMO_KEY' \
  -H 'Idempotency-Key: YOUR_UNIQUE_LOGICAL_REQUEST_ID' \
  -H 'Content-Type: application/json' \
  --data '{"input":{"search_query":"laptop"}}'
```

Admission returns HTTP **202** with `run_id`, `status_url` and `reused`. Poll the
returned `status_url` with the **same scoped key** until terminal. Read `result`
only when `status` is `succeeded`; `queued`, `running` and `verifying` are still
in progress. Failures and cancellation have their own status/error evidence.
The examples above do not poll automatically to completion.

Approval-gated runs retain `status: "running"` while exposing
`phase: "awaiting_approval"` and a bounded `approval` record. Continue polling or
cancel the run. Only the unlocked owner dashboard can decide; REST consumer
keys and MCP tools have no approval authority. `GET /v1/action-contract`, MCP
`get_contract` and the OpenAPI extension `x-hermo-approval-required-steps`
identify the enabled checkpoints in the published definition.

Use a new idempotency key for each new logical request. If you lose the admission
response, resend the **same input and idempotency key** to retrieve its original
receipt. Do not replace it with a new ID and risk repeating a website submission.
`GET /v1/action-contract` returns this key's active published contract.

For MCP, use a local client supporting Streamable HTTP and Bearer headers. Point
it at `http://127.0.0.1:4317/mcp` and use the same workflow-scoped key. Discover
the actual `action_...` tool, call it with `{input, request_id}`, then poll
`get_run` with its run ID. `get_contract` and `cancel_run` use the same key
boundaries. Client configuration syntax varies; use the MCP connection section
in **API docs** for the local endpoint and authorization configuration.

## 6. Inspect failures and maintain versions

Open **Runs** to inspect an execution's failed step, error code, expected result,
observed evidence and suggested action. `EXECUTION_OUTCOME_UNKNOWN` means a
website submission may have occurred without confirmation. Inspect the website
before deciding whether another request is appropriate. Hermo does not replay
uncertain submissions automatically. Cancellation cannot undo a website change.

Use **Edit draft** or **Version history → Open draft** to repair a published
workflow. Saving and testing a draft leaves the published API unchanged. Publish
the verified replacement when ready. **Restore as draft** prepares an older
definition for editing and retesting; **Roll back live API** switches new calls
to a previously published revision. Already accepted runs retain their revision.
The `/versions/1/` endpoint segment is API compatibility, not the active workflow
revision number.

To call a specific immutable publication, read `GET /v1/action-revisions` with
the workflow's scoped key, then fetch
`GET /v1/action-contract?revision=NUMBER`. Submit its input to
`POST /v1/actions/SLUG/revisions/NUMBER/runs` with a new logical request ID in
`Idempotency-Key`. This selects a saved contract without changing the live API.
In MCP, use `get_contract` with `{revision}` and `invoke_revision` with
`{revision,input,request_id}`. Both interfaces enforce the same browser authority,
approval gates and verification. A request ID already used for one revision
cannot be repurposed for another.

**Roll back live API** now displays the selected revision's contract and website
permission changes. When these require review, confirm the separate acknowledgment
before **Confirm rollback** becomes available. The working draft stays intact.
For exact REST routes, owner review fields and recovery behavior, see
[published contracts and revision invocation](architecture/published-contracts.md).

## Media and website preview

Choose **Generate media** for a website generation task in connected Chrome or
an authorized managed connection with explicitly reviewed website-action scope.
Record its input and generation control, wait for the completed result, and
select its image, video, audio or download **URL** in Outputs. If each result
creates a new element, the draft editor's **Result targeting** can select a
supported latest-result target, such as **Latest image result**. Save, verify a
new completed result, and publish again.

Hermo returns validated HTTP(S) media links. With companion 0.7.8, a selected
page-local (`blob:`) image is captured after it loads and passes freshness checks.
PNG, JPEG, WebP and GIF images up to 8 MiB are stored encrypted locally; the
returned loopback download link expires after one hour. Anyone with that link
can download that single image until expiry; share it only with trusted callers.
Revoking its issuing API key also revokes its image links. The temporary image
cache is capped at 128 MiB and run deletion removes its images.
Protected remote links, page-local video/audio and canvas-only results may not
be portable. Hermo does not transfer Chrome cookies or fetch arbitrary remote
assets to make them accessible. Five minutes is a maximum wait, not a delay: a
fresh loaded image completes as soon as it settles.

For an opaque asset URL, set **Output mappings → Media preview** to Image,
Video, Audio or Download link, then save, verify and publish. In the API
playground or `/workflow-data.html`, **Load preview** displays the verified
asset without running the workflow again or forwarding your Hermo key to its
host. Video and audio players do not autoplay.

To see the website's actual appearance inside Hermo, open the companion on the
paired website tab and choose **Enable live preview**, then return to Hermo's
**Website** view. **Detected fields** is a separate simplified inspection. The
live preview supports pointer clicks on detected controls and wheel scrolling
inside the website. Button clicks during recording become replayable steps;
clicking an input opens its Interact editor so its value can be bound to an API
parameter. Use the Interact controls and Scroll buttons for keyboard access.
Changed or stale targets fail instead of clicking another element. Reload
companion 0.7.8 and reconnect to enable these controls. Capture is explicit,
limited to one tab, expires after at most 15 minutes, and stops after two minutes
without frame requests. Stopping preview preserves the automation connection.
API keys cannot request these owner-only preview frames.

## Keys and runtime availability

Create keys from **API docs → Create key**. Open **Test action → API keys** to
manage just that workflow's keys, or use **Privacy** for the project list.
Keys expire after 30 days, are scoped to one action, and read only their own
runs. The secret is shown once. **Rotate key** atomically revokes the old key and
shows its replacement once; update your integration with the replacement.
Revoking or rotating cancels that key's queued/active runs and preserves the
shared browser connection and other workflow keys. An already-issued website
action may finish before cancellation can stop it; an uncertain outcome is not
replayed. If the companion fails to acknowledge a cancelled command before its
deadline, Hermo ends the connection rather than allowing overlapping work.
For a staged cutover, create another key, update the consumer, then revoke the
old key. Review destructive dialogs and type the exact
confirmation requested before deleting saved resources.

| Action | Effect |
| --- | --- |
| Close the dashboard or companion popup | The independent runtime keeps serving APIs. |
| Close a connected website tab | Connected-Chrome execution becomes unavailable. |
| Stop the website's Hermo connection | Ends that tab's automation authority. |
| Lock the workspace | Locks owner access and ends connected-tab authority; existing managed APIs retain scoped-key authorization. |
| Stop the runtime or power off the computer | Local APIs become unavailable. |

Connected-tab authority expires with the owner unlock lease (currently four
hours). Browser/runtime restart, expired permission or out-of-scope navigation
requires explicit reconnection. A Chrome worker suspension can recover a valid
idle connection, but interrupted submissions are not replayed. Managed retrieval
uses its own local browser and can work after the original Chrome tab closes;
its independent runtime and any required dedicated session must remain valid.

Pause the action, stop its connection or revoke keys when you need to block
managed calls. Consult [configuration](configuration.md),
[architecture](architecture.md) and [security guidance](../SECURITY.md) before
using sensitive workflows.
