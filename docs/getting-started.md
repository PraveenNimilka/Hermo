# Your first Hermo workflow

This walkthrough installs Hermo, records an authorized website lookup, verifies
and publishes it, and calls it through REST and MCP. It uses Northstar, Hermo's
local practice website. Its account and orders are synthetic; no external
account or paid service is needed.

For platform requirements and encryption setup, read [Installation](installation.md).
The current release has received its complete installation checks on Windows.

## 1. Install and start

Install Node.js 24 or newer, including npm. Clone the repository or fully extract
its release ZIP into a writable directory. On Windows, double-click
**Start Hermo.cmd**. The first start installs locked dependencies, builds the
dashboard and opens it when ready. Keep the terminal window open.

To run the same setup manually in PowerShell:

```powershell
git clone --branch v0.1.0-beta.1 https://github.com/PraveenNimilka/Hermo.git
Set-Location Hermo
npm.cmd ci
npx.cmd playwright install chromium
npm.cmd run build
npm.cmd start
```

The Chromium download enables the isolated browser used in this walkthrough.
Open [http://127.0.0.1:4317/](http://127.0.0.1:4317/). Create and confirm a
workspace password of at least 12 characters, then choose **Create private
workspace**. Retain this password securely; there is no preset account.

On Windows the storage key is protected by your Windows account. Other platforms
need a persisted `HERMO_MASTER_KEY` before the first start; follow the
[encryption instructions](installation.md#encryption-key). Never generate a new
key for an existing workspace.

## 2. Connect the practice website

1. Open **Connections → Connect app**.
2. Expand **Advanced browser options** and choose **Try the Northstar sandbox**.
   This selects an account-based isolated connection at the local `/sandbox/`
   address. Review its scope and continue.
3. In the website controls, fill **Email** with `alex@northstar.example` and
   **Password** with `demo-only-local`. These credentials are only for the
   synthetic practice website. Choose **Sign in**.
4. Select the visible account marker **Alex Morgan · Northstar Supplies** and
   choose **Confirm this account**. The connection should show **Connected**.

The isolated browser uses its own profile. It does not import your personal
Chrome profile. Northstar's login remains valid for up to an hour while this
runtime stays running; its synthetic login sessions expire on runtime restart.

## 3. Record the lookup

1. Open **Actions → Create action** and choose the Northstar connection.
2. Choose **Search and extract**, name the action **Order lookup**, and enter
   `orders.lookup` as its **API action ID**.
3. Choose **Start demonstration** and use **Interact**.
4. Select the **Order ID** field and enter `ORD-2041`. Check **Make this an API
   input**, set **Parameter name** to `order_id`, and choose **Fill field**.
5. Select **Search orders** and perform the click. The page should show the
   order and status **Shipped**.
6. Switch to **Outputs**. Add the displayed order ID as `order_id` and its
   status as `status`. Select the actual result values rather than headings.
7. Choose **Define verification**. Check that the returned `order_id` equals the
   `order_id` input, and require a nonempty status. Keep the run bounded by the
   **Maximum run time** setting, review authorization, and choose **Save & test
   action**.

Demonstrating an action performs real browser operations. On a real website,
submitting a form can change data or consume a website allowance immediately.
Only use websites and accounts you are authorized to automate.

## 4. Verify with another record

In **Test action**, set `order_id` to `ORD-2042` and choose **Run verification**.
Expect `order_id: "ORD-2042"` and `status: "Processing"` after the run succeeds.
Using another record helps detect a mapping that captured the original value.

If a field or result was selected incorrectly, expand **Edit workflow steps and
extraction**, repair its target and save the draft. Retest after any definition
or execution-connection change. Prefer element or text waits to fixed delays.
The timeout is an upper bound: verification should finish when its checks pass.

For a workflow that changes website data, configure **Pause for owner approval
before this step** before the first operation needing your decision. Consumer
keys cannot approve a paused step; the unlocked owner uses **Review approval**
in the dashboard. Approval waiting counts toward the total run timeout.

## 5. Publish a reviewed contract

1. After a successful test, inspect **Review workflow permissions**. Check the
   connection, origins, recorded controls, inputs, output mappings and limits.
2. Acknowledge the reviewed permissions and choose **Publish API**.
3. Copy the one-time scoped key and endpoint into your local secret storage.
   The key is shown once. Keep it out of source control, screenshots and logs.
4. Open **API docs** to inspect the published input/output schema and examples.

Publication makes this workflow callable on your computer. It does not create
a hosted service or expose your loopback runtime to the public internet.

## 6. Invoke through REST and poll to completion

This PowerShell example assumes the exact action ID and input above. Enter your
own scoped key when prompted. Treat terminal error evidence as a failure; do not
use output from a run that has not succeeded.

```powershell
$base = 'http://127.0.0.1:4317'
$secret = Read-Host 'Hermo workflow key' -AsSecureString
$key = [System.Net.NetworkCredential]::new('', $secret).Password
$headers = @{ Authorization = "Bearer $key" }
$requestId = [guid]::NewGuid().ToString()
$admissionHeaders = @{
  Authorization = "Bearer $key"
  'Idempotency-Key' = $requestId
}
$body = @{ input = @{ order_id = 'ORD-2042' } } | ConvertTo-Json
$receipt = Invoke-RestMethod -Method Post `
  -Uri "$base/v1/actions/orders.lookup/versions/1/runs" `
  -Headers $admissionHeaders -ContentType 'application/json' -Body $body
$deadline = (Get-Date).AddMinutes(6)
do {
  if ((Get-Date) -gt $deadline) {
    throw 'Polling deadline reached. Keep the receipt; inspect Runs before retrying.'
  }
  Start-Sleep -Milliseconds 500
  $run = Invoke-RestMethod -Uri $receipt.status_url -Headers $headers
} while ($run.status -notin @('succeeded', 'failed', 'cancelled'))
if ($run.status -ne 'succeeded') { throw ($run | ConvertTo-Json -Depth 12) }
$run.result | ConvertTo-Json -Depth 12
Remove-Variable key, headers, admissionHeaders, secret
```

Admission returns HTTP **202**, not the finished result. Preserve `run_id`,
`status_url` and your request ID. If admission's response is lost, resend the
same input with the same `Idempotency-Key` to recover its receipt. Use a new ID
only for a new logical operation. A local polling deadline does not cancel work.
Check **Runs** or explicitly request cancellation before deciding what to do next.

## 7. Invoke through MCP

Configure a local client that supports Streamable HTTP:

- Endpoint: `http://127.0.0.1:4317/mcp`
- Authorization header: `Bearer YOUR_HERMO_WORKFLOW_KEY`
- Required POST headers: `Content-Type: application/json` and
  `Accept: application/json, text/event-stream`

Use the same workflow-scoped key as REST. The endpoint is stateless: initialize
and negotiate the protocol in the client, send its initialization notification,
then send `tools/list`. Include the negotiated `MCP-Protocol-Version` header on
subsequent requests. Use the tool name returned by discovery; for this slug it
is `action_orders_lookup`. A normal MCP client manages these transport details.

Invocation body:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "action_orders_lookup",
    "arguments": {
      "input": { "order_id": "ORD-2042" },
      "request_id": "order-lookup-example-unique-request-001"
    }
  }
}
```

Read `result.structuredContent.run_id` from the admission response. Poll with
the same authorized client, replacing the placeholder below with that ID:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "get_run",
    "arguments": { "run_id": "RUN_ID_FROM_ADMISSION" }
  }
}
```

