import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { bindRemoteMcpConfiguration, initRemoteMcpConfiguration } from "./index.js";
vi.mock("node:crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, scrypt(password: string, salt: string, size: number, done: (error: Error | null, key: Buffer) => void) {
    queueMicrotask(() => done(null, actual.createHash("shake256", { outputLength: size }).update(password).update(salt).digest()));
  } };
});
vi.mock("../../mcp-oauth/src/client/loopback-authorization.js", async importOriginal => ({
  ...await importOriginal<typeof import("../../mcp-oauth/src/client/loopback-authorization.js")>(),
  createLoopbackAuthorizationSession: async () => ({ redirectUri: "http://127.0.0.1:49152/callback", waitForCode: async () => "code", close: vi.fn() }) }));
const original = "https://resource.example/mcp", changed = "https://other.example/mcp", issuer = "https://auth.example";
it("gives native declarative servers durable independent named URL trust histories", async () => {
  const fs = createFsFromVolume(new Volume()).promises;
  const authStore = { backend: "file" as const, fileStore: { fs, filePath: "/home/test/binding.enc", salt: "fixture", getMachineIdentity: () => ({ hostname: "host", username: "user" }) } };
  const bind = (url: string, name = "catalog") => bindRemoteMcpConfiguration(initRemoteMcpConfiguration([{ name, url, tools: [], auth: { type: "oauth", clientMode: "dynamic" } }]).configuration,
    { env: {}, oauth: { authStore, allowInteractive: true, now: () => 1000 } })[0].oauth!.provider;
  const fetch = vi.fn(async (url: string | URL) => Response.json(String(url).endsWith("/register")
    ? { client_id: "original", redirect_uris: ["http://localhost/callback"] } : { access_token: "private-access", token_type: "Bearer", expires_in: 3600 }));
  expect(await bind(original).handleUnauthorized({ requestUrl: new URL(original), response: new Response(null, { status: 401 }), challenge: null,
    discovery: { resource: original, resourceMetadataUrl: `${original}/metadata`, resourceMetadata: { resource: original, authorization_servers: [issuer] },
      authorizationServer: issuer, authorizationServerMetadataUrl: `${issuer}/metadata`, authorizationServerMetadata: {
        issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, registration_endpoint: `${issuer}/register`,
        response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] } }, fetch })).toEqual({ action: "retry" });
  const authorization = async (url: string, name = "catalog") => {
    const headers = new Headers(); await bind(url, name).authorizeRequest!({ requestUrl: new URL(url), headers, fetch }); return headers.get("Authorization");
  };
  expect(await authorization(original)).toBe("Bearer private-access");
  expect(await authorization(original, "independent")).toBeNull();
  expect(await authorization(changed)).toBeNull();
  expect(await authorization(original)).toBeNull();
});
