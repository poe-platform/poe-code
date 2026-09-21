import { expect, it, vi } from "vitest";
import { createDefaultOAuthClientProvider } from "./default-oauth-client-provider.js";
import type { DefaultOAuthClientProviderOptions, OAuthDiscoveryResult, StoredOAuthSession } from "./types.js";

vi.mock("./loopback-authorization.js", async importOriginal => ({ ...await importOriginal<typeof import("./loopback-authorization.js")>(),
  createLoopbackAuthorizationSession: async () => ({ redirectUri: "http://127.0.0.1:49152/callback", waitForCode: async () => "005930", close() {} }) }));

const resource = "https://resource.example/mcp", issuer = "https://auth.example";
const discovery: OAuthDiscoveryResult = { resource, resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer] },
  authorizationServer: issuer, authorizationServerMetadataUrl: `${issuer}/metadata`, authorizationServerMetadata: { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`, token_endpoint_auth_methods_supported: ["none", "client_secret_post"], response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] } };

it.each((["fresh", "initial", "persisted"] as const).flatMap(source => (["public", "confidential", "url"] as const).map(kind => ({ source, kind }))))(
  "uses the explicit $kind app for $source consent despite advertised registration", async ({ source, kind }) => {
    let now = 1000;
    const clientId = kind === "url" ? "https://client.example/metadata.json?app=005930" : "original";
    const clientSecret = kind === "confidential" ? "original-secret" : undefined;
    const tokenEndpointAuthMethod = kind === "confidential" ? "client_secret_post" : "none";
    const tokens = { accessToken: "expired-access", tokenType: "Bearer" as const, expiresAt: 0, scope: "read" };
    let session: StoredOAuthSession | null = source === "persisted" ? { resource, authorizationServer: issuer,
      client: { clientId, clientSecret, tokenEndpointAuthMethod }, tokens,
      discovery: { resourceMetadataUrl: discovery.resourceMetadataUrl, resourceMetadata: discovery.resourceMetadata, authorizationServerMetadata: discovery.authorizationServerMetadata } } : null;
    const requests: { url: string; body: URLSearchParams }[] = [];
    const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input); requests.push({ url, body: new URLSearchParams(String(init?.body)) });
      return Response.json(url.endsWith("/register") ? { client_id: "replacement", ...(clientSecret === undefined ? {} : { client_secret: "replacement-secret" }), token_endpoint_auth_method: tokenEndpointAuthMethod }
        : { access_token: requests.filter(request => request.url.endsWith("/token")).length === 1 ? "consented-access" : "rotated-access",
          refresh_token: "original-refresh", token_type: "Bearer", expires_in: 1, scope: "read" });
    });
    const options: DefaultOAuthClientProviderOptions = { client: { mode: "dynamic", clientId, clientSecret, tokenEndpointAuthMethod, metadata: { scope: "read" } }, browser: {}, now: () => now,
      sessionStore: { load: async () => session, save: async (_key, value) => { session = value; }, clear: async () => { session = null; } },
      ...(source === "initial" ? { initialGrant: { resource, tokens } } : {}) };
    const provider = createDefaultOAuthClientProvider(options);
    expect(await provider.authenticate!({ requestUrl: new URL(resource), fetch, discover: async () => discovery })).toMatchObject({ accessToken: "consented-access" });
    expect(requests.map(request => request.url)).toEqual([`${issuer}/token`]);
    expect(session?.client).toMatchObject({ clientId, tokenEndpointAuthMethod });
    const headers = new Headers(); now = 2000;
    await provider.authorizeRequest!({ requestUrl: new URL(resource), headers, fetch });
    expect(headers.get("Authorization")).toBe("Bearer rotated-access");
    expect(requests.map(request => request.url)).toEqual([`${issuer}/token`, `${issuer}/token`]);
    expect(requests[0].body.get("grant_type")).toBe("authorization_code"); expect(requests[1].body.get("grant_type")).toBe("refresh_token");
    for (const request of requests) { expect(request.body.get("client_id")).toBe(clientId); expect(request.body.get("client_secret")).toBe(clientSecret ?? null); }
    expect(session?.client.clientId).toBe(clientId); expect(session?.tokens?.accessToken).toBe("rotated-access");
  }
);
