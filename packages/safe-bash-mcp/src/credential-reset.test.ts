import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import * as sdk from "./index.js";
import { createResourceBoundOAuthStores, createDefaultOAuthClientProvider } from "mcp-oauth";
vi.mock("node:crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, scrypt(password: string, salt: string, size: number, done: (error: Error | null, key: Buffer) => void) {
    queueMicrotask(() => done(null, actual.createHash("shake256", { outputLength: size }).update(password).update(salt).digest()));
  } };
});
const resource = "https://resource.example/mcp";
const server = sdk.initRemoteMcpConfiguration([{ name: "catalog", url: resource, tools: [], auth: { type: "oauth", clientMode: "static", env: { clientId: "ID" } } }]).configuration.servers[0];
function fixture() {
  const fs = createFsFromVolume(new Volume()).promises;
  const authStore = { backend: "file" as const, fileStore: { fs, filePath: "/home/test/credentials.enc", salt: "fixture",
    getMachineIdentity: () => ({ hostname: "host", username: "user" }) } };
  return { fs, authStore };
}
it("resets a corrupt native identity without reading credential environment references or making requests", async () => {
  const f = fixture(), environmentRead = vi.fn(() => { throw new Error("must not read ID"); });
  const env = {}; Object.defineProperty(env, "ID", { enumerable: true, get: environmentRead });
  await createResourceBoundOAuthStores(f.authStore, undefined, "catalog").reset(resource);
  const [file] = await f.fs.readdir("/home/test");
  await f.fs.writeFile(`/home/test/${file}`, "corrupt-private-record");
  expect(await sdk.resetRemoteMcpAuthentication(server, { binding: { env, oauth: { authStore: f.authStore } } })).toEqual({ name: "catalog", url: resource, reset: true });
  expect(environmentRead).not.toHaveBeenCalled();
  const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "original" }, browser: {}, authStore: f.authStore, resourceIdentity: "catalog",
    initialGrant: { resource, tokens: { accessToken: "stale-access", tokenType: "Bearer", expiresAt: null } } });
  const headers = new Headers(), fetch = vi.fn(async () => Response.json({}));
  await provider.authorizeRequest!({ requestUrl: new URL(resource), headers, fetch });
  expect(headers.has("Authorization")).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});
it("requires an explicit reset hook for host-owned persistence and never assumes clear is safe", async () => {
  const factory = vi.fn(() => ({ load: async () => null, save: async () => {}, clear: async () => {} }));
  await expect(sdk.resetRemoteMcpAuthentication(server, { binding: { oauth: { sessionStore: factory } } })).rejects.toThrow("reset hook");
  expect(factory).not.toHaveBeenCalled();
});
it("passes the validated server and cancellation/lock bounds to the host reset hook", async () => {
  const signal = new AbortController().signal, reset = vi.fn(async () => {});
  expect(await sdk.resetRemoteMcpAuthentication(server, { signal, timeoutMs: 123, binding: { oauth: { reset } } })).toEqual({ name: "catalog", url: resource, reset: true });
  expect(reset).toHaveBeenCalledWith(server, { signal, timeoutMs: 123 });
});
it("preserves host reset failures without quoting credentials", async () => {
  const failure = new Error("host reset failed");
  await expect(sdk.resetRemoteMcpAuthentication(server, { binding: { oauth: { reset: async () => { throw failure; } } } })).rejects.toBe(failure);
});
it("rejects unmanaged credentials instead of claiming to reset a supplied bearer token", async () => {
  const reset = vi.fn(async () => {});
  const [bearer] = sdk.initRemoteMcpConfiguration([{ name: "catalog", url: resource, auth: { type: "bearer", env: "TOKEN" } }]).configuration.servers;
  await expect(sdk.resetRemoteMcpAuthentication(bearer, { binding: { oauth: { reset } } })).rejects.toThrow("OAuth");
  expect(reset).not.toHaveBeenCalled();
});
it.each([0, -1, 1.5, NaN, Infinity, 2_147_483_648])("rejects invalid reset lock bounds before invoking a host hook: %s", async timeoutMs => {
  const reset = vi.fn(async () => {});
  await expect(sdk.resetRemoteMcpAuthentication(server, { timeoutMs, binding: { oauth: { reset } } })).rejects.toThrow("timeoutMs");
  expect(reset).not.toHaveBeenCalled();
});
it("retains an already canceled reset reason before consulting persistence", async () => {
  const reset = vi.fn(async () => {}), controller = new AbortController(), reason = new Error("cancel reset");
  controller.abort(reason);
  await expect(sdk.resetRemoteMcpAuthentication(server, { signal: controller.signal, binding: { oauth: { reset } } })).rejects.toBe(reason);
  expect(reset).not.toHaveBeenCalled();
});
