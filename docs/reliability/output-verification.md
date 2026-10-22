# Output verification

Hermo returns `result` only for a verified successful run. Completing a click is
not sufficient. Both browser adapters read bounded DOM mappings, require the
configured freshness/settling evidence, convert values and evaluate the workflow's
success rules. The runtime validates the converted structure again before
persisting success. REST, MCP and generated OpenAPI use the same output contract.

## Supported mappings

| Type or constraint | Behavior |
| --- | --- |
| `string` | Preserve captured text. Nonblank unless optional/nullable. |
| `number` | Strict finite decimal/exponent conversion; no currency guessing. |
| `integer` | Numeric conversion plus JavaScript safe-integer validation. |
| `boolean` | Exactly `true` or `false` text. |
| `url` | Absolute HTTP(S), without credentials or control/space characters. |
| `object`, `fields` | Declared relative mappings; expected columns and types. |
| `array`, `items` | Repeated relative items; `minItems`/`maxItems`, up to 100. |
| `required: false` | Omit missing fields; present values must still validate. |
| `nullable: true` | Missing values may become null. |
| `enum` | Bounded, unique scalar choices matching the declared type. |
| `minimum`, `maximum` | Inclusive number/integer bounds. |
| `minLength`, `maxLength` | Unicode code-point lengths for text constraints. |
| `format` | Strict `date`, qualified `date-time`, or qualified `time`. |
| `uniqueItems` | Compare complete converted array values structurally. |
| `pattern` | Restricted, full-value anchored pattern; see below. |

Dates use ISO calendar values. Date-times and times require seconds and `Z` or a
numeric timezone offset. Existing extraction resource limits still apply,
including UTF-16 text size limits, bounded nesting, fields and total values.
These bounds are independent of declared Unicode length constraints.

Patterns support ASCII literals, character classes, predefined classes such as
`\d`, escaped punctuation and optional exact repetitions such as `{3}`. Start
with `^` and end with `$`. Groups, alternation, wildcards, backreferences,
lookarounds and variable repetition are rejected. For example `^[A-Z]{3}-\d{4}$`.
This intentionally supports less syntax than arbitrary JSON Schema patterns to
avoid exposing a regex execution engine to unbounded author configuration.

Use the full workflow editor for nested mappings and constraints. The basic
type editor preserves advanced mappings and directs their editing to that editor.
Saving a draft clears its verification; existing publications remain unchanged.

## Success rules

Legacy `nonempty`, `equals_input`, `contains`, `url`, `number` and `changed`
checks remain supported. Legacy `equals_input` compares raw observed text with
the string form of the request input: `"2.0"` does not equal numeric input `2`.
New collection comparisons operate on converted typed values:

```json
[
  {"kind":"unique","output":"products","path":["sku"]},
  {"kind":"rows","output":"products","path":["category"],
   "operator":"eq","value":"stationery","quantifier":"all"},
  {"kind":"compare","output":"totals","path":["subtotal"],
   "operator":"lte","other_output":"totals","other_path":["total"]}
]
```

Paths are bounded arrays of declared field names and list indices, not scripts
or expressions. `unique` without a path compares complete rows. Row predicates
support `all`, `some` and `exactly_one`; even `all` requires a nonempty list.
Operators are `eq`, `ne`, `lt`, `lte`, `gt`, `gte`; rows also support text
`contains`. Ordered comparisons require numbers. Missing/null operands fail.
Choose context/category checks to reject a structurally similar unrelated table.
Schema validation alone cannot determine that a table is the intended one.

## Freshness and identical results

`changed` compares the captured pre-action observation with the settled result.
Generated media additionally rejects known prior asset URLs. DOM identity can
help identify a new response, but does not prove its business correctness.

For legitimate identical results, authors can explicitly select a separate
required scalar text completion marker, such as a website-issued request receipt:

```json
{"kind":"completion","output":"result","evidence":"receipt"}
```

Select one visible plain-text element without latest-item, attribute, media or
frame extraction. The marker's value must change after the last enabled navigate/fill/select/check/
click action, not merely after an earlier fill. It must settle without a loading
state. Hermo reads it before dependent results and checks it again afterwards.
A static banner, a new node with the same marker text, or a fixed delay does not
satisfy this policy. Markers cannot recursively vouch for each other. Generated
media cannot substitute this rule for fresh asset verification.

Marker capture follows target readiness. Managed native actionability retries
refresh it again. Companion 0.7.2 checks the captured marker in the same
synchronous isolated-world operation immediately before issuing the final action;
changes during another readiness wait fail closed. Older companions reject this
new policy with `COMPANION_UPDATE_REQUIRED` before issuing workflow actions.

A marker only proves the website's configured observable transition. Do not use
an input echo, cosmetic counter or untrusted page claim as proof of a consequential
backend commit. Add correlation, context and schema checks appropriate to the site.
If evidence is absent or unstable, execution fails instead of returning old data.

## Evidence and diagnostics

Success evidence includes run ID, workflow version/revision, step outcomes,
applied rule summaries, passed checks and timestamps. Failure with a validation
diagnostic retains separate `verification_evidence`; it has no successful result.
Diagnostic paths identify fields, for example `["products",0,"quantity"]`,
without including captured values or expected literal values.

Existing public `code`/`category` values remain compatible. Additive `detail_code`
distinguishes `OUTPUT_SCHEMA_INVALID`, `OUTPUT_STALE`,
`OUTPUT_VERIFICATION_FAILED` and `APPROVAL_EXPIRED`. See the nested
`verification.reason`, `path` and `keyword` for repair guidance. A possible
submission without completion evidence remains uncertain and is never retried
automatically.

Reproduce the actual table, form-approval and SDK MCP flows with
`node scripts/verify-trusted-execution.mjs`. Evidence is written under ignored
`validation/results/`; it contains safe run metadata rather than keys or cookies.
