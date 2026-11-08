import http from "node:http";
import { EventEmitter } from "node:events";
import { setImmediate } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { createDefaultOAuthClientProvider } from "./default-oauth-client-provider.js";
import type { OAuthDiscoveryResult, StoredOAuthSession } from "./types.js";
const resource = "https://resource.example/mcp";
const issuer = "https://auth.example";
const discovery: OAuthDiscoveryResult = {
  resource, resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer] },
  authorizationServer: issuer, authorizationServerMetadataUrl: `${issuer}/metadata`, authorizationServerMetadata: {
    issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
    response_types_supported: ["code"], code_challenge_methods_supported: ["S256"]
  }
};
class Listener extends EventEmitter {
  listen(_port: number, _host: string, ready: () => void) { queueMicrotask(ready); return this; }
  address() { return { port: 49152, address: "127.0.0.1", family: "IPv4" }; }
  close = vi.fn(() => this);
}

it("closes the callback and preserves request cancellation identity during authorization", async () => {
  const listener = new Listener();
  const controller = new AbortController();
  const entered = Promise.withResolvers<void>();
  const callback = Promise.withResolvers<string>();
  let authorization!: URL;
  const fetch = vi.fn(async () => Response.json({ access_token: "new", token_type: "Bearer" }));
  const provider = createDefaultOAuthClientProvider({
    client: { mode: "static", clientId: "client" },
    browser: { createServer: () => listener as unknown as http.Server, readLine: () => callback.promise,
      openBrowser: async url => { authorization = new URL(url); entered.resolve(); } },
    sessionStore: { load: async () => null, save: async () => {}, clear: async () => {} }
  });
  const pending = provider.handleUnauthorized({ requestUrl: new URL(resource), response: new Response(null, { status: 401 }),
    discovery, challenge: null, fetch, signal: controller.signal }).catch(error => error);
  const reason = { cancelled: true };
  try {
    await entered.promise;
    controller.abort(reason);
    await setImmediate();
    expect(listener.close).toHaveBeenCalledOnce();
    expect(await pending).toBe(reason);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    const redirect = new URL(authorization.searchParams.get("redirect_uri")!);
    redirect.searchParams.set("code", "cleanup");
    redirect.searchParams.set("state", authorization.searchParams.get("state")!);
    callback.resolve(redirect.toString());
    await pending;
  }
});

it("cancels stalled token bodies with the request signal while retaining tokenless refresh intent", async () => {
  const controller = new AbortController();
  const entered = Promise.withResolvers<void>();
  const cancel = vi.fn();
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const session: StoredOAuthSession = { resource, authorizationServer: issuer, client: { clientId: "client" },
    tokens: { accessToken: "expired", refreshToken: "refresh", tokenType: "Bearer", expiresAt: 0 },
    discovery: { resourceMetadataUrl: discovery.resourceMetadataUrl, resourceMetadata: discovery.resourceMetadata,
      authorizationServerMetadata: discovery.authorizationServerMetadata } };
  const save = vi.fn(async () => {});
  const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "client" }, browser: {},
    sessionStore: { load: async () => session, save, clear: async () => {} } });
  const pending = Promise.resolve(provider.authorizeRequest!({ requestUrl: new URL(resource), headers: new Headers(), signal: controller.signal,
    fetch: async () => { entered.resolve(); return new Response(new ReadableStream({ start(value) { body = value; }, cancel })); }
  })).catch(error => error);
  const reason = { cancelled: true };
  try {
    await entered.promise; await setImmediate(); controller.abort(reason); await setImmediate();
    expect(cancel).toHaveBeenCalledOnce();
    expect(await pending).toBe(reason);
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(resource, expect.objectContaining({ refreshState: "pending", client: session.client }));
    expect(save.mock.calls[0]?.[1]).not.toHaveProperty("tokens");
  } finally { try { body.close(); } catch { /* Cancelled. */ } await pending; }
});

it("settles unauthorized-request cancellation during a stalled provenance read without later redemption", async () => {
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), controller = new AbortController();
  const fetch = vi.fn(async () => { throw new Error("canceled request must not redeem"); });
  const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "client" }, allowInteractive: false, browser: {},
    sessionStore: { load: async () => { entered.resolve(); await release.promise; return null; }, save: async () => {}, clear: async () => {} } });
  const reason = new Error("cancel provenance read");
  const pending = Promise.resolve(provider.handleUnauthorized({ requestUrl: new URL(resource), response: new Response(null, { status: 401 }),
    discovery, challenge: null, fetch, signal: controller.signal })).catch(error => error);
  try {
    await entered.promise; controller.abort(reason);
    expect(await Promise.race([pending, setImmediate().then(() => "still waiting")])).toBe(reason);
    expect(fetch).not.toHaveBeenCalled();
  } finally { release.resolve(); await pending; }
  await setImmediate();
  expect(fetch).not.toHaveBeenCalled();
});

it("settles explicit-auth cancellation while its selected lazy discovery callback is stalled", async () => {
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), controller = new AbortController();
  const openBrowser = vi.fn(), fetch = vi.fn(async () => { throw new Error("canceled discovery must not continue"); });
  const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "client" }, browser: { openBrowser },
    sessionStore: { load: async () => null, save: async () => {}, clear: async () => {} } });
  const reason = { canceled: "lazy-discovery" };
  const pending = provider.authenticate!({ requestUrl: new URL(resource), fetch, signal: controller.signal,
    discover: async () => { entered.resolve(); await release.promise; return discovery; } }).catch(error => error);
  try {
    await entered.promise; controller.abort(reason);
    expect(await Promise.race([pending, setImmediate().then(() => "still waiting")])).toBe(reason);
  } finally { release.resolve(); await pending; }
  await setImmediate();
  expect(openBrowser).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});

it("rejects an already canceled unauthorized request before reading credentials", async () => {
  const load = vi.fn(async () => null), reason = new Error("already canceled");
  const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "client" }, browser: {},
    sessionStore: { load, save: async () => {}, clear: async () => {} } });
  await expect(provider.handleUnauthorized({ requestUrl: new URL(resource), response: new Response(null, { status: 401 }), discovery,
    challenge: null, fetch: vi.fn(), signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
  expect(load).not.toHaveBeenCalled();
});
