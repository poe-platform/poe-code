# Tiny HTTP MCP OAuth test server infinite default TTL crashes direct token issuance

## Summary

The exported `tiny-http-mcp-oauth-test-server` SDK factory accepts `ttlSeconds: Infinity` and starts a listening OAuth-protected MCP fixture successfully, but its public `handle.oauth.issueTokenFor(...)` helper then rejects inside `jose` with `Invalid setExpirationTime input` when it tries to mint a direct access token using that configured lifetime.

## Reproduction

Add the following disposable test as `packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMcpOAuthTestServer } from "./index.js";

describe("non-finite SDK token TTL", () => {
  it("creates a listening fixture whose direct token issuance crashes", async () => {
    const server = createMcpOAuthTestServer({ ttlSeconds: Number.POSITIVE_INFINITY });
    const handle = await server.listen({ hostname: "127.0.0.1", port: 0 });
    try {
      await expect(handle.oauth.issueTokenFor({
        clientId: "client",
        resource: handle.resource,
        scopes: ["mcp.read"],
      })).rejects.toThrow("Invalid setExpirationTime input");
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

The test passes:

```text
✓ packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts > non-finite SDK token TTL > creates a listening fixture whose direct token issuance crashes
```

Remove the disposable probe after confirmation.

## Observed Behavior

`McpOAuthTestServerOptions` publicly declares `ttlSeconds?: number` without rejecting non-finite values. During `listen()`, the wrapper creates its embedded OAuth fixture with `defaultTokenTtlSeconds: options.ttlSeconds ?? 60`, so `Infinity` survives configuration and the HTTP MCP server begins listening normally. Calling the wrapper's exposed `handle.oauth.issueTokenFor()` helper without a per-token TTL then tries to sign an access token with an infinite expiration and throws `TypeError: Invalid setExpirationTime input` from the JWT dependency.

## Expected Behavior

The combined OAuth-protected MCP fixture should reject a non-finite `ttlSeconds` option before it opens a listening server, consistent with its CLI accepting only positive finite integer TTL values. Once `listen()` succeeds, its public direct-token helper should be usable with the fixture's configured defaults.

## Impact

SDK callers can launch a seemingly operational OAuth MCP integration fixture that fails only when they issue credentials for the protected MCP endpoint. The delayed dependency-level failure obscures the invalid wrapper configuration, wastes an allocated listening fixture, and creates validation drift between programmatic use and the command-line entrypoint.
