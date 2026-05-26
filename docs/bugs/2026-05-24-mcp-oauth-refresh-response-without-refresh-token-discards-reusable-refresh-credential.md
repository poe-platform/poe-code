# MCP OAuth refresh response without a refresh token discards the reusable refresh credential

## Summary

The exported `mcp-oauth` client provider replaces the full stored token set after a successful refresh. When an authorization server returns a new access token without rotating the existing refresh token, the provider saves `refreshToken: undefined`, permanently losing the reusable credential and preventing future background refreshes.

## Reproduction

From the repository root, seed an expired MCP OAuth session with a refresh token, return a successful refresh response that omits `refresh_token`, and then advance time past the refreshed access-token expiry:

```sh
probe=$(mktemp -d /tmp/mcp-oauth-refresh-omission-probe.XXXXXX)

cat > "$probe/repro.mts" <<'EOF'
import { createDefaultOAuthClientProvider } from "file:///Users/kjopek/Workspace/poe-code/packages/mcp-oauth/dist/index.js";

const resource = "https://resource.example.test/mcp";
const issuer = "https://auth.example.test";
let now = 10_000;
let tokenCalls = 0;
let stored = {
  resource,
  authorizationServer: issuer,
  client: { clientId: "client-id" },
  tokens: {
    accessToken: "expired-access",
    refreshToken: "persistent-refresh",
    tokenType: "Bearer",
    expiresAt: 1
  },
  discovery: {
    resourceMetadataUrl: `${resource}/.well-known/oauth-protected-resource`,
    resourceMetadata: { resource, authorization_servers: [issuer] },
    authorizationServerMetadata: {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"]
    }
  }
};

const provider = createDefaultOAuthClientProvider({
  client: { mode: "static", clientId: "client-id" },
  browser: { async openBrowser() { throw new Error("interactive authorization not expected"); } },
  now: () => now,
  sessionStore: {
    async load() { return stored; },
    async save(_resource, session) { stored = session; },
    async clear() { throw new Error("clear not expected"); }
  }
});

const fetch = async (_input, init) => {
  tokenCalls += 1;
  console.log(`refresh_request_${tokenCalls}=${String(init?.body)}`);
  return new Response(JSON.stringify({
    access_token: `refreshed-access-${tokenCalls}`,
    token_type: "Bearer",
    expires_in: 1
  }), { status: 200, headers: { "content-type": "application/json" } });
};

const firstHeaders = new Headers();
await provider.authorizeRequest({ requestUrl: new URL(resource), headers: firstHeaders, fetch });
console.log(`first_authorization=${firstHeaders.get("Authorization")}`);
console.log(`saved_refresh_token=${stored.tokens?.refreshToken ?? "missing"}`);

now = 12_000;
const secondHeaders = new Headers();
await provider.authorizeRequest({ requestUrl: new URL(resource), headers: secondHeaders, fetch });
console.log(`second_authorization=${secondHeaders.get("Authorization")}`);
console.log(`token_calls=${tokenCalls}`);
EOF

node "$probe/repro.mts"

nl -ba packages/mcp-oauth/src/client/token-endpoint.ts | sed -n '102,153p'
nl -ba packages/mcp-oauth/src/client/default-oauth-client-provider.ts | sed -n '136,204p'
```

## Observed Behavior

The initial refresh succeeds using the stored refresh token, but the saved token set immediately loses that credential. After the replacement access token has expired, no second refresh request occurs:

```text
refresh_request_1=client_id=client-id&grant_type=refresh_token&refresh_token=persistent-refresh&resource=https%3A%2F%2Fresource.example.test%2Fmcp
first_authorization=Bearer refreshed-access-1
saved_refresh_token=missing
second_authorization=Bearer refreshed-access-1
token_calls=1
```

`packages/mcp-oauth/src/client/token-endpoint.ts:137` through `packages/mcp-oauth/src/client/token-endpoint.ts:152` produce `refreshToken: undefined` whenever a successful token response omits `refresh_token`. `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:198` through `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:203` then overwrite the stored token object with that response instead of preserving the previous reusable refresh credential.

## Expected Behavior

A successful refresh response that does not include a replacement refresh token should preserve the existing refresh token. Subsequent access-token expiration should still be recoverable through non-interactive refresh rather than losing the established session credential.

## Impact

Authorization servers that rotate access tokens but not refresh tokens cause `mcp-oauth` sessions to lose unattended renewal after the first refresh. Long-running MCP clients subsequently send stale credentials or require a new interactive authorization flow even though the original refresh credential remains valid server-side.
