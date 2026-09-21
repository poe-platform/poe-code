import { expect, it, vi } from "vitest";
import { setImmediate } from "node:timers/promises";
import { createDefaultOAuthClientProvider } from "./default-oauth-client-provider.js";
import type { OAuthSessionStore, StoredOAuthSession } from "./types.js";

const resource = "https://resource.example/mcp";
const issuer = "https://auth.example";
const initial: StoredOAuthSession = { resource, authorizationServer: issuer, client: { clientId: "client" },
  tokens: { accessToken: "expired", refreshToken: "one-use-refresh", tokenType: "Bearer", expiresAt: 0 },
  discovery: { resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer] }, authorizationServerMetadata: {
    issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"]
  } } };

function fixture() {
  const entered = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  let session = structuredClone(initial);
  let redemptions = 0;
  const fetch = vi.fn(async (_input: string | URL, init?: RequestInit) => {
    if (++redemptions > 1) throw new Error("rotating refresh token replayed");
    entered.resolve();
    await finish.promise;
    init?.signal?.throwIfAborted();
    return Response.json({ access_token: "winner", refresh_token: "winner-refresh", token_type: "Bearer", expires_in: 3600 });
  });
  const store: OAuthSessionStore = { load: vi.fn(async () => structuredClone(session)), save: vi.fn(async (_key, value) => { session = structuredClone(value); }), clear: vi.fn(async () => { delete session.tokens; }) };
  const provider = (sessionLockTimeoutMs?: number) => createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "client" }, allowInteractive: false, browser: {}, now: () => 1000, sessionStore: store, sessionLockTimeoutMs });
  const authorize = async (p = provider(), signal?: AbortSignal) => { const headers = new Headers(); await p.authorizeRequest!({ requestUrl: new URL(resource), headers, fetch, signal }); return headers.get("Authorization"); };
  return { entered, finish, fetch, store, provider, authorize };
}

it("serializes complete refresh transactions across providers sharing a session store", async () => {
  const f = fixture();
  const first = f.authorize();
  await f.entered.promise;
  const second = f.authorize();
  f.finish.resolve();
  expect(await Promise.all([first, second])).toEqual(["Bearer winner", "Bearer winner"]);
  expect(f.fetch).toHaveBeenCalledOnce();
  expect(f.store.save).toHaveBeenCalledTimes(2);
});

it("cancels a waiting request promptly without canceling the owner or releasing its lock", async () => {
  const f = fixture();
  const p = f.provider();
  const first = f.authorize(p);
  await f.entered.promise;
  const controller = new AbortController();
  const reason = new Error("cancel waiter");
  const second = f.authorize(p, controller.signal).catch(error => error);
  await setImmediate();
  controller.abort(reason);
  const third = f.authorize(p);
  // The waiter must settle without waiting for the endpoint response.
  try {
    expect(await Promise.race([second, setImmediate().then(() => "still waiting")])).toBe(reason);
    expect(f.fetch).toHaveBeenCalledOnce();
  } finally { f.finish.resolve(); await Promise.allSettled([first, second, third]); }
  expect(await first).toBe("Bearer winner");
  expect(await third).toBe("Bearer winner");
  expect(f.fetch).toHaveBeenCalledOnce();
});

it("holds a host backend lock across reread, redemption and persistence", async () => {
  const f = fixture();
  const events: string[] = [];
  const load = f.store.load, save = f.store.save;
  f.store.load = async key => { events.push("read"); return load(key); };
  f.store.save = async (key, value) => { events.push(value.refreshState === "pending" ? "intent" : "persist"); await save(key, value); };
  f.store.withLock = async (key, operation, options) => {
    expect(key).toBe(resource); expect(options.timeoutMs).toBeGreaterThan(0);
    events.push("locked");
    try { return await operation(); } finally { events.push("released"); }
  };
  const pending = f.authorize();
  await f.entered.promise;
  expect(events).toEqual(["locked", "read", "intent"]);
  f.finish.resolve();
  expect(await pending).toBe("Bearer winner");
  expect(events).toEqual(["locked", "read", "intent", "persist", "released"]);
});

it("times out a waiter without letting a following transaction bypass the owner", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const owner = f.authorize();
  await f.entered.promise;
  const waiter = f.authorize(f.provider(5)).catch(error => error);
  const next = f.authorize();
  try {
    await vi.advanceTimersByTimeAsync(5);
    expect(await waiter).toMatchObject({ message: expect.stringContaining("transaction lock") });
    expect(f.fetch).toHaveBeenCalledOnce();
  } finally { f.finish.resolve(); await Promise.allSettled([owner, waiter, next]); vi.useRealTimers(); }
  expect(await next).toBe("Bearer winner");
  expect(f.fetch).toHaveBeenCalledOnce();
});

it.each([0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER])("rejects an invalid or unschedulable lock wait before redemption: %s", async timeout => {
  const f = fixture();
  f.finish.resolve();
  await expect(f.authorize(f.provider(timeout))).rejects.toThrow("sessionLockTimeoutMs");
  expect(f.fetch).not.toHaveBeenCalled();
});
