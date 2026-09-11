import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { deepCopyFromSandbox, deepCopyToSandbox, isSandboxClosure } from "./values.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";
import { encodeReplayData, decodeReplayData } from "../snapshot/replay-data.js";

it.each([
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const view=new Float32Array(buffer);view[0]=7;return ()=>{buffer.resize(12);return [view.length,view.byteOffset,Array.from(view)]}",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const view=new Float32Array(buffer).subarray(1);return ()=>{buffer.resize(16);return [view.length,view.byteOffset,Array.from(view)]}",
  "const buffer=new ArrayBuffer(12,{maxByteLength:16});const view=new Float32Array(buffer,4,2);buffer.resize(4);return ()=>{buffer.resize(12);return [view.length,view.byteOffset,Array.from(view)]}",
  "const buffer=new ArrayBuffer(12,{maxByteLength:16});const view=new Float32Array(buffer,8);buffer.resize(4);return ()=>{buffer.resize(16);return [view.length,view.byteOffset,Array.from(view)]}"
])("preserves resizable Float32 view layout through snapshots: %s", async source => {
  const expected = runInNewContext(`(function(){${source}})()()`);
  let read = (await run(source)).returnValue;
  for (let round = 0; round < 2; round++) {
    const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "external", bindings: { read } }], callStack: [], pendingPromises: [], moduleBindings: {} });
    const result = restore(JSON.parse(JSON.stringify(saved)), { source }).currentScope.lookup("read");
    if (!result.found || !isSandboxClosure(result.value)) throw new Error("Missing restored reader");
    expect(await result.value.call([])).toEqual(expected);
    read = result.value;
  }
});

it.each([
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const view=new Float32Array(buffer);view[0]=7;return view",
  "const buffer=new ArrayBuffer(12,{maxByteLength:16});const view=new Float32Array(buffer,4,2);buffer.resize(4);return view",
  "const buffer=new ArrayBuffer(12,{maxByteLength:16});const view=new Float32Array(buffer,8);buffer.resize(4);return view"
])("preserves resizable view layout through replay and data copies: %s", async source => {
  const expected = runInNewContext(`(function(){${source}})()`) as Float32Array;
  const original = (await run(source)).returnValue;
  const resize = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resize")!.value;
  Reflect.apply(resize, expected.buffer, [16]);
  for (const copy of [decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(original)))),
    deepCopyFromSandbox(deepCopyToSandbox(original))]) {
    const view = copy as Float32Array;
    Reflect.apply(resize, view.buffer, [16]);
    expect([view.length, view.byteOffset, Array.from(view)]).toEqual([expected.length, expected.byteOffset, Array.from(expected)]);
  }
});
