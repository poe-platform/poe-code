# Tiny HTTP MCP OAuth zero TTL token accepted at expiration instant

## Summary

`createMcpOAuthTestServer()` accepts `ttlSeconds: 0` through its SDK even though the CLI requires a positive TTL. It mints an access token whose `exp` equals `iat`, and the protected MCP endpoint accepts that zero-lifetime token when it is presented at the same integer-second timestamp.

## Reproduction

Create a disposable Vitest probe at `packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts`:

```ts
import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";
import { nodeFetch } from "tiny-http-mcp-server";
import { createMcpOAuthTestServer } from "./index.js";

describe("zero SDK token TTL", () => {
  it("accepts its own direct access token at the exact expiration instant", async () => {
    const server = createMcpOAuthTestServer({ ttlSeconds: 0 });
    const handle = await server.listen({ hostname: "127.0.0.1", port: 0 });

    try {
      const token = await handle.oauth.issueTokenFor({
        clientId: "client",
        resource: handle.resource,
        scopes: ["mcp.read"],
      });
      const payload = decodeJwt(token);
      expect(payload.exp).toBe(payload.iat);

      const response = await nodeFetch(handle.mcpUrl, {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "probe", version: "1" },
          },
        }),
      });

      expect(response.status).toBe(200);
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

The probe passes: the minted JWT has no positive lifetime, yet it successfully authenticates an MCP initialization request at the expiration boundary.

## Observed Behavior

The SDK wrapper forwards `options.ttlSeconds ?? 60` to the embedded OAuth server without enforcing the CLI's positive-integer requirement. A value of `0` causes direct issuance to sign a JWT with `expiresAt = issuedAt`. The JWT verifier used by the protected MCP endpoint considers that token valid while the current time equals `exp`, so a token with zero configured lifetime receives authenticated access.

## Expected Behavior

The SDK should reject zero token TTL configuration consistently with the CLI, and the protected-resource verification path should not admit a token whose expiration instant has already been reached. Access tokens require a positive validity interval and must be rejected at `now >= exp`.

## Impact

SDK-created fixtures can test applications using access tokens that are nominally expired at issuance but still authorize requests during a timing window. This masks expiration-boundary mistakes and creates behavior inconsistent with both the CLI option contract and expected bearer-token lifetime enforcement.
