# Core reliability milestone validation

Date: 15 October 2026. Scope: milestone 1 of [the production readiness audit and roadmap](PRODUCTION-READINESS.md). This is an incremental reliability delivery, not a declaration that Hermo is ready for public release or supports every website.

## Implemented behavior

- One live runtime owns a data directory before initialization or interrupted-run recovery. An operating-system-released SQLite lock prevents a second process from touching a live owner's jobs. Existing encrypted workspace data is preserved.
- Runtime startup does not launch an unused isolated browser. Concurrent first use shares a launch. Stop, Lock, cancellation and shutdown invalidate pending startup work, so a late browser cannot resume navigation after revocation.
- Recovery preserves each interrupted run's version, accepted input, progress and possible-submission evidence. Unstarted jobs remain queued. Interrupted active jobs are not replayed automatically.
- Recording and execution exclude one another; accepted work blocks conflicting dashboard navigation, controls and tab replacement. Pairing codes and physical tab reservations are consumed before asynchronous work, preventing double pairing and authority races.
- Step issue/completion, queue wait, execution time and verification are durable observations. Errors distinguish cause and outcome certainty. A possible external submission followed by timeout, disconnection, cancellation or restart is an unknown outcome, with no automatic retry.
- Shutdown stops dispatch before HTTP draining, revokes live companion authority and flushes long polls before releasing storage ownership.
- Companion 0.5.0 restores valid idle grants after actual MV3 worker termination using trusted session storage and recovery alarms. Unknown in-flight work fails closed. A live command authorization check and absolute deadline protect delayed mutations; Stop prevents controls still waiting for readiness from later executing.
- The neutral dashboard reports actual runtime, queue, tab and authorization-lease health. Test/run details display step history, timing, verification and sanitized errors at desktop, tablet and phone widths.

## Verification results

The final full suite passed **154 tests, 0 failed, 0 cancelled, 0 skipped**, in 521.8 seconds. Production build, focused regression tests and live practice-site validation also pass.

| Check | Evidence and boundary |
| --- | --- |
| TypeScript and production build | `npm.cmd run build` passed; `work/production-core-build.log`. Main entry: `index-DgfYNvqF.js`. |
| Real Chrome companion lifecycle | Actual service worker stopped through Chrome's worker API, then recovered by its alarm. Idle transport interruption recovered. Stop during disabled-control readiness produced zero submissions. An unknown in-flight worker restart disconnected without replay. |
| Dashboard independence | Closed the authenticated React dashboard in real Chrome, changed website data and called a scoped published REST endpoint. A fresh result was returned with the dashboard still closed. The runtime and browser remained available. |
| Real extension workflow | Production extension popup, explicitly selected tabs, recording, parameter substitution, output verification, publication, REST/MCP, key scope, revocation, wrong-tab and credential-page boundaries run in the full suite against owned fixtures. These are not private vendor accounts. |
| Scheduler and state | Deterministic adapter tests cover serialization, recording reservations, cancellation cleanup, idempotency receipts after disconnection, verification phases and sanitized diagnostics. |
| Pairing and uncertain transport | Concurrent pairing reservations, stale capabilities, Stop/Lock races, lost operation acknowledgement, timeout, one mutation only, sibling disconnection and rejection of late authorization/replies. |
| Startup and shutdown | Deferred browser-launch tests prove late contexts close without navigation. A listening-server test holds a real companion long poll, queues a job, closes the runtime and proves no new dispatch during draining; queued work survives reopening storage. |
| Persistence | Encrypted interrupted records retain provenance; active mutations are never automatically replayed. Cross-process lock tests cover live ownership, failed initialization, clean close and abrupt process exit. |
| UI and accessibility-focused checks | Real Chrome at 1440, 768 and 375 pixels: step lists, status/error evidence, dialog bounds, no horizontal overflow or clipped diagnostic labels, neutral colors, runtime-unreachable state and no page errors. Synthetic stored records are clearly test fixtures. |
| Live external websites | `node scripts/verify-public.mjs` passed against Books to Scrape and Quotes to Scrape. Two records per site, dynamic input, publication, API polling, missing-record failure, scoped keys, cross-key isolation, traversal rejection, revocation and OpenAPI. Timestamped results: `PUBLIC-INTEGRATION-VALIDATION.json`; log: `work/production-core-public-tests.log`. |
| Running workspace | Existing workspace restarted at `http://127.0.0.1:4318`. `/health`, dashboard and companion guide return 200; the current production entry is served. No private workspace unlock or user credentials were used for this smoke check. |
| Source checks | JavaScript syntax and `git diff --check` pass. Git reports existing LF/CRLF normalization warnings, not whitespace errors. |

Full-suite command: `node --test --test-concurrency=1 tests/*.test.mjs`. Final log: `work/production-core-final-tests.log`.

An earlier complete attempt passed 149 of 150 tests. The sole failure was a stale extension mock missing the newly used `chrome.alarms` and session-storage APIs. The fixture was updated without relaxing production checks; its five focused checks pass. The final suite reruns the complete repository after that correction and the additional startup/shutdown race fixes. Browser launch and loopback network operations were denied by the normal sandbox, so these checks ran through the authorized execution path.

Visual evidence is saved under `work/runtime-ui/` (one directory per test run). The desktop overview and phone failure inspector were also visually inspected. Existing chart loading states were not redesigned in this milestone.

## Security and operating limits

- Reload the unpacked extension from `companion/browser` to **0.5.0**, unlock Hermo and reconnect the saved website tab. Old companion versions are rejected when they lack command guards.
- Closing the dashboard is supported. The local runtime process, computer and authorized browser must remain available. Explicit Lock revokes browser authority. Grants currently inherit the owner's four-hour unlock lease; browser/runtime restart can require pairing again.
- Active companion cancellation or timeout invalidates that tab link. Other accepted requests on it fail as disconnected with separate records. Cancelling an unstarted queued request leaves the link intact. Cancellation cannot undo a transmitted website submission.
- Scheduling remains globally serial, with a fixed queue limit of 30; this is conservative shared-tab isolation, not a configurable per-tab parallel scheduler.
- Accepted inputs and results are encrypted, not fully classified or redacted. The new step metadata excludes values/selectors and new error records are sanitized, but sensitive-input classification across recording and exports is still a release gate.
- General action workflows can still need stronger fresh-completion evidence. A nonempty output does not establish business truth or completion of every asynchronous website task.
- Typed/default/optional inputs, nested/list output contracts, immutable published revisions, projects, a general step editor, full API playground, packaging and complete release acceptance remain planned. Existing `/versions/1` endpoints are preserved and do not imply complete workflow version history.
- No external accounts were created; no private Google, Gemini, ChatGPT, Claude or other vendor session was certified. Owned fixtures and explicitly permitted public practice websites provide the stated evidence.
- No cloud browser, remote credential synchronization, arbitrary JavaScript API or public runtime exposure was introduced. No independent security audit is claimed.
