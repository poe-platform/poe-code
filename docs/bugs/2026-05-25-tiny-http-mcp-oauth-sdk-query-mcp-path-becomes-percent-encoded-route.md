# Tiny HTTP MCP OAuth SDK query MCP path becomes percent-encoded route

## Summary

`createMcpOAuthTestServer()` accepts an SDK `mcpPath` containing a query string such as `"/mcp?tenant=demo"`, but it does not create an endpoint at `/mcp` with that query. Instead it embeds the literal question mark in the URL pathname, publishing and serving `/mcp%3Ftenant=demo` as a different route.

## Reproduction

Create a disposable Vitest probe at `packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMcpOAuthTestServer } from "./index.js";

describe("SDK MCP path containing query", () => {
  it("publishes a percent-encoded endpoint path instead of the requested query", async () => {
    const server = createMcpOAuthTestServer({ mcpPath: "/mcp?tenant=demo" });
    const handle = await server.listen({ hostname: "127.0.0.1", port: 0 });

    try {
      expect(new URL(handle.mcpUrl).pathname).toBe("/mcp%3Ftenant=demo");
      expect(new URL(handle.mcpUrl).search).toBe("");
    } finally {
      await handle.close();
    }
  });
});
```

Run:

```sh
npm exec -- vitest run packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts --reporter verbose
```

The probe passes: the accepted SDK option produces a published MCP URL with an encoded `?` in its path and no query component.

## Observed Behavior

`normalizePath()` treats `mcpPath` as a raw path string and preserves query delimiters. Later, `buildUrl()` assigns that complete string to `url.pathname`; the URL implementation percent-encodes the literal question mark because it is now path data. As a result, input describing a query-qualified endpoint is transformed into a separate pathname without warning or rejection.

## Expected Behavior

The SDK should reject `mcpPath` values containing query or fragment syntax, or explicitly parse them if such endpoint forms are supported. A configured route must not silently turn into a different percent-encoded route than the caller supplied.

## Impact

SDK consumers can publish incorrect MCP and protected-resource metadata URLs and then fail to connect to the endpoint they believed they configured. Query-based tenant or fixture routing is silently lost, turning setup errors into confusing discovery and authorization failures.
