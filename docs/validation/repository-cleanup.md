# Repository cleanup

Scope: behavior-preserving repository maintenance on `chore/human-repo-cleanup`.
The baseline was the existing release commit `b76c7fa`.

## Audit and actions

| Finding | Action |
| --- | --- |
| 40 tracked root files, including milestone plans and reports | MOVE explanatory guides into `docs/`; ARCHIVE historical records. |
| 24 committed evidence/result files at a generated output location | MOVE to a dated validation snapshot; ignore future regenerated output. |
| 268-line README with overlapping feature and release notes | KEEP detailed text in `docs/reference.md`; replace the entry point with a 122-line README. |
| Runtime, dashboard, public pages, extensions and scripts | KEEP paths and behavior; no framework or architecture rewrite. |
| Scripts generate reports at established locations | KEEP output paths; document the difference between generated files and committed snapshots. |
| Tests, fixtures, licenses, lockfile and CI | KEEP; only replace a personal name in one fixture and its matching assertion with synthetic data. |
| Missing installation and task walkthrough | ADD installation, user, configuration and architecture guides with a docs index. |
| Missing package description/repository metadata and editor defaults | ADD verified metadata and a small `.editorconfig`; no version, dependency or formatting changes. |
| Private local state, downloaded agent skills and working files | KEEP ignored and unpublished. |
| CI already covers install, build and tests | KEEP behavior unchanged. |

The root now has 13 tracked/intended files. The cleanup moves 53 existing files
and deletes none. Source directories remain intact. The full old README is
retained rather than silently discarding operational caveats.

## Verification

Before changes, `npm ci` and `npm run build` passed, followed by **246 application
tests and 22 independent consumer tests**, with no failures or skips.

The same final checks passed on Windows with Node.js 26.3.0 and npm 11.16.0:

| Check | Baseline | After cleanup |
| --- | --- | --- |
| `npm ci` | Passed | Passed |
| `npm run build` | Passed | Passed; generated application asset names unchanged |
| `npm test` | 246 passed | 246 passed, zero failures or skips |
| `npm run test:consumers` | 22 passed | 22 passed, zero failures or skips |
| Relative Markdown targets | 41 files, zero broken targets | 52 files, zero broken targets |

There is no separate lint script; the build includes TypeScript checking.
Both installs reported the same npm allow-scripts warning for esbuild; neither
the install policy nor dependencies were changed to suppress it.

The documented runtime entry point booted with disposable data. Health,
dashboard assets and public guides returned 200; an unauthenticated owner route
returned 401. Read-only checks of the existing workspace confirmed unchanged
record counts, encrypted workflow/connection payloads, key records and master-key
fingerprint, with database integrity intact. Existing owner data was not reset.

Reference checks found no stale imports or broken relative Markdown targets.
The remaining original report-path reference is an intentional script output
contract. Lockfile, dependency versions, application behavior files, licenses
and CI were compared against the baseline and remain unchanged. The only test
fixture edit substitutes a synthetic name and updates its matching assertion.

## Sensitive-data review

No installed Gitleaks or TruffleHog was available. A read-only fallback scan
checked the working tree, intended additions, staged snapshot and reachable Git
history for token prefixes, private keys, Bearer/master-key literals, credential
URLs, JWTs, personal paths and email patterns. Matches were
manually classified as synthetic fixtures, email recognition code or unsafe-URL
rejection tests. No real credential was identified. That is not independent
security certification.

A personal fixture name was replaced with synthetic data. The earlier commit
still contains its original text; history was not rewritten. Intentional synthetic
credentials remain in tests so rejection behavior is still exercised. No provider
credential was rotated or removed. Private workspace data was not used for tests.

## Kept on purpose

- Application source layout and defensive/security checks: no proven need for a
  behavior-preserving rewrite was established.
- Historical plans and reports: archived with repaired references, not deleted.
- Served HTML guides and consumer apps: load-bearing paths remain available.
- CI, licenses, lockfile and dependency versions: unchanged.
- Runtime-generated report paths: retained for script compatibility.

## Owner follow-up

- Review and merge the cleanup branch; no default-branch merge is implicit.
- Set GitHub About text if desired: “Turn authorized website workflows into local
  REST APIs and MCP tools.” Suggested topics: `browser-automation`, `local-first`,
  `rest-api`, `mcp`, `chrome-extension`, `developer-tools`.
- Choose maintainers before adding CODEOWNERS; no identities were invented.
- Consider GitHub secret scanning and push protection where available.
- Choose a dashboard screenshot for the README. Existing dated screenshots remain
  in this validation archive; no synthetic product image was added.
- Consider a `v0.1.0` tag after reviewing release limitations. No tag or changelog
  history was invented during cleanup.

Private third-party account workflows, media portability, macOS/Linux and
independent security review retain their documented limitations. This maintenance
pass does not certify universal website support or production readiness.
