# Verification record

Executed locally on 12–13 October 2026, Windows, Node 26.3.0, installed Chrome fallback. Synthetic accounts only. Logged-out public ChatGPT/Claude pages were additionally inspected on 13 October; no public deployment or live customer/vendor account login was involved.

## Automated results

- `npm.cmd run build`: TypeScript strict checking and Vite production build passed. Vite reports a size warning for the ~821 KB JavaScript chunk (~251 KB compressed); this is a performance follow-up, not a passed performance benchmark.
- `npm.cmd test`: **24 tests passed, 0 failed, 0 skipped** in the final run. These comprise seven network/storage tests, nine original end-to-end subtests and their parent, and six browser-compatibility/security subtests and their parent.
- After the final dropdown-label and wrapping correction, `node --test tests/browser.test.mjs` passed again: **7 tests, 0 failed**. The final TypeScript/production build also passed.
- `npm.cmd audit --json`: **0 reported vulnerabilities** among 340 dependency entries at check time. This measures known registry advisories, not application security or absence of undiscovered vulnerabilities.

Checks exercised:

1. Private/reserved/mapped IP denial and public HTTPS URL admission.
2. Proxy authentication and denial of private, nondefault-port, management and traversal destinations.
3. Salted password hashing, wrong-password rejection, authenticated ciphertext tamper rejection, no plaintext secret marker in the database, encrypted round-trip after reopening.
4. Windows DPAPI key protection and successful decryption after store restart.
5. Owner setup, unauthenticated access, CSRF, Host, Origin, Fetch-Site and noncanonical route rejection, response security headers.
6. Real isolated browser connection, demo authentication and account marker; saved cookies excluded from exposed data.
7. Parameterized recording, named outputs, disabled-control rejection, and untested publish rejection.
8. Fresh replays for two different order IDs with different statuses; missing records fail without a result.
9. REST key scope, strict input fields, wrong connection denial, idempotency reuse/conflict and cross-key run isolation.
10. MCP initialize/discovery/action/status and cross-key run denial.
11. Paused API admission and persisted queued-run cancellation.
12. Deliberately wrong output selector fails exact verification without a result.
13. Session expiry fails, account reconnect succeeds, revocation denies requests, exports exclude sessions/key secrets, disconnect removes stored browser state and revokes keys, logout denies owner access.
14. Delayed hydration, stable element identifiers, rich-text editors, open shadow inputs and embedded-frame discovery.
15. Recorded iframe navigation, select and checkbox replay with two distinct input sets and exact output checks.
16. Direct pointer/keyboard typing, scrolling/reload, popup-tab selection, input bounds, CSRF denial and rejection of unrecorded actions during recording.
17. Explicit human-challenge status and blocked-domain diagnostics without sensitive query markers.
18. Origin expansion rejects private hosts/nondefault ports and public-to-local dependency grants, revokes published keys and invalidates tested status.
19. Public-address fallback handles an unreachable first address, while mixed public/private DNS answers cause zero dial attempts. CONNECT-level login-origin diagnostics are scoped/redacted and clearable.
20. Blocked Google login redirects retain their useful destination, explicit retry targets that destination, and error/denied/challenge/login pages have no selectable account markers and reject confirmation. Invalid legacy browser-error checkpoints recover to the validated entry URL; error-frame text is excluded while valid parent account text remains available.
21. A synthetic login button uses fetch through a redirect to an unapproved OpenAI authentication destination. The actual browser fails the request, Hermo exposes the exact blocked origin, account confirmation stays disabled, and diagnostics omit the private query marker. This tests the reported fetch failure pattern without entering credentials or completing provider login.
22. Resuming an active connection preserves manually entered page content; malformed resume flags are rejected. Existing fresh-recording and owner logout/expiry tests continue to cover the separate reset and lock behavior.
23. An initially blocked Google popup retains its own destination and tab identity, including after reconnect. Switching and retrying stay on that tab while preserving the original portal; queries remain redacted. A deliberate stored-versus-active policy mismatch is reconciled during retry, while the unapproved Google Accounts destination remains blocked.
24. Partial local HTTP requests and denied HTTPS CONNECT requests followed by TCP resets do not crash the proxy. The denied CONNECT reset initially reproduced an uncaught ECONNRESET; the fixed test also checks that proxy authentication remains enforced afterward.

The runner used actual browser pages behind the policy proxy. Tests call the real HTTP API; SQLite fixture alterations are limited to explicitly adversarial cases. Test directories and synthetic owner credentials are separate from the delivered user workspace.

## Interface walkthrough

The Codex in-app browser was used to complete:

**Unlock → connect synthetic portal → sign in → confirm account marker → create action → demonstrate ORD-2041 → bind order_id → search → select order_id/status → define exact verification → replay ORD-2042 → verified Processing result → publish → one-time key/URL screen → generated docs → OpenAPI download.**

The downloaded OpenAPI file was created successfully by the UI. Browser error/warning logs inspected during the walkthrough were empty. The one-time synthetic key was redacted from the testing transcript and is not included in screenshots or this package.

