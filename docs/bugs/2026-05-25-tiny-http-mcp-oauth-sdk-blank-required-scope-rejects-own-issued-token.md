# Tiny HTTP MCP OAuth SDK blank required scope rejects own issued token

## Summary

The exported `tiny-http-mcp-oauth-test-server` programmatic factory accepts `scopes: [""]` and starts normally, publishing a blank required OAuth scope. Its exposed authorization-server helper can issue a token using that same configured blank scope, but the protected MCP endpoint rejects the token with `insufficient_scope`, so the started fixture cannot authorize requests using its own advertised/issued requirement. The CLI rejects empty scopes before starting.

## Reproduction

Create a disposable probe at `packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { nodeFetch } from "tiny-http-mcp-server";
import { createMcpOAuthTestServer } from "./index.js";

function initializeBody(): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "probe", version: "1" }
    }
  });
}

describe("MCP OAuth fixture blank required scope", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
  });

  it("rejects a token issued for its own blank required scope", async () => {
    const handle = await createMcpOAuthTestServer({ scopes: [""] })
      .listen({ port: 0, hostname: "127.0.0.1" });
    cleanups.push(handle.close);
    const token = await handle.oauth.issueTokenFor({
      clientId: "probe",
      resource: handle.resource,
      scopes: [""]
    });

    const response = await nodeFetch(handle.mcpUrl, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: initializeBody()
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toContain("insufficient_scope");
  });
});
```

Run the probe and delete it afterward:

```sh
npm exec -- vitest run packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts --reporter verbose
rm packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts
```

The reproduction passes:

```text
✓ packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts > MCP OAuth fixture blank required scope > rejects a token issued for its own blank required scope
```

## Observed Behavior

`McpOAuthTestServerOptions` accepts `scopes?: string[]` in `packages/tiny-http-mcp-oauth-test-server/src/index.ts:11` through `packages/tiny-http-mcp-oauth-test-server/src/index.ts:19`, and `normalizeScopes()` simply copies any supplied array at `packages/tiny-http-mcp-oauth-test-server/src/index.ts:120` through `packages/tiny-http-mcp-oauth-test-server/src/index.ts:123`. Startup supplies that array both to the embedded authorization defaults and to `scopesSupported`/`requiredScopes` for the MCP server in `packages/tiny-http-mcp-oauth-test-server/src/index.ts:230` through `packages/tiny-http-mcp-oauth-test-server/src/index.ts:277`. With `scopes: [""]`, a token issued for `scopes: [""]` is rejected on MCP initialization with HTTP `403` and an `insufficient_scope` challenge.

The CLI uses different validation: `parseScopes()` trims entries, removes empty strings, and rejects input when no non-empty scope remains at `packages/tiny-http-mcp-oauth-test-server/src/cli.ts:144` through `packages/tiny-http-mcp-oauth-test-server/src/cli.ts:156`.

## Expected Behavior

The programmatic API should normalize and validate configured scopes using the same non-empty-scope rule as the CLI before starting the test fixture. It should reject blank scope definitions rather than creating an authorization configuration whose own identically configured token cannot satisfy access control.

## Impact

SDK users can construct a fixture that starts successfully and advertises OAuth behavior, yet deterministically denies credentials minted through its own exposed OAuth helper. Integration tests then fail at authentication time with misleading scope errors instead of receiving an immediate configuration diagnostic, and behavior diverges depending on whether the same fixture is started from code or from its CLI.
