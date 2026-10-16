# Human browser handling and the reported failures

Historical research and implementation check, 13 October 2026. This records the isolated-browser investigation at that milestone. The selected-tab companion has since shipped; current setup and limits are in [README.md](README.md) and [SECURITY.md](SECURITY.md).

## What the screenshots show

ChatGPT and Claude are showing website verification gates, rather than a broken browser screenshot. Google's sign-in redirect failed at the proxy, and the error document then appeared in Hermo's account-marker choices. Gemini's missing icon glyphs are consistent with supporting script/font hosts being blocked; the updated public check loaded the application after those dependencies were approved.

## What the primary sources establish

[Cloudflare's supported-browser documentation](https://developers.cloudflare.com/cloudflare-challenges/reference/supported-browsers/) says automated browsers and Playwright are unsupported for solving production challenges. A headed window remains controlled by Playwright; changing headless mode cannot make it vendor-certified as human.

[Cloudflare's challenge troubleshooting](https://developers.cloudflare.com/cloudflare-challenges/troubleshooting/challenge-solve-issues/) also explains that certain failed requests beneath `challenges.cloudflare.com` and `dnstest.dev` are normal non-blocking probes. Approving every random probe domain is not a reliable fix. Hermo now labels the relevant Cloudflare subdomain diagnostics as potentially non-blocking and does not recommend bulk/wildcard approval for them. Required apex resources still need explicit approval.

[Google's sign-in guidance](https://support.google.com/accounts/answer/7675428?hl=en) says Google can block browsers controlled through automation or embedded in other applications. Reaching the sign-in form verifies the transport and redirect fix; it does not prove that a user's account login will be accepted.

[OpenAI's login troubleshooting](https://help.openai.com/en/articles/7426629-why-cant-i-log-in-to-chatgpt) identifies auth.openai.com as part of ChatGPT sign-in. Its [network guidance](https://help.openai.com/en/articles/9247338-network-recommendations-for-chatgpt-errors-on-web-and-apps) lists authentication and asset services. Hermo's first curated list omitted those sign-in destinations; the revised list offers exact domains for explicit review. It does not copy the vendor's broad wildcard allowlist or automatically grant permissions.

[Chrome's activeTab documentation](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) describes explicit, temporary access to a user-selected normal browser tab. At this milestone, a narrowly scoped companion extension was a proposed integration mode. It has since shipped with explicit pairing, authorization and lifecycle handling; vendor restrictions still apply.

[Playwright's BrowserContext page-event documentation](https://playwright.dev/docs/api/class-browsercontext#browser-context-event-page) explains that a popup's initial request can precede the page event. [Its request-frame documentation](https://playwright.dev/docs/api/class-request#request-frame) also explains that some navigation requests begin before their corresponding frame is available. The local regression reproduced the resulting metadata bug: a blocked Google popup was incorrectly labeled with its parent portal address. Context-level tracking with deferred frame association fixes that case without guessing tab identity.

## Implemented changes

- Visible desktop handoff for manual interaction, with isolated state transferred from the preview and the same network/security rules retained.
- Exact-domain service review for the three reported apps, to reduce repeated opaque approval steps while keeping each permission change explicit.
- Proxy-level destination diagnostics, public-address fallback, original login-destination retry and readable addresses for browser errors.
- Fetch-login redirects now retain proxy-level blocked destinations even when a CORS/preflight failure hides them from ordinary page requests. The UI distinguishes website failures from a lost local Hermo connection and offers retry when a request fails.
- Google identity redirects are recognized independently of the original app, with a separate exact-domain approval list and destination retry. Reopening the UI resumes an active context rather than discarding in-progress login state.
- Initial Google popup tracking, explicit sign-in-tab selection and approval/retry targeting now cover the separate-window case. Existing saved permissions are reconciled on retry/reload/resume, and desktop transfer preserves concurrent permission updates. The preview caption distinguishes screenshot refresh from website reload.
- A reproducible ECONNRESET in denied CONNECT requests is handled from socket acceptance; aborted local requests close their upstream transports.
- Account confirmation guards for detected login, verification, denied and error pages, including exclusion of their frame outputs.
- Browser status near the top of the dialog, explicit retry actions, stale-poll protection and automatic workspace unlock recovery after owner-session expiry/restart.
- Frame clicks now await navigation of the actual target frame before scanning its resulting controls/text.

## Practical result and limits

The synthetic account survives desktop handoff. The logged-out Gemini application and Google identity form were reached successfully through Hermo. ChatGPT and Claude remain at vendor verification gates. No CAPTCHA was solved, no account credentials were submitted, no regular browser profile was imported, and no fingerprint or automation-flag masking was added.

A local Hermo key authorizes Hermo only. The isolated replay investigated here remains GET/HEAD retrieval: it does not implement consumer AI prompt POST/streaming adapters, grant vendor API credits, or override vendor access restrictions. Website behavior, identity-provider rules and networks remain external dependencies; zero errors across every website is not a testable guarantee this prototype can provide.


## Follow-up transport and lifecycle checks

The fresh anonymous check in `PUBLIC-BROWSER-CHECK.json` reached Google’s Email or phone form with HTTP 200 and no failed transport requests. An unapproved background autofill connection remained in diagnostics while the sign-in form loaded. ChatGPT and Claude returned HTTP 403 verification pages; their recorded transport failures were empty. This separates a provider challenge from an approval or tunnel failure. No real credentials were submitted and no verification was completed.

[Anthropic’s network documentation](https://code.claude.com/docs/en/network-config) explicitly identifies `assets-proxy.anthropic.com` as an additional claude.ai/desktop dependency whose blocking can cause a blank page. Hermo now offers this exact origin alongside `assets.claude.ai` and `js.hcaptcha.com` for explicit review. [hCaptcha’s documentation](https://docs.hcaptcha.com/) identifies `js.hcaptcha.com` as its client SDK origin. Dynamic verification assets may require further exact-domain review; this list does not grant a wildcard or guarantee provider acceptance.

Desktop handoff now waits for active preview captures before transferring the context, retains the original preview if creating the desktop context fails, and reopens a closed private browser from its saved, confirmed state. Concurrent screenshot requests share one capture. Diagnostics retain the page’s specific resource type instead of replacing it with the proxy’s generic connection label. The close/reopen and concurrent-capture cases are covered by browser regression tests.

Selecting Google as a search engine affects search navigation. Google workspace OAuth now authenticates Hermo using a registered client and redirect configuration; it does not establish a login session with another provider. The separately implemented private Google browser feature saves and explicitly reuses an encrypted, personally authenticated Google website session. It does not import the regular browser profile or change provider verification policy. See [GOOGLE-BROWSER.md](GOOGLE-BROWSER.md).

The integration lab supplies three owned websites with separate accounts and live generated API consumers. It is reproducible without sending personal credentials to external providers. The council diagnostic attempted in this environment did not complete, so these changes have no completed council consensus or independent security audit.
