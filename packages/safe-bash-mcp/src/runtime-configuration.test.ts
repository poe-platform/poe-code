import { expect, it, vi } from "vitest";
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { CommandRegistry } from "@poe-platform/safe-bash/contracts";
import type { HttpTransportFetch, StoredOAuthSession } from "tiny-mcp-client";
import { bindRemoteMcpConfiguration, createRemoteMcpCommands, initRemoteMcpConfiguration } from "./index.js";

const tool = { name: "find", inputSchema: { type: "object" } };
const server = { name: "catalog", url: "https://catalog.example/mcp", tools: [tool], protocolVersion: "2025-03-26" as const };
const oauth = { type: "oauth" as const, clientMode: "static" as const, env: { clientId: "APP_ID", clientSecret: "APP_SECRET" } };
function configuration(auth: typeof oauth | { type: "bearer"; env?: string } = oauth) {
  return initRemoteMcpConfiguration([{ ...server, auth }]).configuration;
}
function memoryStore() {
  let session: StoredOAuthSession | null = null;
  return { load: vi.fn(async () => session), save: vi.fn(async (_resource: string, value: StoredOAuthSession) => { session = value; }), clear: vi.fn(async () => { session = null; }) };
}

it("binds bearer and header references without changing the declarative configuration", () => {
  const config = initRemoteMcpConfiguration([{ ...server, auth: { type: "bearer", env: "TOKEN" }, headers: { "X-Key": { env: "KEY" } } }]).configuration;
  const env = { TOKEN: "actual-token", KEY: "actual-key" };
  const [bound] = bindRemoteMcpConfiguration(config, { env });
  expect(new Headers(bound.headers).get("Authorization")).toBe("Bearer actual-token");
  expect(new Headers(bound.headers).get("X-Key")).toBe("actual-key");
  expect(JSON.stringify(config)).not.toContain("actual-token");
  env.TOKEN = "mutated-token";
  expect(new Headers(bound.headers).get("Authorization")).toBe("Bearer actual-token");
  expect(bound).not.toHaveProperty("auth");
});

it("reports missing required environment references without consulting the process environment", () => {
  expect(() => bindRemoteMcpConfiguration(configuration({ type: "bearer", env: "TOKEN" }), { env: {} })).toThrow("TOKEN");
  expect(() => bindRemoteMcpConfiguration(configuration(), { env: {} })).toThrow("APP_ID");
});

it("never evaluates accessor or inherited environment values", () => {
  const getter = vi.fn(() => "secret");
  const env = Object.defineProperty({}, "APP_ID", { get: getter });
  expect(() => bindRemoteMcpConfiguration(configuration(), { env })).toThrow("environment");
  expect(getter).not.toHaveBeenCalled();
  expect(() => bindRemoteMcpConfiguration(configuration(), { env: Object.create({ APP_ID: "inherited" }) })).toThrow("APP_ID");
});

it("binds an OAuth initial grant through the native provider without reading tokens into artifacts", async () => {
  const config = configuration();
  const store = memoryStore();
  const [bound] = bindRemoteMcpConfiguration(config, { env: { APP_ID: "client", APP_SECRET: "app-secret", MCP_CATALOG_ACCESS_TOKEN: "access-secret", MCP_CATALOG_REFRESH_TOKEN: "refresh-secret", MCP_CATALOG_EXPIRES_AT: "100000" },
    oauth: { sessionStore: () => store, now: () => 1000 } });
  const fetch = vi.fn(async () => { throw new Error("unexpected network"); });
  const headers = new Headers();
  await bound.oauth!.provider.authorizeRequest!({ requestUrl: new URL(server.url), headers, fetch });
  expect(headers.get("Authorization")).toBe("Bearer access-secret");
  expect(fetch).not.toHaveBeenCalled();
  expect(store.save).not.toHaveBeenCalled();
  expect(JSON.stringify(config)).not.toContain("access-secret");
});

