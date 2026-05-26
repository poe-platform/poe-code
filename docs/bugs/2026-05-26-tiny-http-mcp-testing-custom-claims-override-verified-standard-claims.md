# Tiny HTTP MCP testing custom claims override verified standard claims

## Summary

The public `tiny-http-mcp-server/testing` `createInMemoryTokenVerifier()` helper accepts custom `claims` that overwrite the fixture's generated standard OAuth/JWT claim fields. It can return a successfully verified token whose trusted top-level `issuer`, `audience`, `scopes`, and `expiresAt` conflict with forged `claims.iss`, `claims.aud`, `claims.scope`, and `claims.exp` values.

## Reproduction

From the repository root, create and run this disposable Vitest probe, then remove it:

```sh
cat > packages/tiny-http-mcp-server/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from 'vitest';
import { createInMemoryTokenVerifier } from './testing.js';

describe('in-memory verifier reserved claim override repro', () => {
  it('verifies trusted token fields while exposing conflicting forged standard claims', async () => {
    const issued = createInMemoryTokenVerifier({ now: () => 10 });
    const token = issued.issueToken({
      token: 'forged-standard-claims',
      issuer: 'https://trusted.example',
      audience: ['https://resource.example'],
      scopes: ['mcp.read'],
      expiresAt: 100,
      claims: {
        iss: 'https://attacker.example',
        aud: 'https://attacker-resource.example',
        exp: 0,
        scope: 'mcp.admin',
      },
    });

    const verified = await issued.verifier.verify({
      token,
      resource: 'https://resource.example',
      authorizationServers: ['https://trusted.example'],
      requiredScopes: ['mcp.read'],
    });

    expect(verified).toMatchObject({
      issuer: 'https://trusted.example',
      audience: ['https://resource.example'],
      scopes: ['mcp.read'],
      expiresAt: 100,
      claims: {
        iss: 'https://attacker.example',
        aud: 'https://attacker-resource.example',
        exp: 0,
        scope: 'mcp.admin',
      },
    });
  });
});
EOF
npm exec -- vitest run packages/tiny-http-mcp-server/src/__probe__.test.ts --reporter verbose
rm packages/tiny-http-mcp-server/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/tiny-http-mcp-server/src/__probe__.test.ts > in-memory verifier reserved claim override repro > verifies trusted token fields while exposing conflicting forged standard claims
```

## Observed Behavior

`issueToken()` first creates standard claims from its validated fixture inputs (`iss`, `aud`, `exp`, and `scope`) and then spreads `input.claims` afterward at `packages/tiny-http-mcp-server/src/testing.ts:130`. A caller can therefore replace all four standard claim values in the exposed `claims` object. `verifier.verify()` still validates access through separate top-level token fields at `packages/tiny-http-mcp-server/src/testing.ts:82`, then returns the contradictory claims unchanged through `cloneVerifiedAccessToken()` at `packages/tiny-http-mcp-server/src/testing.ts:60`.

## Expected Behavior

Custom test claims should not be able to overwrite the standard authorization claims derived from the token inputs, or conflicting reserved names should be rejected explicitly. A successfully verified token snapshot should present one internally consistent issuer, audience, expiration, and scope interpretation.

## Impact

Tests using this exported fixture can accidentally generate authentication contexts that claim both restricted and elevated permissions, trusted and attacker-controlled issuers, or valid and expired states simultaneously. Tools inspecting `request.auth.claims` may exercise authorization behavior different from the verifier's decision, allowing misleading tests to pass or making real policy failures difficult to diagnose.
