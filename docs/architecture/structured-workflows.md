# Structured workflows and bounded waits

Open an action's working draft, then **Edit workflow steps and extraction**.
Saving clears that draft's verification. A published revision stays unchanged
until the owner verifies and publishes a new revision with permission consent.

## Inputs

Scalar fields retain their existing behavior. The advanced input definition
editor also accepts objects, arrays, integers and null. These are Hermo field
definitions; the published contract generates standard JSON Schema from them.

```json
{
  "type": "object",
  "required": true,
  "properties": {
    "query": { "type": "string", "required": true },
    "limit": { "type": "integer", "default": 10, "minimum": 1, "maximum": 50 }
  }
}
```

For a browser Fill step, select this input and enter `["query"]` under **Input
value path (JSON array)**. An empty path binds a scalar input directly. Objects
and arrays are never implicitly stringified. Paths have at most four field names
or array indices; nullable and potentially missing paths are rejected. Array
indices must be guaranteed by the input's `minItems`.

Input coercion is strict unless explicitly configured: `coercion: "number"`
accepts decimal text for a numeric field and `"boolean"` accepts literal `true`
or `false` text. Defaults and normalization run before request hashing and replay.
Unknown fields, unsafe property names, excessive depth, invalid numbers and
oversized collections fail validation. JSON input is bounded to 2,000 nodes,
100 items per array and 24,576 aggregate string characters. Field definitions
allow up to four nesting levels and 16 properties per nested object.

## Outputs

The output editor supports nested objects and repeated lists. A list's selector
identifies item containers; child selectors are relative to that item. Configure
visible text or an allowed attribute, optional fields, nullable values and list
limits. To permit an empty list, set **Minimum items** to zero. Missing optional
fields are omitted; required fields and declared types are still checked.

`null` is a distinct output type. Legacy conversion accepts actual null or the
literal website text `null`; missing required targets still fail. Existing
outputs keep legacy text conversion when `coercion` is absent. Strict conversion
requires an already typed value: a DOM string `42` is not a native JSON number.
Structured results are returned as JSON through REST and MCP without flattening.

Output limits remain four levels, 64 mapping nodes, 100 rows per collection,
2,000 observed values and bounded text size. Constraint errors report a field
path and reason without including the rejected website value.

## Steps and waits

Steps have stable identities after saving. Reorder, disable, duplicate or remove
steps in the timeline; review any affected approval selections. Duplicating a
protected step creates a different identity and preserves explicit protection.

Available conditions include element visibility/enabled state, literal text,
approved URL, navigation readiness, a typed output predicate, bounded delay and
managed-browser response metadata. Delays are 100–10,000 ms; individual deadlines
are 100–30,000 ms and always fit inside the overall workflow deadline.

Response waits match an exact approved URL, GET/HEAD method and optional status.
They observe requests issued since the last website action or invocation startup,
including responses that arrived before the wait step. They do not issue requests
or read response bodies. Connected Chrome does not support this observation.

The default error policy stops execution. A wait may explicitly continue after
its own timeout: its receipt then says skipped with `WAIT_TIMEOUT_CONTINUED`.
This does not say the condition succeeded. Cancellation, total timeout, lost
authorization and website/session errors still stop execution. Browser actions
are never automatically repeated. Final result verification remains mandatory.

## Locator repair

For a saved draft, open its authorized browser and choose **Inspect target**.
Review the proposed selector and semantic evidence, probe it, and explicitly
apply the selected change. Inspection never opens a page, fills, clicks or
executes the workflow. Tickets expire after one minute; a changed browser,
document, node or draft requires new inspection. Applying changes only locator
fields and clears draft evidence; run verification before publishing again.

Matching scores describe DOM evidence, not the business safety of an action.
The actual meaning of a control can change even when its accessible name remains
the same. Connected framed targets and inaccessible closed shadow trees are
unsupported. Reload companion 0.7.10 in place and reconnect to enable new
negotiated observations; existing supported commands remain available to old links.
