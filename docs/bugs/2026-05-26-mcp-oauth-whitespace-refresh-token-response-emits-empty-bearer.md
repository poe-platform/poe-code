# MCP OAuth whitespace refresh token response emits empty bearer

## Summary

The exported `@poe-code/mcp-oauth` default client provider accepts a successful token refresh response whose `access_token` consists only of spaces. It persists that unusable token, reports that the rejected protected-resource request should be retried, and a subsequent request emits an `Authorization` header normalized by the platform to the credential-less value `Bearer`.

## Reproduction

Create a disposable Vitest probe at `packages/mcp-oauth/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  createDefaultOAuthClientProvider,
  type OAuthDiscoveryResult,
  type OAuthSessionStore,
  type StoredOAuthSession
} from "./index.js";

const resource = "https://mcp.example.com/";
const discovery: OAuthDiscoveryResult = {
  resource,
  resourceMetadataUrl: "https://mcp.example.com/.well-known/oauth-protected-resource",
  resourceMetadata: { resource, authorization_servers: ["https://auth.example.com"] },
  authorizationServer: "https://auth.example.com",
  authorizationServerMetadataUrl: "https://auth.example.com/.well-known/oauth-authorization-server",
  authorizationServerMetadata: {
    issuer: "https://auth.example.com",
    authorization_endpoint: "https://auth.example.com/authorize",
    token_endpoint: "https://auth.example.com/token",
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"]
  }
};

function createStore(initial: StoredOAuthSession): OAuthSessionStore & { saved: StoredOAuthSession[] } {
  let session: StoredOAuthSession | null = initial;
  const saved: StoredOAuthSession[] = [];
  return {
    saved,
    async load() { return session; },
    async save(_resource, next) { session = next; saved.push(next); },
    async clear() { session = null; }
  };
}

describe("mcp-oauth whitespace refreshed access token", () => {
  it("reports retry and later sends an empty bearer credential", async () => {
    const store = createStore({
      resource,
      authorizationServer: discovery.authorizationServer,
      client: { clientId: "client" },
      tokens: { accessToken: "rejected", refreshToken: "refresh", tokenType: "Bearer", expiresAt: null },
      discovery: {
        resourceMetadataUrl: discovery.resourceMetadataUrl,
        resourceMetadata: discovery.resourceMetadata,
        authorizationServerMetadata: discovery.authorizationServerMetadata
      }
    });
    const provider = createDefaultOAuthClientProvider({
      client: { mode: "static", clientId: "client" },
      browser: { openBrowser: vi.fn(async () => undefined) },
      sessionStore: store
    });
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      access_token: "   ",
      refresh_token: "refresh-next",
      token_type: "Bearer"
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(provider.handleUnauthorized({
      requestUrl: new URL(resource),
      response: new Response(null, { status: 401 }),
      challenge: { scheme: "Bearer", raw: "", params: { error: "invalid_token" } },
      discovery,
      fetch
    })).resolves.toEqual({ action: "retry" });

    const headers = new Headers();
    await provider.authorizeRequest?.({ requestUrl: new URL(resource), headers, fetch });
    expect(store.saved.at(-1)?.tokens?.accessToken).toBe("   ");
    expect(headers.get("Authorization")).toBe("Bearer");
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/mcp-oauth/src/__probe__.test.ts --reporter verbose
rm -f packages/mcp-oauth/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/mcp-oauth/src/__probe__.test.ts > mcp-oauth whitespace refreshed access token > reports retry and later sends an empty bearer credential
```

## Observed Behavior

After an `invalid_token` challenge, a refresh response containing `access_token: "   "` is accepted and saved as the session's current access token. `handleUnauthorized()` returns `{ action: "retry" }`; when `authorizeRequest()` later writes `Authorization: Bearer    ` through `Headers.set()`, the stored HTTP header value is normalized to `Bearer`, which contains no credential.

In `packages/mcp-oauth/src/client/token-endpoint.ts:128` through `packages/mcp-oauth/src/client/token-endpoint.ts:151`, `requestTokens()` requires only that `access_token` be a non-empty raw string, without rejecting blank-after-trimming values. `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:198` through `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:204` save the refreshed token, while `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:84` through `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:89` request a retry merely because an access-token field exists. The normal request path then formats it into the authorization header at `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:51` through `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:63`.

## Expected Behavior

A token endpoint response should be successful only when it supplies a usable nonblank bearer credential. Whitespace-only access-token values should be rejected before storage and before the provider signals that a protected-resource request can be retried.

## Impact

A malformed or misconfigured OAuth token endpoint can make authentication refresh appear successful while installing and transmitting an empty bearer credential. MCP clients may retry failed requests with no usable authorization, persist broken session state, and produce confusing authentication loops instead of surfacing the invalid token response at its source.
