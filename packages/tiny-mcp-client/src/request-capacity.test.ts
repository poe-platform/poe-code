import { PassThrough } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { expect, it } from "vitest";
import { JsonRpcMessageLayer, createInMemoryTransportPair } from "./internal.js";

it("bounds outstanding exchanges and recovers capacity after cancellation", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const layer = new JsonRpcMessageLayer(input, output);
  const requests = Array.from({ length: 128 }, () => layer.sendRequest("tools/list", {}, { timeoutMs: null }).catch(() => undefined));
  try {
    expect(() => {
      const request = layer.sendRequest("tools/list", {}, { timeoutMs: null });
      requests.push(request.catch(() => undefined));
    }).toThrow("capacity");
    expect(layer.cancelRequest(1, new Error("cancelled"))).toBe(true);
    await requests[0];
    const recovered = layer.sendRequest("tools/list", {}, { timeoutMs: null }).catch(() => undefined);
    expect(layer.cancelRequest(129, new Error("cancelled"))).toBe(true);
    await recovered;
  } finally {
    layer.dispose();
    await Promise.all(requests);
    input.destroy();
    output.destroy();
  }
});

it.each(["abort", "dispose"])("cancels an MRTR callback wait promptly with %s", async (action) => {
  const { clientTransport, serverTransport } = createInMemoryTransportPair();
  const client = new JsonRpcMessageLayer(clientTransport.readable, clientTransport.writable, 30_000, undefined, 1);
  const server = new JsonRpcMessageLayer(serverTransport.readable, serverTransport.writable);
  client.requestMetadata = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": { roots: {} }
  };
  const entered = Promise.withResolvers<void>();
  const response = Promise.withResolvers<{ roots: [] }>();
  let signal: AbortSignal | undefined;
  client.onInputRequest("roots/list", (_params, context) => {
    signal = context.signal;
    entered.resolve(); return response.promise;
  });
  server.onRequest("tools/call", () => ({ resultType: "input_required", inputRequests: { roots: { method: "roots/list" } } }));
  server.onRequest("tools/list", () => ({ resultType: "complete", tools: [], ttlMs: 0, cacheScope: "private" }));
  const controller = new AbortController();
  const reason = new Error("stop callback wait");
  const operation = client.sendRequest("tools/call", { name: "work", arguments: {} }, { signal: controller.signal, timeoutMs: null });
  const observed = operation.then(() => "completed", (error) => error);
  try {
    await entered.promise;
    expect(signal).toBeInstanceOf(AbortSignal);
    if (action === "abort") controller.abort(reason);
    else client.dispose(reason);
    expect(await Promise.race([observed, setImmediate().then(() => "still pending")])).toBe(reason);
    expect(signal?.aborted).toBe(true);
    if (action === "abort") await expect(client.sendRequest("tools/list", {})).resolves.toMatchObject({ tools: [] });
    else expect(controller.signal.aborted).toBe(false);
  } finally {
    controller.abort(reason); response.resolve({ roots: [] });
    client.dispose(); server.dispose(); clientTransport.dispose();
    await observed;
  }
});

it.each([0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])("rejects an invalid concurrent request limit %s", (limit) => {
  const input = new PassThrough();
  const output = new PassThrough();
  try {
    expect(() => new JsonRpcMessageLayer(input, output, 30_000, undefined, limit))
      .toThrow("maxConcurrentRequests must be a positive safe integer");
  } finally { input.destroy(); output.destroy(); }
});

it("retains exchange capacity while waiting for an MRTR callback", async () => {
  const { clientTransport, serverTransport } = createInMemoryTransportPair();
  const client = new JsonRpcMessageLayer(clientTransport.readable, clientTransport.writable, 30_000, undefined, 1);
  const server = new JsonRpcMessageLayer(serverTransport.readable, serverTransport.writable);
  client.requestMetadata = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": { roots: {} }
  };
  const entered = Promise.withResolvers<void>();
  const response = Promise.withResolvers<{ roots: [] }>();
  client.onInputRequest("roots/list", () => { entered.resolve(); return response.promise; });
  let attempt = 0;
  server.onRequest("tools/call", () => attempt++ === 0
    ? { resultType: "input_required", inputRequests: { roots: { method: "roots/list" } } }
    : { resultType: "complete", content: [] });
  const operation = client.sendRequest("tools/call", { name: "work", arguments: {} }, { timeoutMs: null });
  try {
    await entered.promise;
    expect(() => client.sendRequest("tools/list", {}, { timeoutMs: null })).toThrow("capacity");
    response.resolve({ roots: [] });
    await expect(operation).resolves.toMatchObject({ resultType: "complete" });
    await expect(client.sendRequest("tools/call", { name: "work", arguments: {} }))
      .resolves.toMatchObject({ resultType: "complete" });
  } finally {
    response.resolve({ roots: [] });
    client.dispose(); server.dispose(); clientTransport.dispose();
    await operation.catch(() => undefined);
  }
});
