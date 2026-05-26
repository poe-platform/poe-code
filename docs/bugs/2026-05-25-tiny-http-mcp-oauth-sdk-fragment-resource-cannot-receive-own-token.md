# Tiny HTTP MCP OAuth SDK fragment resource cannot receive own token

## Summary

`createMcpOAuthTestServer()` accepts an explicit protected `resource` URI containing a fragment and publishes it in protected-resource metadata. Its embedded OAuth server rejects the same resource when asked to mint a token, so the fixture advertises a protected resource for which its own token issuer cannot issue credentials.

## Reproduction

Create a disposable Vitest probe at `packages/tiny-http-mcp-oauth-test-server/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { nodeFetch } from "tiny-http-mcp-server";
import { createMcpOAuthTestServer } from "./index.js";

describe("SDK protected resource fragment", () => {
  it("publishes a resource identifier containing a URI fragment", async () => {
    const server = createMcpOAuthTestServer({
      resource: "https://resource.example.test/mcp#tenant",
    });
    const handle = await server.listen({ hostname: "127.0.0.1", port: 0 });

    try {
      const metadata = await nodeFetch(handle.prmUrl);
      await expect(metadata.json()).resolves.toMatchObject({
        resource: "https://resource.example.test/mcp#tenant",
      });

      await expect(handle.oauth.issueTokenFor({
        clientId: "client",
        resource: handle.resource,
        scopes: ["mcp.read"],
      })).rejects.toThrow("resource must not include a fragment");
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

The probe passes: the PRM publishes the fragment-bearing resource, but direct issuance from `handle.oauth` rejects that exact resource string.

## Observed Behavior

The SDK wrapper forwards `options.resource` directly into the HTTP MCP server configuration and exposed handle without validating it. In contrast, the embedded `tiny-oauth-test-server` validates resources through `parseAbsoluteUrl()`, which rejects URI fragments. Consequently, the protected-resource metadata publishes `https://resource.example.test/mcp#tenant`, while `handle.oauth.issueTokenFor({ resource: handle.resource, ... })` fails before producing a token.

## Expected Behavior

The SDK should validate explicit protected resource URIs using the same constraints as its embedded OAuth issuer before listening. It must not publish a resource identifier that its own issuer rejects for token audience construction.

## Impact

SDK-created OAuth/MCP fixtures can start and advertise discoverable resource metadata but cannot produce usable access tokens for the configured audience. Integration tests fail during authentication rather than setup, and clients receive metadata describing an internally unsupported protected resource.
