import { PassThrough } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { expect, it, onTestFinished, vi } from "vitest";
import { JsonRpcMessageLayer, type McpRequestContext } from "./internal.js";

function setup(limit = 128) {
  const input = new PassThrough();
  const output = new PassThrough();
  const frames: Array<{ id: number; error?: { code: number }; result?: unknown }> = [];
  output.on("data", (chunk) => frames.push(JSON.parse(chunk.toString())));
  const layer = new JsonRpcMessageLayer(input, output, 30_000, undefined, limit);
  onTestFinished(() => { layer.dispose(); input.destroy(); output.destroy(); });
  return { input, layer, frames };
}

it("rejects duplicate active server request IDs without invoking another callback", async () => {
  const { input, layer, frames } = setup();
  const finish = Promise.withResolvers<string>();
  const handler = vi.fn(() => finish.promise);
  layer.onRequest("work", handler);
  try {
    input.write('{"jsonrpc":"2.0","id":1,"method":"work"}\n');
    input.write('{"jsonrpc":"2.0","id":1,"method":"work"}\n');
    await setImmediate();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(frames).toEqual([{ jsonrpc: "2.0", id: 1, error: { code: -32600, message: "Duplicate active server request ID" } }]);
  } finally { layer.dispose(); finish.resolve("done"); }
});

it("retains cancelled callback capacity until its work settles", async () => {
  const { input, layer, frames } = setup(1);
  const finish = Promise.withResolvers<string>();
  let context: McpRequestContext | undefined;
  const handler = vi.fn((_params, request) => { context = request; return finish.promise; });
  layer.onRequest("work", handler);
  try {
    input.write('{"jsonrpc":"2.0","id":1,"method":"work"}\n');
    input.write('{"jsonrpc":"2.0","id":2,"method":"work"}\n');
    await setImmediate();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(frames).toMatchObject([{ id: 2, error: { code: -32000 } }]);
    input.write('{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":1}}\n');
    input.write('{"jsonrpc":"2.0","id":3,"method":"work"}\n');
    await setImmediate();
    expect(context?.signal?.aborted).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(frames).toMatchObject([{ id: 2, error: { code: -32000 } }, { id: 3, error: { code: -32000 } }]);
    finish.resolve("done");
    await setImmediate();
    input.write('{"jsonrpc":"2.0","id":4,"method":"work"}\n');
    await setImmediate();
    expect(handler).toHaveBeenCalledTimes(2);
    expect(frames.at(-1)).toMatchObject({ id: 4, result: "done" });
    expect(frames.some((frame) => frame.id === 1)).toBe(false);
  } finally { layer.dispose(); finish.resolve("done"); }
});

it("notifies a legacy callback when its connection is disposed", async () => {
  const { input, layer } = setup();
  const finish = Promise.withResolvers<string>();
  let context: McpRequestContext | undefined;
  layer.onRequest("work", (_params, request) => { context = request; return finish.promise; });
  try {
    input.write('{"jsonrpc":"2.0","id":1,"method":"work"}\n');
    await setImmediate();
    layer.dispose(new Error("closed"));
    expect(context?.signal?.aborted).toBe(true);
  } finally { finish.resolve("done"); }
});

it.each([undefined, NaN, () => undefined, { value: undefined }])("returns an internal error for non-JSON callback results: %s", async (value) => {
  const { input, layer, frames } = setup();
  layer.onRequest("work", () => value);
  input.write('{"jsonrpc":"2.0","id":1,"method":"work"}\n');
  await setImmediate();
  expect(frames).toMatchObject([{ id: 1, error: { code: -32603 } }]);
  expect(frames[0]).not.toHaveProperty("result");
});
