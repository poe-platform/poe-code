import { setImmediate } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createResourceBoundOAuthStores, createDefaultOAuthClientProvider, type StoredOAuthSession } from "../index.js";
vi.mock("node:crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, scrypt(password: string, salt: string, size: number, done: (error: Error | null, key: Buffer) => void) {
    queueMicrotask(() => done(null, actual.createHash("shake256", { outputLength: size }).update(password).update(salt).digest()));
  } };
});
const resource = "https://resource.example/mcp", issuer = "https://auth.example";
function fixture() {
  const fs = createFsFromVolume(new Volume()).promises;
  const authStore = { backend: "file" as const, fileStore: { fs, filePath: "/home/test/import.enc", salt: "fixture", getMachineIdentity: () => ({ hostname: "host", username: "user" }) } };
  return { fs, authStore, stores: createResourceBoundOAuthStores(authStore, undefined, "catalog") };
}
function grant(): StoredOAuthSession {
  return { resource, authorizationServer: issuer,
    client: { clientId: "original", clientSecret: "private-secret", registration: { client_id: "original", client_secret: "private-secret" }, registrationOwnership: "caller" },
    tokens: { accessToken: "private-access", refreshToken: "private-refresh", tokenType: "Bearer", expiresAt: 3_610_000 },
    discovery: { resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer] },
      authorizationServerMetadata: { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] } } };
}
it("imports the original client and grant atomically for a fresh provider without automatic env replay", async () => {
  const f = fixture(), session = grant();
  await f.stores.importSession(session);
  const reloaded = createResourceBoundOAuthStores(f.authStore, undefined, "catalog");
  expect(await reloaded.sessionStore.load(resource)).toEqual(session);
  expect(await reloaded.clientStore.load(issuer)).toEqual(session.client);
  await reloaded.sessionStore.withLock!(resource, async () => {}, {});
  expect(reloaded.initialGrantAllowed).toBe(false);
  const provider = createDefaultOAuthClientProvider({ client: { mode: "dynamic" }, browser: {}, resourceIdentity: "catalog", authStore: f.authStore, now: () => 10_000 });
  const headers = new Headers(), fetch = vi.fn(async () => Response.json({}));
  await provider.authorizeRequest!({ requestUrl: new URL(resource), headers, fetch });
  expect(headers.get("Authorization")).toBe("Bearer private-access");
  expect(fetch).not.toHaveBeenCalled();
});
it("replaces corrupt native documents without decrypting old credentials", async () => {
  const f = fixture(); await f.stores.reset(resource);
  const [file] = await f.fs.readdir("/home/test"); await f.fs.writeFile(`/home/test/${file}`, "corrupt-private-record");
  await f.stores.importSession(grant());
  expect(await f.stores.sessionStore.load(resource)).toEqual(grant());
});
it("retains concurrent imports for different named servers using one native backing configuration", async () => {
  const f = fixture();
  const imports = Array.from({ length: 12 }, (_, index) => {
    const session = grant();
    session.tokens!.accessToken = `private-access-${index}`;
    session.tokens!.refreshToken = `private-refresh-${index}`;
    return { name: `catalog-${index}`, session };
  });
  await Promise.all(imports.map(({ name, session }) => createResourceBoundOAuthStores(f.authStore, undefined, name).importSession(session)));
  await createResourceBoundOAuthStores(f.authStore, undefined, imports[0].name).reset(resource);
  for (const { name, session } of imports.slice(1)) {
    const reloaded = createResourceBoundOAuthStores(f.authStore, undefined, name);
    expect(await reloaded.sessionStore.load(resource)).toEqual(session);
    expect(await reloaded.clientStore.load(issuer)).toEqual(session.client);
  }
});
it("waits for the stable native lock before replacing client and tokens", async () => {
  const f = fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const owner = f.stores.sessionStore.withLock!(resource, async () => { entered.resolve(); await release.promise; }, {});
  await entered.promise;
  let imported = false;
  const waiting = createResourceBoundOAuthStores(f.authStore, undefined, "catalog").importSession(grant()).then(() => { imported = true; });
  try { await setImmediate(); expect(imported).toBe(false); } finally { release.resolve(); }
  await Promise.all([owner, waiting]);
  expect(await f.stores.sessionStore.load(resource)).toEqual(grant());
});
it("cancels a lock waiter without changing the existing grant", async () => {
  const f = fixture(); await f.stores.importSession(grant());
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const owner = f.stores.sessionStore.withLock!(resource, async () => { entered.resolve(); await release.promise; }, {});
  await entered.promise;
  const controller = new AbortController(), reason = new Error("cancel import");
  const session = grant(); session.tokens!.accessToken = "replacement";
  const waiting = f.stores.importSession(session, { signal: controller.signal });
  controller.abort(reason);
  try { await expect(waiting).rejects.toBe(reason); } finally { release.resolve(); }
  await owner;
  expect(await f.stores.sessionStore.load(resource)).toEqual(grant());
});
it.each(["resource", "issuer", "registration", "missing-tokens"])("rejects contradictory import binding before replacing credentials: %s", async field => {
  const f = fixture(), session = grant();
  if (field === "resource") session.resource = "file:///private";
  if (field === "issuer") session.discovery.authorizationServerMetadata.issuer = "https://another.example";
  if (field === "registration") session.client.registration!.issuer = "https://another.example";
  if (field === "missing-tokens") delete session.tokens;
  await expect(f.stores.importSession(session)).rejects.toThrow("OAuth import");
  expect(await f.stores.sessionStore.load(resource)).toBeNull();
});
it("marks explicitly imported full registrations as caller-owned without requiring a storage marker", async () => {
  const f = fixture(), session = grant(); delete session.client.registrationOwnership;
  await f.stores.importSession(session);
  expect((await f.stores.sessionStore.load(resource))?.client.registrationOwnership).toBe("caller");
  expect((await f.stores.clientStore.load(issuer))?.registrationOwnership).toBe("caller");
});
it("takes an owned snapshot before waiting for a native lock", async () => {
  const f = fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const owner = f.stores.sessionStore.withLock!(resource, async () => { entered.resolve(); await release.promise; }, {});
  await entered.promise;
  const session = grant(), waiting = f.stores.importSession(session);
  session.tokens!.accessToken = "mutated";
  session.client.registration!.client_id = "mutated";
  release.resolve(); await Promise.all([owner, waiting]);
  expect(await f.stores.sessionStore.load(resource)).toEqual(grant());
});
it.each([0, -1, 1.5, Infinity, 2_147_483_648])("rejects unsupported import lock intervals: %s", async timeoutMs => {
  const f = fixture();
  await expect(f.stores.importSession(grant(), { timeoutMs })).rejects.toThrow("timeoutMs");
  expect(await f.stores.sessionStore.load(resource)).toBeNull();
});

