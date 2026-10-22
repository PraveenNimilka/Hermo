# Browser identity recovery

Hermo stores a saved browser binding separately from the companion identity in
Chrome's extension-local storage. Worker suspension and ordinary reloads retain
the identity. Reinstalling, clearing extension storage, changing Chrome profiles,
or loading an unpacked extension from a different directory can replace it.
The old server binding then correctly rejects an ordinary pairing grant.

The connection form uses one authorization checkbox. Creating a code includes
browser identity recovery automatically. The owner's tab authorization issues a
short-lived, one-use code with server-held replacement permission. The companion
cannot add that permission itself. API callers may explicitly set
`replace_browser: false` to restrict a code to the saved identity.
The grant still requires an unlocked owner, CSRF, the exact website origin, a
valid companion protocol, an available physical tab, and no active recording or
run. Changing the app's selected saved browser after issuing the code invalidates
the attempt.

Recovery reuses a matching current-browser binding, updates an exclusively used
current-browser binding, or moves only this app to a separate saved browser.
It never resets sibling apps. Related browser metadata changes are transactional;
workflow definitions, revisions and API keys are untouched. Repeated successful
reconnects reuse the binding. Runtime restart still requires a fresh live grant.

Impact: `server/browser-workspaces.mjs` binding persistence,
`server/connected-browser.mjs` owner grants and pairing, and
`src/ConnectedTab.tsx` explicit recovery consent. No new companion permissions,
identity format, database schema or consumer API contract are required.
Existing whole-browser reset remains an explicitly authorized advanced action.

Validation on 22 October 2026:

- `npm run build`: passed.
- `node --test tests/simplified-workflow.test.mjs tests/companion-stop-race.test.mjs tests/browser-reconnect.test.mjs tests/browser-identity.test.mjs`: 16 passed.
- The real disposable Chrome test changes stored identity, restarts its worker,
  exercises the popup and owner form, reconnects through an authorized code, and
  successfully invokes the existing published API with its original key.
- API tests cover sibling token preservation, reuse, one-use codes, missing owner
  or CSRF, persisted recovery after runtime restart, and unchanged workflow/key rows.
- Local runtime restarted with the fix; `/health` returned HTTP 200.

An existing mismatched installation needs one fresh owner-authorized Connect
code. This does not promise continued access after Chrome storage is erased or
an owner unlock lease expires.
