# Website Change Detector

Start: `node validation-apps/start.mjs change-detector`. Open `http://127.0.0.1:4502` and configure a published extraction workflow and scoped key. Run repeated observations with the same inputs. Verified output is compared structurally; timestamped history can be stored locally and exported. Failed executions never become successful observations.

See [consumer setup and testing](../README.md) for managed browser independence verification and data privacy. The observation test in `tests/data.test.mjs`, polling/error tests in `tests/client.test.mjs` and independent host test cover this app. A compatible managed executor and running independent runtime are required for the original-browser-closed scenario.
