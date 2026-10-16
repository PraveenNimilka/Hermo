# Product Search Explorer

Start: `node validation-apps/start.mjs product-search` from the repository root. Open `http://127.0.0.1:4501`, configure the published `validation.products` action and its scoped key, load its contract and select a supported category. Run to show real returned records, raw JSON, verification and run details; title filtering is local to returned products.

See [consumer setup and testing](../README.md) for workflow creation, alternate runtime ports and the shared regression command. The product-record test in `tests/data.test.mjs`, REST tests in `tests/client.test.mjs` and independent host test in `tests/host.test.mjs` cover this app. Live website proof is recorded separately in the repository validation report.
