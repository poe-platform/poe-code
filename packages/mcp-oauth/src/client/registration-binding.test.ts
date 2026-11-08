import { expect, it, vi } from "vitest";
import { createDefaultOAuthClientProvider } from "./default-oauth-client-provider.js";
import type { DefaultOAuthClientProviderOptions, OAuthDiscoveryResult, StoredOAuthSession } from "./types.js";
vi.mock("./loopback-authorization.js", async importOriginal => ({
  ...await importOriginal<typeof import("./loopback-authorization.js")>(),
  createLoopbackAuthorizationSession: async () => ({ redirectUri: "http://127.0.0.1:49152/callback", waitForCode: async () => "code", close: vi.fn() })
}));
const resource = "https://resource.example/mcp", issuer = "https://auth.example";
const discovery: OAuthDiscoveryResult = { resource, resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer] },
  authorizationServer: issuer, authorizationServerMetadataUrl: `${issuer}/metadata`, authorizationServerMetadata: {
    issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, registration_endpoint: `${issuer}/register`,
    response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] } };
function fixture(client: DefaultOAuthClientProviderOptions["client"], saved: StoredOAuthSession | null = null) {
  let session = saved;
  const fetch = vi.fn(async (url: string | URL) => Response.json(String(url).endsWith("/register")
    ? { client_id: "fresh", client_secret: "fresh-secret" } : { access_token: "fresh-access", refresh_token: "fresh-refresh", token_type: "Bearer" }));
  const save = vi.fn(async (_key: string, value: StoredOAuthSession) => { session = value; }), clear = vi.fn(async () => { session = null; });
  const provider = createDefaultOAuthClientProvider({ client, browser: {}, now: () => 10_000, sessionStore: { load: async () => session, save, clear } });
  return { fetch, save, clear, session: () => session,
    authorize: () => provider.authorizeRequest!({ requestUrl: new URL(resource), headers: new Headers(), fetch }),
    run: () => provider.handleUnauthorized({ requestUrl: new URL(resource), response: new Response(null, { status: 401 }), challenge: null, discovery, fetch }) };
}
function stored(expiresAt: number | null = 0): StoredOAuthSession {
  return { resource, authorizationServer: issuer, client: { clientId: "old", clientSecret: "private-old-secret",
    registration: { client_id: "old", client_secret: "private-old-secret", client_secret_expires_at: 10 } },
    tokens: { accessToken: "private-old-access", refreshToken: "private-old-refresh", tokenType: "Bearer", expiresAt },
    discovery: { resourceMetadataUrl: discovery.resourceMetadataUrl, resourceMetadata: discovery.resourceMetadata, authorizationServerMetadata: discovery.authorizationServerMetadata } };
}
it("rejects an imported registration issuer before code exchange or persistence", async () => {
  const f = fixture({ mode: "dynamic", registration: { client_id: "client", client_secret: "private-secret", issuer: "https://another.example" } });
  expect(await f.run()).toMatchObject({ action: "fail", error: { message: expect.stringContaining("registration issuer") } });
  expect(f.fetch).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled();
});
it("rejects contradictory persisted registration issuer before attaching or redeeming its grant", async () => {
  const session = stored(null); session.client.registration!.issuer = "https://another.example";
  const f = fixture({ mode: "dynamic" }, session);
  await expect(f.authorize()).rejects.toThrow("registration issuer");
  expect(f.fetch).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled(); expect(f.clear).not.toHaveBeenCalled();
});
it("rejects a fresh DCR issuer mismatch before saving or exchanging", async () => {
  const f = fixture({ mode: "dynamic" });
  f.fetch.mockResolvedValueOnce(Response.json({ client_id: "client", client_secret: "private-secret", issuer: "https://another.example" }));
  expect(await f.run()).toMatchObject({ action: "fail", error: { message: expect.stringContaining("registration issuer") } });
  expect(f.fetch).toHaveBeenCalledOnce(); expect(f.save).not.toHaveBeenCalled();
});
it("rejects already-expired secrets returned by fresh DCR before activating registration", async () => {
  const f = fixture({ mode: "dynamic" });
  f.fetch.mockResolvedValueOnce(Response.json({ client_id: "client", client_secret: "private-secret", client_secret_expires_at: 10 }));
  expect(await f.run()).toMatchObject({ action: "fail", error: { message: expect.stringContaining("client secret has expired") } });
  expect(f.fetch).toHaveBeenCalledOnce(); expect(f.save).not.toHaveBeenCalled();
});
it("does not submit a known-expired client secret during headless refresh", async () => {
  const f = fixture({ mode: "dynamic" }, stored());
  await expect(f.authorize()).rejects.toThrow("client secret has expired");
  expect(f.fetch).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled(); expect(f.clear).not.toHaveBeenCalled();
});
it("replaces an owned expired registration only during interactive reauthorization", async () => {
  const f = fixture({ mode: "dynamic" }, stored());
  expect(await f.run()).toEqual({ action: "retry" });
  expect(f.fetch.mock.calls.map(([url]) => String(url))).toEqual([`${issuer}/register`, `${issuer}/token`]);
  expect(f.session()?.client.clientId).toBe("fresh");
});
it("requires a caller-owned expired imported registration to be updated explicitly", async () => {
  const f = fixture({ mode: "dynamic", registration: { client_id: "old", client_secret: "private-old-secret", client_secret_expires_at: 10 } });
  expect(await f.run()).toMatchObject({ action: "fail", error: { message: expect.stringContaining("client secret has expired") } });
  expect(f.fetch).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled();
});
it("retains caller-owned expired registration policy after a persisted session reload", async () => {
  const session = stored(); Object.assign(session.client, { registrationOwnership: "caller" });
  const f = fixture({ mode: "dynamic" }, session);
  expect(await f.run()).toMatchObject({ action: "fail", error: { message: expect.stringContaining("update the imported registration") } });
  expect(f.fetch).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
});
it("continues using live access tokens without redeeming an expired secret", async () => {
  const f = fixture({ mode: "dynamic" }, stored(100_000));
  expect(await f.authorize()).toMatchObject({ accessToken: "private-old-access" });
  expect(f.fetch).not.toHaveBeenCalled();
});

