import { expect, it, vi } from "vitest";
import { createDefaultOAuthClientProvider } from "./default-oauth-client-provider.js";
import type { OAuthClientProvider, OAuthDiscoveryResult, StoredOAuthSession, StoredOAuthTokens } from "./types.js";

vi.mock("./loopback-authorization.js", async importOriginal => ({ ...await importOriginal<typeof import("./loopback-authorization.js")>(),
  createLoopbackAuthorizationSession: async (options: { openBrowser?(url: string): Promise<void> }) => ({ redirectUri: "http://127.0.0.1:49152/callback",
    waitForCode: async (url: string) => { await options.openBrowser?.(url); return "selected-code"; }, close: vi.fn() }) }));
const resource = "https://resource.example/mcp", issuer = "https://issuer.example";
function discovery(): OAuthDiscoveryResult { return { resource, resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer], custom: { all: ["values"] } },
  authorizationServer: issuer, authorizationServerMetadataUrl: `${issuer}/metadata`, authorizationServerMetadata: { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
    response_types_supported: ["code"], code_challenge_methods_supported: ["S256"], custom: { nested: ["original"] } } }; }
const tokens: StoredOAuthTokens = { accessToken: "selected-access", refreshToken: "selected-refresh", tokenType: "Bearer", expiresAt: null };
function fixture(load: () => Promise<StoredOAuthSession | null> = async () => null, openBrowser?: (url: string) => Promise<void>) {
  let stored: StoredOAuthSession | null = null;
  const fetch = vi.fn(async (_url: string | URL, _init?: RequestInit) => Response.json({ access_token: "consented-access", refresh_token: "consented-refresh", token_type: "Bearer", expires_in: 3600 }));
  const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "selected-app", clientSecret: "selected-secret" }, browser: { openBrowser }, now: () => 1000,
    sessionStore: { load, save: async (_key, value) => { stored = value; }, clear: async () => { stored = null; } } });
  return { fetch, provider, stored: () => stored };
}
function stored(): StoredOAuthSession {
  const metadata = discovery(); return { resource, authorizationServer: issuer, client: { clientId: "selected-app", clientSecret: "selected-secret" }, tokens: { ...tokens },
    discovery: { resourceMetadataUrl: metadata.resourceMetadataUrl, resourceMetadata: metadata.resourceMetadata, authorizationServerMetadata: metadata.authorizationServerMetadata } };
}
function rejected(f: ReturnType<typeof fixture>, metadata = discovery()): Parameters<OAuthClientProvider["handleUnauthorized"]>[0] {
  return { requestUrl: new URL(resource), response: new Response(null, { status: 401 }), challenge: null, discovery: metadata, fetch: f.fetch };
}

it("owns consent metadata before its host browser callback can redirect the code exchange", async () => {
  const metadata = discovery(), expected = structuredClone(metadata);
  const f = fixture(undefined, async () => {
    metadata.authorizationServerMetadata.token_endpoint = "https://replacement.example/token";
    (metadata.authorizationServerMetadata.custom as { nested: string[] }).nested[0] = "replacement";
  });
  expect(await f.provider.handleUnauthorized(rejected(f, metadata))).toEqual({ action: "retry" });
  expect(f.fetch.mock.calls[0]?.[0]).toBe(`${issuer}/token`);
  expect(f.stored()?.discovery.authorizationServerMetadata).toEqual(expected.authorizationServerMetadata);
});

it("owns nested issuer metadata before the host provenance read can replace flow policy", async () => {
  const metadata = discovery();
  const f = fixture(async () => { metadata.authorizationServerMetadata.authorization_endpoint = "https://replacement.example/authorize";
    metadata.authorizationServerMetadata.token_endpoint = "https://replacement.example/token"; return null; });
  expect(await f.provider.handleUnauthorized(rejected(f, metadata))).toEqual({ action: "retry" });
  expect(f.fetch.mock.calls[0]?.[0]).toBe(`${issuer}/token`);
  expect(f.stored()?.discovery.authorizationServerMetadata.authorization_endpoint).toBe(`${issuer}/authorize`);
});

