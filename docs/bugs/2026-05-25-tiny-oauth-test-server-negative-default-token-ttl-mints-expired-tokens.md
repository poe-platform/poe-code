# Tiny OAuth test server negative default token TTL mints expired tokens

## Summary

The exported `tiny-oauth-test-server` factory accepts a negative `defaultTokenTtlSeconds` option and uses it for tokens issued without an explicit per-call TTL. A server configured with `defaultTokenTtlSeconds: -1` successfully issues an access token whose expiration precedes its issuance timestamp. This is distinct from the existing per-call `issueTokenFor({ ttlSeconds: -60 })` defect because it corrupts the factory's default behavior for every token path that relies on configured defaults.

## Reproduction

Create a disposable Vitest probe at `packages/tiny-oauth-test-server/src/__probe__.test.ts`:

```ts
import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";
import { createOAuthTestServer } from "./index.js";

describe("tiny OAuth negative default token TTL", () => {
  it("issues an already-expired direct token when the factory default is negative", async () => {
    const server = createOAuthTestServer({
      issuer: "https://issuer.example.test/oauth",
      signingKeySeed: "probe",
      defaultTokenTtlSeconds: -1
    });

    const token = await server.issueTokenFor({
      clientId: "client",
      resource: "https://resource.example.test/mcp",
      scopes: ["mcp.read"]
    });
    const claims = decodeJwt(token);

    expect(claims.exp).toBeLessThan(claims.iat!);
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/tiny-oauth-test-server/src/__probe__.test.ts --reporter verbose
rm packages/tiny-oauth-test-server/src/__probe__.test.ts
```

The test passes:

```text
✓ packages/tiny-oauth-test-server/src/__probe__.test.ts > tiny OAuth negative default token TTL > issues an already-expired direct token when the factory default is negative
```

## Observed Behavior

`OAuthTestServerOptions` exposes `defaultTokenTtlSeconds?: number` in `packages/tiny-oauth-test-server/src/index.ts:21` through `packages/tiny-oauth-test-server/src/index.ts:34`. Factory creation reads that value without validation into `defaultTokenTtlSeconds` at `packages/tiny-oauth-test-server/src/index.ts:650` through `packages/tiny-oauth-test-server/src/index.ts:662`. When `issueTokenFor()` omits `ttlSeconds`, it selects the negative default at `packages/tiny-oauth-test-server/src/index.ts:767` through `packages/tiny-oauth-test-server/src/index.ts:787`, and token signing computes `expiresAt = issuedAt + input.ttlSeconds` at `packages/tiny-oauth-test-server/src/index.ts:1366` through `packages/tiny-oauth-test-server/src/index.ts:1405`. The resulting JWT has `exp < iat` although creation and issuance both resolve successfully.

The previously retained report `docs/bugs/2026-05-24-tiny-oauth-test-server-issue-token-for-accepts-negative-ttl-and-mints-expired-token.md` covers an explicit per-token `ttlSeconds` override. This reproduction exercises the separate server-configuration default used when callers do not override a lifetime.

## Expected Behavior

`createOAuthTestServer()` should reject non-positive default token lifetimes before exposing a server configured to issue unusable credentials. Any path relying on `defaultTokenTtlSeconds` should produce valid future-expiring tokens or fail with a clear configuration error.

## Impact

SDK users can create a seemingly valid OAuth fixture whose default direct-token, authorization-code, and refresh-token flows issue already expired access tokens whenever they inherit the invalid configured lifetime. Tests then fail downstream during token use rather than at fixture setup, and callers must diagnose a systemic invalid server configuration after successful issuance responses.