it.each([undefined, null, 0, 11])("permits refresh when secret expiry is absent, unknown, unlimited or future: %s", expiry => {
  const session = stored();
  if (expiry === undefined) delete session.client.registration!.client_secret_expires_at;
  else session.client.registration!.client_secret_expires_at = expiry;
  const f = fixture({ mode: "dynamic" }, session);
  return expect(f.authorize()).resolves.toMatchObject({ accessToken: "fresh-access" });
});

it("does not treat an unused public-client secret expiry as a refresh barrier", async () => {
  const session = stored(); session.client.registration!.token_endpoint_auth_method = "none";
  const f = fixture({ mode: "dynamic" }, session);
  expect(await f.authorize()).toMatchObject({ accessToken: "fresh-access" });
});

it("retains strictly matched registration issuer metadata during refresh", async () => {
  const session = stored(); session.client.registration!.issuer = issuer;
  session.client.registration!.client_secret_expires_at = 0;
  const f = fixture({ mode: "dynamic" }, session);
  expect(await f.authorize()).toMatchObject({ accessToken: "fresh-access" });
  expect(f.session()?.client.registration?.issuer).toBe(issuer);
});

it("preserves caller ownership and original app through successful refresh", async () => {
  const session = stored(); session.client.registration!.client_secret_expires_at = 0;
  session.client.registrationOwnership = "caller";
  const f = fixture({ mode: "dynamic" }, session);
  expect(await f.authorize()).toMatchObject({ accessToken: "fresh-access" });
  expect(f.session()?.client).toEqual(session.client);
  expect(f.fetch.mock.calls.map(([url]) => String(url))).toEqual([`${issuer}/token`]);
});
