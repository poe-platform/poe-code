import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../run.js";
import { deepCopyFromSandbox, deepCopyToSandbox, isSandboxClosure } from "./values.js";
import { encodeReplayData, decodeReplayData } from "../snapshot/replay-data.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it.each([
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});buffer.resize(12);return [buffer.byteLength,buffer.maxByteLength,buffer.resizable]",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const view=new Float32Array(buffer);return [view.length,view.byteLength,view.buffer===buffer]",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const view=new Float32Array(buffer);view[0]=7;buffer.resize(12);return [view.length,Array.from(view)]",
  "const buffer=new ArrayBuffer(7,{maxByteLength:16});const view=new Float32Array(buffer);buffer.resize(11);return [view.length,view.byteLength,view.byteOffset]",
  "const buffer=new ArrayBuffer(7,{maxByteLength:16});const view=new Float32Array(buffer,4);return [view.length,view.byteLength,view.byteOffset]",
  "try{new Float32Array(new ArrayBuffer(7));return 'accepted'}catch(error){return error.name}",
  "const buffer=new ArrayBuffer(4,{maxByteLength:16});const view=new Float32Array(buffer,0,{valueOf(){buffer.resize(12);return 3}});return [view.length,buffer.byteLength]",
  "const buffer=new ArrayBuffer(12,{maxByteLength:16});try{new Float32Array(buffer,0,{valueOf(){buffer.resize(4);return 3}});return 'accepted'}catch(error){return [error.name,buffer.byteLength]}",
  "return [new Float32Array(2),new ArrayBuffer(8),{},Float32Array.prototype].map(value=>ArrayBuffer.isView(value))"
])("matches native resizable-buffer operations: %s", async source => {
  expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext(`(function(){${source}})()`) });
});

it("preserves resizable capacity through host data copies", () => {
  const buffer = Reflect.construct(ArrayBuffer, [8, { maxByteLength: 16 }]) as ArrayBuffer;
  const copied = deepCopyFromSandbox(deepCopyToSandbox(buffer));
  expect(Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "maxByteLength")!.get!.call(copied)).toBe(16);
  expect(Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")!.get!.call(copied)).toBe(true);
});

it("preserves resizable capacity through replay data", () => {
  const buffer = Reflect.construct(ArrayBuffer, [8, { maxByteLength: 16 }]) as ArrayBuffer;
  const copied = decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(buffer))));
  expect(Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "maxByteLength")!.get!.call(copied)).toBe(16);
  expect(Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")!.get!.call(copied)).toBe(true);
});

it("preserves guest resizable capacity through snapshot round trips", async () => {
  const source = "const buffer=new ArrayBuffer(8,{maxByteLength:16});return ()=>[buffer.byteLength,buffer.maxByteLength,buffer.resizable]";
  let read = (await run(source)).returnValue;
  for (let round = 0; round < 2; round++) {
    const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "external", bindings: { read } }], callStack: [], pendingPromises: [], moduleBindings: {} });
    const result = restore(JSON.parse(JSON.stringify(saved)), { source }).currentScope.lookup("read");
    if (!result.found || !isSandboxClosure(result.value)) throw new Error("Missing restored reader");
    expect(await result.value.call([])).toEqual([8, 16, true]);
    read = result.value;
  }
});
