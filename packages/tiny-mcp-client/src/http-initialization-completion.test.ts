import { expect, it, vi } from "vitest";
import { HttpTransport, McpClient } from "./index.js";
const url = "https://resource.example/mcp";
function fixture(notificationStatus = 202) {
  const methods: string[] = [];
  const fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    if (init?.method !== "POST") return new Response(null, { status: 405 });
    const request = JSON.parse(String(init.body)); methods.push(request.method);
    if (request.method === "notifications/initialized") return new Response(null, { status: notificationStatus });
    return Response.json({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "synthetic", version: "1" } } });
  });
  const transport = new HttpTransport({ url, fetch });
  const client = new McpClient({ clientInfo: { name: "test", version: "1" }, protocolVersion: "2025-03-26" });
  return { methods, fetch, transport, client };
}
it("completes the initialized POST before connect returns and an immediate close", async () => {
  const f = fixture();
  try {
    await f.client.connect(f.transport);
    expect(f.methods).toEqual(["initialize", "notifications/initialized"]);
  } finally { await f.client.close(); f.transport.dispose(); await f.transport.closed; }
});
it("rejects connection when initialization completion fails instead of reporting ready", async () => {
  const f = fixture(403);
  try { await expect(f.client.connect(f.transport)).rejects.toMatchObject({ status: 403, method: "POST" }); }
  finally { await f.client.close(); f.transport.dispose(); await f.transport.closed; }
});

it("preserves cancellation while the initialized POST is stalled", async () => {
  const f = fixture(), entered = Promise.withResolvers<void>();
  const base = f.fetch.getMockImplementation()!;
  const controller = new AbortController(), reason = { canceled: "initialization completion" };
  f.fetch.mockImplementation(async (input, init) => {
    if (init?.body && JSON.parse(String(init.body)).method === "notifications/initialized") {
      entered.resolve();
      return new Promise((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
        if (init.signal!.aborted) reject(init.signal!.reason);
      });
    }
    return base(input, init);
  });
  const observed = f.client.connect(f.transport, { signal: controller.signal }).catch(error => error);
  try { await entered.promise; controller.abort(reason); expect(await observed).toBe(reason); }
  finally { controller.abort(reason); await f.client.close(); f.transport.dispose(); await f.transport.closed; }
});

it("bounds a stalled initialized POST with the connection request deadline", async () => {
  const f = fixture(), entered = Promise.withResolvers<void>(), deadline = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  const base = f.fetch.getMockImplementation()!;
  const reason = new Error("completion deadline");
  f.fetch.mockImplementation(async (input, init) => {
    if (init?.body && JSON.parse(String(init.body)).method === "notifications/initialized") {
      entered.resolve();
      return new Promise((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
        if (init.signal!.aborted) reject(init.signal!.reason);
      });
    }
    return base(input, init);
  });
  const observed = f.client.connect(f.transport).catch(error => error);
  try { await entered.promise; deadline.abort(reason); expect(await observed).toBe(reason); }
  finally { deadline.abort(reason); await f.client.close(); f.transport.dispose(); await f.transport.closed; timeout.mockRestore(); }
});
