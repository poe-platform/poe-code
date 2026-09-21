import http from "node:http";
import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { createDefaultOAuthClientProvider } from "./default-oauth-client-provider.js";
import type { DefaultOAuthClientProviderOptions, OAuthDiscoveryResult, StoredOAuthSession } from "./types.js";

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

function interaction(settings: { allowInteractive?: boolean; redirectUri?: string; scope?: string; signal?: AbortSignal; client?: DefaultOAuthClientProviderOptions["client"] } = {}) {
  let authorization!: URL;
  let callback = Promise.withResolvers<string>();
  let session: StoredOAuthSession | null = null;
  const createServer = vi.fn(() => new Listener() as unknown as http.Server);
  const openBrowser = vi.fn(async (url: string) => {
    authorization = new URL(url);
    const redirect = new URL(authorization.searchParams.get("redirect_uri")!);
    redirect.searchParams.set("code", "authorization-code");
    redirect.searchParams.set("state", authorization.searchParams.get("state")!);
    callback.resolve(redirect.toString());
    callback = Promise.withResolvers<string>();
  });
  const fetch = vi.fn(async (url: string | URL, _init?: RequestInit) => Response.json(String(url).endsWith("/register")
    ? { client_id: "registered-client", redirect_uris: JSON.parse(String(_init?.body)).redirect_uris }
    : { access_token: "token", token_type: "Bearer", expires_in: 3600 }));
  const metadata = { scope: settings.scope };
  const options: DefaultOAuthClientProviderOptions = {
    client: settings.client ?? { mode: "dynamic", metadata }, allowInteractive: settings.allowInteractive,
    browser: { openBrowser, readLine: () => callback.promise, createServer, redirectUri: settings.redirectUri, signal: settings.signal },
    sessionStore: { load: async () => session, save: async (_key, value) => { session = value; }, clear: async () => { session = null; } }
  };
  const provider = createDefaultOAuthClientProvider(options);
  return { provider, options, fetch, createServer, openBrowser, metadata, session: () => session,
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

it("explicitly authenticates without fabricating a rejected resource request", async () => {
  const f = interaction(), discover = vi.fn(async () => discovery);
  const tokens = await f.provider.authenticate!({ requestUrl: new URL(resource), fetch: f.fetch, discover });
  expect(tokens).toMatchObject({ accessToken: "token" });
  expect(discover).toHaveBeenCalledOnce();
  expect(f.openBrowser).toHaveBeenCalledOnce();
  tokens!.accessToken = "caller-mutated";
  expect(f.session()?.tokens?.accessToken).toBe("token");
  await f.provider.authenticate!({ requestUrl: new URL(resource), fetch: f.fetch, discover });
  expect(discover).toHaveBeenCalledOnce();
  expect(f.openBrowser).toHaveBeenCalledOnce();
});

it("joins overlapping interactive authorizations through token persistence without replacing PKCE", async () => {
  const f = interaction(), entered = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>();
  const original = f.fetch.getMockImplementation()!;
  f.fetch.mockImplementation(async (url, init) => {
    if (String(url).endsWith("/token")) { entered.resolve(); await finish.promise; }
    return original(url, init);
  });
  const owner = f.run();
  await entered.promise;
  const follower = f.run();
  try {
    expect(f.openBrowser).toHaveBeenCalledOnce();
    expect(f.createServer).toHaveBeenCalledOnce();
    finish.resolve();
    expect(await Promise.all([owner, follower])).toEqual([{ action: "retry" }, { action: "retry" }]);
    expect(f.openBrowser).toHaveBeenCalledOnce();
    expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(f.session()?.tokens?.accessToken).toBe("token");
  } finally { finish.resolve(); await Promise.allSettled([owner, follower]); }
});

it("rearms an interactive transaction after the owner fails while a follower is waiting", async () => {
  const f = interaction(), entered = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>();
  const original = f.fetch.getMockImplementation()!;
  let tokenRequests = 0;
  f.fetch.mockImplementation(async (url, init) => {
    if (String(url).endsWith("/token") && ++tokenRequests === 1) {
      entered.resolve(); await finish.promise;
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    }
    return original(url, init);
  });
  const owner = f.run();
  await entered.promise;
  const follower = f.run();
  try {
    finish.resolve();
    expect(await owner).toMatchObject({ action: "fail", error: { error: "invalid_grant" } });
    expect(await follower).toEqual({ action: "retry" });
    expect(f.openBrowser).toHaveBeenCalledTimes(2);
    expect(f.session()?.tokens?.accessToken).toBe("token");
  } finally { finish.resolve(); await Promise.allSettled([owner, follower]); }
});

it("rejects explicit authentication discovery for another resource before registration or consent", async () => {
  const f = interaction();
  await expect(f.provider.authenticate!({ requestUrl: new URL(resource), fetch: f.fetch,
    discover: async () => ({ ...discovery, resource: "https://other.example/mcp" }) })).rejects.toThrow("resource");
  expect(f.fetch).not.toHaveBeenCalled();
  expect(f.openBrowser).not.toHaveBeenCalled();
});

it("honors the headless policy for explicit authentication", async () => {
  const f = interaction({ allowInteractive: false });
  await expect(f.provider.authenticate!({ requestUrl: new URL(resource), fetch: f.fetch,
    discover: async () => discovery })).rejects.toThrow("interactive");
  expect(f.createServer).not.toHaveBeenCalled();
  expect(f.openBrowser).not.toHaveBeenCalled();
});

it("requests configured scopes even when discovery advertises wider permissions", async () => {
  const fixture = interaction({ scope: "read" });
  expect(await fixture.run()).toEqual({ action: "retry" });
  expect(fixture.authorization().searchParams.get("scope")).toBe("read");
});

it.each(["invalid_token", "insufficient_scope"])("keeps explicit consent scopes when a %s challenge requests broader permissions", async error => {
  const f = interaction({ scope: "read offline_access" });
  expect(await f.provider.handleUnauthorized({ requestUrl: new URL(resource), response: new Response(null, { status: 401 }),
    challenge: { scheme: "Bearer", params: { error, scope: "read write admin" } }, discovery, fetch: f.fetch })).toEqual({ action: "retry" });
  expect(f.authorization().searchParams.get("scope")).toBe("offline_access read");
  expect(JSON.parse(String(f.fetch.mock.calls[0]?.[1]?.body)).scope).toBe("offline_access read");
  expect(f.session()?.requestedScope).toBe("offline_access read");
  expect((await f.authorize()).get("Authorization")).toBe("Bearer token");
  expect(f.openBrowser).toHaveBeenCalledOnce();
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

it("keeps a provider headless when caller options later enable interaction", async () => {
  const f = interaction({ allowInteractive: false });
  f.options.allowInteractive = true;
  expect(await f.run()).toMatchObject({ action: "fail", error: { message: expect.stringContaining("interactive") } });
  expect(f.createServer).not.toHaveBeenCalled();
  expect(f.openBrowser).not.toHaveBeenCalled();
  expect(f.fetch).not.toHaveBeenCalled();
});

it("keeps the original interactive policy when caller options later disable it", async () => {
  const f = interaction();
  f.options.allowInteractive = false;
  expect(await f.run()).toEqual({ action: "retry" });
  expect(f.openBrowser).toHaveBeenCalledOnce();
});

it("keeps an explicitly static app out of DCR after caller mode mutation", async () => {
  const f = interaction({ client: { mode: "static", clientId: "original-static" } });
  f.options.client.mode = "dynamic";
  expect(await f.run()).toEqual({ action: "retry" });
  expect(f.fetch).toHaveBeenCalledOnce();
  expect(f.fetch.mock.calls[0]?.[0]).toBe(`${issuer}/token`);
  expect(new URLSearchParams(String(f.fetch.mock.calls[0]?.[1]?.body)).get("client_id")).toBe("original-static");
  expect(f.authorization().searchParams.get("client_id")).toBe("original-static");
});

it("keeps native registration available after caller replaces dynamic app options", async () => {
  const f = interaction();
  f.options.client = { mode: "static", clientId: "replacement-app" };
  expect(await f.run()).toEqual({ action: "retry" });
  expect(f.fetch).toHaveBeenCalledTimes(2);
  expect(f.authorization().searchParams.get("client_id")).toBe("registered-client");
});

it("keeps the original callback and browser dependencies after caller replacement", async () => {
  const redirectUri = "http://localhost:39119/original-callback?app=one";
  const f = interaction({ redirectUri });
  const replacement = vi.fn(async () => { throw new Error("replacement dependency invoked"); });
  f.options.browser.redirectUri = "http://localhost:39120/replacement-callback";
  f.options.browser.openBrowser = replacement;
  f.options.browser.readLine = replacement;
  f.options.browser.createServer = () => { throw new Error("replacement listener invoked"); };
  expect(await f.run()).toEqual({ action: "retry" });
  expect(f.createServer).toHaveBeenCalledOnce();
  expect(f.openBrowser).toHaveBeenCalledOnce();
  expect(replacement).not.toHaveBeenCalled();
  expect(f.authorization().searchParams.get("redirect_uri")).toBe(redirectUri);
  expect(JSON.parse(String(f.fetch.mock.calls[0]?.[1]?.body)).redirect_uris).toEqual([redirectUri]);
  expect(new URLSearchParams(String(f.fetch.mock.calls[1]?.[1]?.body)).get("redirect_uri")).toBe(redirectUri);
});

it.each(["signal", "timeout"])("does not acquire a replacement browser %s policy", async policy => {
  const f = interaction();
  if (policy === "signal") f.options.browser.signal = AbortSignal.abort(new Error("replacement cancellation"));
  else f.options.browser.timeoutMs = 0;
  expect(await f.run()).toEqual({ action: "retry" });
  expect(f.openBrowser).toHaveBeenCalledOnce();
});

it("captures landing-page values while the original browser callback stays executable", async () => {
  const listener = new Listener();
  const landingPage = { title: "Original title", body: "Original body" };
  const end = vi.fn();
  const fetch = vi.fn(async () => Response.json({ access_token: "token", token_type: "Bearer" }));
  const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "client" },
    sessionStore: { load: async () => null, save: async () => {}, clear: async () => {} },
    browser: { landingPage, createServer: () => listener as unknown as http.Server, openBrowser: async url => {
      const authorization = new URL(url), callback = new URL(authorization.searchParams.get("redirect_uri")!);
      callback.searchParams.set("state", authorization.searchParams.get("state")!);
      callback.searchParams.set("code", "code");
      listener.emit("request", { url: callback.pathname + callback.search }, { writeHead: vi.fn(), end });
    } } });
  landingPage.title = "Replacement title";
  landingPage.body = "Replacement body";
  expect(await provider.handleUnauthorized({ requestUrl: new URL(resource), response: new Response(null, { status: 401 }),
    challenge: null, discovery, fetch })).toEqual({ action: "retry" });
  expect(end).toHaveBeenCalledWith(expect.stringContaining("Original title"));
  expect(end).toHaveBeenCalledWith(expect.stringContaining("Original body"));
  expect(end.mock.calls[0]?.[0]).not.toContain("Replacement");
});

it("retains live cancellation from the original browser signal after caller replacement", async () => {
  const controller = new AbortController(), reason = new Error("original browser cancellation");
  const f = interaction({ signal: controller.signal });
  f.options.browser.signal = new AbortController().signal;
  controller.abort(reason);
  expect(await f.run()).toEqual({ action: "fail", error: reason });
  expect(f.createServer).not.toHaveBeenCalled();
  expect(f.fetch).not.toHaveBeenCalled();
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
