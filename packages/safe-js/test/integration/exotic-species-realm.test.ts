import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../src/run.js";
import { dump } from "../../src/dump.js";
import { restore } from "../../src/restore.js";
import { isSandboxClosure } from "../../src/interp/values.js";

// ECMA-262 edition 16, 10.4.2.3 steps 4-5: a foreign intrinsic Array
// is discarded before @@species lookup. A Proxy around it is not discarded.
it.each(["slice()", "map(x=>x)", "filter(x=>true)", "concat()", "flat()", "flatMap(x=>x)", "splice(0,1)"])(
  "uses the current realm default without reading foreign Array species: %s", async method => {
    const source = `return C=>{const a=[1];a.constructor=C;try{const result=a.${method};return [Object.getPrototypeOf(result)===Array.prototype,result[0]]}catch(e){return e}}`;
    const foreign = "Object.defineProperty(Array,Symbol.species,{get(){throw 73}});await 0;return [Array,new Proxy(Array,{})]";
    const native = runInNewContext(`(()=>{${source}})()`);
    const nativeConstructors = await runInNewContext(`(async()=>{${foreign}})()`);
    expect(native(nativeConstructors[0])).toEqual([true, 1]);
    expect(native(nativeConstructors[1])).toBe(73);
    const fn = (await run(source)).returnValue;
    const original = await run(foreign);
    const replay = await run(foreign, { snapshot: restore(JSON.parse(await dump(original)), { source: foreign }) });
    if (!isSandboxClosure(fn)) throw new Error("Expected guest method");
    for (const state of [original, replay]) {
      expect(state.ok).toBe(true);
      if (!Array.isArray(state.returnValue)) throw new Error("Expected foreign constructors");
      expect(await fn.call([state.returnValue[0]], { stack: [], thisValue: undefined })).toEqual([true, 1]);
      expect(await fn.call([state.returnValue[1]], { stack: [], thisValue: undefined })).toBe(73);
    }
  }
);

it("still reads same-realm Array species after its global binding is replaced", async () => {
  const source = "const C=Array;Object.defineProperty(C,Symbol.species,{get(){throw 71}});globalThis.Array=null;try{[].slice()}catch(e){return e}";
  expect(runInNewContext(`(()=>{${source}})()`)).toBe(71);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: 71 });
});
