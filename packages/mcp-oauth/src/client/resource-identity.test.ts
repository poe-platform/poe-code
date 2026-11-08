import { setImmediate } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createResourceBoundOAuthStores } from "./resource-bound-store.js";
import { createDefaultOAuthClientProvider } from "./default-oauth-client-provider.js";
import type { DefaultOAuthClientProviderOptions, OAuthDiscoveryResult } from "./types.js";
vi.mock("node:crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, scrypt(password: string, salt: string, size: number, done: (error: Error | null, key: Buffer) => void) {
    queueMicrotask(() => done(null, actual.createHash("shake256", { outputLength: size }).update(password).update(salt).digest()));
  } };
});
vi.mock("./loopback-authorization.js", async importOriginal => ({ ...await importOriginal<typeof import("./loopback-authorization.js")>(),
  createLoopbackAuthorizationSession: async () => ({ redirectUri: "http://127.0.0.1:49152/callback", waitForCode: async () => "code", close: vi.fn() }) }));
const original = "https://resource.example/mcp", changed = "https://other.example/mcp", issuer = "https://auth.example";
function fixture() {
  const fs = createFsFromVolume(new Volume()).promises;
  const authStore = { backend: "file" as const, fileStore: { fs, filePath: "/home/test/identity.enc", salt: "fixture", getMachineIdentity: () => ({ hostname: "host", username: "user" }) } };
  let registrations = 0;
  const fetch = vi.fn(async (url: string | URL, _init?: RequestInit) => Response.json(String(url).endsWith("/register")
    ? { client_id: `client-${++registrations}`, redirect_uris: ["http://localhost/callback"] }
    : { access_token: `access-${registrations}`, refresh_token: `refresh-${registrations}`, token_type: "Bearer", expires_in: 3600 }));
  const make = (identity = "catalog", extra: Partial<DefaultOAuthClientProviderOptions> = {}) => createDefaultOAuthClientProvider({
    client: { mode: "dynamic" }, browser: {}, authStore, resourceIdentity: identity, now: () => 1000, ...extra } as DefaultOAuthClientProviderOptions);
  const authorize = async (resource: string, identity = "catalog", extra: Partial<DefaultOAuthClientProviderOptions> = {}) => {
    const headers = new Headers();
    const tokens = await make(identity, extra).authorizeRequest!({ requestUrl: new URL(resource), headers, fetch });
    return { tokens, headers };
  };
  const login = (resource: string, identity = "catalog", signal?: AbortSignal) => {
    const discovery: OAuthDiscoveryResult = { resource, resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer] },
      authorizationServer: issuer, authorizationServerMetadataUrl: `${issuer}/metadata`, authorizationServerMetadata: {
        issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, registration_endpoint: `${issuer}/register`,
        response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] } };
    return make(identity).handleUnauthorized({ requestUrl: new URL(resource), response: new Response(null, { status: 401 }), challenge: null, discovery, fetch, signal });
  };
  return { fs, authStore, fetch, make, authorize, login, registrations: () => registrations };
}
it("keeps an unchanged named resource's persisted grant across provider recreation", async () => {
  const f = fixture();
  expect(await f.login(original)).toEqual({ action: "retry" });
  expect((await f.authorize(original)).headers.get("Authorization")).toBe("Bearer access-1");
});
it("does not revive retired credentials when a named resource URL changes and reverts", async () => {
  const f = fixture();
  expect(await f.login(original)).toEqual({ action: "retry" });
  expect((await f.authorize(changed)).headers.has("Authorization")).toBe(false);
  expect((await f.authorize(original)).headers.has("Authorization")).toBe(false);
});
it("retires old registrations along with tokens even when the new resource has the same issuer", async () => {
  const f = fixture();
  expect(await f.login(original)).toEqual({ action: "retry" });
  expect(await f.login(changed)).toEqual({ action: "retry" });
  expect(f.registrations()).toBe(2);
  expect((await f.authorize(original)).headers.has("Authorization")).toBe(false);
});
it("keeps different logical server identities independent at the same URL", async () => {
  const f = fixture();
  expect(await f.login(original, "catalog")).toEqual({ action: "retry" });
  expect((await f.authorize(original, "other")).headers.has("Authorization")).toBe(false);
  expect((await f.authorize(original, "catalog")).headers.get("Authorization")).toBe("Bearer access-1");
});
it("keeps explicit profiles for the same logical server independent", async () => {
  const f = fixture();
  expect(await f.login(original)).toEqual({ action: "retry" });
  expect((await f.authorize(changed, "catalog", { persistenceNamespace: "other-profile" })).headers.has("Authorization")).toBe(false);
  expect((await f.authorize(original)).headers.get("Authorization")).toBe("Bearer access-1");
});

