# Website-to-JSON Explorer

Start: `node validation-apps/start.mjs json-explorer`. Open `http://127.0.0.1:4503`, configure the published `validation.quotes` action and scoped key, load its contract and run a supported page. Inspect nested quote/tag records, filter returned data and export verified JSON with run evidence.

See [consumer setup and testing](../README.md). Nested/optional record tests in `tests/data.test.mjs`, contract/poll tests in `tests/client.test.mjs` and independent host tests cover the app. Only actual Hermo results appear; empty data is never filled with sample quotes.
