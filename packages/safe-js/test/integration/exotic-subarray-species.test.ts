import { expect, it } from "vitest";
import { run } from "../../src/run.js";

// ECMA-262 edition 16, %TypedArray%.prototype.subarray:
// auto length with undefined end passes TWO constructor arguments, not three.
it.each(["Uint8Array", "Float32Array", "BigInt64Array"].flatMap(name => [
  { view: "new T(buffer)", end: "", count: 2 },
  { view: "new T(buffer)", end: ",undefined", count: 2 },
  { view: "new T(buffer)", end: ",2", count: 3 },
  { view: "new T(buffer,0,3)", end: "", count: 3 }
].map(options => ({ name, ...options }))))(
  "preserves species argument count for $name $view end=$end", async ({ name, view, end, count }) => {
    const source = `const T=${name};const buffer=new ArrayBuffer(3*T.BYTES_PER_ELEMENT,{maxByteLength:6*T.BYTES_PER_ELEMENT});const a=${view};let seen; a.constructor={ [Symbol.species]:function(...args){seen=[args.length,args[0]===buffer,args[1]];return Reflect.construct(T,args)}};const result=a.subarray(1${end});return [seen,result.buffer===buffer]`;
    const expected = [[count, true, name === "Uint8Array" ? 1 : name === "Float32Array" ? 4 : 8], true];
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  }
);
