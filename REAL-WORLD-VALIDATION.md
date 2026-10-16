# Real-world validation

Hermo remains **early access**. This report separates actual external website
execution from controlled regression fixtures and lists what has not been proven.
The final machine-readable verification index is
[`validation/results/release-summary.json`](validation/results/release-summary.json).

Final local release gates passed: **246/246** core regression tests (no failures,
cancellations or skips; 710.4 seconds), **22/22** independent consumer tests,
TypeScript/Vite production build, both external execution modes and all six live
consumer interfaces. The focused crash/startup/state tests also passed **13/13**.
Configured GitHub CI is a separate check and is not claimed as executed locally.

## Scope and architecture

The six applications in [`validation-apps/`](validation-apps/README.md) are real,
independent consumers of published, scoped REST or MCP interfaces. Their small
loopback hosts forward only approved public API routes to one configured local
Hermo runtime. They have no owner credentials, database access, server imports or
direct requests to target websites. API keys stay in browser memory.

The acceptance harness provisions an isolated workspace through the same Studio
HTTP routes used by the dashboard: connection, recording, structured output
editing, verified test and publication. It starts `server/index.mjs` as a separate
process with disposable encrypted storage, then calls published consumer APIs.
The existing owner's workspace is never used as a test database.

## Actual external targets

