# Tiny OAuth test server infinite default token TTL crashes token issuance

## Summary

`createOAuthTestServer()` accepts `defaultTokenTtlSeconds: Infinity` during setup, but any token minting operation that inherits that default later rejects inside `jose` with `Invalid setExpirationTime input` instead of returning an OAuth token or an actionable configuration error.

## Reproduction

Create a disposable Vitest probe at `packages/tiny-oauth-test-server/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createOAuthTestServer } from "./index.js";

describe("non-finite default token TTL", () => {
  it("accepts configuration that makes direct token issuance throw", async () => {
    const server = createOAuthTestServer({
      issuer: "https://issuer.example.test/oauth",
      signingKeySeed: "probe",
      defaultTokenTtlSeconds: Number.POSITIVE_INFINITY,
    });

    await expect(server.issueTokenFor({
      clientId: "client",
      resource: "https://resource.example.test/mcp",
      scopes: ["mcp.read"],
    })).rejects.toThrow("Invalid setExpirationTime input");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/tiny-oauth-test-server/src/__probe__.test.ts --reporter verbose
```

The probe passes, demonstrating that the factory accepts the invalid default and defers failure until a token is requested.

## Observed Behavior

`createOAuthTestServer()` stores `options.defaultTokenTtlSeconds` without checking that it is finite. `issueTokenFor()` selects that configured default when the per-call TTL is absent, and `issueAccessToken()` calculates `expiresAt = issuedAt + ttlSeconds`. For `Infinity`, the calculated expiration is also `Infinity`; passing that value to `SignJWT.setExpirationTime()` throws `TypeError: Invalid setExpirationTime input` from the dependency.

## Expected Behavior

The server should validate `defaultTokenTtlSeconds` at construction time and reject non-finite values with a package-level configuration error. Valid-looking server creation should not result in an internal JWT-library exception during normal token minting.

## Impact

Test fixtures and demos can initialize successfully with a malformed default TTL, then fail later in direct token issuance, authorization-code exchanges, or refresh rotations when they attempt to mint access tokens. The delayed dependency-level exception obscures the bad configuration and can derail unrelated authentication-flow tests.