it("withholds reimported environment grants after a URL transition and revert", async () => {
  const f = fixture();
  const extra = { client: { mode: "static" as const, clientId: "imported-client" }, initialGrant: { resource: original,
    tokens: { accessToken: "private-import", refreshToken: "private-refresh", tokenType: "Bearer" as const, expiresAt: null } } };
  expect((await f.authorize(original, "catalog", extra)).headers.get("Authorization")).toBe("Bearer private-import");
  expect((await f.authorize(changed)).headers.has("Authorization")).toBe(false);
  expect((await f.authorize(original, "catalog", extra)).headers.has("Authorization")).toBe(false);
});
it("rejects resourceIdentity together with custom persistence rather than claiming an unenforced history", () => {
  const f = fixture();
  expect(() => f.make("catalog", { sessionStore: { load: async () => null, save: async () => {}, clear: async () => {} } })).toThrow("custom stores");
});

it("serializes URL transitions behind a rotating refresh for the same logical identity", async () => {
  const f = fixture();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const base = f.fetch.getMockImplementation()!;
  f.fetch.mockImplementation(async (url, init) => {
    if (new URLSearchParams(String(init?.body)).get("grant_type") === "refresh_token") {
      entered.resolve(); await release.promise;
      return Response.json({ access_token: "rotated", refresh_token: "rotated-refresh", token_type: "Bearer", expires_in: 3600 });
    }
    const response = await base(url, init);
    if (String(url).endsWith("/token")) return Response.json({ ...await response.json(), expires_in: 0 });
    return response;
  });
  expect(await f.login(original)).toEqual({ action: "retry" });
  const rotation = f.authorize(original);
  await entered.promise;
  let transitioned = false;
  const transition = f.authorize(changed).then(result => { transitioned = true; return result; });
  try {
    await setImmediate();
    expect(transitioned).toBe(false);
  } finally { release.resolve(); }
  expect((await rotation).headers.get("Authorization")).toBe("Bearer rotated");
  expect((await transition).headers.has("Authorization")).toBe(false);
  expect((await f.authorize(original)).headers.has("Authorization")).toBe(false);
});

it("fails closed on corrupt identity persistence before URL changes or imported-grant fallback", async () => {
  const f = fixture();
  expect(await f.login(original)).toEqual({ action: "retry" });
  const [file] = await f.fs.readdir("/home/test");
  await f.fs.writeFile(`/home/test/${file}`, "corrupted-private-record");
  const extra = { client: { mode: "static" as const, clientId: "imported-client" }, initialGrant: { resource: original,
    tokens: { accessToken: "private-import", tokenType: "Bearer" as const, expiresAt: null } } };
  for (const resource of [original, changed]) await expect(f.authorize(resource, "catalog", extra)).rejects.toThrow();
  expect(await f.fs.readFile(`/home/test/${file}`, "utf8")).toBe("corrupted-private-record");
  expect(f.fetch).toHaveBeenCalledTimes(2);
});

it("does not retire credentials when a changed-URL challenge is canceled waiting for the identity lock", async () => {
  const f = fixture();
  expect(await f.login(original)).toEqual({ action: "retry" });
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const stores = createResourceBoundOAuthStores(f.authStore, undefined, "catalog");
  const holder = stores.sessionStore.withLock!(original, async () => { entered.resolve(); await release.promise; }, { timeoutMs: 1000 });
  await entered.promise;
  const controller = new AbortController(), reason = new Error("cancel changed resource");
  const observed = f.login(changed, "catalog", controller.signal).catch(error => error);
  try {
    await setImmediate();
    controller.abort(reason);
    expect(await observed).toBe(reason);
  } finally { release.resolve(); await holder; }
  expect((await f.authorize(original)).headers.get("Authorization")).toBe("Bearer access-1");
});

