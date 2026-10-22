# Managed browser upgrade — 22 October 2026

## Authority and compatibility

Existing definitions with `effect: retrieval` retain GET/HEAD-only replay and
deny sockets. A definition explicitly configured with
`effect: recorded_browser_actions` can issue HTTP methods and WSS only within
its frozen, reviewed origin scope. Changing that effect changes the draft hash,
permission fingerprint and breaking-change review; existing immutable revisions
are not rewritten. Approvals still gate the exact configured browser steps.
Website scripts may issue requests before or after a step; step approval does
not classify every background request. No failed/uncertain submission is replayed.

## Complete profile persistence

Authenticated connections use Playwright `launchPersistentContext` with a fresh,
private working directory. Before Chromium goes online, Hermo installs its origin,
method, socket and download guards. Restored pages are discarded; each invocation
navigates anew and must prove account identity and output freshness. Public
connections remain anonymous and do not restore private profile files.

On orderly context closure Chromium flushes its files, then Hermo encrypts the
complete directory into `managed_profile_files` using the runtime's existing
AES-GCM key protection. Each authenticated record binds connection ID, file index,
relative path and content. A SQLite savepoint replaces the prior snapshot only
when every file is ready. Cookie snapshots migrate into the first disk profile;
session-only cookies are retained alongside Chromium's files. Personal Chrome
directories are never opened. Reset/removal deletes the encrypted profile as well
as the previous logical session authority.

Readable working files are necessary while Chromium runs. They live in
`managed-profile-active` beneath the protected runtime directory, are deleted on
closure, and abandoned copies are discarded at the next exclusive runtime start.
They must not be included in live backups. Disk/device encryption and OS account
protection remain necessary for working files and same-user hostile software.
Deleting files is not a secure disk erase. A hard process kill may lose changes
since the last completed encrypted snapshot; recovery uses that snapshot and never
repeats the interrupted workflow. An application login expired by its provider
still requires explicit sign-in.

Paths reject traversal, links and hard-linked files. Snapshot limits are 10,000
files, 64 MiB per file and 512 MiB total; exceeding them fails persistence while
preserving the prior committed snapshot. Chromium process locks are excluded.
The existing per-connection SQLite leases serialize opens across managers and
processes. Service workers, arbitrary downloads and personal browser imports
remain disabled. These limits are deliberate supported boundaries.

## Acceptance evidence

New tests cover encrypted disk files/cache/session cookies, independent restart,
connection isolation, tampered records, traversal, abandoned directories, POST,
PATCH, socket results and retrieval-mode denials. Existing managed runtime tests
retain owner/CSRF gates, expiry/account mismatch, cancellation, reset, alternate
targets and immutable-version tests. Public compatibility checks are opt-in via
`node scripts/verify-managed-websites.mjs`; generated evidence is local and ignored.
Final full-suite and live-site outcomes are recorded in the testing report.
