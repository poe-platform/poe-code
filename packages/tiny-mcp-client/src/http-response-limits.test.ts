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

it.each(["slow deletion", "failed deletion"])(
  "keeps initialization failure primary despite %s", async mode => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const deleting = Promise.withResolvers<void>(), deletion = Promise.withResolvers<Response>();
    const transport = new HttpTransport({ url: "https://mcp.invalid/limits", maxResponseBytes: 8,
      fetch: async (_url, init) => {
        if (init?.method === "DELETE") { deleting.resolve(); return deletion.promise; }
        if (init?.method !== "POST") return new Response(null, { status: 405 });
        return new Response("123456789", { headers: { "Content-Type": "application/json", "Mcp-Session-Id": "failed-session" } });
      } });
    const client = new McpClient({ clientInfo: { name: "limit-test", version: "1" }, protocolVersion: "2025-03-26" });
    const outcome = client.connect(transport).catch(error => error);
    let cleaned = false;
    void transport.closed.then(() => { cleaned = true; });
    try {
      await Promise.race([deleting.promise, outcome.then(error => { throw error; })]);
      const primary = await transport.closeReason;
      expect(primary.message).toContain("8 bytes");
      expect(cleaned).toBe(false);
      if (mode === "slow deletion") await vi.advanceTimersByTimeAsync(51);
      deletion.resolve(new Response(null, { status: mode === "failed deletion" ? 500 : 204 }));
      const error = await outcome;
      expect(error.message).toContain("8 bytes");
      expect(error).toBe(primary);
      const closed = await transport.closed;
      if (mode === "failed deletion") expect(closed.reason).toMatchObject({ status: 500, method: "DELETE" });
      else expect(closed.reason).toBe(error);
    } finally {
      deletion.resolve(new Response(null, { status: 204 }));
      await client.close(); transport.dispose(); await transport.closed; vi.useRealTimers();
    }
  }
);

it("keeps a receive-stream failure primary when final initialization and deletion overlap", async () => {
  const receiving = Promise.withResolvers<Response>(), initialized = Promise.withResolvers<void>();
  const transport = new HttpTransport({ url: "https://mcp.invalid/limits", fetch: async (_url, init) => {
    if (init?.method === "GET") return receiving.promise;
    if (init?.method === "DELETE") return new Response(null, { status: 500 });
    const request = JSON.parse(String(init?.body));
    if (request.method === "notifications/initialized") {
      receiving.resolve(new Response(null, { status: 403 }));
      await new Promise<void>(resolve => setImmediate(resolve));
      initialized.resolve();
      return new Response(null, { status: 202 });
    }
    return Response.json({ jsonrpc: "2.0", id: request.id, result: {
      protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "qa", version: "1" }
    } }, { headers: { "Mcp-Session-Id": "owned-session" } });
  } });
  const client = new McpClient({ clientInfo: { name: "limit-test", version: "1" }, protocolVersion: "2025-03-26" });
  try {
    const error = await client.connect(transport).catch(error => error);
    await initialized.promise;
    expect(error).toMatchObject({ status: 403, method: "GET", rpcMethod: "notifications/initialized" });
    expect((await transport.closed).reason).toMatchObject({ status: 500, method: "DELETE" });
  } finally { receiving.resolve(new Response(null, { status: 405 })); await client.close(); transport.dispose(); await transport.closed; }
});
