import { expect, it, vi } from "vitest";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";
import { encodeReplayData, decodeReplayData } from "./replay-data.js";
import { serializeSafeJSSnapshot } from "./dump-format.js";

it.each(["snapshot", "replay"])("preserves supported capacities during %s restoration", route => {
  const source = "return 0";
  for (const capacity of [undefined, 0, 4, 16]) {
    const length = capacity === 0 ? 0 : 4;
    const buffer = new ArrayBuffer(length, capacity === undefined ? undefined : { maxByteLength: capacity });
    new Uint8Array(buffer).fill(7);
    const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "external", bindings: { buffer } }], callStack: [], pendingPromises: [], moduleBindings: {} });
    const binding = route === "snapshot" ? restore(saved, { source }).currentScope.lookup("buffer") : undefined;
    const restored = (route === "replay" ? decodeReplayData(encodeReplayData(buffer)) : binding?.found ? binding.value : undefined) as ArrayBuffer;
    expect(restored).not.toBe(buffer);
    expect(restored.resizable).toBe(capacity !== undefined);
    expect(restored.maxByteLength).toBe(capacity ?? length);
    expect(Array.from(new Uint8Array(restored))).toEqual(Array.from(new Uint8Array(buffer)));
  }
});

it.each(["snapshot", "replay"])("rejects silent resizable-buffer downgrades during %s restoration", route => {
  const source = "return 0";
  const construct = Reflect.construct;
  for (const [length, capacity] of [[0, 0], [0, 16], [4, 4], [4, 16]]) {
    const buffer = new ArrayBuffer(length, { maxByteLength: capacity });
    const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "external", bindings: { buffer } }], callStack: [], pendingPromises: [], moduleBindings: {} });
    const replay = encodeReplayData(buffer);
    const legacy = vi.spyOn(Reflect, "construct").mockImplementation((target, args, newTarget) =>
      construct(target, target === ArrayBuffer ? [args[0]] : args, newTarget ?? target));
    try {
      expect(() => route === "snapshot" ? restore(saved, { source }) : decodeReplayData(replay))
        .toThrow("Resizable ArrayBuffer restoration is not supported by this host.");
    } finally { legacy.mockRestore(); }
  }
});

it.each([false, true])("preserves buffer/view aliases in snapshot order (bufferFirst=%s)", bufferFirst => {
  const buffer = new ArrayBuffer(12);
  const view = new Float32Array(buffer, 4, 2);
  view[0] = 7;
  const values = bufferFirst ? [buffer, view] : [view, buffer];
  const source = "return 0";
  const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "external", bindings: { values } }], callStack: [], pendingPromises: [], moduleBindings: {} });
  const output = restore(JSON.parse(JSON.stringify(saved)), { source }).currentScope.lookup("values");
  if (!output.found || !Array.isArray(output.value)) throw new Error("Missing restored values");
  const result = output.value[bufferFirst ? 1 : 0] as Float32Array;
  expect(result.buffer).toBe(output.value[bufferFirst ? 0 : 1]);
  expect(Array.from(result)).toEqual([7, 0]);
});

it.each(["false-tracking", "nonzero-tracking-length", "fixed-tracking", "beyond-capacity", "misaligned-offset"])("rejects malformed Float32 view layout: %s", corruption => {
  const source = "return 0";
  const saved = JSON.parse(JSON.stringify(serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "external", bindings: { view: new Float32Array(2) } }], callStack: [], pendingPromises: [], moduleBindings: {} })));
  const nodes = Object.values(saved.heap as Record<string, Record<string, unknown>>);
  const view = nodes.find(node => node.kind === "float32array")!;
  const buffer = nodes.find(node => node.kind === "arraybuffer")!;
  if (corruption === "false-tracking") view.lengthTracking = false;
  if (corruption === "nonzero-tracking-length") view.lengthTracking = true;
  if (corruption === "fixed-tracking") { view.lengthTracking = true; view.length = 0; }
  if (corruption === "beyond-capacity") { buffer.maxByteLength = 16; view.byteOffset = 16; }
  if (corruption === "misaligned-offset") view.byteOffset = 1;
  expect(() => restore(saved, { source })).toThrow();
});

it.each([false, true])("preserves buffer/view aliases in replay order (bufferFirst=%s)", bufferFirst => {
  const buffer = new ArrayBuffer(12);
  const view = new Float32Array(buffer, 4, 2);
  view[0] = 7;
  const values = bufferFirst ? [buffer, view] : [view, buffer];
  const output = decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(values))));
  if (!Array.isArray(output)) throw new Error("Missing replay values");
  const result = output[bufferFirst ? 1 : 0] as Float32Array;
  expect(result.buffer).toBe(output[bufferFirst ? 0 : 1]);
  expect(Array.from(result)).toEqual([7, 0]);
});

it("records explicit buffers in diagnostic dumps", () => {
  const buffer = new ArrayBuffer(8);
  const saved = JSON.parse(serializeSafeJSSnapshot({ sourceHash: "buffer", values: [buffer, new Float32Array(buffer)] }));
  expect(Object.values(saved.heap)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "arraybuffer" })]));
});

it("restores replay buffers whose metadata points back to their view", () => {
  const buffer = new ArrayBuffer(8);
  const view = new Float32Array(buffer);
  Object.defineProperty(buffer, "owner", { value: view, enumerable: true });
  const result = decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(view)))) as Float32Array;
  expect(Object.getOwnPropertyDescriptor(result.buffer, "owner")?.value).toBe(result);
});

it.each(["negative-byte", "fractional-byte", "two-payloads", "missing-payload", "small-capacity", "fractional-capacity", "infinite-capacity"])("rejects malformed buffer storage: %s", corruption => {
  const source = "return 0";
  const saved = JSON.parse(JSON.stringify(serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "external", bindings: { buffer: new ArrayBuffer(8) } }], callStack: [], pendingPromises: [], moduleBindings: {} })));
  const buffer = Object.values(saved.heap as Record<string, Record<string, unknown>>).find(node => node.kind === "arraybuffer")!;
  if (corruption === "negative-byte") (buffer.bytes as number[])[0] = -1;
  if (corruption === "fractional-byte") (buffer.bytes as number[])[0] = 0.5;
  if (corruption === "two-payloads") buffer.buffer = { kind: "ref", id: 1 };
  if (corruption === "missing-payload") delete buffer.bytes;
  if (corruption === "small-capacity") buffer.maxByteLength = 4;
  if (corruption === "fractional-capacity") buffer.maxByteLength = 8.5;
  if (corruption === "infinite-capacity") buffer.maxByteLength = Infinity;
  expect(() => restore(saved, { source })).toThrow();
});
