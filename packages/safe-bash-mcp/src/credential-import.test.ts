import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import * as sdk from "./index.js";
import { createResourceBoundOAuthStores, type StoredOAuthSession } from "mcp-oauth";
vi.mock("node:crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, scrypt(password: string, salt: string, size: number, done: (error: Error | null, key: Buffer) => void) {
    queueMicrotask(() => done(null, actual.createHash("shake256", { outputLength: size }).update(password).update(salt).digest()));
  } };
});
const resource = "https://resource.example/mcp", issuer = "https://auth.example";
const payload = { tokens: { access_token: "private-access", refresh_token: "private-refresh", token_type: "Bearer", expires_in: 3600, scope: "read" },
  clientInfo: { client_id: "original", client_secret: "private-secret", token_endpoint_auth_method: "client_secret_post", redirect_uris: ["http://localhost:49152/callback"], provider_metadata: { tenant: "one" } } };
const dynamic = sdk.initRemoteMcpConfiguration([{ name: "catalog", url: resource, tools: [], auth: { type: "oauth", clientMode: "dynamic", scope: "read" } }]).configuration.servers[0];
function fixture() {
  const fs = createFsFromVolume(new Volume()).promises;
  const authStore = { backend: "file" as const, fileStore: { fs, filePath: "/home/test/import.enc", salt: "fixture", getMachineIdentity: () => ({ hostname: "host", username: "user" }) } };
  const fetch = vi.fn(async (url: string | URL) => Response.json(String(url).includes("oauth-protected-resource")
    ? { resource, authorization_servers: [issuer] }
    : { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["client_secret_post", "none"] }));
  const binding = { env: {}, oauth: { authStore, now: () => 10_000 } };
  return { fs, authStore, fetch, binding, stores: createResourceBoundOAuthStores(authStore, undefined, "catalog") };
}
it("imports raw tokens and complete original DCR metadata without initializing or listing tools", async () => {
  const f = fixture();
  expect(await sdk.importRemoteMcpAuthentication(dynamic, payload, { binding: f.binding, fetch: f.fetch })).toEqual({ name: "catalog", url: resource, imported: true });
  expect(f.fetch).toHaveBeenCalledTimes(2);
  const session = await f.stores.sessionStore.load(resource);
  expect(session).toMatchObject({ resource, authorizationServer: issuer, client: { clientId: "original", registrationOwnership: "caller", registration: payload.clientInfo },
    requestedScope: "read", tokens: { accessToken: "private-access", refreshToken: "private-refresh", expiresAt: 3_610_000 } });
  expect(await f.stores.clientStore.load(issuer)).toEqual(session?.client);
});
it("anchors expiry before asynchronous discovery and preserves delayed issuance", async () => {
  const f = fixture(); let now = 10_000;
  const base = f.fetch.getMockImplementation()!;
  f.fetch.mockImplementation(async url => { now = 2_000_000; return base(url); });
  await sdk.importRemoteMcpAuthentication(dynamic, payload, { binding: { ...f.binding, oauth: { ...f.binding.oauth, now: () => now } }, fetch: f.fetch });
  expect((await f.stores.sessionStore.load(resource))?.tokens?.expiresAt).toBe(3_610_000);
  await sdk.importRemoteMcpAuthentication(dynamic, { ...payload, issuedAt: 1000 }, { binding: f.binding, fetch: f.fetch });
  expect((await f.stores.sessionStore.load(resource))?.tokens?.expiresAt).toBe(3_601_000);
});
it("does not read stale token, timing or header environment credentials during explicit import", async () => {
  const f = fixture(), read = vi.fn(() => { throw new Error("private-marker"); });
  const env = {};
  if (dynamic.auth?.type !== "oauth") throw new Error("fixture");
  for (const ref of [dynamic.auth.credentials.accessToken, dynamic.auth.credentials.refreshToken, dynamic.auth.credentials.expiresAt, { env: "HEADER" }])
    Object.defineProperty(env, ref.env, { enumerable: true, get: read });
  await sdk.importRemoteMcpAuthentication({ ...dynamic, headers: { "X-API-Key": { env: "HEADER" } } }, payload, { binding: { ...f.binding, env }, fetch: f.fetch });
  expect(read).not.toHaveBeenCalled();
});
it.each([
  { tokens: { ...payload.tokens, expires_in: -1 } },
  { tokens: { ...payload.tokens, access_token: "private\nvalue" } },
  { clientInfo: { ...payload.clientInfo, client_id: "" } },
  { clientInfo: { ...payload.clientInfo, token_endpoint_auth_method: "unsupported" } },
  { tokens: { ...payload.tokens, scope: "write" } },
  { issuedAt: "private-value" }, { extra: "private-value" }
])("rejects malformed/profile-incompatible imports before discovery or persistence: %#", async change => {
  const f = fixture();
  await expect(sdk.importRemoteMcpAuthentication(dynamic, { ...payload, ...change }, { binding: f.binding, fetch: f.fetch })).rejects.toThrow();
  expect(f.fetch).not.toHaveBeenCalled();
  expect(await f.stores.sessionStore.load(resource)).toBeNull();
});
it("requires the original configured ID when no clientInfo is supplied", async () => {
  const f = fixture();
  await expect(sdk.importRemoteMcpAuthentication(dynamic, { tokens: payload.tokens }, { binding: f.binding, fetch: f.fetch })).rejects.toThrow("original client ID");
  expect(f.fetch).not.toHaveBeenCalled();
});
it("infers full caller-owned registration from the explicitly configured original app", async () => {
  const f = fixture();
  if (dynamic.auth?.type !== "oauth") throw new Error("fixture");
  const env = { [dynamic.auth.credentials.clientId.env]: "original", [dynamic.auth.credentials.clientSecret.env]: "private-secret" };
  await sdk.importRemoteMcpAuthentication(dynamic, { tokens: payload.tokens }, { binding: { ...f.binding, env }, fetch: f.fetch });
  expect((await f.stores.sessionStore.load(resource))?.client).toMatchObject({ clientId: "original", clientSecret: "private-secret", registrationOwnership: "caller" });
});
it("rejects a configured original app conflicting with clientInfo before any request", async () => {
  const f = fixture();
  if (dynamic.auth?.type !== "oauth") throw new Error("fixture");
  await expect(sdk.importRemoteMcpAuthentication(dynamic, payload, { binding: { ...f.binding, env: { [dynamic.auth.credentials.clientId.env]: "another" } }, fetch: f.fetch })).rejects.toThrow("client identity");
  expect(f.fetch).not.toHaveBeenCalled();
});
it.each(["payload", "registration"])("requires imported %s issuer to match validated discovery", async location => {
  const f = fixture();
  const value = location === "payload" ? { ...payload, issuer: "https://another.example" } : { ...payload, clientInfo: { ...payload.clientInfo, issuer: "https://another.example" } };
  await expect(sdk.importRemoteMcpAuthentication(dynamic, value, { binding: f.binding, fetch: f.fetch })).rejects.toThrow("issuer");
  expect(await f.stores.sessionStore.load(resource)).toBeNull();
});
it("requires an explicit atomic import hook for host-owned persistence", async () => {
  const f = fixture(), factory = vi.fn(() => ({ load: async () => null, save: async () => {}, clear: async () => {} }));
  await expect(sdk.importRemoteMcpAuthentication(dynamic, payload, { binding: { ...f.binding, oauth: { sessionStore: factory } }, fetch: f.fetch })).rejects.toThrow("import hook");
  expect(factory).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
});
it("passes the bound grant to a host import hook without querying its session factory", async () => {
  const f = fixture(), importSession = vi.fn(async (_server: unknown, _session: StoredOAuthSession, _options: unknown) => {});
  await sdk.importRemoteMcpAuthentication(dynamic, payload, { binding: { ...f.binding, oauth: { now: () => 10_000, importSession } }, fetch: f.fetch });
  expect(importSession).toHaveBeenCalledWith(dynamic, expect.objectContaining({ tokens: expect.objectContaining({ expiresAt: 3_610_000 }) }), expect.objectContaining({ timeoutMs: 30_000, signal: expect.any(AbortSignal) }));
  expect(await f.stores.sessionStore.load(resource)).toBeNull();
});

