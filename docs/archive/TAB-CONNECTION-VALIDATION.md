# Immediate selected-tab connection validation

15 October 2026. User-requested change: connect companion tabs without detecting or confirming an account name/email.

## Implemented behavior

- Owner-authorized, exact-origin pairing immediately saves Connected and a selected_tab origin binding in the existing encrypted connection payload. Existing active native links can adopt this binding; offline saved setups cannot claim a live connection.
- The built normal-tab UI has no Account marker or Confirm this account controls. Creating a Connect code and consuming it in the actual extension automatically completes the dialog. Initial preview errors retry. A fresh code cannot be falsely completed by an older live connection, including the manual Check button.
- Runs use the website account currently signed in to that selected tab. Name changes and hidden profiles do not require confirmation. Native run verification reports selected_tab_origin (public tabs retain public_source_origin); it does not claim vendor-account identity proof.
- Recording and replay require a ready website. A detected sign-in/challenge fails without a successful result but keeps live transport Connected; completing sign-in permits retry without a new pair or confirmation.
- Companion 0.4.1 immediately shows Hermo connected and Stop. Same-origin reload and popup closure retain active authority. Stop, tab/scope loss, owner lock/expiry, restart or lost transport end it. The manual diagnostic controller shares recoverable/terminal error behavior.
- Owner authentication, CSRF, one-use grant, selected-tab permission, exact-origin/path rules, scoped keys, output/freshness checks and isolated browser account verification remain. No dependency/schema migration or user data reset was introduced. Account confirmation remains only for optional isolated/legacy import flows.

## Evidence

Targeted runtime/transport/lifecycle suite: 24 passed, 0 failed in 181 seconds (`work/no-account-runtime-tests.log`). It exercises actual Chrome extension/website tasks without a visible private-account profile: chat, media, read-only weather, search, form submission and custom tasks, owner tests/publication, REST/MCP, consumer UI, stale media rejection, login recovery, Stop/reconnect and encryption migration.

Targeted connected-browser integration: 18 passed, 0 failed in 114 seconds (`work/no-account-connected-tests.log`). Actual Chrome covers hidden-profile connection/reload, UI recording/repair, full fresh replies, changing profile text, REST/MCP, consumers/revocation/deletion and source/credential/owner boundaries. Full regression validation includes the final deterministic transient-preview assertion.

Automatic UI pairing/private task follow-up: 14 passed, 0 failed in 98 seconds (`work/no-account-auto-pair-tests.log`). This includes creating the code in the built owner UI, invoking the production popup on the actual website tab, transient callback failure followed by automatic completion, fresh-code guards on both automatic and manual checking, and six task families without account markers. Final full regression rerun: **134 passed, 0 failed, 0 cancelled, 0 skipped**, 500.3 seconds (`work/no-account-full-tests.log`). It includes the six private task families, final pairing/recovery guards, every main dashboard screen at desktop/tablet/mobile widths, monochrome alignment, account-isolated legacy behavior and API/owner/resource boundaries. The initial broad run passed 122 checks and failed only the new fixture because Chrome focus stayed on the owner UI while opening the companion. Focusing the website before invoking the popup corrected the fixture; no permission check was relaxed. Production TypeScript/Vite build passes. Changed-source UTF-8/trailing-whitespace scan and git diff --check pass (Git reports only existing line-ending conversion notices).

Main server restarted on http://127.0.0.1:4318 and serves index-uuymp52r.js. Home, chat consumer and connection guide return HTTP 200. Saved .hermo browser/app/action/key/run data remain. Refresh/unlock Hermo, reload the unpacked companion and reconnect the saved website tab once after the update. No account name selection is required.

## Scope and limitations

Owned disposable websites and synthetic credentials were tested; this is not an authenticated live Gemini certification. DOM-based controls/outputs and existing permission limits still apply. The tab connection cannot guarantee an unexpired website sign-in, and cancellation cannot undo a transmitted submission. Companion account switching now follows the current website session instead of an account pin; the authorization text and guides state this explicitly.

## Rollback and review

Original target copies: work/no-account-confirmation-baseline. Reference/impact record: work/no-account-confirmation-impact.md. Independent read-only review identified and verified correction of completion retries, LOGIN_REQUIRED recovery copy, manual pending-code handling and terminal controller cleanup. No remaining blocker was found.
