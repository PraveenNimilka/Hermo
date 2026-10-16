# Browser authentication findings — 13 October 2026

Historical research: the direct ChatGPT-plan connector described below was removed on 14 October 2026 at the owner's request. Its callback, direct response API and consumer pages are no longer shipped. Hermo's current product uses verified recorded website tasks and their generic scoped REST/MCP contracts; Google workspace authentication and website browser flows remain. The implementation observations below describe the earlier release, not current setup instructions.

The reported Google screen is an authentication refusal, not a missing-origin approval. Google explicitly documents that it can reject browsers controlled through software automation. An installed Google session copied into another runtime does not prove that a downstream app has authorized that runtime. A change of search engine does not establish authentication. [Google guidance](https://support.google.com/accounts/answer/7675428?hl=en)

| Product | What its official documentation establishes | Implication for Hermo |
| --- | --- | --- |
| Meta Muse | An isolated VM, provider API connectors, a separate browser broker and protected credential service. The browser agent pauses during human takeover and credential filling. | Keep credential handling separate, use provider connectors when available and require human sign-in for browser work. |
| ChatGPT Dots | A dot has its own cloud computer; connecting the user's computer is optional and can provide signed-in local browser context. | A cloud or isolated session does not inherently become the user's existing local browser session. |
| Grok Bot | Persistent cloud browser sessions and connectors, with shared app logins across a user's Bots. Its FAQ explicitly says sites can block automation, expire a session or require a human step. | Persistence reduces repeated setup; it is not a universal verification bypass. |

Sources: [Muse technical architecture](https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse), [Dots getting started](https://learn.chatgpt.com/docs/dots/getting-started), [Grok Bot overview and limits](https://docs.x.ai/grok-bot/overview).

## Implemented supported ChatGPT route

OpenAI documents local/open-source registration that authorizes eligible Plus/Pro plan use. Hermo now provides that route as a separate native connector. It opens the ordinary browser for authorization, retains encrypted credentials server-side, lists the account's available models and requests completed text through the public Responses API. It requires explicit plan scope; identity alone is insufficient. This does not expose ChatGPT history or turn every free website account into API access. [Availability](https://developers.openai.com/siwc/quickstart)

The implementation uses a stable local host identifier, public-client PKCE, fresh state and nonce, an owner/browser-bound one-use callback and the issued client ID. Signature, issuer, audience and nonce are verified. Returning sign-in must match the saved client and account. [Protocol](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)

Hermo uses only the published model and Responses endpoints. Inference requests use `store: false` and `stream: true`; partial deltas are not accepted as completed output. Refreshes are serialized and scoped local keys expire after 24 hours. [Inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [Sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)

## Verification boundary

Owned fixtures test the complete local OAuth/key/consumer protocol using synthetic accounts, signing keys and provider streams. Those tests cannot establish that OpenAI has enabled this flow for a particular real account or that Google accepts a particular website login. Live account consent remains the user's action. The separate ordinary-browser companion's Google cookie transfer succeeded according to the user's screenshots; downstream ChatGPT Google OAuth in the automated browser was refused.

Hermo now implements a separate **selected normal-Chrome tab execution companion** (`companion/browser`). This differs from Google cookie import: the task runs in the same Chrome tab/profile the user already signed in to, with temporary active-tab permission. No paid AI plan or cookie copy is required. Chrome documents that invoking an extension grants scoped temporary access, preserved on same-origin navigation and revoked when the tab leaves that origin. Sign-in, MFA and verification are completed manually before attaching or after renewing permission. [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), [isolated-world scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting).

The extension uses registered local DOM functions, exact-origin commands, owner/password-protected one-use pairing and a memory-only runtime capability. Hermo confirms an account marker, records inputs/actions/text outputs and keeps its existing tested-key/REST/MCP contract. Show connected tab focuses the existing tab. The original proxy remains for isolated/public retrieval; normal Chrome keeps ordinary networking and recorded effects are disclosed as possible writes. No search-engine substitution, CAPTCHA bypass, fingerprint disguise or hidden profile attachment is used.

The production extension popup/controller passed a real Chrome test in a new empty synthetic profile: existing website login → pairing → account confirmation → recording → two verified inputs → key → REST/MCP → origin/logout/lock failure. The test used Chrome's documented extension-testing API only in that disposable profile; production does not use a debugger. [Chrome extension test protocol](https://chromedevtools.github.io/devtools-protocol/tot/Extensions/).

This removes Hermo's separate-browser session mismatch and proxy gating from the selected-tab route. It cannot force Google, OpenAI, Anthropic or another site to accept automation, grant free API entitlement or finish every dynamic response. Actual personal-account acceptance remains an operator check. No universal or zero-error claim is made.
