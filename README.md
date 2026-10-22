# Hermo

Turn authorized website workflows into local REST APIs and MCP tools.

Hermo records a browser task, captures its inputs and outputs, verifies the result,
and publishes a versioned workflow for your applications. Your workspace and
browser sessions stay on your computer. This is a **beta, source-available release**.

[Install](docs/installation.md) · [End-to-end guide](docs/getting-started.md) ·
[User guide](docs/user-guide.md) · [Documentation](docs/README.md)

## Capabilities

- **Record browser tasks:** use an authorized Chrome tab or a dedicated managed browser.
- **Define verified results:** map typed inputs, nested outputs, bounded waits and success checks.
- **Publish stable contracts:** issue scoped keys, retain immutable revisions and review permissions.
- **Control execution:** approve protected steps, inspect run evidence, cancel work and revoke keys.
- **Integrate locally:** invoke the same published workflow through REST, OpenAPI or MCP.

## Install

Requires **Node.js 24+ with npm**. Windows is the release-tested platform.
Connected-tab workflows require Chrome 120+ and the unpacked companion.
Review the [license](LICENSE) before installing.

Download and extract the [beta release](https://github.com/PraveenNimilka/Hermo/releases),
then double-click **Start Hermo.cmd**. It installs locked dependencies, builds the
dashboard and starts the runtime. Keep its terminal open while using your APIs.
Internet access is required during initial setup; Node.js must already be installed.

For a terminal installation of this beta:

```powershell
git clone --branch v0.1.0-beta.1 https://github.com/PraveenNimilka/Hermo.git
cd Hermo
npm.cmd ci
npm.cmd run build
npm.cmd start
```

Open [127.0.0.1:4317](http://127.0.0.1:4317) and create a workspace password.
For managed-browser workflows, also run `npx.cmd playwright install chromium`.
See [installation](docs/installation.md) for companion setup, encryption and upgrades.

## Create your first workflow

1. Open **Connections**, add a website and authorize access to its account or public pages.
2. For an existing Chrome tab, load `companion/browser` at `chrome://extensions`,
   create a Connect code in Hermo, and connect that tab through the companion.
3. Choose **Actions → Create action**. Demonstrate the task and name its dynamic inputs.
4. Select actual result fields and define checks that prove the requested task completed.
5. Test the workflow, inspect its output, review its permissions and choose **Publish API**.
6. Copy the scoped key and generated examples from **API docs**.

Follow the [end-to-end guide](docs/getting-started.md) for a complete local practice
workflow, REST polling, MCP invocation and restart verification.

## Call a published workflow

Use the action ID and input fields from your own contract. This example assumes
an `orders.lookup` action with an `order_id` input:

```sh
curl -X POST 'http://127.0.0.1:4317/v1/actions/orders.lookup/versions/1/runs' \
  -H 'Authorization: Bearer YOUR_HERMO_KEY' \
  -H 'Idempotency-Key: YOUR_UNIQUE_REQUEST_ID' \
  -H 'Content-Type: application/json' \
  --data '{"input":{"order_id":"ORD-2041"}}'
```

An accepted request returns HTTP 202 with `run_id` and `status_url`. Poll that URL
with the same key until terminal; consume `result` only when `status` is
`succeeded`. Reuse the same input and request ID when recovering a lost receipt.
For MCP, use a Streamable HTTP client at `/mcp` with the same scoped key.
See [calling workflows](docs/user-guide.md#5-publish-and-call-the-api).

## Configuration

Set variables in the runtime's environment. Hermo does not load `.env` files.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HERMO_PORT` | `4317` | Loopback HTTP port |
| `HERMO_DATA_DIR` | `.hermo/` | Persistent local workspace |
| `HERMO_MASTER_KEY` | Windows CurrentUser DPAPI | Stable 32-byte base64 key; required outside Windows |
| `HERMO_BROWSER_PATH` | Browser discovery | Trusted managed Chromium executable |

Keep keys and complete backups private. Replacing a key does not recover encrypted
data. See [configuration](docs/configuration.md) and [security](SECURITY.md).

## Repository layout

| Directory | Contents |
| --- | --- |
| `src/` | Dashboard components and styles |
| `server/` | Runtime, encrypted store, execution and APIs |
| `companion/browser/` | Canonical Chrome companion |
| `public/` | Served guides, assets and practice pages |
| `integrations/` | Optional, separately documented integrations |
| `tests/` | Regression tests and synthetic fixtures |
| `validation-apps/` | Runnable REST/MCP consumer examples |
| `scripts/` | Startup and explicit verification tools |
| `docs/` | Operating guides, architecture and security references |

## Development and verification

Read [Contributing](CONTRIBUTING.md) for licensing and contribution requirements.
Run `npm ci`, `npx playwright install chromium`, `npm run build`, `npm test`,
`npm run test:consumers` and `npm run check:repo`. The build includes TypeScript
checking; there is no separate lint command. Tests use disposable state, never an
owner's workspace. See [release verification](docs/testing/release-acceptance.md).

## Known limitations

- Keep the runtime and computer running. This loopback service is not configured for public hosting.
- Connected Chrome needs its authorized tab and valid lease. Managed workflows can reopen encrypted sessions after restart.
- Managed retrieval permits GET/HEAD only. Reviewed website actions allow HTTP submissions and WSS within exact approved origins.
- Website changes, expired sessions, quotas, verification screens and unsupported layouts can stop a workflow.
- Cancellation cannot undo website changes. Inspect uncertain submissions before retrying; they are not automatically replayed.
- Active managed profiles use temporary readable files. Crashes recover the last completed encrypted snapshot.
- Service workers and arbitrary downloads are disabled. Protected media links may not work in other applications.
- Windows is verified; macOS/Linux lack equivalent release testing. See [compatibility](docs/browser-compatibility.md).

## License and support

Personal and internal business use is free under the proprietary [Hermo License](LICENSE).
Modification, redistribution, rebranding and providing Hermo as a service require
written permission, subject to its exceptions. Earlier [MIT grants](licenses/hermo-mit-legacy.txt)
and [third-party terms](THIRD-PARTY-NOTICES.md) remain intact.
Use [GitHub issues](https://github.com/PraveenNimilka/Hermo/issues) for reproducible
bugs without credentials or private data. Follow [SECURITY.md](SECURITY.md) for private reports.
