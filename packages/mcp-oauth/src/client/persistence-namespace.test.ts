import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createAuthStoreClientStore, createAuthStoreSessionStore } from "./auth-store-session-store.js";
import { createDefaultOAuthClientProvider } from "./default-oauth-client-provider.js";
import type { StoredOAuthSession } from "./types.js";

vi.mock("node:crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, scrypt(password: string, salt: string, size: number, done: (error: Error | null, key: Buffer) => void) {
    queueMicrotask(() => done(null, actual.createHash("shake256", { outputLength: size }).update(password).update(salt).digest()));
  } };
});
const resource = "https://resource.example/mcp", issuer = "https://auth.example";
const session: StoredOAuthSession = { resource, authorizationServer: issuer, client: { clientId: "app-a" }, refreshState: "pending",
  discovery: { resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer] }, authorizationServerMetadata: {
    issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"]
  } } };
function fixture() {
  const fs = createFsFromVolume(new Volume()).promises;
  return { fs, options: { backend: "file" as const, fileStore: { fs, salt: "namespace-fixture", filePath: "/home/test/session.enc",
    getMachineIdentity: () => ({ hostname: "host", username: "user" }) } } };
}

it("isolates session records and initial-import tombstones across named profiles for the same resource", async () => {
  const f = fixture();
  await createAuthStoreSessionStore(f.options, "profile-a").save(resource, session);
  expect(await createAuthStoreSessionStore(f.options, "profile-b").load(resource)).toBeNull();
  expect(await createAuthStoreSessionStore(f.options).load(resource)).toBeNull();
  expect(await createAuthStoreSessionStore(f.options, "profile-a").load("HTTPS://RESOURCE.EXAMPLE:443/mcp")).toEqual(session);
  expect(await f.fs.readdir("/home/test")).toHaveLength(1);
  expect((await f.fs.readdir("/home/test")).join(" ")).not.toContain("profile-a");
});

it("isolates stored dynamic clients across profiles sharing an issuer", async () => {
  const f = fixture();
  await createAuthStoreClientStore(f.options, "profile-a").save(issuer, { clientId: "a", clientSecret: "private-a" });
  await createAuthStoreClientStore(f.options, "profile-b").save(issuer, { clientId: "b", clientSecret: "private-b" });
  expect(await createAuthStoreClientStore(f.options, "profile-a").load(issuer)).toEqual({ clientId: "a", clientSecret: "private-a" });
  expect(await createAuthStoreClientStore(f.options, "profile-b").load(issuer)).toEqual({ clientId: "b", clientSecret: "private-b" });
  await createAuthStoreClientStore(f.options, "profile-a").clear(issuer);
  expect(await createAuthStoreClientStore(f.options, "profile-b").load(issuer)).toEqual({ clientId: "b", clientSecret: "private-b" });
});

it.each(["path", "salt", "replacement"])("captures session persistence %s before caller configuration changes", async mutation => {
  const f = fixture(), original = { ...f.options, fileStore: { ...f.options.fileStore } };
  const store = createAuthStoreSessionStore(f.options, "profile-a");
  if (mutation === "path") f.options.fileStore.filePath = "/home/other/session.enc";
  else if (mutation === "salt") f.options.fileStore.salt = "other-salt";
  else f.options.fileStore = { ...f.options.fileStore, filePath: "/home/other/session.enc", salt: "other-salt" };
  await store.save(resource, session);
  expect(await createAuthStoreSessionStore(original, "profile-a").load(resource)).toEqual(session);
  expect(await store.load(resource)).toEqual(session);
  await store.clear(resource);
  expect(await createAuthStoreSessionStore(original, "profile-a").load(resource)).toBeNull();
});

it("captures issuer-client persistence before caller configuration changes", async () => {
  const f = fixture(), original = { ...f.options, fileStore: { ...f.options.fileStore } };
  const store = createAuthStoreClientStore(f.options, "profile-a");
  f.options.fileStore.filePath = "/home/other/client.enc";
  const client = { clientId: "original-app", clientSecret: "original-private-secret" };
  await store.save(issuer, client);
  expect(await createAuthStoreClientStore(original, "profile-a").load(issuer)).toEqual(client);
  expect(await store.load(issuer)).toEqual(client);
  await store.clear(issuer);
  expect(await createAuthStoreClientStore(original, "profile-a").load(issuer)).toBeNull();
});

it("keeps transaction writes on the originally locked credential record", async () => {
  const f = fixture(), original = { ...f.options, fileStore: { ...f.options.fileStore } };
  const store = createAuthStoreSessionStore(f.options, "profile-a");
  await store.withLock!(resource, async () => {
    f.options.fileStore.filePath = "/home/other/session.enc";
    await expect(createAuthStoreSessionStore(original, "profile-a").withLock!(resource, async () => "bypassed", { timeoutMs: 0 })).rejects.toThrow("lock");
    await store.save(resource, session);
    expect(await createAuthStoreSessionStore(original, "profile-a").load(resource)).toEqual(session);
    expect(await f.fs.readdir("/home/test")).toHaveLength(2);
  }, { timeoutMs: 1000 });
  const names = await f.fs.readdir("/home/test");
  expect(names.filter(name => name.endsWith(".enc"))).toHaveLength(1);
  expect(await f.fs.readdir(`/home/test/${names.find(name => name.endsWith(".lock"))}`)).toEqual([]);
});

it("retains the original host filesystem dependency after option-handle replacement", async () => {
  const f = fixture(), original = { ...f.options, fileStore: { ...f.options.fileStore } };
  const store = createAuthStoreSessionStore(f.options, "profile-a");
  f.options.fileStore.fs = createFsFromVolume(new Volume()).promises;
  await store.save(resource, session);
  expect(await createAuthStoreSessionStore(original, "profile-a").load(resource)).toEqual(session);
});

