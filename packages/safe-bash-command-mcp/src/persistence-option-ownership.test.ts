import { Volume, createFsFromVolume } from "memfs";
import { expect, it, vi } from "vitest";
import type { CreateSecretStoreInput } from "auth-store";
import { bindRemoteMcpConfiguration, authenticateRemoteMcpServer, resetRemoteMcpAuthentication, initRemoteMcpConfiguration } from "./index.js";

const capture = vi.hoisted(() => ({ check: (_input: CreateSecretStoreInput) => {} }));
vi.mock("auth-store", async importOriginal => {
  const original = await importOriginal<typeof import("auth-store")>();
  return { ...original, createSecretStore(input: CreateSecretStoreInput) { capture.check(input); return original.createSecretStore(input); } };
});
const entry = { name: "catalog", url: "https://resource.example/mcp", tools: [], auth: { type: "oauth" as const, clientMode: "static" as const, env: { clientId: "APP_ID" } } };
const configuration = initRemoteMcpConfiguration([entry]).configuration;
it.each(["binding", "auth", "reset"] as const)("retains declared hidden persistence dependencies through facade %s", async route => {
  class Host {
    #home = "/synthetic";
    fs = createFsFromVolume(new Volume()).promises;
    salt = "fixture";
    getHomeDirectory() { return this.#home; }
    getMachineIdentity() { return { hostname: "fixture-host", username: this.#home }; }
  }
  const fileStore = new Host(); Object.defineProperty(fileStore, "fs", { enumerable: false });
  const authStore = { backend: "file" as const, platform: "linux" as const, env: {}, fileStore };
  Object.defineProperty(authStore, "platform", { enumerable: false });
  Object.defineProperty(authStore, "env", { enumerable: false });
  capture.check = input => { expect(input.platform).toBe("linux"); expect(input.env).toBe(authStore.env); expect(input.fileStore?.fs === fileStore.fs).toBe(true);
    expect(input.fileStore?.getHomeDirectory).toBeTypeOf("function"); expect(input.fileStore?.getMachineIdentity).toBeTypeOf("function"); };
  const binding = { env: { APP_ID: "original" }, oauth: { authStore } };
  if (route === "reset") { await expect(resetRemoteMcpAuthentication(configuration.servers[0], { binding })).resolves.toEqual({ name: "catalog", url: entry.url, reset: true }); }
  else if (route === "binding") { const [bound] = bindRemoteMcpConfiguration(configuration, binding); const headers = new Headers();
    await bound.oauth!.provider.authorizeRequest!({ requestUrl: new URL(entry.url), headers, fetch: vi.fn() }); expect(headers.get("Authorization")).toBeNull(); }
  else { const fetch = vi.fn(async () => { throw new Error("fixture stops before transport"); });
    await expect(authenticateRemoteMcpServer(configuration.servers[0], { binding, fetch })).rejects.toThrow("fixture stops before transport"); expect(fetch).toHaveBeenCalled(); }
});
