# MCP OAuth empty stored dynamic client ID bypasses registration and is transmitted

## Summary

`mcp-oauth`'s auth-store-backed dynamic client store accepts a persisted registration with `clientId: ""` even though newly registered client IDs are explicitly required to be non-empty. The default provider reuses the unusable stored registration instead of performing dynamic registration, opens authorization with an empty `client_id`, and submits `client_id=` in the token exchange.

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
      get: vi.fn(async () => JSON.stringify({ clientId: "" })),
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

describe("empty stored dynamic client probe", () => {
  it("reuses and submits an empty persisted clientId instead of registering", async () => {
    let browserClientId: string | null = null;
    let tokenClientId: string | null = null;
    let registrationCalls = 0;
    const provider = createDefaultOAuthClientProvider({
      client: { mode: "dynamic", metadata: { clientName: "poe-code test" } },
      browser: {
        openBrowser: async (authorizationUrl: string) => {
          const url = new URL(authorizationUrl);
          browserClientId = url.searchParams.get("client_id");
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
        if (String(input) === `${AUTHORIZATION_SERVER}/register`) {
          registrationCalls += 1;
        }
        expect(String(input)).toBe(TOKEN_ENDPOINT);
        tokenClientId = new URLSearchParams(String(init?.body ?? "")).get("client_id");
        return new Response(JSON.stringify({ access_token: "access-token", token_type: "Bearer" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    expect(result.action).toBe("retry");
    expect(registrationCalls).toBe(0);
    expect(browserClientId).toBe("");
    expect(tokenClientId).toBe("");
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/mcp-oauth/src/__probe__.test.ts --reporter verbose
rm packages/mcp-oauth/src/__probe__.test.ts
nl -ba packages/mcp-oauth/src/client/auth-store-session-store.ts | sed -n '61,92p'
nl -ba packages/mcp-oauth/src/client/default-oauth-client-provider.ts | sed -n '342,410p'
nl -ba packages/mcp-oauth/src/client/token-endpoint.ts | sed -n '102,125p'
```

The reproduction passes:

```text
✓ packages/mcp-oauth/src/__probe__.test.ts > empty stored dynamic client probe > reuses and submits an empty persisted clientId instead of registering
```

## Observed Behavior

`createAuthStoreClientStore().load()` accepts any string `clientId`, including the empty string, at `packages/mcp-oauth/src/client/auth-store-session-store.ts:61` through `packages/mcp-oauth/src/client/auth-store-session-store.ts:92`. When `resolveClient()` finds such a stored client, it immediately returns it as a dynamic registration at `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:342` through `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:348`, bypassing the dynamic registration request. This differs from freshly registered clients, where the same function rejects an empty `client_id` response at `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:392` through `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:397`. The empty stored value then reaches both the authorization URL and token request body, with the latter serialized by `requestTokens()` at `packages/mcp-oauth/src/client/token-endpoint.ts:102` through `packages/mcp-oauth/src/client/token-endpoint.ts:125` as `client_id=`.

## Expected Behavior

Stored dynamic registrations should apply the same non-empty `clientId` requirement as registrations received from the authorization server. An empty stored `clientId` should be rejected or discarded so the provider can register a usable client rather than sending invalid OAuth requests.

## Impact

A corrupted or partially written dynamic-client credential record can permanently suppress automatic registration and make interactive authorization fail with empty client identifiers. Users receive avoidable OAuth failures until persisted state is manually repaired or removed.