it("uses the provider's namespace consistently while preserving another profile's pending refresh", async () => {
  const f = fixture();
  await createAuthStoreSessionStore(f.options, "profile-a").save(resource, session);
  const fetch = vi.fn(async () => Response.json({ access_token: "bad", token_type: "Bearer" }));
  const provider = (namespace: string, clientId: string) => createDefaultOAuthClientProvider({ client: { mode: "static", clientId }, browser: {}, allowInteractive: false,
    authStore: f.options, persistenceNamespace: namespace, initialGrant: { resource, tokens: { accessToken: `${clientId}-grant`, tokenType: "Bearer", expiresAt: null } } });
  const headers = new Headers();
  await provider("profile-b", "app-b").authorizeRequest!({ requestUrl: new URL(resource), headers, fetch });
  expect(headers.get("Authorization")).toBe("Bearer app-b-grant");
  await expect(provider("profile-a", "app-a").authorizeRequest!({ requestUrl: new URL(resource), headers: new Headers(), fetch })).rejects.toThrow("refresh outcome");
  expect(await createAuthStoreSessionStore(f.options, "profile-a").load(resource)).toEqual(session);
  expect(fetch).not.toHaveBeenCalled();
});

it("locks the namespaced backing identity without blocking another profile", async () => {
  const f = fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const a = createAuthStoreSessionStore(f.options, "profile-a"), b = createAuthStoreSessionStore(f.options, "profile-b");
  const owner = a.withLock!(resource, async () => { entered.resolve(); await release.promise; }, { timeoutMs: 1000 });
  await entered.promise;
  try {
    expect(await b.withLock!(resource, async () => "independent", { timeoutMs: 0 })).toBe("independent");
    await expect(createAuthStoreSessionStore(f.options, "profile-a").withLock!(resource, async () => "bypassed", { timeoutMs: 0 })).rejects.toThrow("lock");
  } finally { release.resolve(); await owner; }
});

it("uses distinct Keychain accounts for profiles sharing the configured service/account", async () => {
  const values = new Map<string, string>();
  const runCommand = vi.fn(async (_command: string, args: string[]) => {
    const account = args[args.indexOf("-a") + 1];
    if (args[0] === "add-generic-password") { values.set(account, args[args.indexOf("-w") + 1]); return { stdout: "", stderr: "", exitCode: 0 }; }
    return { stdout: values.get(account) ?? "", stderr: "", exitCode: values.has(account) ? 0 : 44 };
  });
  const options = { backend: "keychain" as const, platform: "darwin" as const, keychainStore: { service: "shared", account: "base", runCommand } };
  await createAuthStoreSessionStore(options, "profile-a").save(resource, session);
  expect(await createAuthStoreSessionStore(options, "profile-b").load(resource)).toBeNull();
  expect(await createAuthStoreSessionStore(options, "profile-a").load(resource)).toEqual(session);
  const accounts = new Set(runCommand.mock.calls.map(([, args]) => args[args.indexOf("-a") + 1]));
  expect(accounts.size).toBe(2);
  expect([...accounts].join(" ")).not.toContain("profile-");
});

it("captures Keychain identity, lock location and command dependency at creation", async () => {
  const values = new Map<string, string>(), fs = createFsFromVolume(new Volume()).promises;
  const runCommand = vi.fn(async (_command: string, args: string[]) => {
    const key = JSON.stringify([args[args.indexOf("-s") + 1], args[args.indexOf("-a") + 1]]);
    if (args[0] === "add-generic-password") { values.set(key, args[args.indexOf("-w") + 1]); return { stdout: "", stderr: "", exitCode: 0 }; }
    return { stdout: values.get(key) ?? "", stderr: "", exitCode: values.has(key) ? 0 : 44 };
  });
  const options = { backend: "keychain" as const, platform: "darwin" as const,
    keychainStore: { service: "original-service", account: "original-account", runCommand, lock: { fs, directory: "/locks/original" } } };
  const original = { ...options, keychainStore: { ...options.keychainStore, lock: { ...options.keychainStore.lock } } };
  const store = createAuthStoreSessionStore(options, "profile-a");
  options.keychainStore.service = "replacement-service";
  options.keychainStore.account = "replacement-account";
  options.keychainStore.lock.directory = "/locks/replacement";
  options.keychainStore.runCommand = vi.fn(async () => { throw new Error("replacement command invoked"); });
  await store.withLock!(resource, async () => {
    expect(await fs.readdir("/locks/original")).toHaveLength(1);
    await store.save(resource, session);
  }, { timeoutMs: 1000 });
  expect(await createAuthStoreSessionStore(original, "profile-a").load(resource)).toEqual(session);
  expect([...values.keys()][0]).toContain("original-service");
  expect([...values.keys()][0]).toContain("original-account:");
});

it.each(["", "   ", "a".repeat(1025), "😀".repeat(257), 42])("rejects invalid namespaces before storing credentials: %s", namespace => {
  const f = fixture();
  expect(() => createAuthStoreSessionStore(f.options, namespace as string)).toThrow("namespace");
  expect(() => createAuthStoreClientStore(f.options, namespace as string)).toThrow("namespace");
  expect(() => createDefaultOAuthClientProvider({ client: { mode: "dynamic" }, browser: {}, persistenceNamespace: namespace as string,
    sessionStore: { load: async () => null, save: async () => {}, clear: async () => {} } })).toThrow("namespace");
});
