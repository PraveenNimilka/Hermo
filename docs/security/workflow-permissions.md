# Workflow permissions

Hermo authorizes a published workflow, not unrestricted browser access. The
owner pairs one Chrome tab or creates a separate managed browser connection.
An action key is bound to one workflow and can start runs, read its own runs and
cancel its own work. It cannot edit workflows, inspect another key's runs,
approve actions, read cookies or submit arbitrary browser commands.

Before publication, open the permission review. It displays the accepted browser
mode, exact origins, steps, input bindings, output mappings, approval checkpoints
and key scope. A fingerprint binds review to the draft and connection settings;
changing either requires a fresh review and successful test. The runtime checks
the same execution configuration when admitting and dispatching work. The review
is a view of enforced configuration, not an independent security control.

The owner publication endpoint requires the reviewed `expected_version` and
`permission_fingerprint`. A breaking input/output contract change additionally
requires its exact `change_fingerprint` and `accept_breaking: true`. The dashboard
uses a separate acknowledgment for breaking changes. Rollback likewise requires
review of changed contracts and website permissions. See
[published contracts](../architecture/published-contracts.md) for exact routes,
errors and migration of owner automation. Consumer keys and existing invocation
routes keep their scope.

Scoped REST `GET /v1/action-permissions` and MCP `get_permissions` expose the
selected active publication's origins, actions, approval policy, session needs
and capabilities. Private selectors, fixed values, account markers, browser
profile IDs and credentials are excluded. This describes authority, not proof
that a website action will succeed or have the intended business effect.

## Browser boundaries

- **Connected Chrome:** explicit selected-tab authorization, current website
  session, companion transport and unexpired owner unlock lease are required.
  The extension uses `activeTab` and `scripting`, not unrestricted remote code.
- **Managed local:** a separate Playwright session with GET/HEAD retrieval
  restrictions. A recorded interaction does not authorize POST requests or
  transfer cookies from normal Chrome. GET endpoints can still have side effects.
- Origin and path restrictions apply to supported commands. Unsupported frames,
  ambiguous locators and changed recorded semantics fail explicitly. Hermo does
  not infer new permissions or silently select another browser session.

Websites are untrusted. A selected button may trigger website scripts and
requests using the website's session. Hermo limits its own recorded commands;
it cannot turn a third-party website into a sandbox or guarantee its behavior.
Use trusted sites and review consequential actions on the live page.

## Keys and versions

Key secrets are displayed once and stored as one-way hashes. Manage keys from
the workflow's key panel. Rotation issues a replacement and revokes only the
selected key. Revocation cancels that key's accepted work; other workflows and
keys sharing a tab remain authorized. An already dispatched command must drain
before the tab can be reused. Cancellation cannot undo website effects.

Draft saves invalidate draft test evidence and do not rewrite published
revisions. Accepted runs persist a frozen definition and connection snapshot.
REST `expected_revision` and the MCP action tool's optional `expected_revision`
guard new admissions against an unexpected publication. Repeating an original
idempotency key with identical inputs retrieves its original receipt even after
a publication changes; it does not execute the action again.

## Operating safely

Keep the runtime bound to loopback. Do not expose its port directly to a network.
The dashboard may close; the runtime, computer and authorized browser must remain
available. Retest a draft after website changes and publish a new revision.
Never bypass website sign-in, MFA, CAPTCHA or service restrictions.

See [human approval](human-approval.md), [output verification](../reliability/output-verification.md),
and the [security policy](../../SECURITY.md).
