import { expect, it, vi } from "vitest";
import { setImmediate } from "node:timers/promises";
import { discoverOAuthMetadata } from "./oauth-discovery.js";

it("cancels stalled OAuth metadata bodies when the candidate deadline aborts", async () => {
  const deadline = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  const entered = Promise.withResolvers<void>();
  const cancel = vi.fn();
  let bodyController!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream({ start(controller) { bodyController = controller; }, cancel }));
  const reason = new Error("metadata deadline");
  const observed = discoverOAuthMetadata("https://resource.example/mcp", {
    resourceMetadataUrl: "https://resource.example/metadata", fetch: async () => { entered.resolve(); return response; }
  }).then(() => "completed", (error: unknown) => error);
  try {
    await entered.promise;
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

it("cancels rejected OAuth metadata bodies", async () => {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({ cancel }), { status: 404 });
  await expect(discoverOAuthMetadata("https://resource.example/mcp", {
    fetch: async () => response, resourceMetadataUrl: "https://resource.example/metadata"
  })).rejects.toThrow("404");
  expect(cancel).toHaveBeenCalledOnce();
});

it("bounds declared OAuth metadata response sizes before consuming bodies", async () => {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({ start(controller) { controller.close(); }, cancel }), {
    headers: { "content-length": String(2 * 1024 * 1024) }
  });
  await expect(discoverOAuthMetadata("https://resource.example/mcp", {
    fetch: async () => response, resourceMetadataUrl: "https://resource.example/metadata"
  })).rejects.toThrow("exceeds");
});

it("bounds streamed multibyte OAuth metadata and cancels its reader", async () => {
  const cancel = vi.fn();
  let pulls = 0;
  const chunk = new TextEncoder().encode("🦊".repeat(100_000));
  const response = new Response(new ReadableStream({
    pull(controller) { pulls++; controller.enqueue(chunk); }, cancel
  }));
  await expect(discoverOAuthMetadata("https://resource.example/mcp", {
    fetch: async () => response, resourceMetadataUrl: "https://resource.example/metadata"
  })).rejects.toThrow("exceeds");
  expect(cancel).toHaveBeenCalledOnce();
  expect(pulls).toBeLessThanOrEqual(4);
  expect(response.body?.locked).toBe(false);
});
