import http from "node:http";
import { EventEmitter } from "node:events";
import { Volume, createFsFromVolume } from "memfs";
import { expect, it, vi } from "vitest";
import { bindRemoteMcpConfiguration, initRemoteMcpConfiguration } from "./index.js";

vi.mock("node:crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, scrypt(password: string, salt: string, size: number, done: (error: Error | null, key: Buffer) => void) {
    queueMicrotask(() => done(null, actual.createHash("shake256", { outputLength: size }).update(password).update(salt).digest()));
  } };
});
const resource = "https://resource.example/mcp", issuer = "https://auth.example";
const configuration = initRemoteMcpConfiguration([{ name: "catalog", url: resource, tools: [], auth: {
  type: "oauth", clientMode: "static", env: { clientId: "ID" }
} }]).configuration;
const env = { ID: "original-app", MCP_CATALOG_ACCESS_TOKEN: "original-grant", MCP_CATALOG_EXPIRES_IN: "60" };

class Listener extends EventEmitter {
  listen(_port: number, _host: string, ready: () => void) { queueMicrotask(ready); return this; }
  address() { return { port: 49152, address: "127.0.0.1", family: "IPv4" }; }
  close = vi.fn(() => this);
}

it.each(["opener", "landing page", "hidden landing page"])("captures the selected browser %s before the imported-grant clock runs", async mutation => {
  const listener = new Listener(), replacement = vi.fn(async () => { throw new Error("replacement browser selected"); });
  let page = "", now = 1000, session: import("mcp-oauth").StoredOAuthSession | null = null;
  const original = vi.fn(async (value: string) => {
    const authorization = new URL(value), redirect = new URL(authorization.searchParams.get("redirect_uri")!);
    redirect.searchParams.set("code", "selected-code"); redirect.searchParams.set("state", authorization.searchParams.get("state")!);
    listener.emit("request", { url: `${redirect.pathname}${redirect.search}` }, { writeHead: vi.fn(), end: (html: string) => { page = html; } });
  });
  const browser = { openBrowser: original, createServer: () => listener as unknown as http.Server,
    landingPage: { title: "Original title", body: "Original body" } };
  if (mutation === "hidden landing page") for (const field of ["title", "body"]) Object.defineProperty(browser.landingPage, field, { enumerable: false });
  const [bound] = bindRemoteMcpConfiguration(configuration, { env, oauth: { allowInteractive: true, browser,
    now: () => { if (mutation === "opener") browser.openBrowser = replacement;
      else { browser.landingPage.title = "Replacement title"; browser.landingPage.body = "Replacement body"; } return now; },
    sessionStore: () => ({ load: async () => session, save: async (_key, value) => { session = value; }, clear: async () => { session = null; } }) } });
  now = 100_000;
  const tokens = await bound.oauth!.provider.authenticate!({ requestUrl: new URL(resource),
    fetch: async () => Response.json({ access_token: "consented-grant", token_type: "Bearer", expires_in: 3600 }), discover: async () => ({
      resource, resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer] },
      authorizationServer: issuer, authorizationServerMetadataUrl: `${issuer}/metadata`, authorizationServerMetadata: {
        issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"]
      } }) });
  expect(tokens?.accessToken).toBe("consented-grant"); expect(original).toHaveBeenCalledOnce(); expect(replacement).not.toHaveBeenCalled();
  expect(page).toContain("Original title"); expect(page).toContain("Original body"); expect(page).not.toContain("Replacement");
  expect(listener.close).toHaveBeenCalledOnce();
});

it("captures native persistence paths before the imported-grant clock runs", async () => {
  const fs = createFsFromVolume(new Volume()).promises;
  const authStore = { backend: "file" as const, fileStore: { fs, filePath: "/original/auth.enc", salt: "fixture", getMachineIdentity: () => ({ hostname: "host", username: "user" }) } };
  const [bound] = bindRemoteMcpConfiguration(configuration, { env, oauth: { authStore,
    now: () => { authStore.fileStore.filePath = "/replacement/auth.enc"; return 1000; } } });
  const headers = new Headers();
  await bound.oauth!.provider.authorizeRequest!({ requestUrl: new URL(resource), headers, fetch: vi.fn(async () => { throw new Error("unexpected network"); }) });
  expect(headers.get("Authorization")).toBe("Bearer original-grant");
  expect((await fs.readdir("/original")).some(name => name.endsWith(".enc"))).toBe(true);
  await expect(fs.stat("/replacement")).rejects.toMatchObject({ code: "ENOENT" });
});
