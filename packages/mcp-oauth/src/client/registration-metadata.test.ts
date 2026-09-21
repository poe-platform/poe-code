import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createDefaultOAuthClientProvider } from "./default-oauth-client-provider.js";
import { createAuthStoreClientStore } from "./auth-store-session-store.js";
import { parseOAuthClientRegistration } from "./client-registration.js";
import type { DefaultOAuthClientProviderOptions, StoredOAuthSession } from "./types.js";

vi.mock("node:crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, scrypt(password: string, salt: string, size: number, done: (error: Error | null, key: Buffer) => void) {
    queueMicrotask(() => done(null, actual.createHash("shake256", { outputLength: size }).update(password).update(salt).digest()));
  } };
});
vi.mock("./loopback-authorization.js", async importOriginal => ({
  ...await importOriginal<typeof import("./loopback-authorization.js")>(),
  createLoopbackAuthorizationSession: async () => ({ redirectUri: "http://127.0.0.1:49152/callback", waitForCode: async () => "code", close: vi.fn() })
}));
const resource = "https://resource.example/mcp", issuer = "https://auth.example";
const registration = { client_id: "registered", client_secret: "private-client-secret", redirect_uris: ["http://localhost/callback"],
  grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], contacts: ["owner@example.test"],
  client_id_issued_at: 1000, client_secret_expires_at: 0, token_endpoint_auth_method: "client_secret_post",
  provider_metadata: { tenant: "one", enabled: true } };
function fixture(client: DefaultOAuthClientProviderOptions["client"] = { mode: "dynamic" }) {
  let session: StoredOAuthSession | null = null;
  const fetch = vi.fn(async (url: string | URL, _init?: RequestInit) => Response.json(String(url).endsWith("/register")
    ? registration : { access_token: "access", refresh_token: "refresh", token_type: "Bearer" }));
  const provider = createDefaultOAuthClientProvider({ client, browser: {},
    sessionStore: { load: async () => session, save: async (_key, value) => { session = value; }, clear: async () => {} } });
  return { fetch, session: () => session, run: () => provider.handleUnauthorized({ requestUrl: new URL(resource), response: new Response(null, { status: 401 }), challenge: null,
    discovery: { resource, resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer] },
      authorizationServer: issuer, authorizationServerMetadataUrl: `${issuer}/metadata`, authorizationServerMetadata: {
        issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, registration_endpoint: `${issuer}/register`,
        response_types_supported: ["code"], code_challenge_methods_supported: ["S256"]
      } }, fetch }) };
}

it("preserves complete DCR response arrays, timestamps and provider metadata in the authorized session", async () => {
  const f = fixture();
  expect(await f.run()).toEqual({ action: "retry" });
  expect(f.session()?.client).toMatchObject({ clientId: "registered", clientSecret: "private-client-secret", registration });
});

it("preserves complete registration through the native client store", async () => {
  const fs = createFsFromVolume(new Volume()).promises;
  const store = createAuthStoreClientStore({ backend: "file", fileStore: { fs, filePath: "/home/test/clients.enc", salt: "fixture",
    getMachineIdentity: () => ({ hostname: "host", username: "user" }) } });
  const client = { clientId: "registered", clientSecret: "private-client-secret", registration };
  await store.save(issuer, client);
  expect(await store.load(issuer)).toEqual(client);
});

it("uses an owned imported registration without registering another client", async () => {
  const supplied = structuredClone(registration);
  const f = fixture({ mode: "dynamic", registration: supplied } as DefaultOAuthClientProviderOptions["client"]);
  supplied.client_id = "mutated"; supplied.redirect_uris.push("http://localhost/other");
  expect(await f.run()).toEqual({ action: "retry" });
  expect(f.fetch).toHaveBeenCalledOnce();
  const body = new URLSearchParams(String(f.fetch.mock.calls[0]?.[1]?.body));
  expect(body.get("client_id")).toBe("registered");
  expect(body.get("client_secret")).toBe("private-client-secret");
  expect(f.session()?.client).toMatchObject({ registration });
});

it.each([
  { redirect_uris: "callback" }, { grant_types: ["code", 7] }, { client_id_issued_at: "today" },
  { client_secret_expires_at: -1 }, { contacts: [false] }, { client_id: "" }
])("rejects malformed imported registration before side effects: %j", invalid => {
  expect(() => fixture({ mode: "dynamic", registration: { ...registration, ...invalid } } as DefaultOAuthClientProviderOptions["client"])).toThrow("OAuth client registration");
});

it("rejects conflicting configured and imported client identities", () => {
  expect(() => fixture({ mode: "static", clientId: "another", registration } as DefaultOAuthClientProviderOptions["client"])).toThrow("OAuth client registration");
});

it("preserves optional null metadata and embedded JWKs in full registration imports", () => {
  const supplied = { ...registration, client_name: null, redirect_uris: null, client_id_issued_at: null,
    jwks: { keys: [] }, provider_metadata: { tenant: "one", optional: null } };
  expect(parseOAuthClientRegistration(supplied)).toEqual(supplied);
});

it("does not use another cached client's grant when importing a full registration", async () => {
  const fetch = vi.fn(async () => Response.json({}));
  const provider = createDefaultOAuthClientProvider({ client: { mode: "dynamic", registration }, browser: {},
    sessionStore: { load: async () => ({ resource, authorizationServer: issuer, client: { clientId: "other" },
      tokens: { accessToken: "other-private-access", tokenType: "Bearer", expiresAt: null },
      discovery: { resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer] },
        authorizationServerMetadata: { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
          response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] } } }), save: async () => {}, clear: async () => {} } });
  const headers = new Headers();
  await expect(provider.authorizeRequest!({ requestUrl: new URL(resource), headers, fetch })).rejects.toThrow("different OAuth client");
  expect(headers.has("Authorization")).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  { extension: undefined }, { extension: Infinity }, { extension: () => "secret" },
  { extension: new Date(0) }, { extension: "😀".repeat(16_384) }
])("rejects non-JSON or oversized registration extensions: %#", invalid => {
  expect(() => parseOAuthClientRegistration({ ...registration, ...invalid })).toThrow("OAuth client registration");
});

it("bounds cyclic and deeply nested provider metadata without leaking input", () => {
  const cyclic: Record<string, unknown> = { marker: "private-marker" }; cyclic.self = cyclic;
  let nested: unknown = "private-marker";
  for (let depth = 0; depth < 70; depth++) nested = { nested };
  for (const extension of [cyclic, nested]) {
    expect(() => parseOAuthClientRegistration({ ...registration, extension })).toThrow("OAuth client registration");
  }
});

it("does not invoke accessors or expose their errors while copying imported metadata", () => {
  const getter = vi.fn(() => { throw new Error("private-marker"); });
  const supplied = { ...registration };
  Object.defineProperty(supplied, "extension", { enumerable: true, get: getter });
  expect(() => parseOAuthClientRegistration(supplied)).toThrow("OAuth client registration");
  expect(getter).not.toHaveBeenCalled();
});
