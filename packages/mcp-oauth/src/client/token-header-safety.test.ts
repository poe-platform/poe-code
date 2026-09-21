import { expect, it, vi } from "vitest";
import { createDefaultOAuthClientProvider } from "./default-oauth-client-provider.js";
import { exchangeAuthorizationCode } from "./token-endpoint.js";
import type { OAuthDiscoveryResult, StoredOAuthSession } from "./types.js";

const resource = "https://resource.example/mcp", issuer = "https://issuer.example";
const discovery: OAuthDiscoveryResult = { resource, resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer] },
  authorizationServer: issuer, authorizationServerMetadataUrl: `${issuer}/metadata`, authorizationServerMetadata: {
    issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] } };
const invalidTokens = ["private-access\nInjected: true", "private-access\u0000hidden", "private-access🔒"];
function fixture(accessToken: string, expiresAt: number | null = null) {
  let stored: StoredOAuthSession | null = { resource, authorizationServer: issuer, client: { clientId: "original-app" },
    tokens: { accessToken, refreshToken: "private-refresh", tokenType: "Bearer", expiresAt },
    discovery: { resourceMetadataUrl: discovery.resourceMetadataUrl, resourceMetadata: discovery.resourceMetadata, authorizationServerMetadata: discovery.authorizationServerMetadata } };
  const store = { load: async () => stored, save: vi.fn(async (_key: string, value: StoredOAuthSession) => { stored = value; }), clear: vi.fn(async () => { stored = null; }) };
  const fetch = vi.fn(async () => Response.json({ access_token: "private-response", refresh_token: "private-rotated", token_type: "Bearer", expires_in: 3600 }));
  const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "original-app" }, browser: {}, sessionStore: store, allowInteractive: false,
    now: () => 1000, initialGrant: { resource, tokens: { accessToken: "private-initial", tokenType: "Bearer", expiresAt: null } } });
  return { provider, store, fetch, stored: () => stored };
}

it.each(invalidTokens.flatMap(accessToken => (["authenticate", "authorizeRequest", "handleUnauthorized"] as const).map(method => ({ accessToken, method }))))(
  "rejects persisted unrepresentable access tokens in $method without exposing them: $accessToken", async ({ accessToken, method }) => {
    const f = fixture(accessToken), headers = new Headers();
    const result = await Promise.resolve(method === "handleUnauthorized" ? f.provider.handleUnauthorized({ requestUrl: new URL(resource), response: new Response(null, { status: 401 }), challenge: null, discovery, fetch: f.fetch })
      : f.provider[method]!({ requestUrl: new URL(resource), headers, fetch: f.fetch })).catch(error => error);
    const error = method === "handleUnauthorized" ? (result as { error?: Error }).error : result;
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("HTTP header"); expect(String(error)).not.toContain("private-access");
    expect(headers.has("Authorization")).toBe(false); expect(f.fetch).not.toHaveBeenCalled();
    expect(f.store.save).not.toHaveBeenCalled(); expect(f.store.clear).not.toHaveBeenCalled();
    expect(f.stored()?.tokens?.accessToken).toBe(accessToken);
});

it.each(invalidTokens)("rejects token-exchange access tokens that cannot be sent as headers: %j", async accessToken => {
  const now = vi.fn(() => 1000);
  const result = await exchangeAuthorizationCode({ tokenEndpoint: `${issuer}/token`, clientId: "original-app", code: "code", codeVerifier: "verifier", redirectUri: "http://localhost/callback",
    resource, fetch: async () => Response.json({ access_token: accessToken, token_type: "Bearer", expires_in: 3600 }), now }).catch(error => error);
  expect(result).toBeInstanceOf(Error); expect(String(result)).toContain("HTTP header"); expect(String(result)).not.toContain("private-access");
  expect(now).not.toHaveBeenCalled();
});

it.each(invalidTokens)("retains pending refresh intent when the rotated access token cannot be sent as a header: %j", async accessToken => {
  const f = fixture("private-expired-access", 0);
  f.fetch.mockImplementation(async () => Response.json({ access_token: accessToken, refresh_token: "private-rotated", token_type: "Bearer", expires_in: 3600 }));
  const result = await Promise.resolve(f.provider.authorizeRequest!({ requestUrl: new URL(resource), headers: new Headers(), fetch: f.fetch })).catch(error => error);
  expect(result).toBeInstanceOf(Error); expect(String(result)).toContain("HTTP header"); expect(String(result)).not.toContain("private-access");
  expect(f.stored()).toMatchObject({ resource, refreshState: "pending", client: { clientId: "original-app" } });
  expect(f.stored()?.tokens).toBeUndefined(); expect(f.fetch).toHaveBeenCalledOnce();
  const follower = await Promise.resolve(f.provider.authorizeRequest!({ requestUrl: new URL(resource), headers: new Headers(), fetch: f.fetch })).catch(error => error);
  expect(String(follower)).toContain("refresh outcome"); expect(f.fetch).toHaveBeenCalledOnce();
});
