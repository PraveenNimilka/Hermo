# Validation records

- [Repository cleanup](repository-cleanup.md) — scope and verification for the documentation and hygiene pass.
- [Release snapshot](current.md) — capabilities and checks recorded before this cleanup.
- [Real website acceptance](real-world.md) — permitted public-site checks, results and limitations.
- [Related fixes](bugfixes.md) — failure cases found during that acceptance work.
- [Dated evidence](2026-10-16/) — original JSON results and screenshots, retained for review.
- [Earlier milestones](../archive/README.md) — historical plans and validation reports.

## Generated output

The committed snapshots have moved here. Verification scripts keep their existing
output contracts: they still write fresh local results to `validation/results/`,
screenshots to `validation/evidence/`, or `PUBLIC-INTEGRATION-VALIDATION.json` at
the repository root. These generated locations are ignored by Git.

Fresh reports can contain website data. Review them before sharing. Do not commit
local runtime databases, browser profiles, account captures or consumer key secrets.
Use disposable state for tests rather than an existing owner's workspace.

Automated fixture results and dated external-site results are different evidence.
No independent security certification or universal website compatibility is claimed.
