# Workflow refinement verification

Date: 2026-10-14. This refinement preserves the existing workspace and builds on the previously verified ChatGPT and output-only workflow.

## Changes

- Management screens remove repeated onboarding and duplicate create/publish controls, move legacy cookie-import setup into Advanced, select the correct action in documentation, and paginate run history.
- Actions and API keys can be deleted. Connections, saved browsers, actions, key revocation/deletion and account forgetting require the exact displayed `Delete "<name>"` phrase in the UI. Destructive dialogs describe affected resources. Active runs, including cancelled workers still unwinding, block destructive removal. New action/key removal endpoints require exact current-name confirmation on the server; older owner endpoints remain compatible with existing callers.
- Action removal deletes its runs and keys together in a transaction; connection/browser setup remains. Key removal retains completed run and idempotency records. Browser directory removal cannot race a new connection binding and is restricted to the managed profile directory.
- Account pickers use eligible identity fields instead of conversation text. Confirmation pins the selected text to reject a changed account. Outputs and controls are classified separately; navigation and feedback controls are secondary. Rich replies, named inline data fields and output-only values remain selectable without wrapper duplicates.
- Companion 0.3.0 connects from the website popup without opening another tab. Its fixed website panel has Stop. Active authority stays in worker memory, never in website DOM or persistent storage. Popup closure and supported website reload keep access; Stop, owner lock, scope exit and transport failure end it. The old controller remains an explicit Advanced fallback.

## Verification

- Initial complete regression suite: 112 passed, zero failures, cancelled or skipped (391.8 seconds).
- Final production build: TypeScript and Vite passed; main asset `index-DBkpxbrc.js`.
- Final built management UI also passed separately after allowing visual animations to settle. Desktop overview, deletion dialog and 390px mobile layout were inspected; no page overflow or browser errors were detected.
- Additional public website validation found that a paragraph containing a separately named date and location suppressed the date field. The inspector now preserves explicit inline data fields before considering their prose wrapper. A regression reproduces this structure; all 13 targeted inspection/identity checks passed after the fix.
- External public checks after that fix passed: Books to Scrape and Quotes to Scrape, two different records per site, missing-record rejection, anonymous replay, scoped keys and revocation. Results: `PUBLIC-INTEGRATION-VALIDATION.json`; log: `work/cleanup-public-tests.log`.
- Final `npm test` after that fix: **113 passed, 0 failed, 0 cancelled, 0 skipped**, in 387.4 seconds; log: `work/cleanup-final-tests.log`.
- Final `npm run build` after that fix passed TypeScript and production bundling; log: `work/cleanup-final-build.log`.
- The restarted main server returned HTTP 200 for the application and companion guide, served the final bundle, advertised companion 0.3.0 and reported `setup_required: false`. The existing workspace remains configured.

Tests use disposable databases, synthetic account identities and temporary Chrome profiles. No personal website account is used for the automated checks. The existing main workspace was not reset or pruned. Tests cover real browser DOM execution, REST/MCP, authorization, cancellation, deletion transactions, UI selection, output-only workflows and the background connection lifecycle.

No pre-existing test failure was observed. The additional public check exposed the inline-field regression introduced during this refinement; it was fixed and both public checks and the complete suite passed afterward. No source files were renamed or removed, no dependencies were changed by this refinement, and legacy routes remain available. Baseline review and `git diff --check` found no whitespace errors; test logs, databases and screenshots remain in ignored `work/` storage.

## Using the update

Open `http://127.0.0.1:4318/`, refresh and unlock your existing workspace. Reload the unpacked Hermo website companion once in `chrome://extensions`; its version must show 0.3.0. Close the old connection/controller tab and pair from the website popup using a new Connect code. Close the popup after connecting; the website panel remains available.

Saved setups persist until explicitly deleted. Browser/extension restart requires a fresh active pairing. This does not bypass website authentication or verification and does not guarantee support for every website. Automated tests establish the described flows and boundaries; personal live provider acceptance still depends on the website.
