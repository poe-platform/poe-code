# Tiny HTTP MCP server Express query path crashes OAuth handler construction

## Summary

The exported `createExpressOAuthHandlers()` API accepts a string `path`, but a query-bearing value such as `"/mcp?tenant=demo"` crashes synchronously while constructing its protected-resource metadata router. Unlike the standalone HTTP listener's query-path misrouting, the Express OAuth adapter cannot even be mounted for the configured endpoint shape.

## Reproduction

Create this disposable probe at `packages/tiny-http-mcp-server/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createExpressOAuthHandlers, createHttpServer } from "./index.js";

describe("Express OAuth query path probe", () => {
  it("throws while constructing handlers for a query-bearing MCP path", () => {
    let message = "";
    try {
      createExpressOAuthHandlers({
        path: "/mcp?tenant=demo",
        server: createHttpServer({ name: "probe", version: "1" }),
        oauth: {
          resource: "https://resource.example/mcp?tenant=demo",
          authorizationServers: ["https://auth.example"],
          verifier: { verify: async () => ({ accessToken: "x", clientId: "c", scopes: [] }) }
        }
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    console.log(JSON.stringify({ message }));
    expect(message).toContain("Unexpected ?");
    expect(message).toContain("/.well-known/oauth-protected-resource/mcp?tenant=demo");
  });
});
```

Run it and remove the probe immediately afterward:

```sh
npm exec -- vitest run packages/tiny-http-mcp-server/src/__probe__.test.ts --reporter verbose
rm -f packages/tiny-http-mcp-server/src/__probe__.test.ts
```

Output:

```text
stdout | packages/tiny-http-mcp-server/src/__probe__.test.ts > Express OAuth query path probe > throws while constructing handlers for a query-bearing MCP path
{"message":"Unexpected ? at index 41: /.well-known/oauth-protected-resource/mcp?tenant=demo; visit https://git.new/pathToRegexpError for info"}

 ✓ packages/tiny-http-mcp-server/src/__probe__.test.ts > Express OAuth query path probe > throws while constructing handlers for a query-bearing MCP path 1ms
```

## Observed Behavior

`createExpressOAuthHandlers()` normalizes its supplied endpoint string at `packages/tiny-http-mcp-server/src/express-middleware.ts:66` and forwards it to `createProtectedResourceMetadataRouter()` at `packages/tiny-http-mcp-server/src/express-middleware.ts:75`. That router concatenates the raw query-bearing value into an Express route path at `packages/tiny-http-mcp-server/src/express-middleware.ts:41` through `packages/tiny-http-mcp-server/src/express-middleware.ts:51`, producing `/.well-known/oauth-protected-resource/mcp?tenant=demo`. Express route parsing rejects the literal `?` during `router.get(...)`, so construction throws before any request can be served.

## Expected Behavior

The Express OAuth adapter should either reject query-bearing MCP endpoint options with its own clear validation error before route registration, or preserve the configured route semantics without crashing. Calling an exported handler factory with accepted options should not leak a lower-level route-parser exception.

## Impact

Applications integrating MCP OAuth through Express cannot configure query-qualified endpoint routes or reliably handle such configuration as a normal startup validation failure. A tenant or environment-specific path string can terminate application setup with an unexpected router exception, preventing the MCP service and its OAuth metadata endpoints from starting.
