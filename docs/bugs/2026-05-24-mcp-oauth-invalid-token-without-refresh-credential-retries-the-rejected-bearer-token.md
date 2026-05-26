# MCP OAuth invalid_token without a refresh credential retries the rejected bearer token

## Summary

The exported `mcp-oauth` client provider reports that a protected-resource request should be retried after receiving an `invalid_token` challenge, even when the cached access token has no refresh token and no new authorization occurs. The retried request is then sent with the exact bearer token that the server already rejected.

## Reproduction

From the repository root, seed a non-expiring cached access token without a refresh token, simulate an `invalid_token` response, and inspect both the recovery result and the next authorization header:

```sh
probe=$(mktemp -d /tmp/mcp-oauth-invalid-token-no-refresh-probe.XXXXXX)

cat > "$probe/repro.mjs" <<'EOF'
import { createDefaultOAuthClientProvider } from "/Users/kjopek/Workspace/poe-code/packages/mcp-oauth/dist/index.js";

const resource = "https://resource.example.test/mcp";
const stored = {
  resource,
  authorizationServer: "https://auth.example.test",
  client: { clientId: "client-id" },
  tokens: { accessToken: "revoked-access", tokenType: "Bearer", expiresAt: null },
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
let browserCalls = 0;
let fetchCalls = 0;
const provider = createDefaultOAuthClientProvider({
  client: { mode: "static", clientId: "client-id" },
  browser: { async openBrowser() { browserCalls += 1; } },
  sessionStore: {
    async load() { return stored; },
    async save() { throw new Error("save not expected"); },
    async clear() { throw new Error("clear not expected"); }
  }
});

const result = await provider.handleUnauthorized({
  requestUrl: new URL(resource),
  response: new Response(null, { status: 401 }),
  challenge: { scheme: "Bearer", raw: "", params: { error: "invalid_token" } },
  discovery: {
    resource,
    resourceMetadataUrl: `${resource}/.well-known/oauth-protected-resource`,
    resourceMetadata: { resource, authorization_servers: ["https://auth.example.test"] },
    authorizationServer: "https://auth.example.test",
    authorizationServerMetadataUrl: "https://auth.example.test/.well-known/oauth-authorization-server",
    authorizationServerMetadata: stored.discovery.authorizationServerMetadata
  },
  fetch: async () => { fetchCalls += 1; throw new Error("fetch not expected"); }
});

const headers = new Headers();
await provider.authorizeRequest({
  requestUrl: new URL(resource),
  headers,
  fetch: async () => { throw new Error("fetch not expected"); }
});
console.log(`result=${JSON.stringify(result)}`);
console.log(`browserCalls=${browserCalls}`);
console.log(`fetchCalls=${fetchCalls}`);
console.log(`retryAuthorization=${headers.get("Authorization")}`);
EOF

node "$probe/repro.mjs"

nl -ba packages/mcp-oauth/src/client/default-oauth-client-provider.ts | sed -n '65,133p'
```

## Observed Behavior

The provider signals a retry without performing refresh or interactive authorization, and the next request carries the rejected token again:

```text
result={"action":"retry"}
browserCalls=0
fetchCalls=0
retryAuthorization=Bearer revoked-access
```

`packages/mcp-oauth/src/client/default-oauth-client-provider.ts:71` through `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:83` marks cached `invalid_token` handling as a forced refresh. When the session contains no refresh credential, `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:129` through `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:130` return the unchanged token-bearing session rather than authorizing again. The caller consequently receives `{ action: "retry" }` at `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:85` through `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:89`.

## Expected Behavior

After an access token is explicitly rejected with `invalid_token`, the provider should never instruct the resource client to retry using that same bearer credential. If no refresh token is available, it should clear or ignore the rejected token and start a fresh authorization flow when interactive recovery is permitted, or fail without retrying.

## Impact

MCP requests encountering revoked, invalidated, or otherwise rejected tokens receive pointless retry attempts carrying the same failed credential. This can produce repeated unauthorized traffic, delay required reauthentication, and leak rejected bearer values into repeated server or proxy logs.