it.each(["replace hook", "remove hook"])("captures the selected atomic import hook before discovery: %s", async mutation => {
  const f = fixture(), entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
  const fetch = f.fetch.getMockImplementation()!;
  f.fetch.mockImplementation(async url => { entered.resolve(); await resume.promise; return fetch(url); });
  const original = vi.fn(async () => {}), replacement = vi.fn(async () => {});
  const oauth = { sessionStore: () => ({ load: async () => null, save: async () => {}, clear: async () => {} }),
    authStore: f.authStore, importSession: original as (() => Promise<void>) | undefined };
  const pending = sdk.importRemoteMcpAuthentication(dynamic, payload, { binding: { env: {}, oauth }, fetch: f.fetch });
  const outcome = pending.catch(error => error);
  try {
    await entered.promise;
    oauth.importSession = mutation === "replace hook" ? replacement : undefined;
    resume.resolve();
    expect(await outcome).toEqual({ name: "catalog", url: resource, imported: true });
    expect(original).toHaveBeenCalledOnce();
    expect(replacement).not.toHaveBeenCalled();
    expect(await f.stores.sessionStore.load(resource)).toBeNull();
  } finally { resume.resolve(); await outcome; }
});

it("captures native import persistence settings before metadata discovery waits", async () => {
  const f = fixture(), entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
  const fetch = f.fetch.getMockImplementation()!;
  f.fetch.mockImplementation(async url => { entered.resolve(); await resume.promise; return fetch(url); });
  const pending = sdk.importRemoteMcpAuthentication(dynamic, payload, { binding: f.binding, fetch: f.fetch });
  const outcome = pending.catch(error => error);
  try {
    await entered.promise;
    f.authStore.fileStore.filePath = "/home/replacement/import.enc";
    resume.resolve();
    expect(await outcome).toEqual({ name: "catalog", url: resource, imported: true });
    expect((await f.stores.sessionStore.load(resource))?.tokens?.accessToken).toBe(payload.tokens.access_token);
    await expect(f.fs.readdir("/home/replacement")).rejects.toMatchObject({ code: "ENOENT" });
  } finally { resume.resolve(); await outcome; }
});

