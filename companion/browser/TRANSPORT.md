# Selected-tab connection

Open the website and sign in normally. Click the Hermo extension, paste the local connect code, authorize the selected tab, and select **Connect selected tab**. Hermo marks the authorized tab connected automatically. The default flow opens no extra browser tab. A fixed Hermo panel remains on the website; **Stop** ends access without deleting the saved setup or signing out.

The module worker owns the active session independently of the popup. Exact-origin, selected-tab and local sandbox-path restrictions apply to every command. Companion 0.6.0 keeps bounded authority in trusted `chrome.storage.session`, inaccessible to website content scripts; pairing codes are consumed once. This is session memory, not a persistent cookie export. Website reload restores the panel while the session remains authorized. Closing the website, leaving its permitted origin/path, locking Hermo, expiry, or selecting Stop ends access. A full browser/extension restart or runtime restart can require pairing again.

Active sessions refresh the panel and validate their tab every four seconds. Polls have an 18-second server response deadline. A recovery alarm restores idle links after Manifest V3 worker termination and revalidates their authorization. An unknown in-flight command fails closed instead of being replayed. Commands carry absolute deadlines and recheck authority after readiness, immediately before mutation. No interrupted command or form submission is retried automatically. See [Chrome worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

Advanced tools retain a manually opened connection/controller page for troubleshooting older installations and callers. It is an explicit alternative and is never opened by the default connect button.

The real Chrome transport test uses only a disposable profile and synthetic local pages. It closes the popup and dashboard, verifies a fresh published REST result, actually terminates the worker, waits for alarm recovery, confirms continued reads, tests reload and trusted Stop, and checks origin exit and owner lock.

A separate scheduling test pauses the command's panel refresh, invokes Stop, then resumes that refresh. It verifies that no website click is issued and that the earlier panel revision cannot overwrite the stopped state.

Protocol 2 now negotiates optional `workflow_waits` and `structured_outputs`. New bounded `observe` and `extract` commands are sent only to links advertising their corresponding capability. `extract` contains declarative mappings, not JavaScript. Its static isolated-world implementation validates scope, bounds, target uniqueness and allowed attributes before returning raw observations for the shared runtime schema validator. Legacy links remain usable for their previous command set. Update and reconnect to enable new commands.
