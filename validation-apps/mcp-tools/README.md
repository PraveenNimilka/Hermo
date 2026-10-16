# Hermo MCP Tools

Start: `node validation-apps/start.mjs mcp-tools`. Open `http://127.0.0.1:4504` and enter the published endpoint and scoped key. Discover authorized tools, inspect their schemas and invoke the workflow tool with matching inputs. Discovery, invocation and `get_run` polling use the actual MCP endpoint.

See [consumer setup and testing](../README.md). MCP protocol/error tests in `tests/client.test.mjs` and independent host tests cover this app. No model provider or conversational integration is configured; tools and results are displayed directly without fabricated AI responses.
