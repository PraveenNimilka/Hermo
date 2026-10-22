# Projects, templates, API examples and reliability

## Organize projects

Use **Manage local projects** beside the sidebar selector to search, sort, create,
rename, describe or archive a project. The action card's **Project** selector moves
that action independently of its website connection. Its workflow ID, route,
scoped keys, publications and accepted runs stay unchanged.

Actions without an explicit assignment follow their connection's project.
Referenced browser connections appear in the action's project as shared resources;
stopping or changing them can affect actions in their original project as well.
Projects organize one owner's workspace; they are not separate authorization
boundaries or collaboration accounts.

Archiving preserves API operation and history. It prevents new assignments until
unarchived. Delete requires the exact current project name and an empty project;
it never silently deletes published actions. The default Personal workspace is
retained for existing data. Project health uses the latest 100 retained receipts
and distinguishes unproven historical successes as uncertain.

## Start from a template

On **Actions**, choose **Use a workflow template**. Search the catalog or import
a structural template. Choose an already authorized connection, configure every
CSS target and full destination URL, give the draft a name and slug, then confirm
the website scope. Instantiation saves a draft without opening a browser or
running, testing or publishing an action.

The catalog covers search/extract, table-to-JSON, detail page, bounded Load more,
an approved form, status lookup, dashboard extraction and an authenticated managed
session. Its targets must be configured for the actual website. The Load more
template clicks twice and extracts accumulated rows; replacing-page websites
return only their final page. There is no general pagination loop or aggregation
across discarded pages.

Continue through the normal editor, verification, permission review and publish
flow, then open the API playground. Templates do not bypass browser capabilities,
origin restrictions, approval gates or freshness checks.

**Export structural template** on an action removes website selectors, URLs,
private names, fixed values, examples, defaults and account information. Neutral
slots require configuration again on import. Unsupported frames, nested input
bindings, dynamic path navigation and complex verification rules reject export
explicitly; a partial template is not silently produced. The portable v1 format
supports scalar input shapes and nested output shapes. Keep using the original
workflow for capabilities outside that portable subset.

Policies that pause at a wait also reject structural export: moving that decision
to an earlier invocation gate would change its timing. Configure the new draft's
intended policy explicitly rather than relying on a silently altered gate.

## Test and share an API example

In **API docs**, connect a key scoped to the published action. Select the active
or a specific immutable revision. Use the schema form or **JSON** request editor;
both apply the published input rules. Execution uses the consumer REST interface.
The receipt, status, approval wait and errors are real runtime responses.

Keep a request's idempotency identifier when recovering a lost receipt. A new
logical request needs a new identifier. Stopping polling does not cancel the
website operation; use **Cancel run** to request cancellation. Inspect uncertain
website outcomes before explicitly authorizing another attempt.

Examples include cURL, JavaScript, TypeScript, Python and an MCP `invoke_revision`
envelope. Download sanitized Markdown, request/schema JSON, a shell snippet or a
minimal client. These exports use synthetic values and placeholders; they do not
include the current key, request input or response. Defaults, enum values,
patterns and authored examples are excluded because they may contain private
values. Review the recipient's constraints and supply suitable values locally.

Localhost refers to the recipient's own computer. Sharing a snippet does not give
access to the sender's runtime. The recipient needs a matching published action,
authorized browser and scoped key on their own runtime. MCP envelopes require
an initialized MCP client and locally configured authorization.

## Measure reliability

Choose **View workflow health** on an action card. Select a measurement period,
inspect the UTC trend, failures, slow steps, revisions and recent retained runs,
or download the sanitized JSON report. Reports exclude inputs, outputs, selectors,
account details and arbitrary website error text.

Only execution-bound verified receipts count as success. Uncertain results,
timeouts and cancellations have separate counts. Success rate is verified success
divided by completed invocations; active runs are excluded from that denominator.
Approval rejection/expiration counts overlap terminal categories. Median and p95
use nearest rank over available completed `execution_ms` measurements, excluding
queue time; missing measurements are disclosed, not treated as zero.

The period is the half-open accepted-at cohort `[from,to)`, at the current snapshot.
Reports use retained local records, up to 10,000 runs over at most 366 days.
Deleted history cannot be reconstructed; a retention setting does not prove
complete historical coverage. Samples below 20 completed runs have an explicit
warning. These measurements are observations, not a statistical reliability or
compatibility guarantee. Retention controls remain under **Privacy**; telemetry
stays local with no third-party analytics.
