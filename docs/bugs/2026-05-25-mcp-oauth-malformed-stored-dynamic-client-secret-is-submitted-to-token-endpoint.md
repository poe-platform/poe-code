# MCP OAuth malformed stored dynamic client secret is submitted to token endpoint

## Summary

`mcp-oauth`'s auth-store-backed dynamic client store validates persisted `clientId` values but not optional `clientSecret` values. A corrupted or incompatible stored dynamic registration containing `clientSecret: 42` is accepted and then serialized into an outbound authorization-code token exchange as `client_secret=42`.

## Reproduction

Add the following temporary probe as `packages/mcp-oauth/src/__probe__.test.ts`:

```ts
import http from "node:http";
import { describe, expect, it, vi } from "vitest";
import {
  createDefaultOAuthClientProvider,
  type OAuthDiscoveryResult,
  type OAuthSessionStore,
  type StoredOAuthSession,
} from "./index.js";

vi.mock("auth-store", () => ({
  createSecretStore: vi.fn(() => ({
    store: {
      get: vi.fn(async () => JSON.stringify({ clientId: "stored-client", clientSecret: 42 })),
      set: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    },
  })),
}));

const RESOURCE_URL = "https://resource.example.com/mcp";
const AUTHORIZATION_SERVER = "https://auth.example.com";
const TOKEN_ENDPOINT = "https://auth.example.com/token";

function createDiscoveryResult(): OAuthDiscoveryResult {
  return {
    resource: RESOURCE_URL,
    resourceMetadataUrl: "https://resource.example.com/.well-known/oauth-protected-resource/mcp",
    resourceMetadata: { resource: RESOURCE_URL, authorization_servers: [AUTHORIZATION_SERVER] },
    authorizationServer: AUTHORIZATION_SERVER,
    authorizationServerMetadataUrl: `${AUTHORIZATION_SERVER}/.well-known/oauth-authorization-server`,
    authorizationServerMetadata: {
      issuer: AUTHORIZATION_SERVER,
      authorization_endpoint: `${AUTHORIZATION_SERVER}/authorize`,
      token_endpoint: TOKEN_ENDPOINT,
      registration_endpoint: `${AUTHORIZATION_SERVER}/register`,
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
    },
  };
}

function createMemorySessionStore(): OAuthSessionStore {
  const sessions = new Map<string, StoredOAuthSession>();
  return {
    async load(resource: string) { return sessions.get(resource) ?? null; },
    async save(resource: string, session: StoredOAuthSession) { sessions.set(resource, session); },
    async clear(resource: string) { sessions.delete(resource); },
  };
}

async function requestLoopbackCallback(url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = http.get(url, (response) => {
      response.resume();
      response.once("end", resolve);
    });
    request.once("error", reject);
  });
}

describe("stored OAuth dynamic client probe", () => {
  it("submits an invalid persisted numeric clientSecret during code exchange", async () => {
    let tokenBody: URLSearchParams | null = null;
    const provider = createDefaultOAuthClientProvider({
      client: { mode: "dynamic", metadata: { clientName: "poe-code test" } },
      browser: {
        openBrowser: async (authorizationUrl: string) => {
          const url = new URL(authorizationUrl);
          const callback = new URL(url.searchParams.get("redirect_uri") ?? "");
          callback.searchParams.set("code", "returned-code");
          callback.searchParams.set("state", url.searchParams.get("state") ?? "");
          await requestLoopbackCallback(callback.toString());
        },
      },
      sessionStore: createMemorySessionStore(),
      authStore: {},
      now: () => 10_000,
    });

    const result = await provider.handleUnauthorized({
      requestUrl: new URL(RESOURCE_URL),
      response: new Response(null, { status: 401 }),
      challenge: null,
      discovery: createDiscoveryResult(),
      fetch: async (input, init) => {
        expect(String(input)).toBe(TOKEN_ENDPOINT);
        tokenBody = new URLSearchParams(String(init?.body ?? ""));
        return new Response(JSON.stringify({ access_token: "access-token", token_type: "Bearer" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    expect(result.action).toBe("retry");
    expect(tokenBody?.get("client_id")).toBe("stored-client");
    expect(tokenBody?.get("client_secret")).toBe("42");
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/mcp-oauth/src/__probe__.test.ts --reporter verbose
rm packages/mcp-oauth/src/__probe__.test.ts
nl -ba packages/mcp-oauth/src/client/auth-store-session-store.ts | sed -n '61,92p'
nl -ba packages/mcp-oauth/src/client/default-oauth-client-provider.ts | sed -n '313,348p;435,449p'
nl -ba packages/mcp-oauth/src/client/token-endpoint.ts | sed -n '102,125p'
```

The reproduction passes:

```text
✓ packages/mcp-oauth/src/__probe__.test.ts > stored OAuth dynamic client probe > submits an invalid persisted numeric clientSecret during code exchange
```

## Observed Behavior

The public client shapes require `clientSecret?: string` in `packages/mcp-oauth/src/client/types.ts:66` through `packages/mcp-oauth/src/client/types.ts:104`. However, `createAuthStoreClientStore().load()` checks only that the parsed JSON is an object with a string `clientId` and returns it through a type assertion at `packages/mcp-oauth/src/client/auth-store-session-store.ts:61` through `packages/mcp-oauth/src/client/auth-store-session-store.ts:92`. The dynamic-client flow loads and reuses that stored record at `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:313` through `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:348` and `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:435` through `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:449`. During code exchange, `requestTokens()` blindly passes the value to `URLSearchParams.set()` at `packages/mcp-oauth/src/client/token-endpoint.ts:102` through `packages/mcp-oauth/src/client/token-endpoint.ts:125`, stringifying the malformed number into the outbound request as `client_secret=42`.

## Expected Behavior

Persisted dynamic-client registrations should be validated against their public runtime shape before reuse. A stored `clientSecret` that is present but not a string should be rejected or discarded, never serialized into an OAuth token request.

## Impact

Corrupted, partially migrated, or version-incompatible dynamic-client registration data can be transmitted to an authorization server as an invalid client credential. This produces avoidable authentication failures and violates the typed auth-store boundary for sensitive OAuth client-secret material.
