# Private Google browser sign-in

Hermo can save a Google **website session** encrypted on this device and explicitly reuse it in another connection's isolated browser. Google workspace OAuth is separate: it unlocks Hermo but does not create website cookies or a Chrome Sync profile.

## Set up and reuse

If Google says **This browser or app may not be secure**, use **Privacy → Normal Chrome sign-in**. This opens a dedicated, ordinary Chrome profile without Playwright or remote debugging. Confirm your workspace password locally, sign in personally in the new window, then use the included local companion to explicitly copy its Google cookies into Hermo. The ten-minute import code is one-use and stops working after workspace lock or server restart. Follow `/normal-chrome.html` on the main app for installation. Google can still reject the browser or reused session; this is not a permanent-access guarantee.

The companion requests cookie access for only the reviewed Google hosts when you choose transfer. It has no background script, website content script, remote endpoint or token storage. It does not copy passwords, other website sessions, local storage, IndexedDB or Chrome Sync. Google cookies can represent multiple accounts: use the dedicated Chrome profile for the account you intend to connect. Normal Chrome uses its ordinary network and Chromium-managed profile storage during manual sign-in; it does not use Hermo's proxy, and locking Hermo does not close that ordinary Chrome window or erase its cookies.

1. Open your running Hermo instance, unlock, and open **Privacy → Your Google browser sign-in**.
2. Name the sign-in, review the eight exact Google service origins, check your authorization, and choose **Set up private Google browser**. The login page opens directly. **Continue setup** resumes an unfinished setup.
3. Choose **Open desktop browser** and sign in personally. Complete any MFA or verification yourself. Hermo does not enter your credentials or solve challenges.
4. When Google shows your signed-in account, choose **Refresh preview**. Open Google's account menu if needed, select the visible email address under **Account marker**, and choose **Save encrypted Google sign-in**. A login, error, verification, or Google marketing page cannot be saved as a profile.
5. In **Connect app**, choose your saved **Google browser sign-in**. For an existing connection, expand **Google sign-in in this private browser**, choose the saved sign-in, and select **Use saved Google sign-in**.
6. Complete the target website's own sign-in. **Return to app** returns to its entry page. Refresh the preview, confirm the target website's account marker, then test and publish its actions again.

For a Google redirect blocked in an existing website connection, expand **Review Google sign-in and display services**, review and approve the listed exact domains, and retry that Google tab. A Google sign-in saved in a different connection does not silently grant this connection access. Unapproved origins remain blocked deliberately.

## Preview and permissions

Hermo captures the isolated browser preview after its own interactions and after **Refresh preview**. **Reload website** and **Retry this tab** explicitly navigate; refreshing the preview does not. Changes made directly in the desktop browser appear after a manual preview refresh.

Each preview request reconciles the active browser's policy with that connection's persisted approvals. This does not approve additional services. The browser and authenticated egress proxy both enforce exact origins and public-IP rules. A preview failure is distinct from an actually closed browser; the latter offers explicit reopening.

## Storage and removal

Up to five saved sign-ins are supported. Only cookies scoped to the reviewed Google hosts and storage from exact reviewed origins enter the reusable profile. Cookies, local storage and IndexedDB are encrypted server-side; profile responses expose names and timestamps only. Profiles are excluded from workspace exports, audit details and logs.

Applying a profile creates a draft browser session. Published API execution continues to use a separately confirmed target account. Applying or removing a sign-in revokes affected API keys and requires reconnection/retesting. **Remove sign-in** deletes Hermo's saved profile and clears dependent connection states; it does not remotely log you out of Google on other devices. Disconnecting an individual app does not remove the independently saved Google profile.

Credentials are not imported from your everyday Chrome profile, and Chrome Sync is not enabled. Server restart can restore explicitly saved sessions; unsaved sign-in progress is only in memory. Google can expire or reject sessions. This is still an automation-controlled browser, not a certification that a human is browsing.

Google explains its [supported-browser restrictions](https://support.google.com/accounts/answer/7675428?hl=en). Playwright documents [authenticated-state reuse](https://playwright.dev/docs/auth). A persistent session cannot guarantee that a website will accept the browser or remove verification. A search engine choice does not change those rules.

Automated Google tests use synthetic accounts and cookies. They do not establish
that Google or another website will accept a real sign-in or reused session.
