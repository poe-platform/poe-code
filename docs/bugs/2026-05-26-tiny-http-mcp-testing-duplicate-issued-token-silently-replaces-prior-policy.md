# Tiny HTTP MCP testing duplicate issued token silently replaces prior policy

## Summary

The public `tiny-http-mcp-server/testing` `createInMemoryTokenVerifier()` helper permits multiple `issueToken()` calls with the same explicit token string and silently overwrites the earlier authorization record. Code retaining the first returned bearer token can unexpectedly authenticate with permissions from a later issuance that used the same textual token value.

## Reproduction

From the repository root, create and run this disposable Vitest probe, then remove it:

```sh
cat > packages/tiny-http-mcp-server/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from 'vitest';
import { createInMemoryTokenVerifier } from './testing.js';

describe('in-memory verifier duplicate token repro', () => {
  it('silently replaces an earlier issued token policy when the token string is reused', async () => {
    const issued = createInMemoryTokenVerifier({ now: () => 10 });
    const first = issued.issueToken({
      token: 'same-token',
      issuer: 'https://issuer.example',
      audience: ['https://resource.example'],
      scopes: ['mcp.read'],
      expiresAt: 100,
    });
    const second = issued.issueToken({
      token: 'same-token',
      issuer: 'https://issuer.example',
      audience: ['https://resource.example'],
      scopes: ['mcp.admin'],
      expiresAt: 100,
    });

    expect(first).toBe(second);
    await expect(issued.verifier.verify({
      token: first,
      resource: 'https://resource.example',
      authorizationServers: ['https://issuer.example'],
      requiredScopes: ['mcp.admin'],
    })).resolves.toMatchObject({ scopes: ['mcp.admin'] });
  });
});
EOF
npm exec -- vitest run packages/tiny-http-mcp-server/src/__probe__.test.ts --reporter verbose
rm packages/tiny-http-mcp-server/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/tiny-http-mcp-server/src/__probe__.test.ts > in-memory verifier duplicate token repro > silently replaces an earlier issued token policy when the token string is reused
```

## Observed Behavior

`issueToken()` uses the supplied `input.token` directly as the key for its internal `Map` and unconditionally calls `tokens.set(token, ...)` at `packages/tiny-http-mcp-server/src/testing.ts:126`. After a first issuance grants only `mcp.read`, a second issuance of the same bearer text with `mcp.admin` replaces that record. Verifying the bearer value returned by the first issuance then succeeds under the later administrative scope.

## Expected Behavior

The fixture should reject duplicate explicit bearer token identifiers or otherwise make replacement an explicit operation. An issued token handle retained by an earlier test setup should not silently acquire a different authorization policy because another setup reused its text value.

## Impact

Parallel or layered integration tests that use stable named tokens can accidentally overwrite one another's authentication policy. Earlier requests may suddenly authenticate with expanded scopes, changed audiences, or changed identities, producing false-positive authorization tests and cross-test contamination that is difficult to attribute to token issuance order.
