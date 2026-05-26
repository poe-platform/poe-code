# Tiny HTTP MCP OAuth test server negative default TTL mints expired direct tokens

## Summary

The exported `tiny-http-mcp-oauth-test-server` factory accepts a negative `ttlSeconds` fixture option and passes it through as the embedded authorization server's default token lifetime. A test server created with `ttlSeconds: -1` resolves normally but its public `handle.oauth.issueTokenFor(...)` API mints a JWT whose expiration timestamp precedes its issuance timestamp.

## Reproduction

Add the following disposable test as `packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { createMcpOAuthTestServer } from "./index.js";

describe("MCP OAuth fixture negative default TTL", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
  });

  it("mints an already-expired direct token using its configured negative TTL", async () => {
    const handle = await createMcpOAuthTestServer({ ttlSeconds: -1 }).listen({ port: 0 });
    cleanups.push(handle.close);

    const token = await handle.oauth.issueTokenFor({
      clientId: "probe-client",
      resource: handle.resource,
      scopes: ["mcp.read"]
    });
    const payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));

    expect(payload.exp).toBeLessThan(payload.iat);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts --reporter verbose
```

The test passes:

```text
✓ packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts > MCP OAuth fixture negative default TTL > mints an already-expired direct token using its configured negative TTL
```

Remove the disposable probe after confirmation.

## Observed Behavior

`McpOAuthTestServerOptions` publicly declares `ttlSeconds?: number` without validation. During `listen()`, the wrapper constructs the embedded OAuth server with `defaultTokenTtlSeconds: options.ttlSeconds ?? 60`. The exposed `handle.oauth.issueTokenFor()` API then uses that configured default lifetime when no per-token TTL is supplied. With `ttlSeconds: -1`, the resulting signed token contains `exp < iat`, even though server creation and issuance both report success.

## Expected Behavior

The OAuth-protected MCP fixture should reject an invalid non-positive configured default TTL before it can start or mint credentials, consistent with its CLI parsing of `--ttl-seconds` as a positive integer. A public fixture option must not silently configure all default direct tokens as already expired.

## Impact

SDK consumers can accidentally instantiate a seemingly valid OAuth MCP test fixture whose helper-issued bearer tokens fail immediately. This creates misleading integration failures and inconsistent validation between the command-line fixture entrypoint and its programmatic API, forcing callers to diagnose expired credentials after successful fixture startup.
