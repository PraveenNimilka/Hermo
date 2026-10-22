# Local Google sign-in companion

For execution in an already signed-in Chrome tab, use the main [Hermo companion](../../companion/browser/README.md) and [connection guide](../../public/connected-browser.html). It records/replays in the same normal tab without cookie import or a paid plan. This optional integration only transfers Google cookies; it does not control the original tab or copy the target website’s own session.

Use this optional companion when Google refuses Hermo's automation-controlled browser. It does not bypass verification or grant provider API access. You sign in personally in an ordinary browser, then explicitly transfer only that Chrome profile's Google cookies to local Hermo.

1. Start Hermo on your device and open Privacy → Normal Chrome sign-in.
2. Authorize transfer, confirm the workspace password locally, and choose Open normal Chrome & create import code. A dedicated Chrome/Edge profile opens; no Playwright or remote debugging is attached.
3. In that new profile, open https://myaccount.google.com/ and finish Google website sign-in yourself. Hermo OAuth sign-in and Chrome Sync do not establish which website session the companion can read.
4. In the same profile, open `chrome://extensions` (or `edge://extensions`), enable Developer mode, choose Load unpacked, and select this repository's `integrations/google-session-extension` folder.
5. Open the companion from the extensions menu. Enter Hermo's canonical local address and its one-use import code. Review the authorization checkbox and choose Allow Google access & transfer. Chrome asks for the fixed Google cookie permissions.
6. Return to Hermo Privacy, choose Check imported sign-in, and explicitly select it when connecting your target app. Complete that app's own sign-in, confirm the correct account, and test/publish its actions.

The code expires in ten minutes and is invalid after lock/restart. Generate a new one if needed. Do not share it, cookies, passwords or OTPs in chat. Use the dedicated profile for one Google account; its cookies can cover every Google account signed into it.

### Updating an already installed companion

This optional integration now has its own folder. If an earlier unpacked
installation reports missing files, load `integrations/google-session-extension`
in the same Chrome profile and approve its optional permissions when transferring.
The main selected-tab companion stays in its existing folder and needs no
reinstallation for this change.

Version **0.1.1** fixes a false sign-in failure: exact subdomain permissions omitted `https://google.com/*`, so Chrome hid shared `.google.com` authentication cookies. Cookie queries now include all cookie paths in the current popup's store. No wildcard Google permission or other profile/store scan is used.

Open `chrome://extensions` in the profile containing the companion, find **Hermo · local Google sign-in companion**, and choose **Reload**. Close and reopen its popup; its footer must show **0.1.1**. Approve the additional exact `google.com` access if Chrome prompts during your next explicitly authorized transfer. Generate a fresh import code in Hermo if the old one expired. Refreshing Hermo alone does not reload an unpacked extension.

If no supported sign-in cookie is found, use **Open Google account in this profile** in the popup. Confirm that this website shows your account rather than a sign-in screen, then reopen the companion and retry in that same normal window. The extension distinguishes missing website cookies, unsupported sign-in cookies, permission/read failures and Incognito context. It does not display cookies or email addresses, transfer a signed-out state, or treat cookie presence as verified account identity; **Check imported sign-in** in Hermo is still required.

Technical references: [Chrome cookie API and host permissions](https://developer.chrome.com/docs/extensions/reference/api/cookies) and [Chromium's cookie-domain permission check](https://github.com/chromium/chromium/blob/main/extensions/browser/api/cookies/cookies_helpers.cc).

### Regression checks

Run `node --test tests/google-companion.test.mjs` for the scoped import protocol. An optional real extension regression uses a disposable Chromium profile, two test-only extensions with static test permissions, synthetic Google-domain cookies, and blocked external page requests: `node --test scripts/verify-companion-browser.mjs`. Install Playwright's bundled Chromium with `npx playwright install chromium --no-shell` first, or point `HERMO_TEST_CHROMIUM_PATH` to a trusted Chromium test executable that supports loading test extensions. This check never opens the user's normal Chrome profile or authenticates to Google. It tests the extension protocol with synthetic cookies; it does not verify a real Google session.

The extension has no background/content scripts, remote endpoint, telemetry, password collection, or token storage. Its only network permission is loopback; its Google cookie permissions are optional. Chrome remembers granted permissions until you revoke them or remove the extension, but collection still happens only on explicit transfer. Passwords, other sites, local storage, IndexedDB and Chrome Sync are not imported. Imported cookies are encrypted by Hermo and remain separate from confirmed API state. Removing a Hermo sign-in does not erase Chrome's cookies or sign you out on other devices.

Normal Chrome uses its own network and Chrome-managed profile files. It does not use Hermo's isolated proxy, and locking Hermo does not close its window. Actual Google login, extension installation and acceptance of the copied session require personal operator testing. Synthetic tests validate the protocol, scope and encryption, not Google's acceptance. Providers may expire or reject cookies; no permanent/universal compatibility guarantee is made.
