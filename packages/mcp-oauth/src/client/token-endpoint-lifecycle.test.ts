import { setImmediate } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { exchangeAuthorizationCode } from "./token-endpoint.js";

const input = { tokenEndpoint: "https://auth.example/token", clientId: "client", clientSecret: "secret",
  code: "code", codeVerifier: "verifier", redirectUri: "http://localhost/callback", resource: "https://resource.example/mcp", now: () => 0 };

it("uses a deadline and forbids redirecting token exchange credentials", async () => {
  const fetch = vi.fn(async () => Response.json({ access_token: "token", token_type: "Bearer" }));
  await exchangeAuthorizationCode({ ...input, fetch });
  expect(fetch).toHaveBeenCalledWith(input.tokenEndpoint, expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }));
});

it("cancels and releases a stalled token body when its deadline aborts", async () => {
  const deadline = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  const cancel = vi.fn();
  let bodyController!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream({ start(controller) { bodyController = controller; }, cancel }));
  const reason = new Error("token exchange timeout");
  const invocation = exchangeAuthorizationCode({ ...input, fetch: async () => response });
  const observed = invocation.then(() => "completed", (error: unknown) => error);
  try {
    await setImmediate();
    deadline.abort(reason);
    expect(await Promise.race([observed, setImmediate().then(() => "still pending")])).toBe(reason);
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  } finally {
    try { bodyController.close(); } catch { /* Already cancelled. */ }
    await observed;
    timeout.mockRestore();
  }
});
