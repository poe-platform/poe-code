import { beforeEach, expect, it, vi } from "vitest";
import { createDefaultOAuthClientProvider } from "./default-oauth-client-provider.js";
import { normalizeStoredOAuthClient } from "./client-registration.js";
import type { StoredOAuthSession } from "./types.js";
const browser = vi.hoisted(() => ({ redirectUri: "http://127.0.0.1:49152/callback", authorization: vi.fn(), close: vi.fn() }));
vi.mock("./loopback-authorization.js", async importOriginal => ({ ...await importOriginal<typeof import("./loopback-authorization.js")>(),
  createLoopbackAuthorizationSession: async () => ({ redirectUri: browser.redirectUri, waitForCode: async (url: string) => { browser.authorization(new URL(url)); return "code"; }, close: browser.close }) }));
const resource = "https://resource.example/mcp", issuer = "https://auth.example";
const discovery = { resource, resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer] },
  authorizationServer: issuer, authorizationServerMetadataUrl: `${issuer}/metadata`, authorizationServerMetadata: {
    issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, registration_endpoint: `${issuer}/register`,
    response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] } };
function fixture(redirects: string[], initial: StoredOAuthSession | null = null, allowInteractive = true) {
  let session = initial;
  const save = vi.fn(async (_resource: string, value: StoredOAuthSession) => { session = value; });
  const fetch = vi.fn(async (url: string | URL, _init?: RequestInit) => Response.json(String(url).endsWith("/register")
    ? { client_id: "fresh", redirect_uris: redirects, token_endpoint_auth_method: "none" }
    : { access_token: "fresh-access", refresh_token: "fresh-refresh", token_type: "Bearer" }));
  const provider = createDefaultOAuthClientProvider({ client: { mode: "dynamic" }, browser: {}, now: () => 1000, allowInteractive,
    sessionStore: { load: async () => session, save, clear: async () => { session = null; } } });
  return { fetch, save, session: () => session,
    authorize: () => provider.authorizeRequest!({ requestUrl: new URL(resource), headers: new Headers(), fetch }),
    run: () => provider.handleUnauthorized({ requestUrl: new URL(resource), response: new Response(null, { status: 401 }), challenge: null, discovery, fetch }) };
}
function oldSession(redirect: string): StoredOAuthSession {
  return { resource, authorizationServer: issuer, client: { clientId: "old", registration: { client_id: "old", redirect_uris: [redirect] } },
    discovery: { resourceMetadataUrl: discovery.resourceMetadataUrl, resourceMetadata: discovery.resourceMetadata, authorizationServerMetadata: discovery.authorizationServerMetadata } };
}
beforeEach(() => { browser.authorization.mockClear(); browser.close.mockClear(); });
it.each(["http://127.0.0.1:49152/callback", "http://127.0.0.1/callback", "http://localhost/callback"])("retains the requested listener separately from fresh normalized metadata: %s", async redirect => {
  const f = fixture([redirect]);
  expect(await f.run()).toEqual({ action: "retry" });
  expect(f.session()?.client).toMatchObject({ requestedRedirectUri: browser.redirectUri, registration: { redirect_uris: [redirect] } });
  expect(browser.authorization.mock.calls[0]?.[0].searchParams.get("redirect_uri")).toBe(browser.redirectUri);
  const token = f.fetch.mock.calls.find(([url]) => String(url).endsWith("/token"));
  expect(new URLSearchParams(String(token?.[1]?.body)).get("redirect_uri")).toBe(browser.redirectUri);
  expect(f.fetch.mock.calls.filter(([url]) => String(url).endsWith("/register"))).toHaveLength(1);
});
it.each(["https://127.0.0.1/callback", "http://evil.example/callback", "http://127.0.0.2/callback", "http://[::1]/callback",
  "http://localhost/other", "http://localhost/callback?extra=1", "http://localhost/callback#fragment", "http://user@localhost/callback"])("rejects contradictory fresh callback metadata before activation: %s", async redirect => {
  const f = fixture([redirect]);
  expect(await f.run()).toMatchObject({ action: "fail", error: { message: expect.stringContaining("redirect") } });
  expect(browser.authorization).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
  expect(f.fetch).toHaveBeenCalledOnce();
  expect(browser.close).toHaveBeenCalledOnce();
});
it("accepts a compatible later redirect without taking the first unrelated entry", async () => {
  const f = fixture(["https://unrelated.example/callback", "http://localhost/callback"]);
  expect(await f.run()).toEqual({ action: "retry" });
});
it.each(["http://127.0.0.1:9999/callback", "http://localhost/callback"])("replaces obsolete cached registrations only at interactive authorization: %s", async redirect => {
  const f = fixture(["http://localhost/callback"], oldSession(redirect));
  expect(await f.run()).toEqual({ action: "retry" });
  expect(f.fetch.mock.calls.filter(([url]) => String(url).endsWith("/register"))).toHaveLength(1);
  expect(f.session()?.client.clientId).toBe("fresh");
});
it("uses captured requested redirect identity when cached response metadata was normalized", async () => {
  const initial = oldSession("http://localhost/callback");
  Object.assign(initial.client, { requestedRedirectUri: browser.redirectUri });
  const f = fixture([], initial);
  expect(await f.run()).toEqual({ action: "retry" });
  expect(f.fetch).toHaveBeenCalledOnce();
  expect(f.session()?.client.clientId).toBe("old");
});
it("refreshes silently with the original client despite obsolete callback metadata", async () => {
  const initial = oldSession("http://127.0.0.1:9999/callback");
  initial.tokens = { accessToken: "expired", refreshToken: "original-refresh", tokenType: "Bearer", expiresAt: 0 };
  const f = fixture([], initial, false);
  expect(await f.authorize()).toMatchObject({ accessToken: "fresh-access" });
  expect(f.fetch).toHaveBeenCalledOnce();
  expect(browser.authorization).not.toHaveBeenCalled();
  const body = new URLSearchParams(String(f.fetch.mock.calls[0]?.[1]?.body));
  expect(body.get("client_id")).toBe("old");
  expect(body.get("refresh_token")).toBe("original-refresh");
  expect(body.has("redirect_uri")).toBe(false);
});
it("retains caller ownership across reload and never replaces an imported app for a different listener", async () => {
  const initial = oldSession("http://127.0.0.1:9999/callback");
  Object.assign(initial.client, { registrationOwnership: "caller" });
  const f = fixture([], initial);
  expect(await f.run()).toMatchObject({ action: "fail", error: { message: expect.stringContaining("imported registration") } });
  expect(f.fetch).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
  expect(f.session()?.client.clientId).toBe("old");
});
it("reuses a compatible caller-owned registration without converting it into a native registration", async () => {
  const initial = oldSession(browser.redirectUri);
  Object.assign(initial.client, { registrationOwnership: "caller" });
  const f = fixture([], initial);
  expect(await f.run()).toEqual({ action: "retry" });
  expect(f.fetch).toHaveBeenCalledOnce();
  expect(f.session()?.client).toMatchObject({ clientId: "old", registrationOwnership: "caller" });
});
it.each(["https://evil.example/callback", "http://user@localhost:49152/callback", 7])("rejects malformed persisted requested callback identity: %#", requestedRedirectUri => {
  expect(() => normalizeStoredOAuthClient({ clientId: "old", requestedRedirectUri })).toThrow("redirect");
});
