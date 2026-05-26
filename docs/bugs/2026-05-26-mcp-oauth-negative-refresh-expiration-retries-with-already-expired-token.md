# MCP OAuth negative refresh expiration retries with already-expired token

## Summary

The exported `mcp-oauth` default client provider accepts a successful refresh response containing negative `expires_in`, saves the replacement access token with an expiration timestamp already in the past, and still reports `{ action: "retry" }` for the rejected protected-resource request. A token endpoint can therefore make the client immediately retry with a credential it has already computed to be expired.

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
const now = 10_000;

function createStore(initial: StoredOAuthSession): OAuthSessionStore & { saved: StoredOAuthSession[] } {
  let session: StoredOAuthSession | null = initial;
  const saved: StoredOAuthSession[] = [];
  return {
    saved,
    async load() {
      return session;
    },
    async save(_resource, next) {
      session = next;
      saved.push(next);
    },
    async clear() {
      session = null;
    }
  };
}

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

describe("mcp-oauth negative refresh expiration", () => {
  it("retries with a newly refreshed access token already expired on receipt", async () => {
    const store = createStore({
      resource,
      authorizationServer: discovery.authorizationServer,
      client: { clientId: "client" },
      tokens: {
        accessToken: "rejected",
        refreshToken: "refresh",
        tokenType: "Bearer",
        expiresAt: now + 60_000
      },
      discovery: {
        resourceMetadataUrl: discovery.resourceMetadataUrl,
        resourceMetadata: discovery.resourceMetadata,
        authorizationServerMetadata: discovery.authorizationServerMetadata
      }
    });
    const provider = createDefaultOAuthClientProvider({
      client: { mode: "static", clientId: "client" },
      browser: { openBrowser: vi.fn(async () => undefined) },
      sessionStore: store,
      now: () => now
    });
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      access_token: "expired-replacement",
      refresh_token: "refresh-next",
      token_type: "Bearer",
      expires_in: -1
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await provider.handleUnauthorized({
      requestUrl: new URL(resource),
      response: new Response(null, { status: 401 }),
      challenge: { scheme: "Bearer", raw: "", params: { error: "invalid_token" } },
      discovery,
      fetch
    });

    expect(result).toEqual({ action: "retry" });
    expect(store.saved.at(-1)?.tokens).toMatchObject({
      accessToken: "expired-replacement",
      expiresAt: now - 1_000
    });
  });
});
```

Run:

```sh
npm exec -- vitest run packages/mcp-oauth/src/__probe__.test.ts --reporter verbose
rm -f packages/mcp-oauth/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/mcp-oauth/src/__probe__.test.ts > mcp-oauth negative refresh expiration > retries with a newly refreshed access token already expired on receipt
```

## Observed Behavior

With `now()` fixed at `10_000`, a successful refresh response containing `expires_in: -1` is normalized into `expiresAt: 9_000` and saved as the current token set. Nevertheless, `handleUnauthorized()` returns `{ action: "retry" }`. In `packages/mcp-oauth/src/client/token-endpoint.ts`, `requestTokens()` accepts every finite numeric `expires_in` value and computes `now + expires_in * 1000` without requiring a non-negative duration. In `packages/mcp-oauth/src/client/default-oauth-client-provider.ts`, `refreshSession()` persists that expired token; although `ensureAuthorizedSession()` observes that it is expired, the interactive retry path returns the session and `handleUnauthorized()` checks only whether an access-token string exists before requesting a retry.

## Expected Behavior

A successful token response must not install a newly issued access token whose declared lifetime is already negative. The provider should reject negative refresh lifetimes as invalid token-endpoint data, or at minimum fail the unauthorized-handling attempt rather than retrying with an access token it already considers expired.

## Impact

A malformed or misconfigured OAuth token endpoint can cause MCP requests to enter repeated authentication retries using immediately unusable credentials while persisting those credentials as current session state. Consumers receive a misleading retry decision instead of a token-response error, making authentication failures harder to diagnose and potentially causing avoidable retry loops.
