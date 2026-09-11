import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";

it.each(["join()", "values().next()", "set([])", "slice()", "subarray()"])("matches native out-of-bounds view method %s", async method => {
  const source = `const buffer=new ArrayBuffer(8,{maxByteLength:16});const view=new Float32Array(buffer,4,1);buffer.resize(0);try{view.${method};return 'accepted'}catch(error){return error.name}`;
  expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext(`(function(){${source}})()`) });
});

it("preserves length tracking in subarray when end is omitted", async () => {
  const source = "const buffer=new ArrayBuffer(8,{maxByteLength:16});const view=new Float32Array(buffer);const tail=view.subarray(1);buffer.resize(16);return [tail.length,tail.byteOffset,tail.buffer===buffer]";
  expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext(`(function(){${source}})()`) });
});
