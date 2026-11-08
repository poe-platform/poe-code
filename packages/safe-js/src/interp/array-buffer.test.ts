import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { deepCopyFromSandbox, deepCopyToSandbox, isSandboxClosure, measureSandboxData } from "./values.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it.each([
  "const buffer=new ArrayBuffer(12);return [buffer.byteLength,buffer instanceof ArrayBuffer,Object.prototype.toString.call(buffer)]",
  "const value=new Float32Array([1,2,3]);return [value.buffer.byteLength,value.buffer===value.subarray(1).buffer,value.buffer===value.slice(1).buffer]",
  "const buffer=new ArrayBuffer(12);const all=new Float32Array(buffer);const view=new Float32Array(buffer,4,2);view[0]=7;return [Array.from(all),view.byteOffset,view.buffer===buffer]",
  "const trace=[];const buffer=new ArrayBuffer({valueOf(){trace.push('length');return 8}});return [buffer.byteLength,trace]",
  "return [-1,Infinity,Symbol('x'),BigInt(1)].map(length=>{try{new ArrayBuffer(length);return 'accepted'}catch(error){return error.name}})"
])("matches native ArrayBuffer foundation: %s", async source => {
  expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext(`(function(){${source}})()`) });
});

it.each([false, true])("preserves imported buffer/view aliases in either order (bufferFirst=%s)", bufferFirst => {
  const buffer = new ArrayBuffer(12);
  const view = new Float32Array(buffer, 4, 2);
  view[0] = 7;
  const input = bufferFirst ? [buffer, view] : [view, buffer];
  const output = deepCopyFromSandbox(deepCopyToSandbox(input));
  expect(Array.isArray(output)).toBe(true);
  const copied = output as [ArrayBuffer | Float32Array, ArrayBuffer | Float32Array];
  const copiedBuffer = copied[bufferFirst ? 0 : 1];
  const copiedView = copied[bufferFirst ? 1 : 0];
  expect(copiedBuffer).toBeInstanceOf(ArrayBuffer);
  expect(copiedBuffer).not.toBe(buffer);
  expect(copiedView).toBeInstanceOf(Float32Array);
  expect((copiedView as Float32Array).buffer).toBe(copiedBuffer);
  expect(Array.from(copiedView as Float32Array)).toEqual([7, 0]);
});

it("preserves exposed buffer identity through snapshot round trips", async () => {
  const source = "const value=new Float32Array([1,2,3]);const buffer=value.buffer;const view=new Float32Array(buffer,4,2);return ()=>{view[0]=7;return [buffer===value.buffer,buffer===view.buffer,Array.from(value)]}";
  const initial = await run(source);
  expect(initial.ok).toBe(true);
  let read = initial.returnValue;
  expect(isSandboxClosure(read)).toBe(true);
  for (let round = 0; round < 2; round++) {
    const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "external", bindings: { read } }], callStack: [], pendingPromises: [], moduleBindings: {} });
    const result = restore(JSON.parse(JSON.stringify(saved)), { source }).currentScope.lookup("read");
    if (!result.found || !isSandboxClosure(result.value)) throw new Error("Missing restored reader");
    expect(await result.value.call([])).toEqual([true, true, [1, 7, 3]]);
    read = result.value;
  }
});

it("counts buffer metadata retained only through a view", () => {
  const buffer = new ArrayBuffer(8);
  Object.defineProperty(buffer, "payload", { value: "x".repeat(1000) });
  expect(measureSandboxData([new Float32Array(buffer)])).toBeGreaterThan(1000);
});

it("copies buffer metadata and back-references retained only through a view", () => {
  const buffer = new ArrayBuffer(8);
  const view = new Float32Array(buffer);
  Object.defineProperty(buffer, "owner", { value: view });
  const imported = deepCopyToSandbox(view) as Float32Array;
  expect(Object.getOwnPropertyDescriptor(imported.buffer, "owner")?.value).toBe(imported);
  const exported = deepCopyFromSandbox(imported) as Float32Array;
  expect(Object.getOwnPropertyDescriptor(exported.buffer, "owner")?.value).toBe(exported);
});
