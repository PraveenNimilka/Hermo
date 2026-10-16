# Hermo

Turn website workflows into local REST APIs and MCP tools.

Hermo is an early-access developer tool. Record a task in an authorized browser,
define its inputs and outputs, test the result, and call the published workflow
from your application. Execution stays on your computer.

## What it does

- Connect an existing Chrome tab or use a separate local browser for retrieval.
- Record controls, bind dynamic inputs, and extract structured data or media URLs.
- Verify results before publishing a workflow-scoped API.
- Inspect runs, repair drafts, and publish or roll back immutable revisions.
- Use REST, generated OpenAPI documentation, or scoped MCP tools.

It works with supported searches, catalogs, dashboards, forms and internal tools
as well as AI websites. Website permissions and technical limits still apply.

## Quick start

Requires **Node.js 24+**, npm and Git. Selected-tab workflows need **Chrome 120+**.
The release checks run on Windows; see the [installation guide](docs/installation.md)
for other platforms, encryption keys, browser installation and upgrades.

Windows PowerShell:

```powershell
git clone https://github.com/PraveenNimilka/Hermo.git
cd Hermo
npm.cmd ci
npm.cmd run build
npm.cmd start
```

Open [127.0.0.1:4317](http://127.0.0.1:4317) and create a workspace password.
Keep the runtime terminal running. Closing the dashboard does not stop APIs.

Load [`companion/browser`](companion/browser/README.md) as an unpacked extension
at `chrome://extensions`. Set its runtime address to `http://127.0.0.1:4317`;
the companion's initial saved address uses port 4318 and must match your runtime.
Authorize a website connection in Hermo and pair its selected tab with the code.

## Your first API

1. Open **Actions → Create action** and choose the connected website.
2. Record the task, or select outputs directly for an extraction workflow.
3. Name changing inputs, select actual results, and define success checks.
4. Run a test. Inspect missing values or failed checks before publishing.
5. Choose **Publish API**, copy its scoped key, and open **API docs**.

Use the endpoint and fields from your own published contract. For example:

```sh
curl -X POST 'http://127.0.0.1:4317/v1/actions/catalog.lookup/versions/1/runs' \
  -H 'Authorization: Bearer YOUR_HERMO_KEY' \
  -H 'Idempotency-Key: YOUR_UNIQUE_LOGICAL_REQUEST_ID' \
  -H 'Content-Type: application/json' \
  --data '{"input":{"search_query":"laptop"}}'
```

This is an illustrative contract, not a bundled workflow. Admission returns
HTTP 202 with `run_id` and `status_url`. Poll that URL with the same key; read
`result` only when `status` is `succeeded`. Preserve the same input and idempotency
key when recovering a lost receipt. The [user guide](docs/user-guide.md) covers
recording, typed outputs, polling, MCP, media and workflow repair.

## Configuration

Set variables in the environment of the runtime process. `.env` files are not
loaded automatically. Never commit workspace data or encryption keys.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `HERMO_PORT` | No | `4317` | Loopback server port |
| `HERMO_DATA_DIR` | No | `.hermo/` | Local persistent workspace |
| `HERMO_MASTER_KEY` | Outside Windows | Windows DPAPI | Persisted 32-byte base64 encryption key |
| `HERMO_BROWSER_PATH` | No | Browser discovery | Isolated Chromium executable |

Windows uses CurrentUser DPAPI unless an explicit key is supplied. Back up the
entire data directory with its encryption-key context. See [configuration](docs/configuration.md)
for browser overrides and optional workspace Google sign-in.

## Project layout

```text
src/              React and TypeScript dashboard
server/           Fastify runtime, SQLite store, workflow engine and adapters
companion/        Chrome extensions and their setup guides
public/           Served guides, examples and local practice pages
tests/            Runtime, browser, security and workflow regression tests
validation-apps/  Independent REST/MCP consumer applications
scripts/          Explicit integration and public-site verification tools
docs/             Installation, usage, architecture and historical evidence
```

## Development

Run `npm ci`, `npm run build`, `npm test` and `npm run test:consumers`.
On PowerShell, use `npm.cmd` if your execution policy blocks npm's shell shim.
Install test Chromium with `npx playwright install chromium` if needed.
There is no separate lint command; the build includes TypeScript checking.
See [Contributing](CONTRIBUTING.md) before running external-site checks.

## Current limits

- The runtime and computer must stay available; there is no cloud execution.
- Connected Chrome needs its authorized tab and valid website session. Pairing
  expires with the owner lease; browser/runtime restart requires reconnection.
- Isolated retrieval allows GET/HEAD only. It cannot submit or generate media.
- Website changes, sign-in checks and unsupported layouts can break recordings.
- Media outputs are links; protected, expired or browser-only assets may not load
  in another application. Hermo does not export Chrome cookies to fix them.
- Submission timeouts may leave an unknown outcome. Inspect the website before
  retrying. Cancellation cannot undo changes already made there.
- This is a loopback service, not a public hosting deployment or security audit.

Read the [documentation index](docs/README.md), [architecture](docs/architecture.md)
and [Security](SECURITY.md) for the operational boundaries.

Authored code is [MIT licensed](LICENSE). See [third-party notices](THIRD-PARTY-NOTICES.md)
for bundled dependencies, fonts and components with their own terms.
