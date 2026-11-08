import { generateKeyPair, SignJWT } from "jose";
import { expect, it, vi } from "vitest";
import { createJwksTokenVerifier } from "./index.js";

const issuer = "https://auth.example";
const resource = "https://resource.example/mcp";
const pair = await generateKeyPair("ES256");
const token = await new SignJWT({}).setProtectedHeader({ alg: "ES256", typ: "JWT" })
  .setIssuer(issuer).setAudience(resource).setExpirationTime("2m").sign(pair.privateKey);
const input = { token, resource, authorizationServers: [issuer], requiredScopes: [] };

it("disables automatic redirects during JWKS retrieval", async () => {
  const fetch = vi.fn(async () => Response.json({ keys: [] }));
  const verifier = createJwksTokenVerifier({ jwksUrl: `${issuer}/jwks`, fetch });
  await expect(verifier.verify(input)).rejects.toBeDefined();
  expect(fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ redirect: "error" }));
});

it("rejects redirected JWKS responses and cancels their bodies", async () => {
  const response = Response.json({ keys: [] });
  Object.defineProperty(response, "redirected", { value: true });
  const cancel = vi.spyOn(response.body!, "cancel");
  const verifier = createJwksTokenVerifier({ jwksUrl: `${issuer}/jwks`, fetch: async () => response });
  await expect(verifier.verify(input)).rejects.toMatchObject({ error: "temporarily_unavailable" });
  expect(cancel).toHaveBeenCalledOnce();
});

it("cancels rejected JWKS bodies before returning temporary unavailability", async () => {
  const cancel = vi.fn();
  const verifier = createJwksTokenVerifier({ jwksUrl: `${issuer}/jwks`, fetch: async () =>
    new Response(new ReadableStream({ cancel }), { status: 503 }) });
  await expect(verifier.verify(input)).rejects.toMatchObject({ error: "temporarily_unavailable" });
  expect(cancel).toHaveBeenCalledOnce();
});

it("rejects oversized declared JWKS bodies without reading them", async () => {
  const response = new Response('{"keys":[]}', { headers: { "content-length": String(2 * 1024 * 1024) } });
  const cancel = vi.spyOn(response.body!, "cancel");
  const verifier = createJwksTokenVerifier({ jwksUrl: `${issuer}/jwks`, fetch: async () => response });
  await expect(verifier.verify(input)).rejects.toMatchObject({ error: "temporarily_unavailable" });
  expect(cancel).toHaveBeenCalledOnce();
});

it("cancels streamed multibyte JWKS after the byte bound", async () => {
  const cancel = vi.fn();
  let pulls = 0;
  const chunk = new TextEncoder().encode("🦊".repeat(100_000));
  const response = new Response(new ReadableStream({ pull(controller) { pulls++; controller.enqueue(chunk); }, cancel }));
  const verifier = createJwksTokenVerifier({ jwksUrl: `${issuer}/jwks`, fetch: async () => response });
  await expect(verifier.verify(input)).rejects.toMatchObject({ error: "temporarily_unavailable" });
  expect(cancel).toHaveBeenCalledOnce();
  expect(pulls).toBeLessThanOrEqual(4);
  expect(response.body?.locked).toBe(false);
});

it("cancels and releases a stalled JWKS body when the fetch timeout aborts", async () => {
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  const entered = Promise.withResolvers<void>();
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({ cancel }));
  const verifier = createJwksTokenVerifier({ jwksUrl: `${issuer}/jwks`, fetch: async () => { entered.resolve(); return response; } });
  const observed = expect(verifier.verify(input)).rejects.toMatchObject({ error: "temporarily_unavailable" });
  try {
    await entered.promise;
    controller.abort(new Error("timeout"));
    await observed;
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  } finally { timeout.mockRestore(); }
});
