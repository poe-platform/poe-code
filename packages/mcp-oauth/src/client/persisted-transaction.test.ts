import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createHash } from "node:crypto";
import { EncryptedFileStore } from "auth-store";
import { createAuthStoreSessionStore, createAuthStoreClientStore } from "./auth-store-session-store.js";
import { createDefaultOAuthClientProvider } from "./default-oauth-client-provider.js";
import type { StoredOAuthSession } from "./types.js";

vi.mock("node:crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, scrypt(password: string, salt: string, size: number, done: (error: Error | null, key: Buffer) => void) {
    queueMicrotask(() => done(null, actual.createHash("shake256", { outputLength: size }).update(password).update(salt).digest()));
  } };
});

it("redeems a rotating refresh token once across independent persisted store/provider instances", async () => {
  const resource = "https://resource.example/mcp", issuer = "https://auth.example";
  const fs = createFsFromVolume(new Volume()).promises;
  const options = { backend: "file" as const, fileStore: { fs, salt: "transaction-fixture", filePath: "/home/test/session.enc",
    getMachineIdentity: () => ({ hostname: "host", username: "user" }) } };
  const initial: StoredOAuthSession = { resource, authorizationServer: issuer, client: { clientId: "client" },
    tokens: { accessToken: "expired", refreshToken: "one-use-refresh", tokenType: "Bearer", expiresAt: 0 },
    discovery: { resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer] }, authorizationServerMetadata: {
      issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"]
    } } };
  await createAuthStoreSessionStore(options).save(resource, initial);
  const entered = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>();
  let redemptions = 0;
  const fetch = vi.fn(async () => {
    if (++redemptions > 1) throw new Error("refresh replay");
    entered.resolve(); await finish.promise;
    return Response.json({ access_token: "winner", refresh_token: "winner-refresh", token_type: "Bearer", expires_in: 3600 });
  });
  const authorize = async () => {
    const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "client" }, browser: {}, allowInteractive: false, authStore: options, now: () => 1000 });
    const headers = new Headers(); await provider.authorizeRequest!({ requestUrl: new URL(resource), headers, fetch }); return headers.get("Authorization");
  };
  const first = authorize();
  await entered.promise;
  const second = authorize();
  finish.resolve();
  expect(await Promise.all([first, second])).toEqual(["Bearer winner", "Bearer winner"]);
  expect(fetch).toHaveBeenCalledOnce();
  expect((await createAuthStoreSessionStore(options).load(resource))?.tokens?.refreshToken).toBe("winner-refresh");
});

it("retains refresh intent across a fresh persisted store/provider after a lost response", async () => {
  const resource = "https://resource.example/mcp", issuer = "https://auth.example";
  const fs = createFsFromVolume(new Volume()).promises;
  const options = { backend: "file" as const, fileStore: { fs, salt: "pending-fixture", filePath: "/home/test/session.enc",
    getMachineIdentity: () => ({ hostname: "host", username: "user" }) } };
  const initial: StoredOAuthSession = { resource, authorizationServer: issuer, client: { clientId: "client" },
    tokens: { accessToken: "expired", refreshToken: "one-use-refresh", tokenType: "Bearer", expiresAt: 0 },
    discovery: { resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer] }, authorizationServerMetadata: {
      issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"]
    } } };
  await createAuthStoreSessionStore(options).save(resource, initial);
  const fetch = vi.fn(async () => { throw new Error("lost token response"); });
  const authorize = async () => {
    const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "client" }, browser: {}, allowInteractive: false,
      initialGrant: { resource, tokens: initial.tokens! }, authStore: options });
    await provider.authorizeRequest!({ requestUrl: new URL(resource), headers: new Headers(), fetch });
  };
  await expect(authorize()).rejects.toThrow("lost token response");
  const persisted = await createAuthStoreSessionStore(options).load(resource);
  expect(persisted).toMatchObject({ refreshState: "pending", client: initial.client });
  expect(persisted?.tokens).toBeUndefined();
  await expect(authorize()).rejects.toThrow("refresh outcome");
  expect(fetch).toHaveBeenCalledOnce();
});

it("never revives an initial grant when the existing encrypted session is corrupt", async () => {
  const resource = "https://resource.example/mcp", issuer = "https://auth.example";
  const fs = createFsFromVolume(new Volume()).promises;
  const options = { backend: "file" as const, fileStore: { fs, salt: "corrupt-fixture", filePath: "/home/test/session.enc",
    throwOnInvalidDocument: false, getMachineIdentity: () => ({ hostname: "host", username: "user" }) } };
  const pending: StoredOAuthSession = { resource, authorizationServer: issuer, client: { clientId: "client" }, refreshState: "pending",
    discovery: { resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer] }, authorizationServerMetadata: {
      issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"]
    } } };
  await createAuthStoreSessionStore(options).save(resource, pending);
  const name = (await fs.readdir("/home/test")).find(name => name.endsWith(".enc"))!;
  await fs.writeFile(`/home/test/${name}`, "private-corrupt-record");
  const fetch = vi.fn(async () => Response.json({ access_token: "bad", token_type: "Bearer" }));
  const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "client" }, browser: {}, allowInteractive: false, authStore: options,
    initialGrant: { resource, tokens: { accessToken: "fresh-but-consumed-family", refreshToken: "consumed", tokenType: "Bearer", expiresAt: null } } });
  await expect(provider.authorizeRequest!({ requestUrl: new URL(resource), headers: new Headers(), fetch })).rejects.toThrow("Invalid encrypted credential document");
  expect(fetch).not.toHaveBeenCalled();
  expect(await fs.readFile(`/home/test/${name}`, "utf8")).toBe("private-corrupt-record");
});

it.each(["session", "client"] as const)("omits decrypted %s contents from invalid JSON diagnostics", async kind => {
  const key = "https://resource.example/mcp", fs = createFsFromVolume(new Volume()).promises;
  const options = { backend: "file" as const, fileStore: { fs, salt: "private-json-fixture", filePath: "/home/test/private.enc",
    getMachineIdentity: () => ({ hostname: "host", username: "user" }) } };
  const hash = createHash("sha256").update(key).digest("hex");
  await new EncryptedFileStore({ ...options.fileStore, filePath: `/home/test/private-${hash}.enc` }).set("private-secret-invalid-json");
  const store = kind === "session" ? createAuthStoreSessionStore(options) : createAuthStoreClientStore(options);
  const error = await store.load(key).catch(error => error);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toContain("Stored OAuth");
  expect(error.message).not.toContain("private");
});
