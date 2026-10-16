# Three applications through generated Hermo APIs

Open `/examples.html` on your running Hermo instance.

1. Create your private workspace password in Hermo, or unlock an existing workspace.
2. In the lab, authorize creating the three local test integrations and choose **Build & verify APIs**.
3. Hermo signs into each synthetic portal, selects its account identity, records a parameterized lookup, captures outputs and saves an exact reference check.
4. Each action is tested using another record in a fresh browser, published with a scoped consumer key, and called through `/v1` using that key.
5. Choose a record and run any of the three applications. The result appears only after account and output verification succeeds.

| Application | Input | Records | Output |
| --- | --- | --- | --- |
| Northstar Orders | `order_id` | `ORD-2041`, `ORD-2042` | `status` |
| Harbor Shipping | `tracking_id` | `PKG-4101`, `PKG-4102` | `delivery_status` |
| Meadow Inventory | `sku` | `SKU-101`, `SKU-102` | `available_units` |

Each portal has a separate login cookie and account identity. Their data is synthetic. `UNKNOWN-RECORD` deliberately fails without returning a result.

## How the consumer app works

`public/examples.js` sends owner-authenticated requests to the lab backend in `server/examples.mjs`. That backend calls the ordinary consumer API using an action-scoped key. It is not a mocked response or a direct database lookup: Hermo's regular execution worker opens a fresh browser and runs the recorded website task.

The browser receives endpoint metadata and verified results. Keys remain encrypted in the local SQLite settings using the existing authenticated encryption and OS-protected key. Owner authentication, CSRF protection, quotas, network restrictions and consumer authorization remain in force.

**API documentation** opens the workspace documentation page. To use an action in your own backend, publish a fresh key from that action's test/publish dialog and save the one-time secret. Creating another key does not expose the lab's stored secret.

Rebuilding reuses the three example workflows, reconnects their synthetic accounts, retests their contracts, and rotates the lab keys. Old lab keys stop working. After a server restart, synthetic portal sessions expire; rebuild the examples to reconnect. Existing user integrations are separate from this catalog.

## Tested boundaries

The automated test builds, consumes and rebuilds all three integrations; checks two valid records per app, unknown records, cross-key execution rejection, wrong-app run rejection, encrypted secret storage, revocation, CSRF and logout. The UI walkthrough also exercises concurrent application requests and a missing record at desktop and mobile widths.

External sign-in is a separate test. These local results do not demonstrate authenticated ChatGPT, Claude or Google account access, and the MVP's replay policy remains GET/HEAD retrieval.
