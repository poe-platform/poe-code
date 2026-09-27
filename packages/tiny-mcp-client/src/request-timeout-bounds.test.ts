import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
import { HttpTransport, JsonRpcMessageLayer } from "./index.js";

it.each([2_147_483_648, Number.MAX_SAFE_INTEGER])("rejects an overflowing default request timer: %s", timeoutMs => {
  const input = new PassThrough(), output = new PassThrough();
  let layer: JsonRpcMessageLayer | undefined;
  try {
    expect(() => { layer = new JsonRpcMessageLayer(input, output, timeoutMs); }).toThrow("requestTimeoutMs");
  } finally { layer?.dispose(); input.destroy(); output.destroy(); }
});

it.each([2_147_483_648, Number.MAX_SAFE_INTEGER])("rejects an overflowing per-request timer before writing: %s", timeoutMs => {
  const input = new PassThrough(), output = new PassThrough();
  const layer = new JsonRpcMessageLayer(input, output);
  const write = vi.spyOn(output, "write");
  let pending: Promise<unknown> | undefined;
  try {
    expect(() => { pending = layer.sendRequest("tools/list", {}, { timeoutMs }); pending.catch(() => undefined); }).toThrow("timeoutMs");
    expect(write).not.toHaveBeenCalled();
  } finally { layer.dispose(); input.destroy(); output.destroy(); }
});

it.each([2_147_483_648, Number.MAX_SAFE_INTEGER])("rejects an overflowing HTTP initialization deadline before fetching: %s", async timeoutMs => {
  const fetch = vi.fn(async () => new Response(null, { status: 202 }));
  const transport = new HttpTransport({ url: "https://mcp.example/tools", fetch });
  try {
    await expect(transport.completeInitialization({ timeoutMs })).rejects.toThrow("timeoutMs");
    expect(fetch).not.toHaveBeenCalled();
  } finally { transport.dispose(); await transport.closed; }
});

it("retains the largest supported timer and explicit unlimited requests", async () => {
  const input = new PassThrough(), output = new PassThrough();
  const layer = new JsonRpcMessageLayer(input, output, 2_147_483_647);
  try {
    const bounded = layer.sendRequest("tools/list", {});
    const unlimited = layer.sendRequest("tools/list", {}, { timeoutMs: null });
    input.write('{"jsonrpc":"2.0","id":1,"result":{}}\n{"jsonrpc":"2.0","id":2,"result":{}}\n');
    await expect(bounded).resolves.toEqual({});
    await expect(unlimited).resolves.toEqual({});
  } finally { layer.dispose(); input.destroy(); output.destroy(); }
});

it.each(["default", "per-request"])("uses no timer for an unlimited %s deadline and still supports cancellation", async mode => {
  const input = new PassThrough(), output = new PassThrough();
  const timer = vi.spyOn(globalThis, "setTimeout");
  let layer: JsonRpcMessageLayer | undefined;
  try {
    layer = new JsonRpcMessageLayer(input, output, mode === "default" ? Infinity : 30_000);
    const controller = new AbortController();
    const request = layer.sendRequest("tools/list", {}, {
      signal: controller.signal,
      ...(mode === "per-request" ? { timeoutMs: Infinity } : {})
    });
    const rejected = expect(request).rejects.toThrow("cancelled");
    controller.abort(new Error("cancelled"));
    await rejected;
    expect(timer).not.toHaveBeenCalled();
  } finally { timer.mockRestore(); layer?.dispose(); input.destroy(); output.destroy(); }
});

it("initializes HTTP with an unlimited deadline without creating a timer", async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 202 }));
  const transport = new HttpTransport({ url: "https://mcp.example/tools", fetch });
  const timer = vi.spyOn(AbortSignal, "timeout");
  try {
    await transport.completeInitialization({ timeoutMs: Infinity });
    expect(fetch).toHaveBeenCalled();
    expect(timer).not.toHaveBeenCalled();
  } finally {
    timer.mockRestore();
    transport.dispose();
    await transport.closed;
  }
});
