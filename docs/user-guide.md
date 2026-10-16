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
managed runs use anonymous sessions and allow only GET/HEAD retrieval. They do
not support form submission, media generation or a silent fallback to your
signed-in Chrome session. Private isolated connections have separate manual
sign-in and identity checks.

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

## 5. Publish and call the API

After a successful test, choose **Publish API**. Copy the one-time scoped key
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

Use a new idempotency key for each new logical request. If you lose the admission
response, resend the **same input and idempotency key** to retrieve its original
receipt. Do not replace it with a new ID and risk repeating a website submission.
`GET /v1/action-contract` returns this key's active published contract.

For MCP, use a local client supporting Streamable HTTP and Bearer headers. Point
it at `http://127.0.0.1:4317/mcp` and use the same workflow-scoped key. Discover
the actual `action_...` tool, call it with `{input, request_id}`, then poll
`get_run` with its run ID. `get_contract` and `cancel_run` use the same key
boundaries. Client configuration syntax varies; copy the configuration in
**API docs → Connect your AI agent**.

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

## Media and website preview

Choose **Generate media** for a website generation task in connected Chrome.
Record its input and generation control, wait for the completed result, and
select its image, video, audio or download **URL** in Outputs. If each result
creates a new element, the draft editor's **Result targeting** can select a
supported latest-result target, such as **Latest image result**. Save, verify a
new completed result, and publish again.

Hermo returns validated media links, not a new media-hosting service. Protected,
expired, `blob:` or canvas-only assets may not be portable to another app.
The API does not copy Chrome cookies to make those links accessible. Unsupported
or missing media fails verification; inspect and repair its output selection.

To see the website's actual appearance inside Hermo, open the companion on the
paired website tab and choose **Enable live preview**, then return to Hermo's
**Website** view. **Detected fields** is a separate simplified inspection. The
visual preview is view-only; record through Interact. Capture is explicit,
limited to one tab, expires after at most 15 minutes, and stops after two minutes
without frame requests. Stopping preview preserves the automation connection.
API keys cannot request these owner-only preview frames.

## Keys and runtime availability

Create keys from **API docs → Create key** and manage them under **Privacy**.
Keys expire after 30 days, are scoped to one action, and read only their own
runs. The secret is shown once. To replace a key, create a new one, update its
consumer, then revoke the old one. Review destructive dialogs and type the exact
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
