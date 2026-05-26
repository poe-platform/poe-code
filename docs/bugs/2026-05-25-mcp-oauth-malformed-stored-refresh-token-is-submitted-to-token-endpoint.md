# MCP OAuth malformed stored refresh token is submitted to token endpoint

## Summary

The exported `mcp-oauth` default client provider trusts persisted session token structure after parsing only the outer JSON object. If storage contains a non-string `tokens.refreshToken`, an expired-session refresh silently string-coerces that value and transmits it to the OAuth token endpoint as a refresh credential.

## Reproduction

From the repository root, add this disposable Vitest probe at `packages/mcp-oauth/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  createDefaultOAuthClientProvider,
  type OAuthDiscoveryResult,
  type OAuthSessionStore,
  type StoredOAuthSession,
} from "./index.js";

const resource = "https://resource.example.com/mcp";
const endpoint = "https://auth.example.com/token";
const discovery: OAuthDiscoveryResult = {
  resource,
  resourceMetadataUrl: "https://resource.example.com/.well-known/oauth-protected-resource/mcp",
  resourceMetadata: { resource, authorization_servers: ["https://auth.example.com"] },
  authorizationServer: "https://auth.example.com",
  authorizationServerMetadataUrl: "https://auth.example.com/.well-known/oauth-authorization-server",
  authorizationServerMetadata: {
    issuer: "https://auth.example.com",
    authorization_endpoint: "https://auth.example.com/authorize",
    token_endpoint: endpoint,
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
  },
};

describe("malformed stored refresh token", () => {
  it("submits a non-string refresh token loaded from persistence", async () => {
    const session = {
      resource,
      authorizationServer: discovery.authorizationServer,
      client: { clientId: "client" },
      tokens: { accessToken: "expired", refreshToken: { secret: true }, tokenType: "Bearer", expiresAt: 0 },
      discovery: { resourceMetadataUrl: discovery.resourceMetadataUrl, resourceMetadata: discovery.resourceMetadata, authorizationServerMetadata: discovery.authorizationServerMetadata },
    } as unknown as StoredOAuthSession;
    const store: OAuthSessionStore = {
      async load() { return session; },
      async save() {},
      async clear() {},
    };
    let body = "";
    const fetch = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      body = String(init?.body ?? "");
      return new Response(JSON.stringify({ access_token: "new", token_type: "Bearer", expires_in: 60 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const provider = createDefaultOAuthClientProvider({
      client: { mode: "static", clientId: "client" },
      browser: { openBrowser: async () => {} },
      sessionStore: store,
      now: () => 1000,
    });

    const result = await provider.handleUnauthorized({
      requestUrl: new URL(resource),
      response: new Response(null, { status: 401 }),
      challenge: { scheme: "Bearer", raw: "", params: { error: "invalid_token" } },
      discovery,
      fetch: fetch as typeof globalThis.fetch,
    });
    console.log(JSON.stringify({ body, result }));

    expect(body).toContain("refresh_token=%5Bobject+Object%5D");
    expect(result).toEqual({ action: "retry" });
  });
});
```

Run:

```sh
npm exec -- vitest run packages/mcp-oauth/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"body":"client_id=client&grant_type=refresh_token&refresh_token=%5Bobject+Object%5D&resource=https%3A%2F%2Fresource.example.com%2Fmcp","result":{"action":"retry"}}
✓ packages/mcp-oauth/src/__probe__.test.ts > malformed stored refresh token > submits a non-string refresh token loaded from persistence
```

## Observed Behavior

`createAuthStoreSessionStore().load()` checks only that parsed persisted JSON is a non-array object before casting it to `StoredOAuthSession` at `packages/mcp-oauth/src/client/auth-store-session-store.ts:36`. The default provider treats any non-`undefined` stored `tokens.refreshToken` as refreshable at `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:105` and forwards it to `refreshAccessToken()` at `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:149`. Although that function declares `refreshToken: string`, the runtime value reaches `URLSearchParams` at `packages/mcp-oauth/src/client/token-endpoint.ts:77` unchanged, so `{ secret: true }` is transmitted as `refresh_token=[object Object]`. A successful token response then causes `handleUnauthorized()` to report `{ action: "retry" }`.

## Expected Behavior

Stored OAuth sessions should validate credential field types before use. A persisted refresh token that is not a non-empty string should be rejected or cleared rather than being coerced and sent to the authorization server as a credential.

## Impact

Corrupted or attacker-influenced persisted OAuth state can cause malformed credential material to be sent over the network during automatic recovery, while callers receive a successful retry decision. This can disclose serialized internal values, generate misleading authorization traffic, and hide credential-store corruption behind apparently successful refresh behavior.
