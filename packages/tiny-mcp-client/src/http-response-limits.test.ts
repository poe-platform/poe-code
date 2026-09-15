import { expect, it, vi } from "vitest";
import { HttpTransport, JsonRpcMessageLayer } from "./index.js";

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
