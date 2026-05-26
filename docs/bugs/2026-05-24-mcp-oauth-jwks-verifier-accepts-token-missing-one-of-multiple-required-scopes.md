# MCP OAuth JWKS verifier accepts a token missing one of multiple required scopes

## Summary

The exported `mcp-oauth` JWKS token verifier treats a configured `requiredScopes` array as an any-of policy rather than requiring every listed scope. A token containing only `mcp.read` is accepted when the protected resource requires both `mcp.read` and `mcp.write`.

## Reproduction

From the repository root, issue a signed token with one scope from the local OAuth test server, then verify it against a policy requiring two scopes:

```sh
probe=$(mktemp -d /tmp/mcp-jwks-required-scopes-probe.XXXXXX)

cat > "$probe/repro.mts" <<'EOF'
import { createOAuthTestServer } from "file:///Users/kjopek/Workspace/poe-code/packages/tiny-oauth-test-server/src/index.ts";
import { createJwksTokenVerifier } from "file:///Users/kjopek/Workspace/poe-code/packages/mcp-oauth/src/server/jwks-token-verifier.ts";

const oauth = createOAuthTestServer({
  signingKeySeed: "required-scopes-probe",
  defaultTokenTtlSeconds: 60
});
const handle = await oauth.listen({ port: 0, hostname: "127.0.0.1" });
try {
  const resource = "https://resource.example.com/mcp";
  const token = await oauth.issueTokenFor({
    clientId: "demo",
    resource,
    scopes: ["mcp.read"]
  });
  const verifier = createJwksTokenVerifier({
    jwksUrl: `${oauth.issuer}/.well-known/jwks.json`
  });
  const verified = await verifier.verify({
    token,
    resource,
    authorizationServers: [oauth.issuer],
    requiredScopes: ["mcp.read", "mcp.write"]
  });
  console.log(JSON.stringify({ accepted: true, scopes: verified.scopes }));
} catch (error) {
  console.log(JSON.stringify({
    accepted: false,
    error: error instanceof Error ? error.message : String(error)
  }));
} finally {
  await handle.close();
}
EOF

./node_modules/.bin/tsx "$probe/repro.mts"

nl -ba packages/mcp-oauth/src/server/jwks-token-verifier.ts | sed -n '361,394p'
```

## Observed Behavior

The verifier accepts the token even though it lacks the required `mcp.write` scope:

```text
{"accepted":true,"scopes":["mcp.read"]}
```

`createJwksTokenVerifier().verify()` in `packages/mcp-oauth/src/server/jwks-token-verifier.ts:378` through `packages/mcp-oauth/src/server/jwks-token-verifier.ts:387` rejects only when no token scope appears in `requiredScopes`, using `accessToken.scopes.some(...)`. As a result, satisfying any one configured requirement is enough to authorize the token.

## Expected Behavior

When a protected resource configures multiple required scopes, a verified token should be authorized only if it contains every required scope. A token lacking any required permission should fail with `insufficient_scope` and advertise the missing requirements.

## Impact

MCP servers relying on `createJwksTokenVerifier()` for combined permissions can unintentionally grant protected operations to tokens with only a weaker subset of privileges. For example, a read-only token may pass authorization for an endpoint configured to require both read and write access.
