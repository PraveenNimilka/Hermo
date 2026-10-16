# Website Records Dashboard

Start: `node validation-apps/start.mjs website-dashboard`. Open `http://127.0.0.1:4505`, configure `validation.quotes` and its scoped key, choose a supported page and load. Search the returned records, inspect details and compare pinned revision IDs across actual runs.

See [consumer setup and testing](../README.md) for safe draft/edit/test/publish/rollback verification. Record/nested/filter tests in `tests/data.test.mjs`, client tests and independent host tests cover this app. Editing/publication is done in Hermo, using owner authorization; the consumer cannot alter workflows.
