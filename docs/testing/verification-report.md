# Execution verification

Assessed on 21 October 2026 (Asia/Colombo; evidence timestamps use UTC).

This section records the earlier release assessment. The subsequent production
upgrade changes schemas and adds features; its current checks and limitations
are tracked in [Production upgrade](../architecture/production-upgrade.md).

This records the assessed local implementation and reproducible checks. It is
not an independent security certification or a guarantee about arbitrary sites.
Evidence files and browser screenshots remain in ignored local directories.

## Environment

- Windows x64; Node.js `v26.3.0`; npm lockfile installation.
- Chrome `155.0.8059.85`; Playwright `1.64.0`.
- Intel Core i7-13650HX. Browser sandbox enabled for execution fixtures.
- Disposable encrypted workspaces and ephemeral loopback ports. No real account,
  payment, destructive external operation, cloud browser or model was required.
- Production companion uses `activeTab` and `scripting`. CDP extension loading
  belongs only to disposable acceptance harnesses.

CI's Node 24 environment was not run remotely during this work. No CI jobs,
dependency versions, lockfiles, public endpoint paths or database schemas were
changed by this increment.

## Baseline and final checks

| Command/check | Observed result |
| --- | --- |
| Baseline `npm run build` | Passed TypeScript and Vite. |
| Baseline `npm test` | 301 passed; 0 failed, cancelled or skipped; 843,356.611 ms. |
| `npm ci` | Passed; 295 packages installed, 296 audited, 0 reported vulnerabilities. |
| Final `npm run build` | Passed TypeScript and Vite after clean installation. |
| Final `node --test tests/output-editor-ui.test.mjs` | 1 passed against the final production UI; 1440/375 px and advanced-contract preservation. |
| `npm run test:consumers` | 23 passed; 0 failed, cancelled or skipped. |
| Final `npm test` | 343 passed; 0 failed, cancelled or skipped; 978,713.840 ms. |
| `npm run test:real-world` | Passed; 20 checks, including expected negative outcomes. |

There is no separate lint script in the manifest. Dedicated Gitleaks/TruffleHog
scanners were unavailable. A bounded source-token scan found no candidate long
Hermo/provider tokens or private-key blocks in the assessed working tree; that
is not an exhaustive secret-scanning guarantee. Repository rules passed for all
255 eligible tracked/new files; UTF-8 and relative-link checks passed. Root file
count remains 14, and the README remains 190 lines. The final diff has no deleted
source files or dependency/lockfile changes.

Some initial browser/build/consumer commands were blocked by sandbox process,
filesystem or loopback permissions. Approved executions outside that sandbox
resolved those environment failures. The first benchmark configuration was
rejected by the existing HTTPS path-template rule; the corrected benchmark uses
an ordinary owned-page recording. Its polling was slowed to respect rate limits.
No product protections were relaxed for those checks. One Node 26 build
process asserted in libuv during shutdown after Vite generated its assets;
the immediate repeat exited successfully. The remote Node 24 runner remains
unverified here.

The strict success gate exposed older test fixtures with missing verification
evidence. They now attach evidence from the real verifier. Additional regression
assertions reject malformed results, absent proof and wrong-version proof while
confirming an adapter cannot rewrite accepted runtime provenance.

Failure testing also reproduced marker changes during a disabled final target's
readiness wait in both adapters, and during the companion's second readiness
wait. The fixes capture after readiness, refresh during managed actionability
retries, and atomically compare companion baselines before input. Companion
0.7.2 adds capability negotiation so older versions cannot silently omit this
check. The old security-effect unit fixtures were updated to start their step
before the issuing event, matching the enforced lifecycle; their uncertainty
assertions were retained.

## Actual browser coverage

The full suite includes local browser and protocol tests for recording, dynamic
inputs, navigation, forms, native select/checkbox, delayed content, frames, shadow
DOM, lists, nested outputs, media freshness, authentication/origin boundaries,
revocation, approval replay/expiry, queue isolation, cancellation and recovery.
Targeted new checks exercised:

- Strict integer, enum, numeric/length/format/pattern and collection constraints.
- Exact nested diagnostic paths; no captured values in errors.
- Row quantifiers, duplicate complete records/keys and typed comparisons.
- Both adapters accepting identical results with changed settled markers, and
  rejecting static markers, markers changed by earlier fills, and mid-read races.
- Real nested integer extraction in both browser modes, with trusted conversion.
- Owner editor saves/reopens constraints and rules at 1440 and 375 CSS pixels,
  named controls, keyboard focus and no horizontal overflow.
- Basic input editing preserving advanced, optional and nullable output mappings.
- Existing immutable publications and accepted-run snapshots surviving draft
  edits, rollback and runtime restarts.

## Three executable demonstration applications

Run from a clean installation:

```sh
node scripts/verify-trusted-execution.mjs
```

The runner creates an owned local site, opens the actual production companion
in disposable Chrome, and records/tests/publishes through owner HTTP routes.
It does not seed workflow records directly in SQLite.

