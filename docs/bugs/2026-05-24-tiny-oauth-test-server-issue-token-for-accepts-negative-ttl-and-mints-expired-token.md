# Tiny OAuth test server issueTokenFor accepts negative TTL and mints expired token

## Summary

The public `issueTokenFor()` API in `tiny-oauth-test-server` accepts a negative `ttlSeconds` value and signs an access token whose expiration precedes its issued-at timestamp. The HTTP `/testing/issue-token` helper rejects non-positive TTLs, so the programmatic API bypasses the package's own advertised token-lifetime validation.

## Reproduction

From the repository root, run a disposable Vitest probe that directly requests a token with `ttlSeconds: -60` and inspects its JWT timestamps:

```sh
cat > /tmp/tiny-oauth-negative-ttl-probe.test.ts <<'PROBE'
import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";
import { createOAuthTestServer } from "./index.js";

describe("tiny OAuth direct negative TTL", () => {
  it("issues an already expired access token for a negative TTL", async () => {
    const server = createOAuthTestServer({ issuer: "https://issuer.example.test", signingKeySeed: "probe" });
    const token = await server.issueTokenFor({ clientId: "client", resource: "https://resource.example.test/mcp", scopes: [], ttlSeconds: -60 });
    const payload = decodeJwt(token);
    console.log(JSON.stringify({ iat: payload.iat, exp: payload.exp, expiredAtIssue: Number(payload.exp) < Number(payload.iat) }));
    expect(Number(payload.exp)).toBeLessThan(Number(payload.iat));
  });
});
PROBE
cp /tmp/tiny-oauth-negative-ttl-probe.test.ts packages/tiny-oauth-test-server/src/__probe__.test.ts
trap 'rm -f packages/tiny-oauth-test-server/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/tiny-oauth-test-server/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The public API returns a signed JWT whose `exp` value is already earlier than `iat` when issued:

```text
{"iat":1779667999,"exp":1779667939,"expiredAtIssue":true}
✓ packages/tiny-oauth-test-server/src/__probe__.test.ts > tiny OAuth direct negative TTL > issues an already expired access token for a negative TTL
```

`packages/tiny-oauth-test-server/src/index.ts:771` through `packages/tiny-oauth-test-server/src/index.ts:783` pass `input.ttlSeconds` directly into token issuance with no positivity validation. `packages/tiny-oauth-test-server/src/index.ts:1374` through `packages/tiny-oauth-test-server/src/index.ts:1402` compute and sign `expiresAt = issuedAt + input.ttlSeconds`. By contrast, the HTTP helper validates `ttl_seconds > 0` at `packages/tiny-oauth-test-server/src/index.ts:1201` through `packages/tiny-oauth-test-server/src/index.ts:1212`.

## Expected Behavior

`issueTokenFor()` should enforce the same positive TTL constraint as the test-only HTTP endpoint and reject zero or negative token lifetimes instead of minting already-expired credentials.

## Impact

Programmatic tests using the exported helper can accidentally generate unusable access tokens while appearing to obtain successful fixtures, or can exercise behavior inconsistent with the package's HTTP-facing token helper. This creates misleading authentication test setup and API inconsistency.
