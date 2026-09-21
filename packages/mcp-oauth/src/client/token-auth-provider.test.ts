import { expect, it, vi } from "vitest";
import { createDefaultOAuthClientProvider } from "./default-oauth-client-provider.js";
import type { DefaultOAuthClientProviderOptions, StoredOAuthSession, OAuthDiscoveryResult } from "./types.js";

vi.mock("./loopback-authorization.js", async importOriginal => ({
  ...await importOriginal<typeof import("./loopback-authorization.js")>(),
  createLoopbackAuthorizationSession: async () => ({ redirectUri: "http://127.0.0.1:49152/callback", waitForCode: async () => "code", close: vi.fn() })
}));
const resource = "https://resource.example/mcp", issuer = "https://auth.example";
const discovery: OAuthDiscoveryResult = { resource, resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer] },
  authorizationServer: issuer, authorizationServerMetadataUrl: `${issuer}/metadata`, authorizationServerMetadata: {
    issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, registration_endpoint: `${issuer}/register`,
    response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] } };
function fixture(client: DefaultOAuthClientProviderOptions["client"]) {
  let session: StoredOAuthSession | null = null;
  const fetch = vi.fn(async (url: string | URL, _init?: RequestInit) => Response.json(String(url).endsWith("/register")
    ? { client_id: "client", client_secret: "private-secret", token_endpoint_auth_method: "client_secret_basic" }
    : { access_token: "access", refresh_token: "refresh", token_type: "Bearer" }));
  const provider = createDefaultOAuthClientProvider({ client, browser: {}, sessionStore: {
    load: async () => session, save: async (_key, value) => { session = value; }, clear: async () => {} } });
  return { fetch, session: () => session, run: (selected = discovery) => provider.handleUnauthorized({ requestUrl: new URL(resource), response: new Response(null, { status: 401 }),
    challenge: null, discovery: selected, fetch }), authorize: () => provider.authorizeRequest!({ requestUrl: new URL(resource), headers: new Headers(), fetch }) };
}
it.each([true, false])("preserves an explicit URL client ID through exchange and refresh (metadata support: %s)", async supported => {
  const clientId = "https://client.example/oauth/metadata.json?application=agent%2Bone";
  const f = fixture({ mode: "static", clientId, tokenEndpointAuthMethod: "none" });
  expect(await f.run({ ...discovery, authorizationServerMetadata: {
    ...discovery.authorizationServerMetadata, client_id_metadata_document_supported: supported
  } })).toEqual({ action: "retry" });
  expect(f.session()!.client.clientId).toBe(clientId);
  f.session()!.tokens!.expiresAt = 0;
  await f.authorize();
  expect(f.fetch).toHaveBeenCalledTimes(2);
  for (const [url, init] of f.fetch.mock.calls) {
    expect(String(url)).toBe(`${issuer}/token`);
    expect(new URLSearchParams(String(init?.body)).get("client_id")).toBe(clientId);
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
  }
});
it.each(["client_secret_basic", "client_secret_post"] as const)("uses configured %s during code exchange and persisted silent refresh", async tokenEndpointAuthMethod => {
  const f = fixture({ mode: "static", clientId: "client", clientSecret: "private-secret", tokenEndpointAuthMethod });
  expect(await f.run()).toEqual({ action: "retry" });
  f.session()!.tokens!.expiresAt = 0;
  await f.authorize();
  expect(f.fetch).toHaveBeenCalledTimes(2);
  for (const [url, init] of f.fetch.mock.calls) {
    expect(String(url)).toBe(`${issuer}/token`);
    const body = new URLSearchParams(String(init?.body));
    if (tokenEndpointAuthMethod === "client_secret_basic") {
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Basic ${Buffer.from("client:private-secret").toString("base64")}`);
      expect(body.has("client_id")).toBe(false);
      expect(body.has("client_secret")).toBe(false);
    } else {
      expect(new Headers(init?.headers).has("Authorization")).toBe(false);
      expect(body.get("client_id")).toBe("client");
      expect(body.get("client_secret")).toBe("private-secret");
    }
  }
});
it("refuses cached grants with a different explicitly selected authentication method", async () => {
  const f = fixture({ mode: "static", clientId: "client", clientSecret: "private-secret", tokenEndpointAuthMethod: "client_secret_basic" });
  expect(await f.run()).toEqual({ action: "retry" });
  f.session()!.client.tokenEndpointAuthMethod = "client_secret_post";
  await expect(f.authorize()).rejects.toThrow("requested OAuth token endpoint authentication");
  expect(f.fetch).toHaveBeenCalledOnce();
});

it.each(["none", ["none", 7], [], Array.from({ length: 129 }, () => "none")])("rejects invalid or unusable auth-method discovery metadata: %#", async supported => {
  const f = fixture({ mode: "dynamic" });
  expect(await f.run({ ...discovery, authorizationServerMetadata: { ...discovery.authorizationServerMetadata, token_endpoint_auth_methods_supported: supported } }))
    .toMatchObject({ action: "fail", error: { message: expect.stringContaining("OAuth token endpoint authentication") } });
  expect(f.fetch).not.toHaveBeenCalled();
});
it("uses the method returned by a fresh dynamic registration", async () => {
  const f = fixture({ mode: "dynamic" });
  expect(await f.run()).toEqual({ action: "retry" });
  expect(new Headers(f.fetch.mock.calls[1]?.[1]?.headers).get("Authorization")).toContain("Basic ");
  expect(new URLSearchParams(String(f.fetch.mock.calls[1]?.[1]?.body)).has("client_secret")).toBe(false);
});
it("does not submit an imported registration secret when its method is none", async () => {
  const f = fixture({ mode: "dynamic", registration: { client_id: "client", client_secret: "private-secret", token_endpoint_auth_method: "none" } });
  expect(await f.run()).toEqual({ action: "retry" });
  expect(f.fetch).toHaveBeenCalledOnce();
  expect(new URLSearchParams(String(f.fetch.mock.calls[0]?.[1]?.body)).has("client_secret")).toBe(false);
});
it("fails before authorization if a configured method is not advertised", async () => {
  const f = fixture({ mode: "static", clientId: "client", clientSecret: "private-secret", tokenEndpointAuthMethod: "client_secret_basic" });
  expect(await f.run({ ...discovery, authorizationServerMetadata: { ...discovery.authorizationServerMetadata, token_endpoint_auth_methods_supported: ["none"] } }))
    .toMatchObject({ action: "fail", error: { message: expect.stringContaining("OAuth token endpoint authentication") } });
  expect(f.fetch).not.toHaveBeenCalled();
});
it("requests a supported confidential DCR method when none is unavailable", async () => {
  const f = fixture({ mode: "dynamic" });
  expect(await f.run({ ...discovery, authorizationServerMetadata: { ...discovery.authorizationServerMetadata, token_endpoint_auth_methods_supported: ["client_secret_basic"] } }))
    .toEqual({ action: "retry" });
  expect(JSON.parse(String(f.fetch.mock.calls[0]?.[1]?.body)).token_endpoint_auth_method).toBe("client_secret_basic");
});
it("rejects unsupported methods at provider creation", () => {
  expect(() => fixture({ mode: "dynamic", tokenEndpointAuthMethod: "private_key_jwt" } as DefaultOAuthClientProviderOptions["client"]))
    .toThrow("OAuth token endpoint authentication");
});
