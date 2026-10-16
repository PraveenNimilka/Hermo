# Browser compatibility

Hermo supports two local execution modes. A website loading successfully does
not establish that its sign-in, controls or output extraction will work.

| Mode | Browser | Execution boundary |
| --- | --- | --- |
| Connected Chrome | An explicitly authorized existing tab | Recorded actions use the current website session and can change data. Commands are scoped to the authorized tab, origin and path. |
| Isolated retrieval | A separate local Chromium context | Approved origins, public-network restrictions and GET/HEAD replay. It cannot submit forms or generate media. |

The dashboard can close while the runtime remains running. Both modes still
need an available local browser. Connected-tab setup is documented in the
[companion guide](../companion/browser/README.md).

## Controls and results

Supported DOM workflows include text fields, rich-text editors, accessible
controls, native select and checkbox inputs, and open shadow roots. Availability
depends on the execution mode and negotiated companion capabilities. Missing or
ambiguous locators fail rather than choosing another element silently.

During recording, use detected controls to create replayable steps. In the
isolated browser, arbitrary pointer, keyboard and navigation commands are
restricted while recording so that unrecorded interactions cannot become hidden
workflow requirements. Scrolling remains available.

Cross-origin frames, closed shadow roots, canvas-only controls, native device
prompts and file transfers are not universally supported. Media extraction
requires an actual supported result URL; a visible image alone does not ensure
that another application can access it. See the [user guide](user-guide.md).

## Preview and sign-in

Connected Chrome offers **Detected fields** and a separately authorized visual
preview. Enable visual preview explicitly from the companion on the paired tab.
Detected fields are a simplified inspection, not a copy of the website layout.

The isolated preview refreshes after Hermo interactions or **Refresh preview**.
Refreshing the preview does not navigate the website. Direct changes in its
desktop window need a manual preview refresh. **Open desktop browser** transfers
the current isolated session for manual interaction; its sandbox and network
restrictions remain in force. It does not import your everyday Chrome profile.

Complete sign-in, MFA and website verification personally. Hermo does not solve
access checks or guarantee that a website will accept an automated browser.
Optional Google setup is described in the [Google browser guide](google-browser.md).

## Troubleshooting isolated pages

1. Open your running Hermo instance, unlock it, and reconnect the website.
2. If a page is blank or fails to load, inspect **Network diagnostics**.
3. Review exact supporting domains before approving them. Redirects and
   identity-provider popups can require separate approval. Approval invalidates
   affected keys and test evidence; test and publish the workflow again.
4. If the domain is already approved, select the correct **Website tab** and
   choose **Retry this tab** or **Reload website**. Do not repeatedly expand
   permissions when the problem is a website or network failure.
5. Use **Open desktop browser** when direct manual interaction is needed.

Domain approval does not allow private or reserved network destinations,
metadata hosts, nondefault HTTPS ports or local management routes. Isolated
service workers are disabled; applications that require them may fail. Approved
encrypted sockets are available during isolated setup, while replay blocks
sockets and external write requests.

Reopening the connection dialog resumes a still-active isolated session. Lock,
browser closure or runtime restart ends that active session; explicitly saved
sessions remain encrypted. A new recording opens its saved checkpoint.

## Testing scope

The automated suites use owned fixtures and disposable browser profiles. They
cover supported controls, lifecycle recovery, network restrictions and output
verification. External checks are opt-in and described in
[Contributing](../CONTRIBUTING.md#external-website-checks). Neither fixture tests
nor a past successful website run guarantee future website compatibility.