Wait for `structuredContent.status` to become terminal and read its result only
on `succeeded`. Use `get_contract` to inspect this key's schema and `cancel_run`
to request cancellation. Preserve `request_id` when recovering admission; use
a new value for each intentional new lookup. REST and MCP share the same queue,
browser permissions, checks and owner-approval boundaries.

## 8. Understand tab closure and restart

| Browser mode | Closing the original tab | Restarting Hermo |
| --- | --- | --- |
| Connected Chrome | Calls need the paired website tab; closing it ends availability. | Unlock and explicitly reconnect the website tab with a fresh Connect code. |
| Managed local browser | Published calls can open their dedicated profile independently. | Calls can restore the last completed encrypted profile if the website still accepts its session. |

To connect an existing Chrome website session, install the unpacked extension
from `companion/browser`, create a Connect code under the app's connection,
and enter it in the companion on the intended website tab. Match the local
runtime address and authorize access. Keep that tab open. Creating a fresh code
and using it in another browser rebinds that app by default, preserving its
actions and keys; other apps retain their own bindings.

For Northstar specifically, restarting expires its server-side synthetic login.
Sign in again and confirm its account before invoking the lookup. This is a
property of the practice website, not a failure to save the Chromium profile.
Real websites can also expire or revoke sessions independently of Hermo.

The runtime must remain running for either mode. Closing only the dashboard does
not stop it. Locking the workspace ends selected-tab authority; managed scoped
APIs can remain available, but owner approval still needs an unlocked dashboard.

## 9. Back up, upgrade and recover safely

Finish or cancel active runs, inspect uncertain website submissions, and stop
Hermo normally. Copy the complete data directory (default `.hermo/`) outside
the checkout, including SQLite journals and the protected key material. Keep an
external master key separately if configured. Do not copy an active browser
profile as your backup or upload the backup to the repository.

Install the next release, run `npm ci` and `npm run build`, then start with the
same data directory and encryption-key context. Check `/health`, unlock, reload
the companion in place, reconnect selected tabs, and verify an existing action.
A Windows DPAPI backup needs the same Windows account context; moving its files
to another account does not make them decryptable.

For missing outputs, inspect and repair the draft, then retest. For
`EXECUTION_OUTCOME_UNKNOWN`, inspect the website before authorizing another
attempt: the original submission may already have happened. Cancellation cannot
undo website changes. Never delete locks, replace encryption keys or clear the
workspace to repair a connection problem.

Continue with [workflow reference](user-guide.md), [browser compatibility](browser-compatibility.md),
[configuration](configuration.md), and [security guidance](../SECURITY.md).
