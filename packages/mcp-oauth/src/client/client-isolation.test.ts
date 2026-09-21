import { expect, it, vi } from "vitest";
import { createDefaultOAuthClientProvider } from "./default-oauth-client-provider.js";
import type { StoredOAuthSession } from "./types.js";

const resource = "https://resource.example/mcp", issuer = "https://auth.example";
const initial: StoredOAuthSession = { resource, authorizationServer: issuer, client: { clientId: "original-client", clientSecret: "original-secret" },
  tokens: { accessToken: "original-private-token", refreshToken: "original-private-refresh", tokenType: "Bearer", expiresAt: null },
  discovery: { resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer] }, authorizationServerMetadata: {
    issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"]
  } } };

it.each([
  { clientId: "other-client", clientSecret: "other-secret" },
  { clientId: "original-client", clientSecret: "other-secret" },
  { clientId: "original-client" }
])("refuses to authorize with a cached static grant belonging to a different client configuration: %j", async client => {
  const save = vi.fn(async () => {}), clear = vi.fn(async () => {}), fetch = vi.fn(async () => Response.json({ access_token: "bad", token_type: "Bearer" }));
  const provider = createDefaultOAuthClientProvider({ client: { mode: "static", ...client }, browser: {}, allowInteractive: false,
    sessionStore: { load: async () => initial, save, clear } });
  const headers = new Headers();
  const error = await provider.authorizeRequest!({ requestUrl: new URL(resource), headers, fetch }).catch(error => error);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toContain("different OAuth client");
  expect(error.message).not.toContain("original-secret"); expect(error.message).not.toContain("other-secret");
  expect(headers.has("Authorization")).toBe(false);
  expect(fetch).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled();
});

it("accepts the original normalized static client without changing its stored credentials", async () => {
  const fetch = vi.fn(async () => Response.json({ access_token: "bad", token_type: "Bearer" }));
  const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: " original-client ", clientSecret: " original-secret " }, browser: {},
    sessionStore: { load: async () => initial, save: async () => {}, clear: async () => {} } });
  const headers = new Headers(); await provider.authorizeRequest!({ requestUrl: new URL(resource), headers, fetch });
  expect(headers.get("Authorization")).toBe("Bearer original-private-token");
  expect(fetch).not.toHaveBeenCalled();
});

it("binds a configured dynamic import to its original client instead of another app's persisted grant", async () => {
  const fetch = vi.fn(async () => Response.json({ access_token: "bad", token_type: "Bearer" }));
  const provider = createDefaultOAuthClientProvider({ client: { mode: "dynamic", clientId: "other-client" }, browser: {}, allowInteractive: false,
    initialGrant: { resource, tokens: { accessToken: "imported-private-token", tokenType: "Bearer", expiresAt: null } },
    sessionStore: { load: async () => initial, save: async () => {}, clear: async () => {} } });
  const headers = new Headers();
  await expect(provider.authorizeRequest!({ requestUrl: new URL(resource), headers, fetch })).rejects.toThrow("different OAuth client");
  expect(headers.has("Authorization")).toBe(false); expect(fetch).not.toHaveBeenCalled();
});
