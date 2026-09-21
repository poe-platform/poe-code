import { expect, it, vi } from "vitest";
import { createDefaultOAuthClientProvider } from "./default-oauth-client-provider.js";
import type { StoredOAuthSession } from "./types.js";
const resource = "https://resource.example/mcp", issuer = "https://issuer.example";
function session(): StoredOAuthSession { return { resource, authorizationServer: issuer, client: { clientId: "original-app", clientSecret: "private-app-secret" },
  tokens: { accessToken: "private-expired-access", refreshToken: "private-original-refresh", tokenType: "Bearer", expiresAt: 0 },
  discovery: { resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer], extension: { nested: ["original"] } },
    authorizationServerMetadata: { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"], extension: { complete: true } } } }; }

it.each(["clock", "fetch"] as const)("owns host-loaded session metadata before the selected %s callback can mutate it", async callback => {
  const loaded = session(), expected = structuredClone(loaded.discovery);
  let saved: StoredOAuthSession | null = null;
  const mutate = () => { loaded.discovery.authorizationServerMetadata.token_endpoint = "https://replacement.example/token";
    loaded.discovery.authorizationServerMetadata.extension = { complete: false };
    (loaded.discovery.resourceMetadata.authorization_servers as string[])[0] = "https://replacement.example";
    (loaded.discovery.resourceMetadata.extension as { nested: string[] }).nested[0] = "replacement";
  };
  const fetch = vi.fn(async (_url: string | URL, _init?: RequestInit) => {
    if (callback === "fetch") mutate();
    return Response.json({ access_token: "private-rotated-access", refresh_token: "private-rotated-refresh", token_type: "Bearer", expires_in: 3600 });
  });
  const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "original-app", clientSecret: "private-app-secret" }, browser: {},
    now: () => { if (callback === "clock") mutate(); return 1000; }, sessionStore: { load: async () => loaded,
      save: async (_key, value) => { saved = value; }, clear: async () => {} } });
  const headers = new Headers();
  await provider.authorizeRequest!({ requestUrl: new URL(resource), headers, fetch });
  expect(fetch.mock.calls[0]?.[0]).toBe(`${issuer}/token`);
  expect(saved?.discovery).toEqual(expected);
  expect(saved?.tokens).toMatchObject({ accessToken: "private-rotated-access", refreshToken: "private-rotated-refresh", expiresAt: 3_601_000 });
  expect(headers.get("Authorization")).toBe("Bearer private-rotated-access");
});