it.each(["reset", "import", "transaction"] as const)("retains the original %s signal through native lock callback checks", async kind => {
  const f = fixture(); await f.stores.importSession(grant());
  const entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
  const owner = f.stores.sessionStore.withLock!(resource, async () => { entered.resolve(); await resume.promise; }, {});
  await entered.promise;
  const options = { signal: new AbortController().signal, timeoutMs: 1000 }, operation = vi.fn(async () => "original transaction");
  const run = kind === "reset" ? f.stores.reset(resource, options) : kind === "import" ? f.stores.importSession(grant(), options)
    : f.stores.sessionStore.withLock!(resource, operation, options);
  const observed = run.catch(error => error);
  try {
    await setImmediate();
    options.signal = AbortSignal.abort(new Error("unrelated replacement native cancellation")); resume.resolve();
    expect(await observed).toBe(kind === "transaction" ? "original transaction" : undefined);
    expect(await f.stores.sessionStore.load(resource)).toEqual(kind === "reset" ? null : grant());
    if (kind === "transaction") expect(operation).toHaveBeenCalledOnce();
  } finally { resume.resolve(); await Promise.allSettled([owner, observed]); }
});

it("checks original transaction cancellation after an active identity reconciliation write", async () => {
  const f = fixture(), entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
  const rename = f.fs.rename.bind(f.fs);
  const intercepted = vi.spyOn(f.fs, "rename").mockImplementation(async (...args) => {
    if (String(args[1]).endsWith(".enc")) { entered.resolve(); await resume.promise; }
    return rename(...args);
  });
  const controller = new AbortController(), reason = new Error("cancel active identity reconciliation"), options = { signal: controller.signal, timeoutMs: 1000 };
  const operation = vi.fn(async () => "should not enter canceled transaction");
  const observed = f.stores.sessionStore.withLock!(resource, operation, options).catch(error => error);
  try {
    await entered.promise;
    controller.abort(reason); options.signal = new AbortController().signal; resume.resolve();
    expect(await observed).toBe(reason); expect(operation).not.toHaveBeenCalled();
  } finally { resume.resolve(); await observed; intercepted.mockRestore(); }
});


