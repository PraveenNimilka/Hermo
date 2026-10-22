# Contributing to Hermo

Hermo is an early-access, local-first website-to-API tool. Keep browser authority
explicit and preserve public endpoint identities, scoped keys and persisted data.

## Permissions before code changes

Read the [Hermo License](LICENSE). New covered material is proprietary; this guide
does not grant permission to modify or redistribute it. Bug reports and feature
suggestions are welcome. Before changing covered source or submitting a code patch,
obtain written permission and agree contribution terms with the maintainer. That
agreement must identify the contributor's retained rights and any rights granted
for incorporation into future proprietary releases; copyright is not assigned
automatically. Do not submit third-party code without the required rights and notices.
Earlier MIT grants and mandatory legal rights remain unaffected.

## Authorized development

Use Node.js 24 or later. Run `npm ci`, `npm run build`, `npm test` and
`npm run test:consumers`. Browser integration tests need a supported local Chrome
or Playwright Chromium installation. See the [installation guide](docs/installation.md)
for platform requirements. Tests create disposable state under ignored `work/` directories.

Do not use an existing owner's data directory for tests. Never commit `.hermo/`,
environment files, credentials, cookie exports, databases or API keys. Examples
must use synthetic accounts or explicitly permitted public data. Report security
concerns privately using the process in SECURITY.md.

For interface changes, preserve the shared neutral design tokens, visible focus,
keyboard operation, meaningful labels, responsive spacing and reduced motion.
Verify both desktop and narrow layouts, including successful and failed requests.

## Repository conventions

Use short, descriptive branch names such as `workflow-safety` or
`fix-tab-reconnect`. Name files and modules for their product responsibility.

Keep root documentation limited to the README, contribution, security, license
and third-party notices. Put maintained operating guides in `docs/`. Keep
temporary plans, reports, captures and local configuration under ignored `work/`.
Run `npm run check:repo` before submitting changes; CI enforces the same rules.
Report test commands and results in the pull request. Automated test results do
not constitute an independent security review or certify website compatibility.

## External website checks

External checks are opt-in. They use read-only catalog and quote pages from
[Books to Scrape](https://books.toscrape.com/) and
[Quotes to Scrape](https://quotes.toscrape.com/). Review the operator's current
[practice-site rules](https://toscrape.com/) before running them.

- `npm run test:public` checks the built-in public examples and scoped APIs.
- `npm run test:real-world` checks structured workflows, REST/MCP, revisions and
  runtime restart using disposable state.
- `node scripts/verify-connected-public.mjs` checks actual companion pairing and
  published execution against an authorized public tab.

For consumer UI checks, run `node scripts/verify-real-world.mjs --keep-running`,
then pass its printed private configuration path to
`node scripts/verify-consumer-apps.mjs <configuration-path>` in another terminal.
Stop the retained harness when finished. Configuration contains disposable
credentials and stays under ignored `work/`; generated reports and screenshots
stay under ignored `validation/` or `PUBLIC-INTEGRATION-VALIDATION.json`.

These checks depend on network and website availability. Local fixture tests
do not establish live account compatibility. Never point fault-injection,
crash tests or load tests at someone else's account or browser.
