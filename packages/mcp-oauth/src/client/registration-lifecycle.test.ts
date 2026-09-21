import { setImmediate } from "node:timers/promises";
import { afterEach, expect, it, vi } from "vitest";
import { createDefaultOAuthClientProvider } from "./default-oauth-client-provider.js";
import type { OAuthMetadataFetch } from "./types.js";

const issuer = "https://auth.example";
const resource = "https://resource.example/mcp";
const close = vi.hoisted(() => vi.fn());
vi.mock("./loopback-authorization.js", async importOriginal => ({
  ...await importOriginal<typeof import("./loopback-authorization.js")>(),
  createLoopbackAuthorizationSession: async () => ({ redirectUri: "http://127.0.0.1:12345/callback", waitForCode: async () => "code", close })
}));
afterEach(() => { vi.restoreAllMocks(); close.mockClear(); });

function register(fetch: OAuthMetadataFetch) {
  const provider = createDefaultOAuthClientProvider({
    client: { mode: "dynamic" }, browser: { openBrowser: async () => {} },
    sessionStore: { load: async () => null, save: async () => {}, clear: async () => {} }
  });
  return provider.handleUnauthorized({ requestUrl: new URL(resource), response: new Response(null, { status: 401 }), challenge: null,
    discovery: { resource, resourceMetadataUrl: `${resource}/metadata`, resourceMetadata: { resource, authorization_servers: [issuer] },
      authorizationServer: issuer, authorizationServerMetadataUrl: `${issuer}/metadata`, authorizationServerMetadata: {
        issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, registration_endpoint: `${issuer}/register`,
        response_types_supported: ["code"], code_challenge_methods_supported: ["S256"]
      } }, fetch });
}

it("uses one registration deadline and forbids redirects", async () => {
  const fetch = vi.fn(async (url: string | URL) => Response.json(String(url).endsWith("/register")
    ? { client_id: "client" } : { access_token: "token", token_type: "Bearer" }));
  await expect(register(fetch)).resolves.toMatchObject({ action: "retry" });
  expect(fetch).toHaveBeenCalledWith(`${issuer}/register`, expect.objectContaining({ signal: expect.any(AbortSignal), redirect: "error" }));
});

it("cancels a stalled registration body and closes the authorization callback on deadline", async () => {
  const deadline = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  const entered = Promise.withResolvers<void>();
  const cancel = vi.fn();
  let bodyController!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream({ start(controller) { bodyController = controller; }, cancel }));
  const observed = register(async () => { entered.resolve(); return response; })
    .then((result) => result.action === "fail" ? result.error : "completed");
  const reason = new Error("registration timeout");
  try {
    await entered.promise;
    await setImmediate();
    deadline.abort(reason);
    expect(await Promise.race([observed, setImmediate().then(() => "still pending")])).toBe(reason);
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
    expect(close).toHaveBeenCalledOnce();
  } finally {
    try { bodyController.close(); } catch { /* Already cancelled. */ }
    await observed;
  }
});