it("selects the native import backend before asynchronous metadata discovery", async () => {
  const f = fixture(), entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
  const fetch = f.fetch.getMockImplementation()!;
  f.fetch.mockImplementation(async url => { entered.resolve(); await resume.promise; return fetch(url); });
  const env = { IMPORT_POLICY_BACKEND: "file" };
  const authStore = { fileStore: f.authStore.fileStore, backendEnvVar: "IMPORT_POLICY_BACKEND", env };
  const pending = sdk.importRemoteMcpAuthentication(dynamic, payload, { binding: { ...f.binding, oauth: { ...f.binding.oauth, authStore } }, fetch: f.fetch });
  const outcome = pending.catch(error => error);
  try {
    await entered.promise;
    env.IMPORT_POLICY_BACKEND = "invalid-replacement";
    resume.resolve();
    expect(await outcome).toEqual({ name: "catalog", url: resource, imported: true });
    expect((await f.stores.sessionStore.load(resource))?.tokens?.accessToken).toBe(payload.tokens.access_token);
  } finally { resume.resolve(); await outcome; }
});

it("retains the original host import hook receiver and its live state", async () => {
  const f = fixture();
  const oauth = { imports: 0, async importSession() { this.imports++; } };
  await sdk.importRemoteMcpAuthentication(dynamic, payload, { binding: { env: {}, oauth }, fetch: f.fetch });
  expect(oauth.imports).toBe(1);
});

