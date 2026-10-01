import { Volume, createFsFromVolume } from "memfs";
import { expect, it, vi } from "vitest";
import type { StoredOAuthSession } from "mcp-oauth";
import { authenticateRemoteMcpServer, bindRemoteMcpConfiguration, initRemoteMcpConfiguration, type ConfigurationBindingOptions } from "./index.js";

vi.mock("../../mcp-oauth/src/client/loopback-authorization.js", async importOriginal => ({ ...await importOriginal<typeof import("../../mcp-oauth/src/client/loopback-authorization.js")>(),
  createLoopbackAuthorizationSession: async () => ({ redirectUri: "http://127.0.0.1:49152/callback", waitForCode: async () => "005930", close() {} }) }));

const resource = "https://resource.example/mcp", issuer = "https://auth.example";
const server = { name: "catalog", url: resource, tools: [], protocolVersion: "2025-03-26" as const, auth: { type: "oauth" as const, clientMode: "static" as const, scope: "read", env: { clientId: "APP_ID" } } };
const configuration = initRemoteMcpConfiguration([server]).configuration;
const metadata = { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] };
const saved: StoredOAuthSession = { resource, authorizationServer: issuer, client: { clientId: "original" }, tokens: { accessToken: "host-grant", tokenType: "Bearer", expiresAt: null, scope: "read" },
  discovery: { resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer] }, authorizationServerMetadata: metadata } };
function authStore() { return { backend: "file" as const, fileStore: { fs: createFsFromVolume(new Volume()).promises, filePath: "/synthetic/auth.enc", salt: "fixture" } }; }

it.each((["binding", "authentication"] as const).flatMap(route => (["now", "sessionStore", "sessionLockTimeoutMs"] as const).map(field => ({ route, field }))))(
  "retains nonenumerable binding $field through $route", async ({ route, field }) => {
    const factory = vi.fn(() => ({ load: async () => saved, save: vi.fn(), clear: vi.fn() }));
    const oauth: NonNullable<ConfigurationBindingOptions["oauth"]> = { sessionStore: factory, now: () => NaN, sessionLockTimeoutMs: field === "sessionLockTimeoutMs" ? 0 : 1000, authStore: authStore() };
    Object.defineProperty(oauth, field, { enumerable: false });
    const binding = { env: { APP_ID: "original", ...(field === "now" ? { MCP_CATALOG_ACCESS_TOKEN: "imported", MCP_CATALOG_EXPIRES_IN: "1", MCP_CATALOG_SCOPE: "read" } : {}) }, oauth };
    const fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer host-grant");
      if (init?.method === "GET") return new Response(null, { status: 405 });
      const rpc = JSON.parse(String(init?.body)); if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "synthetic", version: "1" } } });
    });
    const run = async () => {
      if (route === "authentication") return authenticateRemoteMcpServer(configuration.servers[0], { binding, fetch });
      const [bound] = bindRemoteMcpConfiguration(configuration, binding), headers = new Headers();
      await bound.oauth!.provider.authorizeRequest!({ requestUrl: new URL(resource), headers, fetch }); return headers.get("Authorization");
    };
    if (field === "now" || field === "sessionLockTimeoutMs") {
      await expect(run()).rejects.toThrow(field === "now" ? "relative expiry" : "sessionLockTimeoutMs"); expect(fetch).not.toHaveBeenCalled();
      if (field === "now") expect(factory).not.toHaveBeenCalled();
    } else { const result = await run(); if (route === "binding") expect(result).toBe("Bearer host-grant"); expect(factory).toHaveBeenCalledOnce(); }
  }
);

it("retains nonenumerable opt-in to interactive binding", async () => {
  const oauth = { allowInteractive: true, sessionStore: () => ({ load: async () => null, save: async () => {}, clear: async () => {} }) };
  Object.defineProperty(oauth, "allowInteractive", { enumerable: false });
  const [bound] = bindRemoteMcpConfiguration(configuration, { env: { APP_ID: "original" }, oauth });
  expect(await bound.oauth!.provider.authenticate!({ requestUrl: new URL(resource), fetch: async () => Response.json({ access_token: "consented", token_type: "Bearer", scope: "read" }),
    discover: async () => ({ resource, resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: saved.discovery.resourceMetadata, authorizationServer: issuer,
      authorizationServerMetadataUrl: `${issuer}/metadata`, authorizationServerMetadata: metadata }) })).toMatchObject({ accessToken: "consented" });
});

it.each(["store", "clock"] as const)("retains private binding class %s state and original receiver", async method => {
  class Host {
    #timestamp = 1000;
    authStore = authStore();
    sessionStore = vi.fn(() => ({ load: async () => method === "store" ? saved : null, save: async () => {}, clear: async () => {} }));
    constructor() { Object.defineProperty(this, "sessionStore", { enumerable: false }); }
    now() { return this.#timestamp; }
    update() { this.#timestamp = 2000; }
  }
  const host = new Host();
  const originalFactory = host.sessionStore;
  Object.defineProperty(host, "sessionStore", { value: function(this: Host) { expect(this).toBe(host); this.now(); return originalFactory(); } });
  const [bound] = bindRemoteMcpConfiguration(configuration, { env: { APP_ID: "original", ...(method === "clock" ? {
    MCP_CATALOG_ACCESS_TOKEN: "imported", MCP_CATALOG_EXPIRES_IN: "1", MCP_CATALOG_SCOPE: "read" } : {}) }, oauth: host });
  host.update(); const headers = new Headers();
  await bound.oauth!.provider.authorizeRequest!({ requestUrl: new URL(resource), headers, fetch: vi.fn(async () => { throw new Error("unexpected traffic"); }) });
  expect(headers.get("Authorization")).toBe(method === "clock" ? null : "Bearer host-grant"); expect(originalFactory).toHaveBeenCalledOnce();
});