it("owns rejected grant provenance before a host read can make the original current grant look stale", async () => {
  const presented = { ...tokens }, session = stored();
  const f = fixture(async () => { presented.refreshToken = "replacement-refresh"; return session; });
  expect(await f.provider.handleUnauthorized({ ...rejected(f), presentedTokens: presented, requestHeaders: new Headers({ Authorization: "Bearer selected-access" }) })).toEqual({ action: "retry" });
  expect(f.fetch).toHaveBeenCalledOnce();
  expect(new URLSearchParams(String(f.fetch.mock.calls[0]?.[1]?.body)).get("refresh_token")).toBe("selected-refresh");
});

it("owns rejected request headers before a host read can replace their Authorization value", async () => {
  const headers = new Headers({ Authorization: "Bearer selected-access" }), session = stored();
  const f = fixture(async () => { headers.set("Authorization", "Bearer replacement-access"); return session; });
  expect(await f.provider.handleUnauthorized({ ...rejected(f), presentedTokens: { ...tokens }, requestHeaders: headers })).toEqual({ action: "retry" });
  expect(f.fetch).toHaveBeenCalledOnce();
});

it("owns the challenge's selected error before the host read can suppress a rejected grant refresh", async () => {
  const challenge = { scheme: "Bearer" as const, raw: "Bearer error=invalid_token", params: { error: "invalid_token" } }, session = stored();
  const f = fixture(async () => { challenge.params.error = "insufficient_scope"; return session; });
  expect(await f.provider.handleUnauthorized({ ...rejected(f), challenge })).toEqual({ action: "retry" });
  expect(f.fetch).toHaveBeenCalledOnce();
});

it("retains the unauthorized request fetch handle when a host read replaces it", async () => {
  const replacement = vi.fn(async () => { throw new Error("replacement token fetch invoked"); });
  const f = fixture(async () => { input.fetch = replacement; return null; });
  const input = rejected(f);
  expect(await f.provider.handleUnauthorized(input)).toEqual({ action: "retry" });
  expect(f.fetch).toHaveBeenCalledOnce(); expect(replacement).not.toHaveBeenCalled();
});

it("retains the authorization target headers when the host read replaces their handle", async () => {
  const headers = new Headers(), replacement = new Headers(), session = stored();
  const f = fixture(async () => { input.headers = replacement; return session; });
  const input = { requestUrl: new URL(resource), headers, fetch: f.fetch };
  await f.provider.authorizeRequest!(input);
  expect(headers.get("Authorization")).toBe("Bearer selected-access"); expect(replacement.has("Authorization")).toBe(false);
});

it("retains the selected explicit-auth discovery callback when the host read replaces it", async () => {
  const replacement = vi.fn(async () => { throw new Error("replacement discovery invoked"); }), original = vi.fn(async () => discovery());
  const f = fixture(async () => { input.discover = replacement; return null; });
  const input = { requestUrl: new URL(resource), fetch: f.fetch, discover: original };
  await expect(f.provider.authenticate!(input)).resolves.toMatchObject({ accessToken: "consented-access" });
  expect(original).toHaveBeenCalledOnce(); expect(replacement).not.toHaveBeenCalled();
});

it("owns explicit-auth metadata once lazy discovery returns and before the next host read", async () => {
  const metadata = discovery(); let returned = false;
  const f = fixture(async () => { if (returned) metadata.authorizationServerMetadata.token_endpoint = "https://replacement.example/token"; return null; });
  await expect(f.provider.authenticate!({ requestUrl: new URL(resource), fetch: f.fetch, discover: async () => { returned = true; return metadata; } })).resolves.toMatchObject({ accessToken: "consented-access" });
  expect(f.fetch.mock.calls[0]?.[0]).toBe(`${issuer}/token`);
});

it("retains the original discovery callback receiver with live host state", async () => {
  const f = fixture(async () => { input.state = 2; return null; });
  const input = { requestUrl: new URL(resource), fetch: f.fetch, state: 0, discover: vi.fn(async function(this: { state: number }) { expect(this.state).toBe(2); this.state++; return discovery(); }) };
  await expect(f.provider.authenticate!(input)).resolves.toMatchObject({ accessToken: "consented-access" });
  expect(input.state).toBe(2); expect(input.discover).toHaveBeenCalledOnce();
});
