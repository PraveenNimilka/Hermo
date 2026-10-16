# Hermo Reliability Lab

Start: `node validation-apps/start.mjs reliability-lab`. Open `http://127.0.0.1:4506`, configure a published endpoint/key and choose a conservative request budget. Inspect run IDs, queue/execution times, revision IDs, verification and explicit request/runtime errors. Export real measured results. Duplicate-key mode preserves one idempotency key across admissions.

See [consumer setup and testing](../README.md) for negative requests and controlled fault testing. Budget/error/statistics tests in `tests/data.test.mjs`, idempotency/polling tests in `tests/client.test.mjs` and independent host tests cover the app. Stop further admissions does not cancel already submitted runs. Do not stress third-party websites or crash your working browser.
