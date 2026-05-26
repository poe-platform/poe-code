# Tiny HTTP MCP testing verified nested claim mutation poisons future auth

## Summary

The public `tiny-http-mcp-server/testing` `createInMemoryTokenVerifier()` helper returns verification results whose nested `claims` objects remain shared with the internally stored token. Mutating a nested custom claim on one successful `verifier.verify()` result silently changes the claims returned by later verifications of the same token.

## Reproduction

From the repository root, create and run this disposable Vitest probe, then remove it:

```sh
cat > packages/tiny-http-mcp-server/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from 'vitest';
import { createInMemoryTokenVerifier } from './testing.js';

describe('in-memory verifier nested claim isolation repro', () => {
  it('lets one verified result mutate nested claims returned by a later verification', async () => {
    const issued = createInMemoryTokenVerifier({ now: () => 10 });
    const token = issued.issueToken({
      token: 'nested-claims-token',
      issuer: 'https://issuer.example',
      audience: ['https://resource.example'],
      scopes: ['mcp.read'],
      expiresAt: 100,
      claims: { profile: { role: 'reader' } },
    });
    const input = {
      token,
      resource: 'https://resource.example',
      authorizationServers: ['https://issuer.example'],
      requiredScopes: ['mcp.read'],
    };

    const first = await issued.verifier.verify(input);
    (first.claims.profile as { role: string }).role = 'admin';
    const second = await issued.verifier.verify(input);

    expect(second.claims.profile).toEqual({ role: 'admin' });
  });
});
EOF
npm exec -- vitest run packages/tiny-http-mcp-server/src/__probe__.test.ts --reporter verbose
rm packages/tiny-http-mcp-server/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/tiny-http-mcp-server/src/__probe__.test.ts > in-memory verifier nested claim isolation repro > lets one verified result mutate nested claims returned by a later verification
```

## Observed Behavior

`issueToken()` stores caller-supplied nested custom claims under the token record at `packages/tiny-http-mcp-server/src/testing.ts:126`. Each successful `verify()` returns `cloneVerifiedAccessToken(token)` at `packages/tiny-http-mcp-server/src/testing.ts:123`, but that clone copies `claims` only one level deep at `packages/tiny-http-mcp-server/src/testing.ts:60`. Therefore the nested `profile` object returned by the first verification is still the stored nested object, and changing its `role` from `reader` to `admin` changes the value returned by the second verification.

## Expected Behavior

Each successful verification result should be isolated from the in-memory issued-token state. Mutating custom nested claim data obtained from one request should not modify subsequent authentication results for the same already-issued token.

## Impact

Tests using the published HTTP MCP testing helper can accidentally or deliberately alter future request authentication context by mutating `request.auth.claims` or a verified token snapshot. A handler that edits nested claims during one request can make later requests appear to carry different tenant, role, policy, or entitlement data without issuing a new token, producing misleading authorization test results and cross-request contamination.