it("keeps empty optional OAuth fields absent and defaults runtime interaction to headless", async () => {
  const [bound] = bindRemoteMcpConfiguration(configuration(), { env: { APP_ID: "client", APP_SECRET: "", MCP_CATALOG_SCOPE: "" }, oauth: { sessionStore: () => memoryStore() } });
  const result = await bound.oauth!.provider.handleUnauthorized({ requestUrl: new URL(server.url), response: new Response(null, { status: 401 }), challenge: null,
    discovery: { resource: server.url, resourceMetadataUrl: `${server.url}/metadata`, resourceMetadata: { resource: server.url, authorization_servers: ["https://auth.example"] },
      authorizationServer: "https://auth.example", authorizationServerMetadataUrl: "https://auth.example/metadata", authorizationServerMetadata: {
        issuer: "https://auth.example", authorization_endpoint: "https://auth.example/authorize", token_endpoint: "https://auth.example/token", response_types_supported: ["code"], code_challenge_methods_supported: ["S256"]
      } }, fetch: vi.fn(async () => { throw new Error("unexpected network"); }) });
  expect(result).toMatchObject({ action: "fail", error: { message: expect.stringContaining("interactive") } });
});

it.each(["NaN", "Infinity", "100.5", "1000seconds", "1e3", "8640000000000001"])("rejects an invalid or ambiguous epoch-millisecond expiry: %s", expiry => {
  expect(() => bindRemoteMcpConfiguration(configuration(), { env: { APP_ID: "client", MCP_CATALOG_ACCESS_TOKEN: "secret", MCP_CATALOG_EXPIRES_AT: expiry } })).toThrow("EXPIRES_AT");
});

it("rejects orphaned token metadata rather than dropping or redeeming it", () => {
  for (const fields of [{ MCP_CATALOG_REFRESH_TOKEN: "refresh-secret" }, { MCP_CATALOG_EXPIRES_AT: "1000" }])
    expect(() => bindRemoteMcpConfiguration(configuration(), { env: { APP_ID: "client", ...fields } })).toThrow("access token");
});

it("redacts invalid header values in binding errors", () => {
  const secret = "credential-secret\nInjected: yep";
  let error: unknown;
  try { bindRemoteMcpConfiguration(configuration({ type: "bearer", env: "TOKEN" }), { env: { TOKEN: secret } }); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).not.toContain("credential-secret");
  expect(String(error)).not.toContain("Injected");
});

it("completes all credential preflight before requesting a host session store", () => {
  const config = initRemoteMcpConfiguration([{ ...server, auth: oauth }, { ...server, name: "second", auth: { type: "bearer", env: "MISSING_TOKEN" } }]).configuration;
  const sessionStore = vi.fn(() => memoryStore());
  expect(() => bindRemoteMcpConfiguration(config, { env: { APP_ID: "client" }, oauth: { sessionStore } })).toThrow("MISSING_TOKEN");
  expect(sessionStore).not.toHaveBeenCalled();
});

it("bounds unique environment values without charging intentionally shared references twice", () => {
  const config = initRemoteMcpConfiguration([{ ...server, headers: { "X-One": { env: "KEY" }, "X-Two": { env: "KEY" } } }]).configuration;
  expect(() => bindRemoteMcpConfiguration(config, { env: { KEY: "four" }, maxCredentialBytes: 4 })).not.toThrow();
  expect(() => bindRemoteMcpConfiguration(config, { env: { KEY: "five!" }, maxCredentialBytes: 4 })).toThrow("byte limit");
  expect(() => bindRemoteMcpConfiguration(config, { env: {}, maxCredentialBytes: 0 })).toThrow("positive");
});

it("rejects control characters in configured scopes without including their values", () => {
  expect(() => bindRemoteMcpConfiguration(configuration(), { env: { APP_ID: "client", MCP_CATALOG_SCOPE: "read\nsecret-scope" } })).toThrow("MCP_CATALOG_SCOPE");
});

