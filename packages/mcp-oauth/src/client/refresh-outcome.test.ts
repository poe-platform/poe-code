import { setImmediate } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { createDefaultOAuthClientProvider } from "./default-oauth-client-provider.js";
import type { OAuthMetadataFetch, OAuthSessionStore, StoredOAuthSession } from "./types.js";

vi.mock("./loopback-authorization.js", async importOriginal => ({
  ...await importOriginal<typeof import("./loopback-authorization.js")>(),
  createLoopbackAuthorizationSession: async () => ({ redirectUri: "http://127.0.0.1:49152/callback", waitForCode: async () => "new-code", close: vi.fn() })
}));

const resource = "https://resource.example/mcp", issuer = "https://auth.example";
const initial: StoredOAuthSession = { resource, authorizationServer: issuer, client: { clientId: "original-client" },
  tokens: { accessToken: "expired", refreshToken: "single-use-refresh", tokenType: "Bearer", expiresAt: 0 },
  discovery: { resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer] }, authorizationServerMetadata: {
    issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"]
  } } };

function fixture() {
  let session = structuredClone(initial);
  const store: OAuthSessionStore = { load: async () => structuredClone(session), save: async (_key, value) => { session = structuredClone(value); }, clear: async () => { throw new Error("must retain client binding"); } };
  const provider = () => createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "original-client" }, browser: {}, allowInteractive: false,
    initialGrant: { resource, tokens: initial.tokens! }, sessionStore: store, now: () => 1000 });
  const authorize = async (fetch: OAuthMetadataFetch, signal?: AbortSignal) => { const headers = new Headers(); await provider().authorizeRequest!({ requestUrl: new URL(resource), headers, fetch, signal }); return headers.get("Authorization"); };
  return { store, provider, authorize, session: () => session };
}

it("persists tokenless refresh intent before any redemption", async () => {
  const f = fixture();
  const fetch = vi.fn(async () => {
    expect(f.session()).toMatchObject({ client: initial.client, refreshState: "pending" });
    expect(f.session().tokens).toBeUndefined();
    return Response.json({ access_token: "winner", refresh_token: "rotated", token_type: "Bearer", expires_in: 3600 });
  });
  expect(await f.authorize(fetch)).toBe("Bearer winner");
  expect(f.session()).not.toHaveProperty("refreshState");
  expect(f.session().tokens?.refreshToken).toBe("rotated");
});

it.each([
  ["network disconnect", async () => { throw new Error("connection lost after redemption"); }],
  ["malformed success", async () => new Response("response lost", { status: 200 })],
  ["unstructured gateway failure", async () => new Response("gateway lost response", { status: 503 })],
  ["JSON gateway failure without OAuth error", async () => Response.json({ message: "response lost" }, { status: 500 })]
] as const)("never replays a grant with an uncertain outcome: %s", async (_label, response) => {
  const f = fixture(), fetch = vi.fn(response);
  await expect(f.authorize(fetch)).rejects.toBeInstanceOf(Error);
  expect(fetch).toHaveBeenCalledOnce();
  expect(f.session()).toMatchObject({ refreshState: "pending", client: initial.client });
  expect(f.session().tokens).toBeUndefined();
  await expect(f.authorize(fetch)).rejects.toThrow("refresh outcome");
  expect(fetch).toHaveBeenCalledOnce();
});

it("preserves cancellation identity and blocks replay after a redeemed response body stalls", async () => {
  const f = fixture(), controller = new AbortController(), entered = Promise.withResolvers<void>(), cancel = vi.fn();
  const reason = { cancelled: "after redemption" };
  const fetch = vi.fn().mockImplementationOnce(async () => { entered.resolve(); return new Response(new ReadableStream({ cancel })); })
    .mockRejectedValue(new Error("refresh replay"));
  const pending = f.authorize(fetch, controller.signal).catch(error => error);
  await entered.promise; await setImmediate(); controller.abort(reason);
  expect(await pending).toBe(reason);
  expect(cancel).toHaveBeenCalledOnce();
  await expect(f.authorize(fetch)).rejects.toThrow("refresh outcome");
  expect(fetch).toHaveBeenCalledOnce();
});

it("does not send a refresh request if intent persistence fails", async () => {
  const f = fixture(), failure = new Error("cannot persist intent"), fetch = vi.fn(async () => Response.json({ access_token: "winner", token_type: "Bearer" }));
  f.store.save = async () => { throw failure; };
  await expect(f.authorize(fetch)).rejects.toBe(failure);
  expect(fetch).not.toHaveBeenCalled();
  expect(f.session().tokens).toEqual(initial.tokens);
});

it("retains pending intent if persistence of the rotated winner fails", async () => {
  const f = fixture(), save = f.store.save, failure = new Error("winner persistence failed");
  f.store.save = async (key, session) => { if (session.tokens) throw failure; await save(key, session); };
  const fetch = vi.fn(async () => Response.json({ access_token: "winner", refresh_token: "rotated", token_type: "Bearer", expires_in: 3600 }));
  await expect(f.authorize(fetch)).rejects.toBe(failure);
  await expect(f.authorize(fetch)).rejects.toThrow("refresh outcome");
  expect(fetch).toHaveBeenCalledOnce();
});

it("restores the grant after a definitive OAuth rejection without consuming it", async () => {
  const f = fixture(), fetch = vi.fn(async () => Response.json({ error: "invalid_scope" }, { status: 400 }));
  await expect(f.authorize(fetch)).rejects.toMatchObject({ error: "invalid_scope" });
  expect(f.session()).not.toHaveProperty("refreshState");
  expect(f.session().tokens).toEqual(initial.tokens);
});

it("retries a definitive transient OAuth rejection once and persists the winner", async () => {
  const f = fixture(), fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: "temporarily_unavailable" }, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ access_token: "winner", refresh_token: "rotated", token_type: "Bearer", expires_in: 3600 }));
  expect(await f.authorize(fetch)).toBe("Bearer winner");
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(f.session()).not.toHaveProperty("refreshState");
});

it("recovers pending intent through fresh authorization using the original client", async () => {
  const f = fixture();
  await expect(f.authorize(async () => { throw new Error("lost refresh response"); })).rejects.toThrow("lost refresh response");
  const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "original-client" }, browser: {}, sessionStore: f.store });
  const fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("client_id")).toBe("original-client");
    expect(body.has("refresh_token")).toBe(false);
    return Response.json({ access_token: "new-grant", refresh_token: "new-refresh", token_type: "Bearer", expires_in: 3600 });
  });
  const metadata = initial.discovery;
  expect(await provider.handleUnauthorized({ requestUrl: new URL(resource), response: new Response(null, { status: 401 }), challenge: null, fetch,
    discovery: { ...metadata, resource, authorizationServer: issuer, authorizationServerMetadataUrl: `${issuer}/metadata`,
      resourceMetadata: { resource, authorization_servers: [issuer] }, authorizationServerMetadata: {
        issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"]
      } } })).toEqual({ action: "retry" });
  expect(fetch).toHaveBeenCalledOnce();
  expect(f.session()).not.toHaveProperty("refreshState");
  expect(f.session().tokens?.refreshToken).toBe("new-refresh");
});

it("rejects corrupt refresh state instead of authorizing with a quarantined grant", async () => {
  const f = fixture();
  await f.store.save(resource, { ...initial, refreshState: "pending" });
  const fetch = vi.fn(async () => Response.json({ access_token: "bad", token_type: "Bearer" }));
  await expect(f.authorize(fetch)).rejects.toThrow("refresh state");
  expect(fetch).not.toHaveBeenCalled();
});
