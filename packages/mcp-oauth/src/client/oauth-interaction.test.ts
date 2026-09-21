import http from "node:http";
import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { createDefaultOAuthClientProvider } from "./default-oauth-client-provider.js";
import type { OAuthDiscoveryResult, StoredOAuthSession } from "./types.js";

const resource = "https://resource.example/mcp";
const issuer = "https://auth.example";
const discovery: OAuthDiscoveryResult = {
  resource, resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer], scopes_supported: ["read", "write"] },
  authorizationServer: issuer, authorizationServerMetadataUrl: `${issuer}/metadata`, authorizationServerMetadata: {
    issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, registration_endpoint: `${issuer}/register`,
    response_types_supported: ["code"], code_challenge_methods_supported: ["S256"], scopes_supported: ["read", "write"]
  }
};
class Listener extends EventEmitter {
  port = 49152;
  listen(port: number, _host: string, ready: () => void) { this.port = port || 49152; queueMicrotask(ready); return this; }
  address() { return { port: this.port, address: "127.0.0.1", family: "IPv4" }; }
  close() { return this; }
}

function interaction(settings: { allowInteractive?: boolean; redirectUri?: string; scope?: string } = {}) {
  let authorization!: URL;
  const callback = Promise.withResolvers<string>();
  let session: StoredOAuthSession | null = null;
  const createServer = vi.fn(() => new Listener() as unknown as http.Server);
  const openBrowser = vi.fn(async (url: string) => {
    authorization = new URL(url);
    const redirect = new URL(authorization.searchParams.get("redirect_uri")!);
    redirect.searchParams.set("code", "authorization-code");
    redirect.searchParams.set("state", authorization.searchParams.get("state")!);
    callback.resolve(redirect.toString());
  });
  const fetch = vi.fn(async (url: string | URL, _init?: RequestInit) => Response.json(String(url).endsWith("/register")
    ? { client_id: "registered-client", redirect_uris: JSON.parse(String(_init?.body)).redirect_uris }
    : { access_token: "token", token_type: "Bearer", expires_in: 3600 }));
  const metadata = { scope: settings.scope };
  const provider = createDefaultOAuthClientProvider({
    client: { mode: "dynamic", metadata }, allowInteractive: settings.allowInteractive,
    browser: { openBrowser, readLine: () => callback.promise, createServer, redirectUri: settings.redirectUri },
    sessionStore: { load: async () => session, save: async (_key, value) => { session = value; }, clear: async () => { session = null; } }
  });
  return { fetch, createServer, openBrowser, metadata, session: () => session,
    authorize: async () => { const headers = new Headers(); await provider.authorizeRequest!({ requestUrl: new URL(resource), headers, fetch }); return headers; },
    seed: (value: StoredOAuthSession) => { session = value; }, authorization: () => authorization, run: () => provider.handleUnauthorized({
    requestUrl: new URL(resource), response: new Response(null, { status: 401 }), challenge: null, discovery, fetch
  }) };
}

it("keeps the exact fixed redirect through registration, authorization and code exchange", async () => {
  const redirectUri = "http://localhost:39119/oauth/callback?app=one";
  const fixture = interaction({ redirectUri });
  expect(await fixture.run()).toEqual({ action: "retry" });
  expect(JSON.parse(String(fixture.fetch.mock.calls[0]?.[1]?.body)).redirect_uris).toEqual([redirectUri]);
  expect(fixture.authorization().searchParams.get("redirect_uri")).toBe(redirectUri);
  expect(new URLSearchParams(String(fixture.fetch.mock.calls[1]?.[1]?.body)).get("redirect_uri")).toBe(redirectUri);
});

it("requests configured scopes even when discovery advertises wider permissions", async () => {
  const fixture = interaction({ scope: "read" });
  expect(await fixture.run()).toEqual({ action: "retry" });
  expect(fixture.authorization().searchParams.get("scope")).toBe("read");
});

