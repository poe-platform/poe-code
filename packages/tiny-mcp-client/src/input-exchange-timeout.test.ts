import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
import { JsonRpcMessageLayer } from "./index.js";

it("keeps the request deadline active while modern server input waits for its host callback", async () => {
  const input = new PassThrough(), output = new PassThrough();
  const layer = new JsonRpcMessageLayer(input, output, 20, undefined, 1);
  layer.requestMetadata = { "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": { elicitation: { form: {} } } };
  let started!: () => void, signal!: AbortSignal, finish!: (value: { action: "decline" }) => void;
  const sent: { id: number; method: string }[] = [];
  output.on("data", chunk => { sent.push(JSON.parse(String(chunk))); });
  const entered = new Promise<void>(resolve => { started = resolve; });
  layer.onInputRequest("elicitation/create", (_params, context) => {
    signal = context.signal; started(); return new Promise(resolve => { finish = resolve; });
  });
  const onTimeout = vi.fn();
  let settled = false;
  vi.useFakeTimers();
  try {
    const outcome = layer.sendRequest("tools/call", { name: "confirm" }, { onTimeout }).catch(error => error).finally(() => { settled = true; });
    input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { resultType: "input_required", inputRequests: {
      question: { method: "elicitation/create", params: { message: "Confirm", requestedSchema: { type: "object", properties: {} } } }
    } } }) + "\n");
    await entered;
    await vi.advanceTimersByTimeAsync(20);
    expect(settled).toBe(true);
    expect(await outcome).toMatchObject({ message: 'JSON-RPC request "tools/call" timed out after 20ms' });
    expect(signal.aborted).toBe(true); expect(onTimeout).toHaveBeenCalledExactlyOnceWith(1);
    const recovered = layer.sendRequest("tools/list", {}, { timeoutMs: null });
    input.write(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { resultType: "complete", tools: [], ttlMs: 0, cacheScope: "private" } }) + "\n");
    await expect(recovered).resolves.toMatchObject({ tools: [] });
    finish({ action: "decline" }); await vi.advanceTimersByTimeAsync(0);
    expect(sent.map(request => request.method)).toEqual(["tools/call", "tools/list"]);
    expect(vi.getTimerCount()).toBe(0);
  } finally { layer.dispose(); input.destroy(); output.destroy(); vi.useRealTimers(); }
});

it("uses one deadline across modern continuations and notifies the latest request ID once", async () => {
  const input = new PassThrough(), output = new PassThrough(), layer = new JsonRpcMessageLayer(input, output, 100);
  layer.requestMetadata = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": { roots: {} } };
  let started!: () => void, finish!: (value: { roots: [] }) => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  layer.onInputRequest("roots/list", () => { started(); return new Promise(resolve => { finish = resolve; }); });
  const sent: { id: number }[] = []; output.on("data", chunk => { sent.push(JSON.parse(String(chunk))); });
  const onTimeout = vi.fn(); let settled = false;
  vi.useFakeTimers();
  try {
    const outcome = layer.sendRequest("tools/call", { name: "work" }, { timeoutMs: 20, onTimeout }).catch(error => error).finally(() => { settled = true; });
    input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { resultType: "input_required", inputRequests: { workspace: { method: "roots/list" } } } }) + "\n");
    await entered; await vi.advanceTimersByTimeAsync(10); finish({ roots: [] }); await vi.advanceTimersByTimeAsync(0);
    expect(sent.map(request => request.id)).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(9); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(settled).toBe(true);
    expect(await outcome).toMatchObject({ message: 'JSON-RPC request "tools/call" timed out after 20ms' });
    expect(onTimeout).toHaveBeenCalledExactlyOnceWith(2); expect(vi.getTimerCount()).toBe(0);
  } finally { layer.dispose(); input.destroy(); output.destroy(); vi.useRealTimers(); }
});

it("keeps an explicitly unlimited modern exchange active during its callback", async () => {
  const input = new PassThrough(), output = new PassThrough(), layer = new JsonRpcMessageLayer(input, output, 20);
  layer.requestMetadata = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": { roots: {} } };
  let started!: () => void, finish!: (value: { roots: [] }) => void, signal!: AbortSignal;
  const entered = new Promise<void>(resolve => { started = resolve; });
  layer.onInputRequest("roots/list", (_params, context) => { signal = context.signal; started(); return new Promise(resolve => { finish = resolve; }); });
  const onTimeout = vi.fn();
  vi.useFakeTimers();
  try {
    const outcome = layer.sendRequest("tools/call", { name: "work" }, { timeoutMs: null, onTimeout });
    input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { resultType: "input_required", inputRequests: { workspace: { method: "roots/list" } } } }) + "\n");
    await entered; await vi.advanceTimersByTimeAsync(100_000);
    expect(signal.aborted).toBe(false); expect(onTimeout).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    finish({ roots: [] }); await vi.advanceTimersByTimeAsync(0);
    input.write(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { resultType: "complete", content: [] } }) + "\n");
    await expect(outcome).resolves.toMatchObject({ content: [] });
  } finally { layer.dispose(); input.destroy(); output.destroy(); vi.useRealTimers(); }
});

it("propagates a throwing timeout observer without letting its timer crash the host", async () => {
  const input = new PassThrough(), output = new PassThrough(), layer = new JsonRpcMessageLayer(input, output, 20);
  const reason = new Error("timeout observer failed");
  vi.useFakeTimers();
  try {
    const outcome = layer.sendRequest("tools/list", {}, { onTimeout: () => { throw reason; } }).catch(error => error);
    await vi.advanceTimersByTimeAsync(20); expect(await outcome).toBe(reason); expect(vi.getTimerCount()).toBe(0);
  } finally { layer.dispose(); input.destroy(); output.destroy(); vi.useRealTimers(); }
});
