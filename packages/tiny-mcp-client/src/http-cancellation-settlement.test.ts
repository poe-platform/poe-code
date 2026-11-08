import { setImmediate } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { HttpTransport, JsonRpcMessageLayer } from "./internal.js";

it.each(["GET expiration", "POST expiration", "DELETE completion"])(
  "settles legacy %s without awaiting stalled cancellation", async (mode) => {
    const cancellation = Promise.withResolvers<void>();
    const cancel = vi.fn(() => cancellation.promise);
    const body = new ReadableStream({ cancel });
    const transport = new HttpTransport({ url: "https://example.test/mcp", fetch: async (_url, init) => {
      if (init?.method === "GET") return mode === "GET expiration"
        ? new Response(body, { status: 404 }) : new Response(null, { status: 405 });
      if (init?.method === "DELETE") return mode === "DELETE completion"
        ? new Response(body, { status: 200 }) : new Response(null, { status: 204 });
      const request = JSON.parse(String(init?.body));
      if (request.method === "expired") return new Response(body, { status: 404 });
      return Response.json({ jsonrpc: "2.0", id: request.id, result: {} },
        { headers: { "Mcp-Session-Id": "session" } });
    } });
    const layer = new JsonRpcMessageLayer(transport.readable, transport.writable, 30_000,
      transport.closed.then((event) => event.reason));
    let outcome: unknown;
    let operation: Promise<void> | undefined;
    try {
      await layer.sendRequest("initialize", {});
      if (mode === "DELETE completion") {
        transport.dispose();
        operation = transport.closed.then((event) => { outcome = event; });
      } else if (mode === "POST expiration") {
        operation = layer.sendRequest("expired", {}).then((value) => { outcome = value; },
          (error) => { outcome = error; });
      } else operation = transport.closed.then((event) => { outcome = event.reason; });
      await setImmediate();
      expect(cancel).toHaveBeenCalledOnce();
      if (mode === "DELETE completion") expect(outcome).toMatchObject({ reason: { message: "HTTP transport disposed" } });
      else expect(outcome).toMatchObject({ message: expect.stringContaining("session expired") });
    } finally {
      cancellation.resolve();
      layer.dispose(); transport.dispose();
      await operation; await transport.closed;
    }
  }
);

it.each(["unsupported media type", "malformed SSE", "completed SSE"])(
  "settles %s without awaiting stalled cancellation", async (mode) => {
    const cancellation = Promise.withResolvers<void>();
    const cancel = vi.fn(() => cancellation.promise);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        if (mode !== "unsupported media type") {
          const data = mode === "completed SSE"
            ? JSON.stringify({ jsonrpc: "2.0", id: 1, result: { resultType: "complete", success: true } })
            : "not JSON";
          controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
        }
      }, cancel
    });
    const transport = new HttpTransport({ url: "https://example.test/mcp", fetch: async () =>
      new Response(body, { headers: { "Content-Type": mode === "unsupported media type"
        ? "text/plain" : "text/event-stream" } }) });
    const layer = new JsonRpcMessageLayer(transport.readable, transport.writable, 30_000,
      transport.closed.then((event) => event.reason));
    let outcome: unknown;
    const operation = layer.sendRequest("own", { _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {}
    } }).then((value) => { outcome = value; }, (error) => { outcome = error; });
    try {
      await setImmediate();
      expect(cancel).toHaveBeenCalledOnce();
      if (mode === "completed SSE") expect(outcome).toMatchObject({ success: true });
      else expect(outcome).toBeInstanceOf(Error);
      expect(body.locked).toBe(false);
    } finally {
      cancellation.resolve();
      layer.dispose(); transport.dispose();
      await operation; await transport.closed;
    }
  }
);