it("reuses a scoped authorization when the token endpoint omits scope", async () => {
  const fixture = interaction({ scope: "read" });
  expect(await fixture.run()).toEqual({ action: "retry" });
  expect(fixture.session()).toMatchObject({ requestedScope: "read", tokens: { accessToken: "token" } });
  expect((await fixture.authorize()).get("Authorization")).toBe("Bearer token");
  expect(fixture.fetch).toHaveBeenCalledTimes(2);
});

it("rejects broader code-exchange grants without activating them", async () => {
  const fixture = interaction({ scope: "read" });
  fixture.fetch.mockResolvedValueOnce(Response.json({ client_id: "registered-client" }))
    .mockResolvedValueOnce(Response.json({ access_token: "broader-private", token_type: "Bearer", scope: "read write" }));
  expect(await fixture.run()).toMatchObject({ action: "fail", error: { message: expect.stringContaining("requested OAuth scope") } });
  expect(fixture.session()?.tokens).toBeUndefined();
  expect((await fixture.authorize()).has("Authorization")).toBe(false);
});

it("captures configured scope before caller metadata can change", async () => {
  const fixture = interaction({ scope: "read" });
  fixture.metadata.scope = "read write";
  expect(await fixture.run()).toEqual({ action: "retry" });
  expect(fixture.authorization().searchParams.get("scope")).toBe("read");
  expect(JSON.parse(String(fixture.fetch.mock.calls[0]?.[1]?.body)).scope).toBe("read");
});

it("does not invent a requested scope from server-advertised permissions", async () => {
  const fixture = interaction();
  expect(await fixture.run()).toEqual({ action: "retry" });
  expect(fixture.authorization().searchParams.has("scope")).toBe(false);
  expect(fixture.session()?.requestedScope).toBeUndefined();
});

it("fails headless unauthorized requests promptly without allocating a callback or launching a browser", async () => {
  const fixture = interaction({ allowInteractive: false });
  expect(await fixture.run()).toMatchObject({ action: "fail", error: { message: expect.stringContaining("interactive") } });
  expect(fixture.createServer).not.toHaveBeenCalled();
  expect(fixture.openBrowser).not.toHaveBeenCalled();
  expect(fixture.fetch).not.toHaveBeenCalled();
});

it("rejects unsafe configured redirects before creating a provider or a listener", () => {
  const createServer = vi.fn(() => new Listener() as unknown as http.Server);
  for (const redirectUri of ["https://remote.example/callback", "http://localhost:0/callback", "http://localhost:39119/callback#fragment"])
    expect(() => createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "client" }, browser: { redirectUri, createServer } })).toThrow("redirect URI");
  expect(createServer).not.toHaveBeenCalled();
});

it("allows silent refresh in headless mode and preserves the registered client", async () => {
  const fixture = interaction({ allowInteractive: false });
  fixture.seed({ resource, authorizationServer: issuer, client: { clientId: "previous-client" },
    tokens: { accessToken: "expired", refreshToken: "rotating-refresh", tokenType: "Bearer", expiresAt: 0 },
    discovery: { resourceMetadataUrl: discovery.resourceMetadataUrl, resourceMetadata: discovery.resourceMetadata,
      authorizationServerMetadata: discovery.authorizationServerMetadata } });
  expect(await fixture.run()).toEqual({ action: "retry" });
  expect(fixture.fetch).toHaveBeenCalledOnce();
  expect(fixture.fetch.mock.calls[0]?.[0]).toBe(`${issuer}/token`);
  const body = new URLSearchParams(String(fixture.fetch.mock.calls[0]?.[1]?.body));
  expect(body.get("client_id")).toBe("previous-client");
  expect(body.get("refresh_token")).toBe("rotating-refresh");
  expect(fixture.createServer).not.toHaveBeenCalled();
  expect(fixture.openBrowser).not.toHaveBeenCalled();
});
