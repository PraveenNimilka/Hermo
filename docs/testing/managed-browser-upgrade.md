# Managed browser acceptance — 22 October 2026

This supplements the initial [production-upgrade assessment](production-upgrade.md).
The implementation is described in [managed-browser storage and authority](../architecture/managed-browser-upgrade.md).

## Delivered

- Complete Chromium disk-profile snapshots encrypted with the existing runtime
  key, connection-bound records and transactional replacement. Existing logical
  sessions migrate automatically; public retrieval stays anonymous.
- Private working directories with explicit NTFS access rules on Windows, bounded
  snapshots, path/link rejection, profile leases, cleanup and safe crash recovery.
- Explicit website-action replay supports HTTP submissions and WSS within the
  reviewed immutable origin scope. Retrieval definitions retain GET/HEAD-only
  restrictions; drafts require fresh verification/publication after permission changes.
- Managed recording, editor/settings, permission manifests, REST/MCP descriptions
  and documentation reflect the supported capabilities.
- No automatic replay on crash, uncertain results, cancellation or persistence failure.

## Executed evidence

- TypeScript/Vite production build passed.
- New vault tests passed: encrypted file/cache records, restart, connection
  isolation, record swapping rejection, traversal and abandoned-copy cleanup.
- Real Chromium POST/PATCH/socket acceptance passed, including complete profile
  cache files and session-only cookies surviving restart, a killed browser process
  recovering the previous committed snapshot, no repeated submission, foreign-origin
  denial, and retrieval-mode POST/socket denial.
- Pending persistent launch/shutdown test passed: networking is never enabled
  after shutdown, proxy grants are released, no readable directory remains and
  no recovery snapshot is created by the canceled launch.
- Existing managed runtime acceptance passed: owner/CSRF authorization, isolated
  accounts, dashboard-independent API execution, runtime restart, expired sessions,
  identity mismatch, cancellation, alternate execution target and reset invalidation.
- Managed settings UI passed its real Chromium visibility/reset/consent checks.
- Public live compatibility: **3 passed**, against JavaScript-rendered Quotes to
  Scrape, the public httpbin HTML POST demonstration and WebSocket.org's secure
  echo page. Evidence: `validation/results/managed-websites-2026-10-22T12-54-02-784Z.json`.
  These are actual external pages, not mocked provider responses. No personal
  account, private conversation, paid API or provider login was used.
- Standard Windows lock suite: **7 passed, 1 skipped**. The skipped file-symlink
  case requires a privilege absent from the ordinary runtime account; junction,
  hard-link, process-death and cross-process exclusivity checks passed. A separate
  administrator check **passed at 13:10:22 UTC**, independently verified from
  `work/profile-file-symlink-result.json`: symbolic lock rejected, symbolic SQLite
  sidecar rejected and target unchanged. The user also supplied the matching
  administrator console output. This covers the privileged case without changing
  the ordinary runtime's Windows privileges or weakening the standard test skip.
- Existing Books/Quotes public REST/MCP live acceptance passed again. Evidence:
  `validation/results/real-world-2026-10-22T13-07-24-657Z.json`.
- **Clean full suite passed: 550 tests, 549 passed, 0 failed, 1 skipped**, in
  1,239,220 ms. The skipped ordinary-account file-symlink case is covered by the
  successful administrator verification above. Complete output:
  `work/production-upgrade-verified.log`.
- Consumer compatibility: **28 passed**. Repository hygiene passed for tracked
  files and an additional scan of **358 current maintained files**, with no issues.
- An earlier integrated run completed with
  **550 tests: 546 passed, 3 failed, 1 skipped** in 1,204,656 ms. The three failures
  were isolated and corrected: a CSP-incompatible test fixture, a test expiring an
  obsolete logical snapshot instead of the website session, and a genuine final
  observation/continued-wait transport race. Subsequent affected-file checks
  passed: managed form API **1**, managed editor/session **2**, connected steps **21**.
  The race fix permits a bounded 250 ms drain of read-only observations only;
  unresolved commands, late errors, cancellation and mutation tasks still fail closed.
  The subsequent clean integrated rerun above includes those fixes.
  The earlier development run
  completed with **535 tests: 513 passed, 21 failed, 1 skipped**. It encountered
  code while the Windows ACL setup was being corrected and old capability
  expectations. Those failures are retained in
  `work/production-upgrade-full-verification.log`; they are not reported as passes.

## Local application upgrade

Confirmed no active accepted runs before stopping the old local process. Saved
the complete stopped data directory, including SQLite journals and matching
DPAPI-protected key material, to a private backup outside the repository.
Started the updated runtime on `http://127.0.0.1:4317/`; `/health` returned `ok`
and the dashboard returned HTTP 200 with the new production bundle.
Read-only comparisons against the backup verified byte-for-byte identical rows
for **1 connection, 2 workflows, 3 API keys and 2 immutable revisions**. Only the
additive profile storage schema is new. The runtime restarts locked; unlock it
normally. Existing connected Chrome links may require a fresh pairing code.

## Boundaries

Website quotas, expired logins, CAPTCHA, access restrictions and future provider
changes are not bypassed. Public demo checks do not establish compatibility with
every authenticated provider. Service workers and arbitrary downloads remain
disabled. Tab session storage is not promised across discarded browser tabs.
Snapshots are bounded at 10,000 files, 64 MiB/file and 512 MiB total. Readable
working files exist while Chromium runs; abrupt power/process loss can lose changes
since the last complete snapshot. Protect the OS account and device, and exclude
active working directories from backups. See the architecture document for details.