it("captures the validated host import hook before invoking the host clock", async () => {
  const f = fixture(), original = vi.fn(async () => {});
  const oauth = { authStore: f.authStore, importSession: original as (() => Promise<void>) | undefined,
    sessionStore: () => ({ load: async () => null, save: async () => {}, clear: async () => {} }),
    now: () => { oauth.importSession = undefined; return 10_000; } };
  await sdk.importRemoteMcpAuthentication(dynamic, payload, { binding: { env: {}, oauth }, fetch: f.fetch });
  expect(original).toHaveBeenCalledOnce();
  expect(await f.stores.sessionStore.load(resource)).toBeNull();
});
it("rejects unmanaged bearer credentials", async () => {
  const f = fixture();
  const server = sdk.initRemoteMcpConfiguration([{ name: "catalog", url: resource, auth: { type: "bearer" } }]).configuration.servers[0];
  await expect(sdk.importRemoteMcpAuthentication(server, payload, { binding: f.binding, fetch: f.fetch })).rejects.toThrow("managed OAuth");
  expect(f.fetch).not.toHaveBeenCalled();
});
it("retains a caller cancellation reason before parsing credentials", async () => {
  const f = fixture(), controller = new AbortController(), reason = new Error("cancel import"); controller.abort(reason);
  await expect(sdk.importRemoteMcpAuthentication(dynamic, payload, { binding: f.binding, fetch: f.fetch, signal: controller.signal })).rejects.toBe(reason);
  expect(f.fetch).not.toHaveBeenCalled();
});
it("withholds stale environment grants after explicitly imported credentials are cleared", async () => {
  const f = fixture(); await sdk.importRemoteMcpAuthentication(dynamic, payload, { binding: f.binding, fetch: f.fetch });
  await f.stores.sessionStore.withLock!(resource, () => f.stores.sessionStore.clear(resource), {});
  if (dynamic.auth?.type !== "oauth") throw new Error("fixture");
  const env = { [dynamic.auth.credentials.clientId.env]: "original", [dynamic.auth.credentials.accessToken.env]: "stale-access" };
  const [bound] = sdk.bindRemoteMcpConfiguration({ version: 1, servers: [dynamic] }, { ...f.binding, env });
  const headers = new Headers(), fetch = vi.fn(async () => Response.json({}));
  await bound.oauth!.provider.authorizeRequest!({ requestUrl: new URL(resource), headers, fetch });
  expect(headers.has("Authorization")).toBe(false); expect(fetch).not.toHaveBeenCalled();
});
it("refuses accessor-bearing credential JSON without invoking it", async () => {
  const f = fixture(), touched = vi.fn();
  const input = { ...payload, get clientInfo() { touched(); throw new Error("private-marker"); } };
  await expect(sdk.importRemoteMcpAuthentication(dynamic, input, { binding: f.binding, fetch: f.fetch })).rejects.toThrow("Invalid OAuth credential import payload");
  expect(touched).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
});
it("rejects invalid bounded JSON text without quoting any input", async () => {
  const f = fixture();
  for (const value of ['{"private-marker":', JSON.stringify(payload).replace('"tokens":', '"issuedAt":9007199254740993,"tokens":')]) {
    await expect(sdk.importRemoteMcpAuthentication(dynamic, value, { binding: f.binding, fetch: f.fetch })).rejects.toThrow();
  }
  expect(f.fetch).not.toHaveBeenCalled();
});
it("rejects an import exceeding its configured byte budget before discovery", async () => {
  const f = fixture();
  await expect(sdk.importRemoteMcpAuthentication(dynamic, payload, { binding: f.binding, fetch: f.fetch, maxImportBytes: 100 })).rejects.toThrow("Invalid OAuth credential import payload");
  expect(f.fetch).not.toHaveBeenCalled();
});
it("cancels discovery without persisting a partially imported client", async () => {
  const f = fixture(), controller = new AbortController(), reason = new Error("cancel discovery"), entered = Promise.withResolvers<void>();
  f.fetch.mockImplementation(async () => { entered.resolve(); return new Promise(() => {}); });
  const pending = sdk.importRemoteMcpAuthentication(dynamic, payload, { binding: f.binding, fetch: f.fetch, signal: controller.signal });
  await entered.promise; controller.abort(reason);
  await expect(pending).rejects.toBe(reason);
  expect(await f.stores.sessionStore.load(resource)).toBeNull(); expect(await f.stores.clientStore.load(issuer)).toBeNull();
});
it.each([0, -1, 1.5, NaN, 2_147_483_648])("rejects invalid import deadlines before discovery: %s", async requestTimeoutMs => {
  const f = fixture();
  await expect(sdk.importRemoteMcpAuthentication(dynamic, payload, { binding: f.binding, fetch: f.fetch, requestTimeoutMs })).rejects.toThrow("requestTimeoutMs");
  expect(f.fetch).not.toHaveBeenCalled();
});
it("preserves the failure identity from a host import hook", async () => {
  const f = fixture(), failure = new Error("host transaction failed");
  await expect(sdk.importRemoteMcpAuthentication(dynamic, payload, { binding: { ...f.binding, oauth: { importSession: async () => { throw failure; } } }, fetch: f.fetch })).rejects.toBe(failure);
});
it("imports a public client with optional null descriptive and secret metadata", async () => {
  const f = fixture();
  await sdk.importRemoteMcpAuthentication(dynamic, { ...payload, clientInfo: { client_id: "original", client_secret: null, client_name: null, redirect_uris: null, token_endpoint_auth_method: "none" } }, { binding: f.binding, fetch: f.fetch });
  expect((await f.stores.sessionStore.load(resource))?.client).toMatchObject({ clientId: "original", registration: { client_secret: null, client_name: null }, tokenEndpointAuthMethod: "none" });
  expect((await f.stores.sessionStore.load(resource))?.client.clientSecret).toBeUndefined();
});

