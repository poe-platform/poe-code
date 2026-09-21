import { expect, it, vi } from "vitest";
import { authenticateRemoteMcpServer, initRemoteMcpConfiguration } from "./index.js";
const resource = "https://resource.example/mcp", issuer = "https://auth.example";
function fixture(publicInitialization = false) {
  const configuration = initRemoteMcpConfiguration([{ name: "catalog", url: resource, tools: [], protocolVersion: "2025-03-26", auth: {
    type: "oauth", clientMode: "static", env: { clientId: "ID" }, redirectUri: "http://127.0.0.1:39141/callback" } }]).configuration.servers[0];
  const callback = Promise.withResolvers<string>();
  const opener = vi.fn(async () => {});
  const observed = vi.fn(async (event: { authorizationUrl: string; redirectUri: string }) => {
    const url = new URL(event.authorizationUrl), redirect = new URL(event.redirectUri);
    expect(url.searchParams.get("redirect_uri")).toBe(event.redirectUri);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("client_id")).toBe("original");
    redirect.searchParams.set("code", "synthetic-code"); redirect.searchParams.set("state", url.searchParams.get("state")!);
    callback.resolve(redirect.href);
  });
  const requests: string[] = [];
  const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes(".well-known/oauth-protected-resource")) return Response.json({ resource, authorization_servers: [issuer] });
    if (url.includes(".well-known/oauth-authorization-server")) return Response.json({ issuer, authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] });
    if (url === `${issuer}/token`) return Response.json({ access_token: "private-access", token_type: "Bearer", expires_in: 3600 });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    if (init?.method !== "POST") return new Response(null, { status: 405 });
    if (!publicInitialization && new Headers(init.headers).get("Authorization") !== "Bearer private-access") return new Response(null, { status: 401,
      headers: { "WWW-Authenticate": 'Bearer resource_metadata="https://resource.example/.well-known/oauth-protected-resource/mcp"' } });
    const request = JSON.parse(String(init.body)); requests.push(request.method);
    if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
    return Response.json({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2025-03-26", serverInfo: { name: "synthetic", version: "1" }, capabilities: { tools: {} } } });
  });
  let session: import("mcp-oauth").StoredOAuthSession | null = null;
  const binding = { env: { ID: "original" }, oauth: { now: () => 1000, sessionStore: () => ({ load: async () => session,
    save: async (_key: string, value: import("mcp-oauth").StoredOAuthSession) => { session = value; }, clear: async () => { session = null; } }),
    browser: { openBrowser: opener, readLine: () => callback.promise } } };
  return { configuration, binding, fetch, observed, opener, requests };
}
it("explicitly authenticates even with supplied schemas, emits the complete URL and verifies only initialization", async () => {
  const f = fixture();
  expect(await authenticateRemoteMcpServer(f.configuration, { binding: f.binding, fetch: f.fetch, onAuthorizationUrl: f.observed })).toMatchObject({ name: "catalog", url: resource, serverInfo: { name: "synthetic", version: "1" } });
  expect(f.observed).toHaveBeenCalledOnce();
  expect(f.opener).not.toHaveBeenCalled();
  expect(f.requests).toEqual(["initialize", "notifications/initialized"]);
});
it("establishes the configured OAuth grant even when initialization is publicly accessible", async () => {
  const f = fixture(true);
  await authenticateRemoteMcpServer(f.configuration, { binding: f.binding, fetch: f.fetch, onAuthorizationUrl: f.observed });
  expect(f.observed).toHaveBeenCalledOnce();
  expect(f.fetch.mock.calls.some(([url]) => String(url).endsWith("/token"))).toBe(true);
  expect(f.requests).toEqual(["initialize", "notifications/initialized", "initialize", "notifications/initialized"]);
});
it("recovers an uncertain refresh outcome explicitly before the first resource request", async () => {
  const f = fixture();
  await f.binding.oauth.sessionStore().save(resource, { resource, authorizationServer: issuer, client: { clientId: "original" }, refreshState: "pending",
    discovery: { resourceMetadataUrl: "https://resource.example/.well-known/oauth-protected-resource/mcp", resourceMetadata: { resource, authorization_servers: [issuer] },
      authorizationServerMetadata: { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] } } });
  await authenticateRemoteMcpServer(f.configuration, { binding: f.binding, fetch: f.fetch, onAuthorizationUrl: f.observed });
  expect(f.observed).toHaveBeenCalledOnce();
  expect(f.requests).toEqual(["initialize", "notifications/initialized"]);
});
it("opens a host browser only when explicitly selected", async () => {
  const f = fixture();
  await authenticateRemoteMcpServer(f.configuration, { binding: f.binding, fetch: f.fetch, onAuthorizationUrl: f.observed, noBrowser: false });
  expect(f.opener).toHaveBeenCalledOnce();
});
it("reuses a fresh authenticated session without emitting another URL or opening a browser", async () => {
  const f = fixture();
  await authenticateRemoteMcpServer(f.configuration, { binding: f.binding, fetch: f.fetch, onAuthorizationUrl: f.observed });
  await authenticateRemoteMcpServer(f.configuration, { binding: f.binding, fetch: f.fetch });
  expect(f.observed).toHaveBeenCalledOnce();
  expect(f.opener).not.toHaveBeenCalled();
});
it("fails explicitly selected browser launch without a configured opener before URL observation", async () => {
  const f = fixture();
  await expect(authenticateRemoteMcpServer(f.configuration, { binding: { ...f.binding, oauth: { ...f.binding.oauth, browser: { readLine: f.binding.oauth.browser.readLine } } },
    fetch: f.fetch, noBrowser: false, onAuthorizationUrl: f.observed })).rejects.toThrow("Host browser opener");
  expect(f.observed).not.toHaveBeenCalled();
  expect(f.fetch.mock.calls.some(([url]) => String(url).endsWith("/token"))).toBe(false);
});
it("fails promptly at auth start when headless URL delivery is unavailable", async () => {
  const f = fixture();
  await expect(authenticateRemoteMcpServer(f.configuration, { binding: f.binding, fetch: f.fetch })).rejects.toThrow("onAuthorizationUrl");
  expect(f.opener).not.toHaveBeenCalled();
  expect(f.fetch.mock.calls.some(([url]) => String(url).endsWith("/token"))).toBe(false);
});
it("settles authorization when URL delivery fails instead of waiting for a callback", async () => {
  const f = fixture(), failure = new Error("URL sink failed");
  await expect(authenticateRemoteMcpServer(f.configuration, { binding: f.binding, fetch: f.fetch,
    onAuthorizationUrl: async () => { throw failure; } })).rejects.toBe(failure);
  expect(f.opener).not.toHaveBeenCalled();
  expect(f.fetch.mock.calls.some(([url]) => String(url).endsWith("/token"))).toBe(false);
});
it("never opens a browser after cancellation during URL delivery", async () => {
  const f = fixture(), controller = new AbortController(), reason = new Error("cancel URL delivery");
  await expect(authenticateRemoteMcpServer(f.configuration, { binding: f.binding, fetch: f.fetch, signal: controller.signal, noBrowser: false,
    onAuthorizationUrl: async () => { controller.abort(reason); } })).rejects.toBe(reason);
  expect(f.opener).not.toHaveBeenCalled();
});
it("bounds headless consent and a stalled URL observer with the complete operation deadline", async () => {
  const f = fixture();
  await expect(authenticateRemoteMcpServer(f.configuration, { binding: f.binding, fetch: f.fetch, requestTimeoutMs: 25,
    onAuthorizationUrl: async () => new Promise<void>(() => {}) })).rejects.toThrow();
  expect(f.opener).not.toHaveBeenCalled();
  expect(f.fetch.mock.calls.some(([url]) => String(url).endsWith("/token"))).toBe(false);
});
