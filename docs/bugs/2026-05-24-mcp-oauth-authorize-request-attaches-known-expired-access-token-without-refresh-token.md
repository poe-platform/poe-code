# MCP OAuth authorizeRequest attaches a known expired access token without a refresh token

## Summary

The exported `mcp-oauth` client provider attaches a cached bearer token even when its stored expiry is already in the past and no refresh token exists. A pre-request authorization hook therefore knowingly sends an unusable access credential instead of withholding it and allowing authorization to be established from the server challenge.

## Reproduction

From the repository root, seed a stored MCP OAuth session with an already expired access token and no refresh token, then ask the provider to authorize a protected-resource request:

```sh
probe=$(mktemp -d /tmp/mcp-oauth-expired-access-probe.XXXXXX)

cat > "$probe/repro.mts" <<'EOF'
import { createDefaultOAuthClientProvider } from "file:///Users/kjopek/Workspace/poe-code/packages/mcp-oauth/dist/index.js";

const resource = "https://resource.example.test/mcp";
let fetchCalls = 0;
const provider = createDefaultOAuthClientProvider({
  client: { mode: "static", clientId: "client-id" },
  browser: { async openBrowser() { throw new Error("not expected"); } },
  now: () => 10_000,
  sessionStore: {
    async load() {
      return {
        resource,
        authorizationServer: "https://auth.example.test",
        client: { clientId: "client-id" },
        tokens: { accessToken: "already-expired", tokenType: "Bearer", expiresAt: 1 },
        discovery: {
          resourceMetadataUrl: "https://resource.example.test/.well-known/oauth-protected-resource",
          resourceMetadata: { resource, authorization_servers: ["https://auth.example.test"] },
          authorizationServerMetadata: {
            issuer: "https://auth.example.test",
            authorization_endpoint: "https://auth.example.test/authorize",
            token_endpoint: "https://auth.example.test/token",
            response_types_supported: ["code"],
            code_challenge_methods_supported: ["S256"]
          }
        }
      };
    },
    async save() { throw new Error("save not expected"); },
    async clear() { throw new Error("clear not expected"); }
  }
});

const headers = new Headers();
await provider.authorizeRequest({
  requestUrl: new URL(resource),
  headers,
  fetch: async () => { fetchCalls += 1; throw new Error("fetch not expected"); }
});
console.log(`authorization=${headers.get("Authorization")}`);
console.log(`fetchCalls=${fetchCalls}`);
EOF

node "$probe/repro.mts"

nl -ba packages/mcp-oauth/src/client/default-oauth-client-provider.ts | sed -n '50,133p'
```

## Observed Behavior

`authorizeRequest()` adds the bearer token even though `expiresAt` is already earlier than `now()`:

```text
authorization=Bearer already-expired
fetchCalls=0
```

`packages/mcp-oauth/src/client/default-oauth-client-provider.ts:110` through `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:126` recognize that the stored token is expired but return the same session when interactive authorization is unavailable and no refresh occurs. `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:51` through `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:62` then attach its expired `accessToken` without checking expiry again.

## Expected Behavior

When the provider knows an access token is expired and cannot refresh it before a request, `authorizeRequest()` should omit the `Authorization` header. The unauthenticated request can then receive an OAuth challenge and trigger the appropriate authorization behavior without disclosing or relying on a known-invalid token.

## Impact

MCP clients send stale bearer credentials after expiration, causing avoidable failed authenticated requests and potentially exposing expired tokens to resource endpoints or intermediary logs. This also compounds refresh-token loss by making the resulting broken session appear authenticated until the server rejects it.
