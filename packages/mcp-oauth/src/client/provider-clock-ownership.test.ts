import { Volume, createFsFromVolume } from "memfs";
import { expect, it, vi } from "vitest";
import { createDefaultOAuthClientProvider, type DefaultOAuthClientProviderOptions } from "../index.js";
const resource = "https://resource.example/mcp";
function base(): DefaultOAuthClientProviderOptions {
  return { client: { mode: "static", clientId: "original" }, browser: {}, allowInteractive: false, now: () => 1000,
    initialGrant: { resource, tokens: { accessToken: "original-grant", tokenType: "Bearer", expiresAt: 3000 } } };
}
it("retains private native provider clock state and original receiver", async () => {
  class Host {
    #timestamp = 1000;
    client = { mode: "static" as const, clientId: "original" }; browser = {}; allowInteractive = false;
    initialGrant = { resource, tokens: { accessToken: "original-grant", tokenType: "Bearer", expiresAt: 3000 } };
    sessionStore = { load: async () => null, save: async () => {}, clear: async () => {} };
    now() { return this.#timestamp; } update() { this.#timestamp = 4000; }
  }
  const host = new Host(), provider = createDefaultOAuthClientProvider(host), fetch = vi.fn(), headers = new Headers();
  await provider.authorizeRequest!({ requestUrl: new URL(resource), headers, fetch }); expect(headers.get("Authorization")).toBe("Bearer original-grant");
  host.update(); headers.delete("Authorization"); await provider.authorizeRequest!({ requestUrl: new URL(resource), headers, fetch });
  expect(headers.get("Authorization")).toBeNull(); expect(fetch).not.toHaveBeenCalled();
});
it.each(["clock", "grant"] as const)("owns the initial %s before native persistence callbacks", async field => {
  const options = base(), fs = createFsFromVolume(new Volume()).promises;
  options.resourceIdentity = "catalog";
  options.authStore = { backend: "file", fileStore: { fs, salt: "fixture", getHomeDirectory: () => {
    if (field === "clock") options.now = () => 4000;
    else options.initialGrant!.tokens.accessToken = "replacement-grant";
    return "/synthetic";
  } } };
  const provider = createDefaultOAuthClientProvider(options), headers = new Headers(), fetch = vi.fn();
  await provider.authorizeRequest!({ requestUrl: new URL(resource), headers, fetch });
  expect(headers.get("Authorization")).toBe("Bearer original-grant"); expect(fetch).not.toHaveBeenCalled();
});
it("owns native persistence configuration before the initial lifetime clock", async () => {
  const options = base(), fs = createFsFromVolume(new Volume()).promises;
  options.resourceIdentity = "catalog";
  options.authStore = { backend: "file", fileStore: { fs, salt: "fixture", filePath: "/synthetic/auth.enc" } };
  options.initialGrant!.tokens = { accessToken: "original-grant", tokenType: "Bearer", expiresIn: 1 };
  options.now = () => { options.authStore!.fileStore!.filePath = "/replacement/auth.enc"; return 1000; };
  const provider = createDefaultOAuthClientProvider(options), headers = new Headers();
  await provider.authorizeRequest!({ requestUrl: new URL(resource), headers, fetch: vi.fn() });
  expect(headers.get("Authorization")).toBe("Bearer original-grant");
  // Native resource stores lazily read absent records through the selected path.
  // Capture lstat targets rather than creating credential files.
  const stat = vi.spyOn(fs, "lstat");
  await provider.authorizeRequest!({ requestUrl: new URL(resource), headers: new Headers(), fetch: vi.fn() });
  expect(stat).toHaveBeenCalled();
  expect(stat.mock.calls.every(([path]) => !String(path).startsWith("/replacement"))).toBe(true);
});
it("keeps backend selection before a lifetime clock changes the backend environment", async () => {
  const options = base(), fs = createFsFromVolume(new Volume()).promises, env = { SELECT_BACKEND: "file" };
  options.resourceIdentity = "catalog";
  options.authStore = { env, backendEnvVar: "SELECT_BACKEND", fileStore: { fs, salt: "fixture", filePath: "/synthetic/auth.enc" } };
  options.initialGrant!.tokens = { accessToken: "original-grant", tokenType: "Bearer", expiresIn: 1 };
  options.now = () => { env.SELECT_BACKEND = "unsupported"; return 1000; };
  const provider = createDefaultOAuthClientProvider(options), headers = new Headers();
  await provider.authorizeRequest!({ requestUrl: new URL(resource), headers, fetch: vi.fn() });
  expect(headers.get("Authorization")).toBe("Bearer original-grant");
});
it("selects the native clock before copying imported non-timing fields", async () => {
  const options = base();
  options.sessionStore = { load: async () => null, save: async () => {}, clear: async () => {} };
  Object.defineProperty(options.initialGrant!.tokens, "accessToken", { enumerable: true, get() { options.now = () => 4000; return "original-grant"; } });
  const provider = createDefaultOAuthClientProvider(options), headers = new Headers();
  await provider.authorizeRequest!({ requestUrl: new URL(resource), headers, fetch: vi.fn() });
  expect(headers.get("Authorization")).toBe("Bearer original-grant");
});
