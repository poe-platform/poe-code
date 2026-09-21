import { Volume, createFsFromVolume } from "memfs";
import { expect, it, vi } from "vitest";
import type { CreateSecretStoreInput } from "auth-store";
import { createAuthStoreSessionStore, createAuthStoreClientStore } from "./auth-store-session-store.js";
import { createResourceBoundOAuthStores } from "./resource-bound-store.js";
import type { StoredOAuthSession } from "./types.js";

// Check declared host dependencies before constructing a backend so no red
// regression can reach ambient filesystem or keychain operations.
const capture = vi.hoisted(() => ({ check: (_input: CreateSecretStoreInput) => {} }));
vi.mock("auth-store", async importOriginal => {
  const original = await importOriginal<typeof import("auth-store")>();
  return { ...original, createSecretStore(input: CreateSecretStoreInput) { capture.check(input); return original.createSecretStore(input); } };
});
const resource = "https://resource.example/mcp", issuer = "https://auth.example";
const session: StoredOAuthSession = { resource, authorizationServer: issuer, client: { clientId: "original" },
  tokens: { accessToken: "005930", tokenType: "Bearer", expiresAt: null }, discovery: {
    resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer] },
    authorizationServerMetadata: { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token` } } };
const routes = ["session", "client", "resource"] as const;
function stores(route: typeof routes[number], options: CreateSecretStoreInput) {
  if (route === "client") return { save: () => createAuthStoreClientStore(options).save(issuer, session.client), load: () => createAuthStoreClientStore(options).load(issuer) };
  if (route === "session") return { save: () => createAuthStoreSessionStore(options).save(resource, session), load: () => createAuthStoreSessionStore(options).load(resource) };
  return { save: () => createResourceBoundOAuthStores(options, undefined, "catalog").sessionStore.save(resource, session),
    load: () => createResourceBoundOAuthStores(options, undefined, "catalog").sessionStore.load(resource) };
}

it.each(routes.flatMap(route => (["backend", "env", "backendEnvVar", "platform"] as const).map(field => ({ route, field }))))(
  "retains hidden backend policy $field through native $route", async ({ route, field }) => {
    const fs = createFsFromVolume(new Volume()).promises;
    const options: CreateSecretStoreInput = { backend: "file", env: { SELECT_BACKEND: "keychain" }, backendEnvVar: "SELECT_BACKEND", platform: "linux",
      fileStore: { fs, filePath: "/synthetic/auth.enc", salt: "fixture" } };
    Object.defineProperty(options, field, { enumerable: false });
    capture.check = input => { expect(input[field]).toEqual(options[field]); expect(input.fileStore?.fs).toBe(fs); };
    await expect(stores(route, options).load()).resolves.toBeNull();
  }
);

it.each(routes.flatMap(route => (["fs", "getMachineIdentity", "getHomeDirectory", "getRandomBytes"] as const).map(field => ({ route, field }))))(
  "retains hidden file dependency $field through native $route", async ({ route, field }) => {
    class Host {
      #home = "/synthetic";
      fs = createFsFromVolume(new Volume()).promises;
      salt = "fixture";
      getHomeDirectory() { return this.#home; }
      getMachineIdentity() { return { hostname: "fixture-host", username: this.#home }; }
      getRandomBytes(size: number) { expect(this.#home).toBe("/synthetic"); return Buffer.alloc(size, 7); }
    }
    const fileStore = new Host();
    for (const method of ["getMachineIdentity", "getHomeDirectory", "getRandomBytes"] as const) {
      Object.defineProperty(fileStore, method, { value: fileStore[method], enumerable: field !== method });
    }
    if (field === "fs") Object.defineProperty(fileStore, field, { enumerable: false });
    const options = { backend: "file" as const, fileStore };
    capture.check = input => { expect(input.fileStore?.fs).toBe(fileStore.fs);
      for (const method of ["getMachineIdentity", "getHomeDirectory", "getRandomBytes"] as const) expect(input.fileStore?.[method]).toBeTypeOf("function"); };
    const selected = stores(route, options); await selected.save();
    await expect(selected.load()).resolves.toEqual(route === "client" ? session.client : session);
    expect(await fileStore.fs.readdir("/synthetic")).not.toHaveLength(0);
  }
);

it.each(routes)("retains private keychain runner and hidden lock dependencies through native %s", async route => {
  class Host {
    #value: string | null = null;
    service = "fixture"; account = "user";
    lock = { fs: createFsFromVolume(new Volume()).promises, directory: "/synthetic/locks" };
    async runCommand(_command: string, args: string[]) {
      if (args[0] === "add-generic-password") this.#value = args.at(-1)!;
      return { stdout: this.#value ?? "", stderr: "", exitCode: this.#value === null ? 44 : 0 };
    }
  }
  const keychainStore = new Host();
  Object.defineProperty(keychainStore.lock, "fs", { enumerable: false });
  Object.defineProperty(keychainStore.lock, "directory", { enumerable: false });
  const options = { backend: "keychain" as const, platform: "darwin" as const, keychainStore };
  capture.check = input => { expect(input.keychainStore?.runCommand).toBeTypeOf("function"); expect(input.keychainStore?.lock?.fs).toBe(keychainStore.lock.fs);
    expect(input.keychainStore?.lock?.directory).toBe("/synthetic/locks"); };
  const selected = stores(route, options); await selected.save();
  await expect(selected.load()).resolves.toEqual(route === "client" ? session.client : session);
});
