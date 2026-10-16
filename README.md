<p align="center">
  <img src="public/brand/hermo-crab.png" alt="Hermo logo" width="96" height="96" />
</p>

<h1 align="center">Hermo</h1>

<p align="center">
  Turn website workflows into local REST APIs and MCP tools.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-24292f?style=flat-square&amp;logo=react&amp;logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5-24292f?style=flat-square&amp;logo=typescript&amp;logoColor=white" alt="TypeScript 5" />
  <img src="https://img.shields.io/badge/Node.js-24%2B-24292f?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 or newer" />
  <img src="https://img.shields.io/badge/Fastify-5-24292f?style=flat-square&amp;logo=fastify&amp;logoColor=white" alt="Fastify 5" />
  <img src="https://img.shields.io/badge/SQLite-24292f?style=flat-square&amp;logo=sqlite&amp;logoColor=white" alt="SQLite" />
  <img src="https://img.shields.io/badge/Playwright-24292f?style=flat-square" alt="Playwright" />
  <img src="https://img.shields.io/badge/Chrome-MV3-24292f?style=flat-square&amp;logo=googlechrome&amp;logoColor=white" alt="Chrome Manifest V3" />
</p>

Hermo records browser tasks as reusable APIs for applications, scripts and AI
agents. Define inputs, select outputs, test the result, and publish a local endpoint.

[Installation](docs/installation.md) · [User guide](docs/user-guide.md) ·
[Architecture](docs/architecture.md) · [Contributing](CONTRIBUTING.md)

Hermo is in early access. Execution requires the local runtime and an authorized browser session.

## Capabilities

- **Browser workflows** — record a connected Chrome tab or use a separate local browser for read-only retrieval.
- **Typed contracts** — bind dynamic inputs and extract nested objects, lists, scalar values and media URLs.
- **Verified execution** — check outputs, inspect failures, and poll queued runs through REST or MCP.
- **Stable publication** — publish immutable revisions, edit drafts, and roll back published workflows.
- **Scoped access** — issue workflow-specific keys, revoke access, and generate OpenAPI documentation.

Use Hermo for supported searches, catalogs, dashboards, forms, internal tools and
AI websites. Website permissions and technical limits still apply.

## How it works

Publishing saves the tested workflow revision and issues a scoped key. Each API
request is authenticated and validated before entering a durable queue. The
runtime executes the authorized steps and checks the outputs; clients poll the
run ID for validated JSON or an explicit failure.

| Part | Technology | Responsibility |
| --- | --- | --- |
| Dashboard | React, TypeScript | Connect websites, edit workflows and inspect runs |
| Local runtime | Node.js, Fastify, SQLite | Authenticate requests, queue work and persist results |
| Chrome companion | Manifest V3 | Operate the explicitly authorized website tab |
| Browser adapters | Companion commands or Playwright | Execute the same workflow contract within each mode's permissions |

The dashboard can close while the runtime continues serving REST and MCP requests.

## Quick start

Requires **Node.js 24+**, npm and Git. Selected-tab workflows need **Chrome 120+**.
Release checks run on Windows. The [installation guide](docs/installation.md)
covers other platforms, encryption keys, browser installation and upgrades.

Windows PowerShell:

```powershell
git clone https://github.com/PraveenNimilka/Hermo.git
cd Hermo
npm.cmd ci
npm.cmd run build
npm.cmd start
```

Open [http://127.0.0.1:4317](http://127.0.0.1:4317) and create a workspace password.
Keep the runtime terminal running; the dashboard can be closed independently.

To connect a website:

1. Load [`companion/browser`](companion/browser/README.md) as an unpacked extension
   at `chrome://extensions`.
2. Set the companion's **Local runtime address** to `http://127.0.0.1:4317`.
   Its initial saved address uses port 4318; it must match your running instance.
3. Create a website connection in Hermo, generate its Connect code, and authorize
   the selected website tab through the companion.

## Create and call an API

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

The example contract is illustrative; create your own workflow first. An accepted
request returns HTTP 202 with `run_id` and `status_url`. Poll that URL with the
same key, and read `result` only when `status` is `succeeded`. Preserve the input
and idempotency key when recovering a lost receipt. See the [user guide](docs/user-guide.md)
for polling, MCP, media outputs and workflow repair.

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
docs/             Installation, usage, configuration and architecture
```

## Development

```sh
npm ci
npx playwright install chromium
npm run build
npm test
npm run test:consumers
```

On PowerShell, use `npm.cmd` and `npx.cmd` if execution policy blocks shell shims.
There is no separate lint command; the build includes TypeScript checking.
Tests use disposable state. See [Contributing](CONTRIBUTING.md) before running
external-site checks; never use an existing owner's workspace for tests.

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

See the [documentation index](docs/README.md) and [Security](SECURITY.md) for operational details.

## License

Authored code is [MIT licensed](LICENSE). See [third-party notices](THIRD-PARTY-NOTICES.md)
for bundled dependencies, fonts and components with their own terms.