The [To Scrape site](https://toscrape.com/) identifies Books to Scrape and Quotes
to Scrape as scraping-practice targets. Their public, anonymous, read-only pages
were reviewed and used at low volume on 16 October 2026. This is not permission
to automate arbitrary websites or accounts.

| Published workflow | Actual behavior | Structured outputs |
| --- | --- | --- |
| `validation.products` | Navigate Books to Scrape categories `travel_2` and `mystery_3` | Products with title, price text, availability and absolute URL; page heading; optional missing description |
| `validation.quotes` | Navigate Quotes to Scrape pages `1` and `2` | Quotes with text, author, nested tags array, optional source; page heading |

These are two actual workflows reused by six applications, not six unrelated
websites. Books to Scrape has category navigation, not a search field. Title and
author filters in the consumers filter returned records. Prices retain the
website's currency text; Hermo does not invent a numeric conversion.

## Six complete consumers

| Application | Executed acceptance | Evidence |
| --- | --- | --- |
| Product Search Explorer | Published catalog API, actual products, title filtering, structured response | [Desktop](validation/evidence/product-search-desktop.png), [mobile](validation/evidence/product-search-mobile.png) |
| Website Change Detector | Two independently verified observations; unchanged classification; local history excludes keys | [Desktop](validation/evidence/change-detector-desktop.png), [mobile](validation/evidence/change-detector-mobile.png) |
| Website-to-JSON Explorer | Nested quote/tag extraction, record inspection and JSON export interface | [Desktop](validation/evidence/json-explorer-desktop.png), [mobile](validation/evidence/json-explorer-mobile.png) |
| Hermo MCP Tools | Real initialize/discovery, scoped schemas, workflow calls and `get_run` polling through `/mcp` | [Desktop](validation/evidence/mcp-tools-desktop.png), [mobile](validation/evidence/mcp-tools-mobile.png) |
| Website Records Dashboard | Published page input, actual paginated records, run revision and verified result | [Desktop](validation/evidence/website-dashboard-desktop.png), [mobile](validation/evidence/website-dashboard-mobile.png) |
| Hermo Reliability Lab | Bounded two-request execution, queue and execution timing, verified statuses and export interface | [Desktop](validation/evidence/reliability-lab-desktop.png), [mobile](validation/evidence/reliability-lab-mobile.png) |

Browser acceptance uses 1440×1000 and 375×812 viewports, checks horizontal
overflow and uncaught page errors, and captures successful states only after
observing actual terminal API responses. Password inputs mask keys. JSON reports
include real run IDs, revision, execution mode, verification timestamps and
record counts. Screenshots illustrate those runs, not seeded success data.

## Reliability and security checks

The external harness checks different dynamic inputs, nested schemas, optional
absence, fresh timestamps on unchanged values, invalid input, invalid and revoked
keys, wrong workflow scope, missing records, duplicate idempotency receipts and
two concurrent admissions. Execution is serialized; no shared browser overlap is
claimed. A missing record fails without returning an earlier successful result.

Actual draft/revision checks run against the public quotes website: editing a
draft leaves revision 1 active, a verified publication selects revision 2, and
explicit rollback restores revision 1. A process stop/restart preserves published
definitions and scoped keys; a new managed run succeeds without its original
recording browser or dashboard. No cloud process is involved.

Actual Connected Chrome acceptance additionally loads the unpacked companion,
explicitly authorizes a real Books to Scrape tab through its native popup, and
closes the dashboard and popup. A recorded dynamic book URL and detected title
and price pass owner verification, published REST execution for a different book,
and MCP discovery/invocation/polling for the original book. Closing the authorized
tab then rejects new work with `409 CONNECTION_STOPPED` and no stale result;
the runtime stays healthy. See
[sanitized connected evidence](validation/results/connected-public-2026-10-16T05-10-10-171Z.json)
and the [actual target tab](validation/evidence/connected-public-book-2026-10-16T05-10-10-171Z.png).
This public acceptance does not claim external account or worker-restart coverage;
worker restart has separate controlled regressions.

Controlled regression tests separately exercise active cancellation, missing
output, timeout, actual Chromium process termination and fresh-request recovery.
The crash test terminates only the disposable browser PID obtained from its own
CDP connection. It verifies that the failed run is not replayed and recovering
its receipt cannot start a new execution. Local fixtures are never presented as
external website acceptance. See [bug fixes](REAL-WORLD-BUGFIXES.md).

## Reproduce

```powershell
npm ci
npm run build
npm test
npm run test:consumers
npm run test:real-world
node scripts/verify-connected-public.mjs
```

Browser tests require local Chrome; configure supported browser paths as described
in the README. External runs depend on the public sites and network availability.
Review their current rules before rerunning. The live harness uses an ephemeral
port and a unique ignored `work/real-world/<timestamp>` directory. It records
sanitized JSON under `validation/results/` and stops its runtime when finished.

To verify all six consumer UIs in the same disposable workspace:

```powershell
node scripts/verify-real-world.mjs --keep-running
# In another terminal, use the private configuration path printed by that run:
node scripts/verify-consumer-apps.mjs work/real-world/<timestamp>/consumer-config.json
```

Stop the retained harness after checking the apps. The private configuration
contains disposable scoped keys and must stay in ignored `work/`. The public
evidence contains no API keys, passwords, cookies or database files.

## Limits and blocked acceptance

- No real conversational language model is configured in the MCP consumer.
  Tool discovery and invocation are real; model conversation is unverified.
- No authorized external private account was supplied for this release's tests.
  External session expiry/re-authentication and private generation are unverified.
  Controlled authentication regressions are not a substitute for those tests.
- Images/video require Connected Chrome, a compatible website DOM and usable
  result URLs. Protected assets, temporary blob/canvas data and provider behavior
  can prevent extraction or embedding. Universal media compatibility is not claimed.
- Managed mode supports authorized GET/HEAD retrieval only. It cannot perform
  generation, purchases or arbitrary mutations. It never silently changes modes.
- The computer and independent runtime must stay available. Connected execution
  additionally needs the explicitly authorized Chrome tab and current lease.
  Runtime/Chrome restart requires explicit companion reconnection.
- The durable execution queue is globally serial, with a bounded admission limit.
  This release is not a high-throughput distributed browser platform.
- There is no independent security audit, signed installer, hosted service or
  guarantee of compatibility with every website. Windows was exercised here;
  other operating systems have not received equivalent end-to-end release testing.

Early failed exploratory runs remain timestamped in `validation/results/`.
The release index identifies the final runs. An ambiguous multi-element wait was
replaced with the page's unique heading in the harness; runtime ambiguity checks
were preserved. A baseline test port collision and a mobile overflow were fixed
or rerun explicitly, rather than being counted as successful tests.
