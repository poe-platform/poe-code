import { expect, it, vi } from "vitest";
import { createDefaultOAuthClientProvider } from "./default-oauth-client-provider.js";
import type { OAuthDiscoveryResult, StoredOAuthSession, StoredOAuthTokens } from "./types.js";

const resource = "https://resource.example/mcp", issuer = "https://auth.example";
const discovery: OAuthDiscoveryResult = {
  resource, resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer] },
  authorizationServer: issuer, authorizationServerMetadataUrl: `${issuer}/metadata`, authorizationServerMetadata: {
    issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
    response_types_supported: ["code"], code_challenge_methods_supported: ["S256"]
  }
};
const tokens: StoredOAuthTokens = { accessToken: "private-access", refreshToken: "private-refresh", tokenType: "Bearer", expiresAt: 0 };

function fixture(current: number, saved: boolean, expiry: number | null = 0) {
  const grant = { ...tokens, expiresAt: expiry };
  const session: StoredOAuthSession = { resource, authorizationServer: issuer, client: { clientId: "original" }, tokens: grant,
    discovery: { resourceMetadataUrl: discovery.resourceMetadataUrl, resourceMetadata: discovery.resourceMetadata,
      authorizationServerMetadata: discovery.authorizationServerMetadata } };
  const now = vi.fn(() => current), fetch = vi.fn(async () => { throw new Error("unexpected network"); });
  const store = { load: vi.fn(async () => saved ? session : null), save: vi.fn(async () => {}), clear: vi.fn(async () => {}) };
  const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "original" }, browser: {}, now,
    allowInteractive: false, sessionStore: store, ...(saved ? {} : { initialGrant: { resource, tokens: grant } }) });
  const headers = new Headers();
  return { now, fetch, store, headers, authorize: () => provider.authorizeRequest!({ requestUrl: new URL(resource), headers, fetch }) };
}

it.each([NaN, Infinity, -Infinity, 1.5, 8_640_000_000_000_001])("rejects an invalid clock before attaching an initial grant: %s", async current => {
  const f = fixture(current, false);
  await expect(f.authorize()).rejects.toThrow(new Error("OAuth clock must return valid epoch milliseconds"));
  expect(f.headers.has("Authorization")).toBe(false);
  expect(f.fetch).not.toHaveBeenCalled(); expect(f.store.save).not.toHaveBeenCalled(); expect(f.store.clear).not.toHaveBeenCalled();
});

it.each([NaN, Infinity, -Infinity, 1.5, 8_640_000_000_000_001])("rejects an invalid clock before using or redeeming a persisted grant: %s", async current => {
  const f = fixture(current, true);
  await expect(f.authorize()).rejects.toThrow(new Error("OAuth clock must return valid epoch milliseconds"));
  expect(f.headers.has("Authorization")).toBe(false);
  expect(f.fetch).not.toHaveBeenCalled(); expect(f.store.save).not.toHaveBeenCalled(); expect(f.store.clear).not.toHaveBeenCalled();
});

it("rejects an invalid clock before submitting an expired client secret on a forced refresh", async () => {
  const now = vi.fn(() => NaN), fetch = vi.fn(async () => Response.json({ access_token: "replacement", token_type: "Bearer" }));
  const session: StoredOAuthSession = { resource, authorizationServer: issuer,
    client: { clientId: "original", clientSecret: "private-secret", registration: {
      client_id: "original", client_secret: "private-secret", client_secret_expires_at: 1 } }, tokens: { ...tokens, expiresAt: null },
    discovery: { resourceMetadataUrl: discovery.resourceMetadataUrl, resourceMetadata: discovery.resourceMetadata,
      authorizationServerMetadata: discovery.authorizationServerMetadata } };
  const save = vi.fn(async () => {}), clear = vi.fn(async () => {});
  const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "original", clientSecret: "private-secret" },
    browser: {}, now, allowInteractive: false, sessionStore: { load: async () => session, save, clear } });
  expect(await provider.handleUnauthorized({ requestUrl: new URL(resource), response: new Response(null, { status: 401 }),
    challenge: { scheme: "Bearer", params: { error: "invalid_token" }, raw: "Bearer error=invalid_token" }, discovery, fetch }))
    .toMatchObject({ action: "fail", error: { message: "OAuth clock must return valid epoch milliseconds" } });
  expect(now).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled();
});

it.each([false, true])("does not read the clock for an unknown access lifetime: saved=%s", async saved => {
  const f = fixture(NaN, saved, null);
  expect(await f.authorize()).toMatchObject({ accessToken: "private-access", expiresAt: null });
  expect(f.headers.get("Authorization")).toBe("Bearer private-access");
  expect(f.now).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
});

it.each([-8_640_000_000_000_000, -1000, 0, 8_640_000_000_000_000])("retains valid signed epoch clocks and exact expiry comparisons: %s", async current => {
  const f = fixture(current, false, 0);
  expect((await f.authorize())?.accessToken).toBe(current < 0 ? "private-access" : undefined);
  expect(f.now).toHaveBeenCalledOnce(); expect(f.fetch).not.toHaveBeenCalled();
});