At a **390 × 844** viewport, the dashboard and recorder were inspected for overflow. The recorder fit a ~370-pixel dialog inside the viewport with scrolling controls. Its screenshot is `screenshots/mobile-recording.jpg`. Mobile workspace lock returned to the password screen and unlock restored the workspace. Desktop screenshot proof is included in `screenshots/`.

The updated connection UI was additionally exercised at 1440 × 1000: frame Reference input → Pro selection → Confirmed checkbox → Lookup → frame outputs `UI-VERIFIED`, `pro`, `true`. Popup-tab selection and the keyboard-input panel were inspected. Screenshots are `browser-frame-result.jpg` and `browser-popup.jpg`. A fresh mobile view of the updated controls was checked at 390 × 844.

Logged-out ChatGPT and Claude sessions both reached website human-verification pages. ChatGPT's Cloudflare resource approval was exercised in the disposable workspace and revealed another explicitly blocked dependency; no verification challenge was solved and neither provider was signed into. Hermo displayed the challenge explanation and domain diagnostics. These checks do not prove vendor login or prompt replay. See BROWSER-COMPATIBILITY.md.

The second compatibility update was checked against logged-out Gemini: its UI loaded after the necessary script/font origins were approved, and **Sign in** reached `accounts.google.com/v3/signin/identifier` with an **Email or phone** field and HTTP 200, instead of ERR_TUNNEL_CONNECTION_FAILED. No credentials were submitted. Detected sign-in pages reject account confirmation. ChatGPT and Claude continued to return human-verification pages (HTTP 403), which is recorded honestly in PUBLIC-BROWSER-CHECK.json.

Desktop handoff was tested through the actual Hermo UI using the synthetic Northstar account. The session survived transfer into a visible Chromium window, the dashboard kept following `/sandbox/orders`, the account marker remained available, and confirmation succeeded. Proof: `screenshots/desktop-browser-handoff.jpg`. This is not evidence that Cloudflare accepts a headed automation browser.

The exact Gemini service-review list and approval/retry flow were exercised in the disposable UI workspace. The subsequent Google identity form rendered with its Email or phone control, a readable HTTPS address and account confirmation paused. Browser warning/error logs were empty. Proof: `screenshots/gemini-sign-in-fixed.jpg`. No identity or password was entered.

The revised ChatGPT service-review list was inspected in the actual UI, including auth.openai.com and the other exact authentication/asset destinations. Approval and retry completed successfully in the anonymous disposable workspace; the approved service list disappeared and no connection failure was reported. The provider still returned a human-verification page. Proof: `screenshots/chatgpt-auth-services.jpg`. Provider account login after that permission review is not verified. The full 23-test suite was rerun successfully after the fetch-redirect diagnostics fix.

The subsequent Google redirect report was reproduced using a synthetic local redirect into accounts.google.com. The UI recognized the blocked identity destination, offered its Google service list, and reached the real Email or phone form after approval/retry, with zero request failures. Refreshing Hermo and reopening the connection retained that Google form instead of restarting the original portal. No credentials were entered. Proof: `screenshots/google-redirect-services.jpg` and `screenshots/google-redirect-recovered.jpg`. The full 23-test suite and production build passed again after this final change.

The separate Google-popup report exposed a different initial-navigation metadata failure: the blocked popup inherited its parent's address. The regression failed before the context-level tracking fix and passed afterward. The UI review/approval selected and retried the popup, reaching the actual Google Email or phone form. After restarting only the disposable test server, the saved Google approvals also allowed a fresh popup without another approval; **Continue in Google sign-in tab** selected it, and **Reload website** kept the form available. Refreshing Hermo and reconnecting again retained the selected Google form. Account-marker selection remained paused. One background `content-autofill.googleapis.com` connection remained unapproved; the sign-in form loaded without granting it. Desktop and mobile layouts were checked; screenshot proof is `screenshots/google-popup-review.jpg`, `screenshots/google-popup-recovered-mobile.jpg` and `screenshots/google-popup-recovered.jpg`. No provider credentials were entered and inspected browser error/warning logs were empty.

One intermediate full test run was interrupted by an uncaught ECONNRESET. A dedicated denied-CONNECT reset test reproduced it before the fix. The final full run passed **all 24 tests**, including that regression and the approval reconciliation case; the final TypeScript/production build passed. The desktop permission-transfer race was corrected by copying the latest approved policy at transfer completion; the exact concurrent headed-browser race was not independently exercised.

## Scope limits

This is evidence for the supported synthetic flow and observed logged-out HTTPS pages, not a universal website compatibility test, a production load test or an independent security audit. Authenticated HTTPS integrations, MFA completion, approved public identity-provider redirects and arbitrary SPA freshness have not been benchmarked end-to-end. Approved Studio WebSockets are implemented but not independently transport-isolation audited. The schema/selector repair, hosted relay, consumer-AI wrappers and external write flows are not implemented. Security boundaries and future production requirements are described in SECURITY.md.

The requested council could not run with the available configured providers. Its earlier diagnostic handoff records the missing authentication/isolation compatibility issues; no independent council review is represented by these checks.
