import { expect, it, vi } from "vitest";
import { createDefaultOAuthClientProvider } from "./default-oauth-client-provider.js";
import type { OAuthDiscoveryResult, StoredOAuthSession, StoredOAuthTokens } from "./types.js";

const resource = "https://resource.example/mcp";
const issuer = "https://auth.example";
const discovery: OAuthDiscoveryResult = {
  resource, resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer] },
  authorizationServer: issuer, authorizationServerMetadataUrl: `${issuer}/metadata`, authorizationServerMetadata: {
    issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
    response_types_supported: ["code"], code_challenge_methods_supported: ["S256"]
  }
};
const tokens: StoredOAuthTokens = { accessToken: "imported-access", refreshToken: "imported-refresh", tokenType: "Bearer", expiresAt: 100_000 };

function fixture(grant = tokens, saved: StoredOAuthSession | null = null) {
  let session = saved;
  const fetch = vi.fn(async (_url: string | URL, _init?: RequestInit) => Response.json({ access_token: "rotated-access", refresh_token: "rotated-refresh", token_type: "Bearer", expires_in: 3600 }));
  const store = { load: vi.fn(async () => session), save: vi.fn(async (_key: string, value: StoredOAuthSession) => { session = value; }), clear: vi.fn(async () => { session = null; }) };
  const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "imported-client", clientSecret: "app-secret" },
    browser: {}, allowInteractive: false, sessionStore: store, now: () => 10_000,
    initialGrant: { resource, tokens: grant }
  });
  return { provider, fetch, store, session: () => session,
    authorize: async (url = resource) => { const headers = new Headers(); await provider.authorizeRequest!({ requestUrl: new URL(url), headers, fetch }); return headers; },
    unauthorized: (metadata = discovery) => provider.handleUnauthorized({ requestUrl: new URL(resource), response: new Response(null, { status: 401 }),
      challenge: { scheme: "Bearer", params: { error: "invalid_token" }, raw: "Bearer error=invalid_token" }, discovery: metadata, fetch }) };
}

it("uses a fresh imported grant only for its resource without fetching or persisting invented discovery", async () => {
  const f = fixture();
  expect((await f.authorize()).get("Authorization")).toBe("Bearer imported-access");
  expect((await f.authorize("https://other.example/mcp")).get("Authorization")).toBeNull();
  expect(f.fetch).not.toHaveBeenCalled();
  expect(f.store.save).not.toHaveBeenCalled();
});

it("binds an expired imported grant to validated discovery and refreshes with its original client", async () => {
  const f = fixture({ ...tokens, expiresAt: 0 });
  expect((await f.authorize()).get("Authorization")).toBeNull();
  expect(await f.unauthorized()).toEqual({ action: "retry" });
  expect(f.fetch).toHaveBeenCalledOnce();
  const request = new URLSearchParams(String(f.fetch.mock.calls[0]?.[1]?.body));
  expect(request.get("client_id")).toBe("imported-client");
  expect(request.get("refresh_token")).toBe("imported-refresh");
  expect(f.session()?.tokens?.expiresAt).toBe(3_610_000);
  expect((await f.authorize()).get("Authorization")).toBe("Bearer rotated-access");
});

it("refreshes a fresh imported access token that the resource explicitly rejected", async () => {
  const f = fixture();
  expect(await f.unauthorized()).toEqual({ action: "retry" });
  expect(f.fetch).toHaveBeenCalledOnce();
  expect(f.session()?.tokens?.accessToken).toBe("rotated-access");
});

it("prefers persisted rotated credentials over the initial grant", async () => {
  const f = fixture(tokens, { resource, authorizationServer: issuer, client: { clientId: "imported-client" }, tokens: { ...tokens, accessToken: "persisted-access" },
    discovery: { resourceMetadataUrl: discovery.resourceMetadataUrl, resourceMetadata: discovery.resourceMetadata, authorizationServerMetadata: discovery.authorizationServerMetadata } });
  expect((await f.authorize()).get("Authorization")).toBe("Bearer persisted-access");
  expect(f.fetch).not.toHaveBeenCalled();
});

it("does not persist imported credentials for mismatched discovery", async () => {
  const f = fixture({ ...tokens, expiresAt: 0 });
  expect(await f.unauthorized({ ...discovery, authorizationServer: "https://other.example" })).toMatchObject({ action: "fail" });
  expect(f.fetch).not.toHaveBeenCalled();
  expect(f.store.save).not.toHaveBeenCalled();
});

it("does not resurrect an initial grant after a persisted grant has been revoked", async () => {
  const f = fixture(tokens, { resource, authorizationServer: issuer, client: { clientId: "imported-client" },
    discovery: { resourceMetadataUrl: discovery.resourceMetadataUrl, resourceMetadata: discovery.resourceMetadata, authorizationServerMetadata: discovery.authorizationServerMetadata } });
  expect((await f.authorize()).get("Authorization")).toBeNull();
  expect(await f.unauthorized()).toMatchObject({ action: "fail" });
  expect(f.fetch).not.toHaveBeenCalled();
  expect(f.store.save).not.toHaveBeenCalled();
});

it("does not revive the initial grant when persisted discovery fails resource binding", async () => {
  const f = fixture(tokens, { resource: "https://other.example/mcp", authorizationServer: issuer, client: { clientId: "imported-client" }, tokens,
    discovery: { resourceMetadataUrl: discovery.resourceMetadataUrl, resourceMetadata: discovery.resourceMetadata, authorizationServerMetadata: discovery.authorizationServerMetadata } });
  expect((await f.authorize()).get("Authorization")).toBeNull();
  expect(await f.unauthorized()).toMatchObject({ action: "fail" });
  expect(f.fetch).not.toHaveBeenCalled();
});

it("owns the initial grant snapshot rather than observing caller mutations", async () => {
  const supplied = { ...tokens };
  const f = fixture(supplied);
  supplied.accessToken = "mutated-secret";
  expect((await f.authorize()).get("Authorization")).toBe("Bearer imported-access");
});

it.each([NaN, Infinity, 1.5, 8_640_000_000_000_001])("rejects invalid imported expiry without logging credential values: %s", expiresAt => {
  expect(() => fixture({ ...tokens, expiresAt })).toThrow("initial grant");
});

it("requires the original client ID instead of dynamically registering an imported grant under a different app", () => {
  expect(() => createDefaultOAuthClientProvider({ client: { mode: "dynamic" }, browser: {}, initialGrant: { resource, tokens } })).toThrow("original client ID");
});

it.each(["https://user:secret@resource.example/mcp", "https://resource.example/mcp#fragment", "file:///tmp/mcp"])("rejects an invalid initial grant resource", resource => {
  expect(() => createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "app" }, browser: {}, initialGrant: { resource, tokens } })).toThrow("initial grant resource");
});