it("uses bound credentials through generated commands and preserves supplied-schema network suppression", async () => {
  const fetch = vi.fn<HttpTransportFetch>(async (_url, init) => {
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer actual-token");
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    if (init?.method !== "POST") return new Response(null, { status: 405 });
    const request = JSON.parse(String(init.body));
    if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
    return Response.json({ jsonrpc: "2.0", id: request.id, result: request.method === "initialize"
      ? { protocolVersion: "2025-03-26", serverInfo: { name: "catalog", version: "1" }, capabilities: { tools: {} } }
      : { content: [{ type: "text", text: "called" }] } });
  });
  const commands = await createRemoteMcpCommands(bindRemoteMcpConfiguration(configuration({ type: "bearer", env: "TOKEN" }), { env: { TOKEN: "actual-token" } }), { fetch });
  expect(fetch).not.toHaveBeenCalled();
  const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry(commands) });
  try { const result = await shell.exec("catalog find"); expect(result.exitCode).toBe(0); expect(JSON.parse(result.stdout).content[0].text).toBe("called"); }
  finally { await shell.dispose(); }
});

it("refreshes an imported grant through actual discovery and reuses its persisted rotation in a new binding", async () => {
  const metadataUrl = "https://catalog.example/.well-known/oauth-protected-resource/mcp";
  const issuer = "https://auth.example";
  const store = memoryStore();
  const tokenRequests: URLSearchParams[] = [];
  const metadataRequests: string[] = [];
  const fetch = vi.fn<HttpTransportFetch>(async (input, init) => {
    const url = String(input);
    if (url === metadataUrl || url === `${issuer}/.well-known/oauth-authorization-server`) {
      const headers = new Headers(init?.headers);
      expect(headers.get("Accept")).toBe("application/json");
      expect(headers.has("Authorization")).toBe(false);
      metadataRequests.push(url);
      return Response.json(url === metadataUrl ? { resource: server.url, authorization_servers: [issuer] } : {
        issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
        response_types_supported: ["code"], code_challenge_methods_supported: ["S256"]
      });
    }
    if (url === `${issuer}/token`) {
      tokenRequests.push(new URLSearchParams(String(init?.body)));
      return Response.json({ access_token: "rotated-access", refresh_token: "rotated-refresh", token_type: "Bearer", expires_in: 3600 });
    }
    expect(url).toBe(server.url);
    if (new Headers(init?.headers).get("Authorization") !== "Bearer rotated-access")
      return new Response(null, { status: 401, headers: { "WWW-Authenticate": `Bearer resource_metadata="${metadataUrl}"` } });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    if (init?.method !== "POST") return new Response(null, { status: 405 });
    const request = JSON.parse(String(init.body));
    if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
    return Response.json({ jsonrpc: "2.0", id: request.id, result: request.method === "initialize"
      ? { protocolVersion: "2025-03-26", serverInfo: { name: "catalog", version: "1" }, capabilities: { tools: {} } }
      : { content: [{ type: "text", text: "authenticated" }] } });
  });
  for (let run = 0; run < 2; run++) {
    const bound = bindRemoteMcpConfiguration(configuration(), { env: {
      APP_ID: "original-client", APP_SECRET: "original-secret", MCP_CATALOG_ACCESS_TOKEN: "expired-access", MCP_CATALOG_REFRESH_TOKEN: "original-refresh", MCP_CATALOG_EXPIRES_AT: "0"
    }, oauth: { now: () => 1000, sessionStore: () => store } });
    const commands = await createRemoteMcpCommands(bound, { fetch });
    if (run === 0) expect(fetch).not.toHaveBeenCalled();
    const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry(commands) });
    try { const result = await shell.exec("catalog find"); expect(result.exitCode).toBe(0); expect(result.stderr).toBe(""); }
    finally { await shell.dispose(); }
  }
  expect(tokenRequests).toHaveLength(1);
  expect(tokenRequests[0].get("client_id")).toBe("original-client");
  expect(tokenRequests[0].get("refresh_token")).toBe("original-refresh");
  expect(metadataRequests).toHaveLength(2);
  expect(store.save.mock.calls.at(-1)?.[1].tokens?.refreshToken).toBe("rotated-refresh");
});
