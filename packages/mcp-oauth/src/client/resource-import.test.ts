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
