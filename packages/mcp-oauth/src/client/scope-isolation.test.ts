import { expect, it, vi } from "vitest";
import { createDefaultOAuthClientProvider } from "./default-oauth-client-provider.js";
import type { StoredOAuthSession } from "./types.js";

const resource = "https://resource.example/mcp", issuer = "https://auth.example";
const initial: StoredOAuthSession = { resource, authorizationServer: issuer, client: { clientId: "client" },
  tokens: { accessToken: "private-access", refreshToken: "private-refresh", tokenType: "Bearer", expiresAt: null },
  discovery: { resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer] }, authorizationServerMetadata: {
    issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"]
  } } };
function fixture(tokenScope?: string, requestedScope?: string, scope = "read") {
  let session = { ...initial, tokens: { ...initial.tokens!, ...(tokenScope === undefined ? {} : { scope: tokenScope }) },
    ...(requestedScope === undefined ? {} : { requestedScope }) } as StoredOAuthSession;
  const fetch = vi.fn(async () => Response.json({ access_token: "rotated", refresh_token: "rotated-refresh", token_type: "Bearer", expires_in: 3600 }));
  const save = vi.fn(async (_key: string, value: StoredOAuthSession) => { session = value; }), clear = vi.fn(async () => {});
  const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "client", metadata: { scope } }, browser: {}, allowInteractive: false,
    sessionStore: { load: async () => session, save, clear }, now: () => 1000 });
  const headers = new Headers();
  return { fetch, save, clear, headers, session: () => session, authorize: () => provider.authorizeRequest!({ requestUrl: new URL(resource), headers, fetch }) };
}

it.each([
  ["read write", undefined],
  [undefined, "read write"],
  [undefined, undefined],
  ["read write", "read"]
] as const)("refuses a cached grant outside an explicit requested scope profile: %s / %s", async (tokenScope, requestedScope) => {
  const f = fixture(tokenScope, requestedScope);
  await expect(f.authorize()).rejects.toThrow("requested OAuth scope");
  expect(f.headers.has("Authorization")).toBe(false);
  expect(f.fetch).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled(); expect(f.clear).not.toHaveBeenCalled();
});

it.each([["read", undefined, "read"], [undefined, "read", "read"], ["write read", "read write", " read  write read "]] as const)
  ("accepts the same scope set independent of order/spacing: %s / %s / %s", async (tokenScope, requestedScope, configured) => {
    const f = fixture(tokenScope, requestedScope, configured);
    await f.authorize(); expect(f.headers.get("Authorization")).toBe("Bearer private-access");
    expect(f.fetch).not.toHaveBeenCalled();
  });

it.each(["read\nwrite", "read\twrite", 'read"write', "read\\write", "read 🐈", "read\n", "\tread", "\n"])("rejects invalid scope syntax before provider setup: %s", scope => {
  expect(() => createDefaultOAuthClientProvider({ client: { mode: "dynamic", metadata: { scope } }, browser: {},
    sessionStore: { load: async () => null, save: async () => {}, clear: async () => {} } })).toThrow("OAuth scope");
});

it.each(["read write", undefined])("rejects imported grants outside an explicit scope profile: %s", scope => {
  expect(() => createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "client", metadata: { scope: "read" } }, browser: {},
    initialGrant: { resource, tokens: { ...initial.tokens!, ...(scope === undefined ? {} : { scope }) } },
    sessionStore: { load: async () => null, save: async () => {}, clear: async () => {} } })).toThrow("requested OAuth scope");
});

it("retains the original granted scope when a refresh response omits it", async () => {
  const f = fixture("read"); f.session().tokens!.expiresAt = 0;
  expect(await f.authorize()).toMatchObject({ accessToken: "rotated", scope: "read" });
  expect(f.session().tokens?.scope).toBe("read");
  expect(await f.authorize()).toMatchObject({ accessToken: "rotated", scope: "read" });
  expect(f.fetch).toHaveBeenCalledOnce();
});

it("refuses a refresh response that broadens an explicitly requested scope set", async () => {
  const f = fixture("read"); f.session().tokens!.expiresAt = 0;
  f.fetch.mockResolvedValueOnce(Response.json({ access_token: "broader-private-grant", refresh_token: "broader-private-refresh", token_type: "Bearer", scope: "read write", expires_in: 3600 }));
  await expect(f.authorize()).rejects.toThrow("requested OAuth scope");
  expect(f.headers.has("Authorization")).toBe(false);
  expect(f.session().tokens).toBeUndefined();
  expect(f.session()).toMatchObject({ refreshState: "pending" });
});
