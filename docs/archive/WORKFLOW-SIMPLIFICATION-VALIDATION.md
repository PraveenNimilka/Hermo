# Saved-browser workflow release

Verified locally on 14 October 2026. Companion version: **0.2.0**. Main workspace: **http://127.0.0.1:4318/**.

## What changed

- Connections now contains named Saved browsers and a reuse picker. Users can use their current Chrome browser or save a separate ordinary Chrome profile. Setup no longer requires visiting Privacy or importing Google cookies.
- Existing connected apps are migrated to a saved browser. The legacy normal-Chrome directory remains in place. A consistent SQLite backup is taken before adding the saved-browser schema.
- A companion connection page accepts a short-lived Connect code for the exact selected website tab. It remembers the localhost address, checks protocol/capabilities before pairing, and rejects another browser context until the owner explicitly restores the binding.
- An isolated, fixed website panel shows connection status and Stop. It survives supported same-origin reloads and is excluded from recording, account markers, output extraction and chat streaming detection. Browser/controller closure or lost authority changes its status.
- Stop cancels active/queued work and keeps browser sign-in, saved apps, actions and API keys. Forget account and Delete remain separate destructive operations. Reconnect checks the actual saved account/source before restoring execution.
- Connected recordings keep the selected conversation/page. Chat extraction, actual prompt echo, full completed replies, repeated prompts and single submission remain covered by the existing browser regressions.
- Read data actions allow zero inputs and zero steps. Shared verification checks source/account, nonempty results, settled reads, number format, an optional required unit, expected context, or input equality when appropriate. Unchanged valid values are accepted.
- The separate data consumer reads its contract using the scoped API key, generates any required fields, and supports a no-input Read data button. Both consumer apps keep keys in memory and clear the key field after configuration.
- Read-only effects are reflected in generated REST documentation and MCP tools. Exports retain the old format and now include action type. Submitted website mutations are never automatically resent after an uncertain outcome.

## Verification evidence

`npm run build` passed TypeScript and the production build. Main bundle: `index-dCXtMSBR.js`.

`npm test` completed with **96 passed, 0 failed, 0 cancelled, 0 skipped**, in approximately 324 seconds. Log: `work/workflow-final-tests.log`.

After the final production asset build, the targeted acceptance suite passed again: **9 passed, 0 failed**, approximately 62 seconds. Log: `work/workflow-final-acceptance.log`. HTTP checks on the restarted main server returned 200 for the main, chat, data and guide pages, confirmed the final bundle and companion 0.2.0 instructions, and returned 401 for anonymous access to saved browsers.

The new acceptance coverage uses disposable Chrome profiles, the production extension and built UI. It exercises:

- SQLite migration, restart and reading restored backup data with the original encryption key;
- owner/CSRF boundaries, browser reuse, incompatible companion preflight and rejection of another browser context;
- managed launch arguments for the saved website and deletion limited to the associated managed directory, preserving a neighboring directory;
- builder demonstration, selection of output-only fields, unit/context rules, verification and publication;
- repeated unchanged data through REST, the consumer and MCP, with no dummy input or click;
- anonymous isolated reads using the same source/unit/context rules;
- wrong unit, wrong location and missing output failing without stale results;
- a real trusted Stop click in the website panel, cancelled work, reload/reconnect, retained published definitions and non-revoked keys;
- a 390px data consumer without horizontal page overflow and no captured UI page errors.

Existing tests cover ChatGPT-like rich and deeply nested layouts, repeated identical prompts, account changes, identity hydration, ambiguous output refusal, lock, wrong origins, idempotency, revocation, REST/MCP scope and the generated chat consumer. An earlier full run timed out in an older browser compatibility test; the isolated rerun passed all eight cases, and the final complete run passed all 96 tests.

`node scripts/verify-public.mjs` passed against the actual **Books to Scrape** and **Quotes to Scrape** practice websites: two records per site, missing-record failure, generated API runs and scope/privacy checks. Evidence: `PUBLIC-INTEGRATION-VALIDATION.json`; log: `work/workflow-public-tests.log`.

The main workspace was inspected using aggregate metadata only. Its published, tested `chat.reply.live` action remains present. Comparing the migration backup and current database confirmed unchanged action IDs/versions/status/test markers and unchanged API-key hashes/scopes/expiry/revocation fields. No account names, cookies or API-key values were printed.

## Applying the update

1. Open `chrome://extensions` in the Chrome browser containing your website session.
2. Reload **Hermo - connect this browser tab** and confirm version **0.2.0**. Close old companion controller tabs.
3. Open Hermo Connections and reuse the saved app/browser. Create a Connect code.
4. On the intended website tab, click the companion, open its connection page, paste the code, authorize it and press Enter.
5. In Hermo, choose Check tab connection. Matching saved account/source evidence is reused; otherwise confirm the actual account/source.

Use a published **API key** in the chat/data consumer. Use the **Connect code** only in the companion. Keep the website and companion controller open while using the action.

## Scope and remaining limits

The controller transport is intentionally retained, as specified in the plan; removing that tab requires a separate lifecycle-tested transport. Saved setup persists, while active authority ends on Stop, lock, closed tabs, lost connection or expiry.

The new weather tests use owned fixtures, not a live weather provider or the user's private account. Managed launch configuration is tested with an injected launcher; no personal Chrome profile is automated. The user's earlier personal ChatGPT success is preserved as reported evidence, not a new live prompt sent during this release.

Visible DOM/open shadow roots are supported. Cross-origin frames, closed shadow roots, canvas-only data, browser-internal pages, provider challenges, quotas and changed layouts can require human attention or another integration. Numeric verification currently accepts decimal notation with an optional simple unit; it does not implement every locale's number notation. Observation time is when Hermo read the page, not proof that the provider updated its data then. Universal compatibility or permanent absence of third-party errors is not claimed.
