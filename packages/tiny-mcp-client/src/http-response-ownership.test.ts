import { setImmediate } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { HttpTransport, JsonRpcMessageLayer } from "./internal.js";

it.each([
  { status: 405, contentType: undefined },
  { status: 404, contentType: undefined },
  { status: 200, contentType: undefined },
  { status: 200, contentType: "application/json" }
])("cancels unused GET bodies for $status/$contentType", async ({ status, contentType }) => {
  const cancel = vi.fn();
  const entered = Promise.withResolvers<void>();
  const transport = new HttpTransport({ url: "https://mcp.invalid/ownership", fetch: async (_url, init) => {
    if (init?.method === "GET") {
      entered.resolve();
      return new Response(new ReadableStream({ cancel }), { status, ...(contentType ? { headers: { "Content-Type": contentType } } : {}) });
    }
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    const request = JSON.parse(String(init?.body));
    return Response.json({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "legacy", version: "1" } } }, { headers: { "Mcp-Session-Id": "session" } });
  } });
  const layer = new JsonRpcMessageLayer(transport.readable, transport.writable, 30_000, transport.closed.then(event => event.reason));
  const initialized = layer.sendRequest("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "owner", version: "1" } }).catch(error => error);
  try {
    await entered.promise;
    await setImmediate();
    expect(cancel).toHaveBeenCalledOnce();
  } finally { layer.dispose(); transport.dispose(); await transport.closed; await initialized; }
});

it.each([200, 405])("cancels unused session termination bodies for status %s", async (status) => {
  const cancel = vi.fn();
  const transport = new HttpTransport({ url: "https://mcp.invalid/ownership", fetch: async (_url, init) => {
    if (init?.method === "GET") return new Response(null, { status: 405 });
    if (init?.method === "DELETE") return new Response(new ReadableStream({ cancel }), { status });
    const request = JSON.parse(String(init?.body));
    return Response.json({ jsonrpc: "2.0", id: request.id, result: {} }, { headers: { "Mcp-Session-Id": "session" } });
  } });
  const layer = new JsonRpcMessageLayer(transport.readable, transport.writable);
  try {
    await layer.sendRequest("initialize", {});
    transport.dispose();
    await transport.closed;
    expect(cancel).toHaveBeenCalledOnce();
  } finally { layer.dispose(); transport.dispose(); await transport.closed; }
});

it("cancels a GET response arriving after disposal without opening its reader", async () => {
  const cancel = vi.fn();
  const entered = Promise.withResolvers<void>();
  const pending = Promise.withResolvers<Response>();
  let source: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({ start(controller) { source = controller; }, cancel });
  const transport = new HttpTransport({ url: "https://mcp.invalid/ownership", fetch: async (_url, init) => {
    if (init?.method === "GET") { entered.resolve(); return pending.promise; }
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    const request = JSON.parse(String(init?.body));
    return Response.json({ jsonrpc: "2.0", id: request.id, result: {} }, { headers: { "Mcp-Session-Id": "session" } });
  } });
  const layer = new JsonRpcMessageLayer(transport.readable, transport.writable);
  try {
    await layer.sendRequest("initialize", {});
    await entered.promise;
    transport.dispose();
    await transport.closed;
    pending.resolve(new Response(body, { headers: { "Content-Type": "text/event-stream" } }));
    await setImmediate();
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  } finally {
    layer.dispose(); transport.dispose();
    pending.resolve(new Response(null, { status: 405 }));
    try { source?.close(); } catch { /* Disposal already canceled this source. */ }
  }
});

it("cancels the unused POST body when an active legacy session expires", async () => {
  const cancel = vi.fn();
  const transport = new HttpTransport({ url: "https://mcp.invalid/ownership", fetch: async (_url, init) => {
    if (init?.method === "GET") return new Response(null, { status: 405 });
    const request = JSON.parse(String(init?.body));
    if (request.method === "expired") return new Response(new ReadableStream({ cancel }), { status: 404 });
    return Response.json({ jsonrpc: "2.0", id: request.id, result: {} }, { headers: { "Mcp-Session-Id": "session" } });
  } });
  const layer = new JsonRpcMessageLayer(transport.readable, transport.writable, 30_000, transport.closed.then(event => event.reason));
  try {
    await layer.sendRequest("initialize", {});
    await expect(layer.sendRequest("expired", {})).rejects.toThrow("session expired");
    expect(cancel).toHaveBeenCalledOnce();
  } finally { layer.dispose(); transport.dispose(); await transport.closed; }
});

it("bounds session termination and aborts a stalled DELETE fetch", async () => {
  const entered = Promise.withResolvers<void>();
  const pending = Promise.withResolvers<Response>();
  let deletionSignal: AbortSignal | null | undefined;
  const transport = new HttpTransport({ url: "https://mcp.invalid/ownership", fetch: async (_url, init) => {
    if (init?.method === "GET") return new Response(null, { status: 405 });
    if (init?.method === "DELETE") { deletionSignal = init.signal; entered.resolve(); return pending.promise; }
    const request = JSON.parse(String(init?.body));
    return Response.json({ jsonrpc: "2.0", id: request.id, result: {} }, { headers: { "Mcp-Session-Id": "session" } });
  } });
  const layer = new JsonRpcMessageLayer(transport.readable, transport.writable);
  try {
    await layer.sendRequest("initialize", {});
    vi.useFakeTimers();
    transport.dispose();
    await entered.promise;
    await vi.advanceTimersByTimeAsync(1000);
    const outcome = await Promise.race([transport.closed, setImmediate().then(() => "still pending")]);
    expect(outcome).toMatchObject({ reason: { message: "HTTP transport session termination timed out" } });
    expect(deletionSignal?.aborted).toBe(true);
  } finally {
    pending.resolve(new Response(null, { status: 405 }));
    layer.dispose(); transport.dispose(); await transport.closed;
    vi.useRealTimers();
  }
});

it("cancels a stalled termination error body and releases its reader at the deadline", async () => {
  const cancel = vi.fn();
  const entered = Promise.withResolvers<void>();
  let source: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({ start(controller) { source = controller; }, cancel });
  const transport = new HttpTransport({ url: "https://mcp.invalid/ownership", fetch: async (_url, init) => {
    if (init?.method === "GET") return new Response(null, { status: 405 });
    if (init?.method === "DELETE") { entered.resolve(); return new Response(body, { status: 500 }); }
    const request = JSON.parse(String(init?.body));
    return Response.json({ jsonrpc: "2.0", id: request.id, result: {} }, { headers: { "Mcp-Session-Id": "session" } });
  } });
  const layer = new JsonRpcMessageLayer(transport.readable, transport.writable);
  try {
    await layer.sendRequest("initialize", {});
    vi.useFakeTimers();
    transport.dispose();
    await entered.promise;
    await vi.advanceTimersByTimeAsync(1000);
    expect(await transport.closed).toMatchObject({ reason: { message: "HTTP transport session termination timed out" } });
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  } finally {
    try { source?.close(); } catch { /* The deadline already canceled this source. */ }
    layer.dispose(); transport.dispose(); await transport.closed;
    vi.useRealTimers();
  }
});
