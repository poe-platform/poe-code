# Tiny HTTP MCP OAuth issuer query breaks direct token verification

## Summary

`tiny-http-mcp-oauth-test-server` accepts an explicit absolute HTTP issuer URL containing a query string, starts both listeners successfully, and exposes a functioning `issueTokenFor()` helper. However, the wrapper builds its JWKS verifier endpoint by appending `/.well-known/jwks.json` to the serialized issuer string. With an issuer such as `http://127.0.0.1:<port>/oauth?tenant=demo`, that produces a malformed query-bearing lookup URL rather than the OAuth server's served JWKS endpoint, so the protected MCP endpoint rejects tokens minted by its own authorization server.

## Reproduction

Create a disposable test at `packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts`:

```ts
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { nodeFetch } from "tiny-http-mcp-server";
import { createMcpOAuthTestServer } from "./index.js";

async function reservePort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("missing port");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

describe("MCP OAuth fixture issuer query", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it("starts but cannot verify a directly issued token", async () => {
    const issuer = `http://127.0.0.1:${await reservePort()}/oauth?tenant=demo`;
    const handle = await createMcpOAuthTestServer({ issuer, scopes: ["mcp.read"] })
      .listen({ port: 0, hostname: "127.0.0.1" });
    cleanups.push(handle.close);
    const token = await handle.oauth.issueTokenFor({
      clientId: "probe",
      resource: handle.resource,
      scopes: ["mcp.read"]
    });

    const response = await nodeFetch(handle.mcpUrl, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "probe", version: "1" } } })
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("unable to load JWKS");
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts --reporter verbose
rm packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts
```

Result:

```text
✓ packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts > MCP OAuth fixture issuer query > starts but cannot verify a directly issued token
```

## Observed Behavior

The wrapper's `parseHttpUrl()` validates only absolute `http:` form and a non-root pathname in `packages/tiny-http-mcp-oauth-test-server/src/index.ts:48` through `packages/tiny-http-mcp-oauth-test-server/src/index.ts:79`, so an issuer containing `?tenant=demo` is accepted at factory construction and used at startup in `packages/tiny-http-mcp-oauth-test-server/src/index.ts:159` through `packages/tiny-http-mcp-oauth-test-server/src/index.ts:166` and `packages/tiny-http-mcp-oauth-test-server/src/index.ts:199` through `packages/tiny-http-mcp-oauth-test-server/src/index.ts:208`.

The embedded OAuth server creates endpoint URLs with `new URL(path, issuer)` in `packages/tiny-oauth-test-server/src/index.ts:366` through `packages/tiny-oauth-test-server/src/index.ts:431`, which correctly produces the served path endpoint. The MCP OAuth wrapper instead configures its verifier with string interpolation, ```${oauth.issuer}/.well-known/jwks.json``` at `packages/tiny-http-mcp-oauth-test-server/src/index.ts:245` through `packages/tiny-http-mcp-oauth-test-server/src/index.ts:253`. When the issuer has a query string, the resulting lookup is not the served JWKS URL. Consequently, the fixture accepts startup and token issuance but answers authenticated MCP initialization with HTTP `401` and an `unable to load JWKS` challenge.

## Expected Behavior

Either issuer URLs containing query components should be rejected before listeners start, or all derived authorization-server endpoints should be resolved through URL semantics consistent with the embedded OAuth server. A token minted by the fixture's own authorization server must verify successfully for a valid configured scope.

## Impact

SDK and CLI users can supply an absolute issuer URL that passes documented validation and receive a running OAuth MCP fixture whose directly issued credentials are unusable. Integration tests then fail as apparent authentication or key-discovery errors after successful fixture setup, masking the configuration-derived endpoint corruption and preventing reliable OAuth interop testing for accepted issuer values.
