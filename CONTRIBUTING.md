# Contributing to Hermo

Hermo is an early-access, local-first website-to-API tool. Keep browser authority
explicit and preserve public endpoint identities, scoped keys and persisted data.

Use Node.js 24 or later. Run `npm ci`, `npm run build`, `npm test` and
`npm run test:consumers`. Browser integration tests need a supported local Chrome
or Playwright Chromium installation. See the README for installation and platform
requirements. Tests create disposable state under ignored `work/` directories.

Do not use an existing owner's data directory for tests. Never commit `.hermo/`,
environment files, credentials, cookie exports, databases or API keys. Examples
must use synthetic accounts or explicitly permitted public data. Report security
concerns privately using the process in SECURITY.md.

For interface changes, preserve the shared neutral design tokens, visible focus,
keyboard operation, meaningful labels, responsive spacing and reduced motion.
Verify both desktop and narrow layouts, including successful and failed requests.

External acceptance testing is explicit: `npm run test:real-world` performs a
small, bounded set of read-only requests against the scraping-practice sites
listed in REAL-WORLD-VALIDATION.md. Review their current rules before running it.
Never point fault-injection, crash tests or load tests at someone else's account
or browser. Local regression fixtures are labelled separately from live evidence.