it.each(["resource", "issuer", "metadata-empty", "metadata-named"])("rejects fragment components at explicit import boundaries: %s", async field => {
  const f = fixture(), session = grant();
  if (field === "resource") session.resource += "#";
  if (field === "issuer") { session.authorizationServer += "#"; session.discovery.authorizationServerMetadata.issuer = session.authorizationServer; }
  if (field === "metadata-empty") session.discovery.resourceMetadata.resource = resource + "#";
  if (field === "metadata-named") session.discovery.resourceMetadata.resource = resource + "#private";
  await expect(f.stores.importSession(session)).rejects.toThrow(new Error("Invalid OAuth import session or resource binding"));
  expect(await f.fs.readdir("/home/test").catch(() => [])).toEqual([]);
});

it("rejects an empty-fragment issuer in a stored client map without rewriting the record", async () => {
  const f = fixture();
  await f.stores.reset(resource);
  await f.stores.clientStore.save(issuer + "#", grant().client);
  const [file] = await f.fs.readdir("/home/test"), before = await f.fs.readFile(`/home/test/${file}`, "utf8");
  const fresh = createResourceBoundOAuthStores(f.authStore, undefined, "catalog");
  await expect(fresh.sessionStore.load(resource)).rejects.toThrow(new Error("Invalid stored OAuth resource client"));
  expect(await f.fs.readFile(`/home/test/${file}`, "utf8")).toBe(before);
});

it("retains escaped hash data through explicit import and reset", async () => {
  const f = fixture(), session = grant(), escapedResource = resource + "/literal%23data?value=%23", escapedIssuer = issuer + "/literal%23data%3Fdata";
  session.resource = escapedResource; session.discovery.resourceMetadata.resource = escapedResource;
  session.authorizationServer = escapedIssuer; session.discovery.authorizationServerMetadata.issuer = escapedIssuer;
  await f.stores.importSession(session);
  const fresh = createResourceBoundOAuthStores(f.authStore, undefined, "catalog");
  expect(await fresh.sessionStore.load(escapedResource)).toEqual(session);
  expect(await fresh.clientStore.load(escapedIssuer)).toEqual(session.client);
  await fresh.reset(escapedResource);
  expect(await fresh.sessionStore.load(escapedResource)).toBeNull();
  expect(await fresh.clientStore.load(escapedIssuer)).toBeNull();
});


it.each(["?", "?private=marker"])("rejects an imported issuer query before replacing credentials: %s", async query => {
  const f = fixture(), session = grant();
  session.authorizationServer += query; session.discovery.authorizationServerMetadata.issuer = session.authorizationServer;
  await expect(f.stores.importSession(session)).rejects.toThrow(new Error("Invalid OAuth import session or resource binding"));
  expect(await f.fs.readdir("/home/test").catch(() => [])).toEqual([]);
});

it.each(["?", "?private=marker"])("rejects a stored client-map issuer query without rewriting it: %s", async query => {
  const f = fixture(); await f.stores.reset(resource); await f.stores.clientStore.save(issuer + query, grant().client);
  const [file] = await f.fs.readdir("/home/test"), before = await f.fs.readFile(`/home/test/${file}`, "utf8");
  await expect(createResourceBoundOAuthStores(f.authStore, undefined, "catalog").sessionStore.load(resource))
    .rejects.toThrow(new Error("Invalid stored OAuth resource client"));
  expect(await f.fs.readFile(`/home/test/${file}`, "utf8")).toBe(before);
});