| Application | Verified behavior |
| --- | --- |
| `json-explorer` | Published structured table, converted prices/quantities; unrelated categories and invalid quantities fail without a result. |
| `approval-console` | Actual native form POST pauses; owner approval allows it; rejection and pending state emit zero POSTs. Consumer has no owner cookie or approval permission. |
| `mcp-tools` | Actual UI discovery/invocation/polling plus SDK `Client`/`StreamableHTTPClientTransport`; REST/MCP schema parity and cross-key denial. No conversational model is configured. |

The initial complete demonstration observed **9 accepted runs: 6 succeeded and
3 deliberately failed**. All reached terminal states. Exactly 3 form POSTs were
observed: recording, approved owner test, approved consumer invocation. There
were zero POSTs after rejection. The automated test repeats these acceptance
assertions as part of the full suite. Reports contain safe metadata, not API
keys, owner cookies, proposed form values or transport credentials.

## Permitted public websites

```sh
npm run test:real-world
```

The existing harness completed against Books to Scrape and Quotes to Scrape,
with dynamic category/page selection, typed collections, unchanged reads,
concurrent admissions, publication/rollback, idempotency and restart behavior.
It also verified invalid-input 400, invalid-key 401, wrong-scope 403 and missing
record failures. Those expected negative results are successful test assertions.

The [sandbox's permission page](https://toscrape.com/) returned HTTP 200 and
describes these fictional sites as scraping practice targets. Both robots.txt
requests returned 404; no robots directives were inferred. No authentication,
anti-bot bypass, external form submission or account mutation was tested.
Observed run: 2026-10-20 17:50:28.488–17:52:14.931 UTC. The local report is
`validation/results/real-world-2026-10-20T17-50-28-473Z.json`.

## Performance observations

The same benchmark was run before and after the changes:

```sh
node scripts/benchmark-runtime.mjs work/runtime-baseline.json
node scripts/benchmark-runtime.mjs work/runtime-after.json
```

It provisions a real owner-recorded numeric read, verifies and publishes it,
closes the studio browser, admits six REST runs together and checks every
result. It also measures 30 health requests, 1,000 SQLite reads and 1,000
100-row conversions following 200 warm-up iterations.

| Measurement | Before | After |
| --- | ---: | ---: |
| Runtime creation | 68.97 ms | 65.95 ms |
| Health HTTP median / p95 | 0.452 / 1.146 ms | 0.445 / 1.053 ms |
| Browser open | 270.29 ms | 248.88 ms |
| Admission HTTP median / p95 | 3.439 / 4.285 ms | 3.488 / 6.411 ms |
| Queue wait median / max | 3,159 / 5,181 ms | 3,205 / 5,236 ms |
| Execution median / max | 901 / 911 ms | 915 / 922 ms |
| 1,000 SQLite reads | 15.49 ms | 16.49 ms |
| 100-row conversion median / p95 | 0.0316 / 0.0426 ms | 0.0539 / 0.0762 ms |
| Parent process RSS at end | 194,953,216 bytes | 203,075,584 bytes |
| Parent CPU user / system | 1.047 / 0.250 s | 1.250 / 0.344 s |
| Whole benchmark wall time | 18.92 s | 19.97 s |

These are individual local observations, not controlled performance estimates.
Small sample counts, filesystem caches, GC and host load affect the results.
CPU/memory exclude Chromium child processes. New validation adds work; the
measurements do not establish a speed improvement. Approval waits intentionally
block the serialized queue; its configured execution timeout begins at dispatch,
while reported total duration includes queue time.

## Compatibility and remaining limits

Existing public statuses, endpoint paths, legacy scalar conversion and raw
input-correlation rules remain. New diagnostic fields and richer contracts are
additive. The companion wire maps integer extraction to raw numeric text for
compatibility; integer enforcement remains in the runtime. Old companions still
need updating for the semantic command guard and new explicit completion policy.

No destructive data migration is required. Back up the data directory using the
installation guide before upgrading. Existing successful historical runs remain
readable; terminal records are not rewritten to manufacture new evidence.

The following remain outside a universal readiness claim:

- Third-party authenticated production accounts, actual purchases/deletions and
  arbitrary provider image/video generation were not exercised.
- Website semantics can change without changing a recorded accessible name.
  An explicitly configured marker cannot prove that a site honestly committed
  its business operation. Authors must select meaningful checks and inspect
  uncertain submissions.
- Recovery tests cannot establish exactly-once remote side effects. Interrupted
  mutations fail for reconciliation instead of replaying automatically.
- The implementation uses a single global queue; an approval wait reduces
  throughput for other connections. Cloud/distributed scheduling is absent.
- Abrupt machine power loss, all operating systems and the remote Node 24 CI
  runner were not covered by this verification run.
- HOL Guard/OPA/Temporal integration is deliberately absent. No protection by
  those systems, external telemetry or independent audit is claimed.

See [trusted execution](../architecture/trusted-execution.md),
[permissions](../security/workflow-permissions.md),
[approval](../security/human-approval.md) and
[output verification](../reliability/output-verification.md).
