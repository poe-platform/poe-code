import { expect, it, vi } from "vitest";
import { HttpTransport, JsonRpcMessageLayer, McpClient } from "./index.js";

it("cancels an oversized open SSE body before releasing its reader", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode("data: " + "x".repeat(100))); },
    cancel
  });
  const transport = new HttpTransport({
    url: "https://mcp.invalid/limits", maxResponseBytes: 64,
    fetch: async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } })
  });
  const layer = new JsonRpcMessageLayer(transport.readable, transport.writable);
  void transport.closed.then(({ reason }) => layer.dispose(reason));
  try {
    await expect(layer.sendRequest("tools/list", {})).rejects.toThrow("64 bytes");
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  } finally {
    layer.dispose();
    transport.dispose();
  }
});

it.each([0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])(
  "rejects invalid HTTP response byte limit %s before starting transport work",
  (maxResponseBytes) => {
    expect(() => new HttpTransport({
      url: "https://mcp.invalid/limits", maxResponseBytes
    })).toThrow("positive safe integer");
  }
);

it.each([200, 400])("bounds HTTP %s JSON bodies and propagates the failure", async (status) => {
  const transport = new HttpTransport({
    url: "https://mcp.invalid/limits",
    maxResponseBytes: 64,
    fetch: async (_url: string | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      return Response.json(status === 200
        ? { jsonrpc: "2.0", id: request.id, result: { text: "x".repeat(100) } }
        : { jsonrpc: "2.0", id: request.id, error: { code: -32020, message: "x".repeat(100) } },
      { status });
    }
  });
  const layer = new JsonRpcMessageLayer(transport.readable, transport.writable);
  void transport.closed.then(({ reason }) => layer.dispose(reason));
  try {
    await expect(layer.sendRequest("tools/list", {})).rejects.toThrow("64 bytes");
  } finally {
    layer.dispose();
    transport.dispose();
  }
});

it.each(["declared bytes", "stream bytes", "malformed UTF-8"])(
  "preserves initialization %s failure while session deletion is pending", async mode => {
    const deletion = Promise.withResolvers<Response>(), deleting = Promise.withResolvers<void>();
    const transport = new HttpTransport({ url: "https://mcp.invalid/limits", maxResponseBytes: 8,
      fetch: async (_url, init) => {
        if (init?.method === "DELETE") { deleting.resolve(); return deletion.promise; }
        if (init?.method !== "POST") return new Response(null, { status: 405 });
        await new Promise<void>(resolve => setImmediate(resolve));
        const headers = { "Content-Type": "application/json", "Mcp-Session-Id": "failed-initialization",
          ...(mode === "declared bytes" ? { "Content-Length": "9" } : {}) };
        return new Response(mode === "malformed UTF-8" ? Uint8Array.of(0xff) : "123456789", { headers });
      } });
    const client = new McpClient({ clientInfo: { name: "limit-test", version: "1" }, protocolVersion: "2025-03-26" });
    const outcome = client.connect(transport).catch(error => error);
    try {
      await Promise.race([deleting.promise, outcome.then(error => { throw error; })]);
      await new Promise<void>(resolve => setImmediate(resolve));
      deletion.resolve(new Response(null, { status: 204 }));
      const error = await outcome;
      expect(error).toBeInstanceOf(Error);
      if (mode === "malformed UTF-8") expect(error.message).toContain("encoded data");
      else expect(error.message).toContain("8 bytes");
      expect((await transport.closed).reason).toBe(error);
    } finally {
      deletion.resolve(new Response(null, { status: 204 }));
      await client.close(); transport.dispose(); await transport.closed;
    }
  }
);
