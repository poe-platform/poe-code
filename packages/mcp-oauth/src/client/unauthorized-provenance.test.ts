import { expect, it, vi } from "vitest";
import { createDefaultOAuthClientProvider } from "./default-oauth-client-provider.js";
import type { OAuthDiscoveryResult, StoredOAuthSession, StoredOAuthTokens } from "./types.js";

const resource = "https://resource.example/mcp";
const issuer = "https://auth.example";
const discovery: OAuthDiscoveryResult = {
  resource, resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer] },
  authorizationServer: issuer, authorizationServerMetadataUrl: `${issuer}/metadata`, authorizationServerMetadata: {
    issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"]
  }
};
const tokens: StoredOAuthTokens = { accessToken: "current-access", refreshToken: "current-refresh", tokenType: "Bearer", expiresAt: 100_000 };
function fixture(current = tokens) {
  let session: StoredOAuthSession | null = { resource, authorizationServer: issuer, client: { clientId: "client" }, tokens: current,
    discovery: { resourceMetadataUrl: discovery.resourceMetadataUrl, resourceMetadata: discovery.resourceMetadata, authorizationServerMetadata: discovery.authorizationServerMetadata } };
  const fetch = vi.fn(async () => Response.json({ access_token: "rotated-access", refresh_token: "rotated-refresh", token_type: "Bearer", expires_in: 3600 }));
  const save = vi.fn(async (_key: string, value: StoredOAuthSession) => { session = value; });
  const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "client" }, browser: {}, allowInteractive: false, now: () => 1000,
    sessionStore: { load: async () => session, save, clear: async () => { session = null; } } });
  return { fetch, save, provider,
    run: (presented: StoredOAuthTokens | null, header = presented === null ? undefined : `Bearer ${presented.accessToken}`) => provider.handleUnauthorized({
      requestUrl: new URL(resource), response: new Response(null, { status: 401 }), discovery, fetch,
      challenge: { scheme: "Bearer", params: { error: "invalid_token" }, raw: "Bearer error=invalid_token" },
      requestHeaders: new Headers(header === undefined ? {} : { Authorization: header }), presentedTokens: presented
    }) };
}

it("retries a delayed rejected request with the persisted winner without redeeming its rotated refresh token", async () => {
  const f = fixture();
  expect(await f.run({ ...tokens, accessToken: "previous-access", refreshToken: "previous-refresh" })).toEqual({ action: "retry" });
  expect(f.fetch).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
});

it("distinguishes refresh-token rotation even when the access token is unchanged", async () => {
  const f = fixture();
  expect(await f.run({ ...tokens, refreshToken: "previous-refresh" })).toEqual({ action: "retry" });
  expect(f.fetch).not.toHaveBeenCalled();
});

it("retries an initially unauthenticated 401 with credentials persisted by another authorization", async () => {
  const f = fixture();
  expect(await f.run(null)).toEqual({ action: "retry" });
  expect(f.fetch).not.toHaveBeenCalled();
});

it("refreshes exactly the current rejected grant", async () => {
  const f = fixture();
  expect(await f.run({ ...tokens })).toEqual({ action: "retry" });
  expect(f.fetch).toHaveBeenCalledOnce();
  expect(f.save).toHaveBeenCalledOnce();
});

it("rejects a provenance snapshot whose access token does not match the presented header", async () => {
  const f = fixture();
  expect(await f.run({ ...tokens }, "Bearer unrelated-secret")).toMatchObject({ action: "fail", error: { message: expect.stringContaining("provenance") } });
  expect(f.fetch).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
});

it("returns independent provenance from authorization without exposing stored mutable tokens", async () => {
  const f = fixture();
  const returned = await f.provider.authorizeRequest!({ requestUrl: new URL(resource), headers: new Headers(), fetch: f.fetch });
  expect(returned).toEqual(tokens);
  returned!.refreshToken = "mutated-refresh";
  expect(await f.run({ ...tokens })).toEqual({ action: "retry" });
  expect(f.fetch).toHaveBeenCalledOnce();
});

it("rechecks rejected provenance after a newer grant appears between session reads", async () => {
  let reads = 0;
  const old = { ...tokens, accessToken: "previous-access", refreshToken: "previous-refresh" };
  const fetch = vi.fn(async () => Response.json({ access_token: "unneeded-access", token_type: "Bearer" }));
  const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "client" }, browser: {}, allowInteractive: false, now: () => 1000,
    sessionStore: { load: async () => ({ resource, authorizationServer: issuer, client: { clientId: "client" }, tokens: ++reads === 1 ? old : tokens,
      discovery: { resourceMetadataUrl: discovery.resourceMetadataUrl, resourceMetadata: discovery.resourceMetadata, authorizationServerMetadata: discovery.authorizationServerMetadata } }), save: async () => {}, clear: async () => {} } });
  expect(await provider.handleUnauthorized({ requestUrl: new URL(resource), response: new Response(null, { status: 401 }), discovery, fetch,
    challenge: { scheme: "Bearer", params: { error: "invalid_token" }, raw: "Bearer error=invalid_token" },
    requestHeaders: new Headers({ Authorization: "Bearer previous-access" }), presentedTokens: old })).toEqual({ action: "retry" });
  expect(fetch).not.toHaveBeenCalled();
});

it("refreshes a proven current token on 401 even when the server omits the invalid_token parameter", async () => {
  const f = fixture();
  expect(await f.provider.handleUnauthorized({ requestUrl: new URL(resource), response: new Response(null, { status: 401 }), discovery, fetch: f.fetch, challenge: null,
    requestHeaders: new Headers({ Authorization: "Bearer current-access" }), presentedTokens: tokens })).toEqual({ action: "retry" });
  expect(f.fetch).toHaveBeenCalledOnce();
});
