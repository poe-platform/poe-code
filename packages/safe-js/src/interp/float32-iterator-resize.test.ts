import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";
import { isSandboxClosure } from "./values.js";

it.each(["keys", "values", "entries"])("preserves %s cursor after a temporary out-of-bounds error", async method => {
  const source = `const buffer=new ArrayBuffer(12,{maxByteLength:16});const view=new Float32Array(buffer,4,2);view.set([1,2]);const iterator=view.${method}();const first=iterator.next();buffer.resize(4);let errorName;try{iterator.next()}catch(error){errorName=error.name}buffer.resize(12);return [first,errorName,iterator.next(),iterator.next()]`;
  expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext(`(function(){${source}})()`) });
});

it.each(["keys", "values", "entries"])("restores a temporarily out-of-bounds %s cursor", async method => {
  const source = `const buffer=new ArrayBuffer(12,{maxByteLength:16});const view=new Float32Array(buffer,4,2);const iterator=view.${method}();iterator.next();buffer.resize(4);return ()=>{let errorName;try{iterator.next()}catch(error){errorName=error.name}buffer.resize(12);return [errorName,iterator.next(),iterator.next()]}`;
  const native = runInNewContext(`(function(){${source}})()`) as () => unknown;
  let read = (await run(source)).returnValue;
  for (let round = 0; round < 2; round++) {
    const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "external", bindings: { read } }], callStack: [], pendingPromises: [], moduleBindings: {} });
    const result = restore(JSON.parse(JSON.stringify(saved)), { source }).currentScope.lookup("read");
    if (!result.found || !isSandboxClosure(result.value)) throw new Error("Missing restored reader");
    expect(await result.value.call([])).toEqual(native());
    read = result.value;
  }
});

it.each(["keys", "values", "entries"])("keeps an exhausted tracking %s iterator exhausted after regrowth", async method => {
  const source = `const buffer=new ArrayBuffer(8,{maxByteLength:16});const view=new Float32Array(buffer);const iterator=view.${method}();buffer.resize(0);const first=iterator.next();buffer.resize(12);return [first,iterator.next()]`;
  // ECMAScript 2026 ArrayIteratorPrototype.next clears its source on exhaustion.
  // Node 22 resumes after regrowth here, so it is not the oracle for this control.
  expect(await run(source)).toMatchObject({ ok: true, returnValue: [
    { value: undefined, done: true }, { value: undefined, done: true }
  ] });
});
