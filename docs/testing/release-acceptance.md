# Release acceptance — 22 October 2026

These checks cover the three requested pre-publication gates. They do not publish
the repository, alter the owner's live workspace, or certify arbitrary websites.

## Clean installation

Cloned the actual public repository into `work/release-github-clone`, at commit
`5c4df1d1cca64106c87ed979cc474e1ad5f01b43`. Ran `npm.cmd ci`, `npm.cmd run build`
and `npm.cmd start`. The server became healthy and its rendered dashboard showed
the new-workspace password form. No existing workspace, dependencies or build
were copied into that clone.

Separately copied the current candidate's maintained source files, including
untracked product files, into `work/release-candidate`. Excluded ignored runtime
data, browser profiles, dependencies, build output and Git metadata. Installed
with its lockfile, built it, and downloaded Playwright Chromium into a new
`PLAYWRIGHT_BROWSERS_PATH`. Tested the actual `Start Hermo.cmd --no-open` launcher
on a disposable port; it installed dependencies, built, started and displayed the
fresh-workspace screen. The browser-opening side effect was suppressed.

Both tests used installed Node.js 26.3.0 and Windows under the current ordinary
user account. This is a fresh project/workspace/browser installation, not a fresh
Windows VM or a new OS account. npm's registry cache and host configuration were
available. Node.js installation itself was not tested.

Found and corrected the companion's initial port mismatch: new installations now
use 4317, matching the runtime. Saved custom addresses remain unchanged.

Evidence: `work/release-github-{install,build}.log`,
`work/release-candidate-{install-final,build-final,browser-install}.log`,
`work/release-install-smoke/result.json` and its screenshots/launcher logs.

The public clone installs, but contains the older feature set and SDK. The new
candidate is still local: publishing requires including its maintained untracked
files and reviewed changes. The clone test does not establish that these changes
are already available from GitHub.

## Independent security review

An independent reviewer inspected the profile vault, Windows locks, browser lifecycle,
HTTP/CONNECT proxy, sandbox socket relay, published authority, reset boundaries
and MCP input limits. It independently reproduced a P2 failure: when Chromium's
close operation rejected, Hermo could archive unflushed profile files, delete the
working directory and release its lease while the browser remained alive.

Corrected both normal-close and startup-error cleanup. Failed closure revokes the
network grant, attempts to stop the browser, and discards uncommitted files only
once closure/disconnection is confirmed. If the process cannot be stopped, its
directory and connection lease remain held. Full shutdown reports a busy profile
instead of silently releasing that lease. The reviewer independently reran its
original reproduction and confirmed the correction.

The reviewer also implemented proxy socket revocation; a second reviewer reviewed
that patch independently. Existing tunnels and sandbox upstream sockets now
belong to their grant. Revocation destroys them, reduced scope closes removed
origins, and a dial completing after revocation cannot restore a tunnel. HTTP
upstream sockets are not pooled across grants. Deterministic tests exercise these
cases without external DNS or private-network exceptions in production policy.

Dependency auditing found the installed MCP SDK 1.31.0 affected by advisories.
Updated the locked SDK to 1.32.0 and explicitly configured
`maxToolInputElements: 10000`. Hermo also retains its 24 KiB HTTP body limit and
stricter bounded workflow-input validation. The SDK advisory requires opting in
to its element limit, not only upgrading:
[GHSA-46jr-4wx8-v453](https://github.com/advisories/GHSA-46jr-4wx8-v453).
Added a regression proving excessive arguments cannot enqueue a run.
The final lockfile audit reports **zero known vulnerabilities**.

This is independent code review and targeted fault injection, not an external
penetration-test certification. No confirmed high/critical boundary bypass was
found in the inspected code. Same-user hostile processes, physical disk erasure,
provider policy changes and compromised browser binaries remain outside these
checks.

## User journey

`scripts/verify-release-journey.mjs` starts the separately installed candidate
against an empty data directory, without an externally supplied master key.
It uses real Chromium, real owner/consumer HTTP routes, the production encrypted
store and queue, and an owned authenticated form website. It does not seed the
database or replace the browser/execution adapter.

1. Create a workspace through the rendered first-run UI; verify Windows DPAPI
   key creation.
2. Explicitly authorize the managed website connection, sign into the synthetic
   account and confirm its account identity.
3. Record a parameterized form fill and POST submission, select the returned
   output, verify fresh output and publish the reviewed immutable workflow.
4. Invoke through REST and MCP; verify successful results.
5. Close the original managed website tab and owner dashboard; invoke through
   both protocols again.
6. Stop the runtime process, start a new one using the same directory and verify
   that the owner dashboard is locked. Invoke through both protocols without
   reopening the original tab or logging into the owner dashboard.
7. Verify exactly eight website submissions: recording, owner verification and
   six consumer calls. No duplicate submissions and no rendered UI exceptions.

The final run passed after the security fixes. Evidence:
`work/release-journey/2026-10-22T14-09-31-989Z/result.json` and
`work/release-journey-final.log`. Onboarding is driven through the UI; recording
and publication use the dashboard's normal owner HTTP controls. This does not
claim a fully manual click-through of every authoring screen or a paid provider
test. Closing/restart independence applies to managed workflows; connected Chrome
still requires its paired tab and valid authorization lease.

Live public website checks also passed after proxy hardening: JavaScript Quotes
to Scrape, httpbin form POST, and WebSocket.org secure echo. Evidence:
`validation/results/managed-websites-2026-10-22T14-10-30-609Z.json`.

## Regression status

The first hosted Windows checks exposed a publication-readiness race after an
approved verification completed in the Runs dialog. Reopening the test dialog
could retain a card's older unverified state. The dialog now refreshes the current
server-side draft on opening and draft changes; run completion also refreshes
the overview. A deterministic regression holds a stale card snapshot and delays
the readiness response, confirming that publication stays disabled until fresh
verification evidence arrives and permissions are acknowledged. No permission,
approval or verification gate is bypassed, and no test timeout was increased.

Final integrated suite passed: **555 tests, 554 passed, 0 failed, 1 skipped**, in
1,249,085 ms (20 minutes 49 seconds). Complete output:
`work/release-final-suite.log`. This includes the failed-close/startup regressions,
proxy revocation cases, excessive MCP argument rejection, and packaged companion.
The ordinary-account Windows file-symlink case is skipped; its separate
administrator verification already passed and remains documented in
[managed-browser acceptance](managed-browser-upgrade.md).

Additional focused security regressions: **16 passed, 0 failed**. Consumer checks:
**28 passed, 0 failed**. Candidate TypeScript/Vite build and repository checks pass.
The final audited lockfile has **zero known vulnerabilities**. The subsequent
documentation and interface-copy cleanup also passed the production build,
**28 consumer tests** and **21 focused interface, repair and repository checks**.
Generated evidence, local data and profiles are excluded from the release tree.