it("explicitly resets a corrupt named envelope without reading it and withholds stale environment imports", async () => {
  const f = fixture();
  expect(await f.login(original)).toEqual({ action: "retry" });
  const [file] = await f.fs.readdir("/home/test");
  await f.fs.writeFile(`/home/test/${file}`, "corrupt-private-record");
  await createResourceBoundOAuthStores(f.authStore, undefined, "catalog").reset(original, { timeoutMs: 1000 });
  const extra = { client: { mode: "static" as const, clientId: "registered-client" }, initialGrant: { resource: original,
    tokens: { accessToken: "stale-environment-access", tokenType: "Bearer" as const, expiresAt: null } } };
  expect((await f.authorize(original, "catalog", extra)).headers.has("Authorization")).toBe(false);
  expect(await f.login(original)).toEqual({ action: "retry" });
  expect(f.registrations()).toBe(2);
});

it("recovers an authenticated envelope with invalid session contents without needing its valid old shape", async () => {
  const f = fixture(), stores = createResourceBoundOAuthStores(f.authStore, undefined, "catalog");
  expect(await f.login(original)).toEqual({ action: "retry" });
  await stores.sessionStore.withLock!(original, () => stores.sessionStore.save(original, { resource: original } as import("./types.js").StoredOAuthSession), { timeoutMs: 1000 });
  await expect(stores.sessionStore.load(original)).rejects.toThrow("stored OAuth");
  await stores.reset(original);
  expect(await stores.sessionStore.load(original)).toBeNull();
});

it("refuses explicit reset through a credential symlink", async () => {
  const f = fixture();
  expect(await f.login(original)).toEqual({ action: "retry" });
  const [file] = await f.fs.readdir("/home/test");
  const originalBytes = await f.fs.readFile(`/home/test/${file}`, "utf8");
  await f.fs.rename(`/home/test/${file}`, "/home/test/target.enc");
  await f.fs.symlink("/home/test/target.enc", `/home/test/${file}`);
  await expect(createResourceBoundOAuthStores(f.authStore, undefined, "catalog").reset(original)).rejects.toThrow("symbolic link");
  expect(await f.fs.readFile("/home/test/target.enc", "utf8")).toBe(originalBytes);
});

it.each(["", " ", "😀".repeat(257)])("validates the namespace at the public resource store boundary", namespace => {
  const f = fixture();
  expect(() => createResourceBoundOAuthStores(f.authStore, namespace, "catalog")).toThrow("namespace");
});

it("resets only the selected name/profile and removes its registration along with its grant", async () => {
  const f = fixture();
  expect(await f.login(original)).toEqual({ action: "retry" });
  expect(await f.login(original, "other")).toEqual({ action: "retry" });
  await f.authorize(original, "catalog", { persistenceNamespace: "different-profile" });
  await createResourceBoundOAuthStores(f.authStore, "different-profile", "catalog").reset(original, { timeoutMs: 1000 });
  expect((await f.authorize(original)).headers.get("Authorization")).toBe("Bearer access-1");
  await createResourceBoundOAuthStores(f.authStore, undefined, "catalog").reset(original, { timeoutMs: 1000 });
  expect((await f.authorize(original)).headers.has("Authorization")).toBe(false);
  expect((await f.authorize(original, "other")).headers.get("Authorization")).toBe("Bearer access-2");
  expect(await f.login(original)).toEqual({ action: "retry" });
  expect(f.registrations()).toBe(3);
});

it("does not mutate credentials when reset is canceled while waiting for the stable identity lock", async () => {
  const f = fixture();
  expect(await f.login(original)).toEqual({ action: "retry" });
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const stores = createResourceBoundOAuthStores(f.authStore, undefined, "catalog");
  const holder = stores.sessionStore.withLock!(original, async () => { entered.resolve(); await release.promise; }, { timeoutMs: 1000 });
  await entered.promise;
  const controller = new AbortController(), reason = new Error("cancel explicit reset");
  const reset = stores.reset(changed, { signal: controller.signal, timeoutMs: 1000 }).catch(error => error);
  try {
    await setImmediate(); controller.abort(reason);
    expect(await reset).toBe(reason);
  } finally { release.resolve(); await holder; }
  expect((await f.authorize(original)).headers.get("Authorization")).toBe("Bearer access-1");
});

it.each(["https://user:private-secret@resource.example/mcp", "https://resource.example/mcp#fragment", "https://resource.example/mcp#", "file:///private/record"])("rejects an unsafe reset resource before mutation", async resource => {
  const f = fixture();
  await expect(createResourceBoundOAuthStores(f.authStore, undefined, "catalog").reset(resource, { timeoutMs: 1000 })).rejects.toThrow("resource");
  expect(await f.fs.readdir("/home/test").catch(() => [])).toEqual([]);
});