it("retains the selected import signal when its host clock installs a replacement canceled handle", async () => {
  const f = fixture(), controller = new AbortController();
  const options = { binding: f.binding, fetch: f.fetch, signal: controller.signal };
  f.binding.oauth.now = () => { options.signal = AbortSignal.abort(new Error("replacement cancellation")); return 10_000; };
  await expect(sdk.importRemoteMcpAuthentication(dynamic, payload, options)).resolves.toEqual({ name: "catalog", url: resource, imported: true });
  expect(f.fetch).toHaveBeenCalledTimes(2);
  expect((await f.stores.sessionStore.load(resource))?.tokens?.accessToken).toBe("private-access");
});

it("retains original import cancellation after its host clock replaces the option handle", async () => {
  const f = fixture(), controller = new AbortController(), reason = new Error("original import cancellation");
  const options = { binding: f.binding, fetch: f.fetch, signal: controller.signal };
  f.binding.oauth.now = () => { controller.abort(reason); options.signal = new AbortController().signal; return 10_000; };
  await expect(sdk.importRemoteMcpAuthentication(dynamic, payload, options)).rejects.toBe(reason);
  expect(f.fetch).not.toHaveBeenCalled();
  expect(await f.stores.sessionStore.load(resource)).toBeNull();
});

it("retains the selected import fetch when its host clock replaces the caller option", async () => {
  const f = fixture(), replacement = vi.fn(async () => { throw new Error("replacement fetch selected"); });
  const options: { binding: typeof f.binding; fetch: (url: string | URL, init?: RequestInit) => Promise<Response> } = { binding: f.binding, fetch: f.fetch };
  f.binding.oauth.now = () => { options.fetch = replacement; return 10_000; };
  await expect(sdk.importRemoteMcpAuthentication(dynamic, payload, options)).resolves.toEqual({ name: "catalog", url: resource, imported: true });
  expect(f.fetch).toHaveBeenCalledTimes(2); expect(replacement).not.toHaveBeenCalled();
});

it("captures original import client identity before the host clock changes environment credentials", async () => {
  const f = fixture(), env = { MCP_CATALOG_CLIENT_ID: "original", MCP_CATALOG_CLIENT_SECRET: "private-secret" };
  f.binding.oauth.now = () => { env.MCP_CATALOG_CLIENT_ID = "replacement"; env.MCP_CATALOG_CLIENT_SECRET = "replacement-secret"; return 10_000; };
  await expect(sdk.importRemoteMcpAuthentication(dynamic, payload, { binding: { ...f.binding, env }, fetch: f.fetch })).resolves.toEqual({ name: "catalog", url: resource, imported: true });
  expect((await f.stores.sessionStore.load(resource))?.client).toMatchObject({ clientId: "original", clientSecret: "private-secret", registration: payload.clientInfo });
});

it("cannot widen the selected import scope through the host lifetime clock", async () => {
  const f = fixture(), env = { MCP_CATALOG_SCOPE: "read" };
  f.binding.oauth.now = () => { env.MCP_CATALOG_SCOPE = "write"; return 10_000; };
  await expect(sdk.importRemoteMcpAuthentication(dynamic, { ...payload, tokens: { ...payload.tokens, scope: "write" } }, {
    binding: { ...f.binding, env }, fetch: f.fetch
  })).rejects.toThrow("requested OAuth scope");
  expect(f.fetch).not.toHaveBeenCalled(); expect(await f.stores.sessionStore.load(resource)).toBeNull();
});

it("captures selected native import persistence paths before the host lifetime clock runs", async () => {
  const f = fixture();
  f.binding.oauth.now = () => { f.authStore.fileStore.filePath = "/replacement/import.enc"; return 10_000; };
  await sdk.importRemoteMcpAuthentication(dynamic, payload, { binding: f.binding, fetch: f.fetch });
  expect((await f.stores.sessionStore.load(resource))?.tokens?.accessToken).toBe("private-access");
  await expect(f.fs.stat("/replacement")).rejects.toMatchObject({ code: "ENOENT" });
});
