import { expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { coerceThrownValue } from "./exceptions.js";

it.each(["Float32Array", "Float64Array", "Uint8Array", "Int8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array"])
  ("rejects out-of-bounds %s clones without changing their backing storage", async name => {
    const source = `const Type=${name};const width=Type.BYTES_PER_ELEMENT;
      const buffer=new ArrayBuffer(width*4,{maxByteLength:width*8});
      const view=new Type(buffer,width,2);buffer.resize(width);
      let error;try{structuredClone({view})}catch(caught){error=[caught.name,caught.code]}
      const after=buffer.byteLength;buffer.resize(width*4);
      return [error,after,view.length,view.buffer===buffer];`;
    const expected = Function(source)();
    expect(expected[0]).toEqual(["DataCloneError",25]);
    expect(await run(source)).toMatchObject({ok:true,returnValue:expected});
  });

it("still clones an in-bounds zero-length typed view", async () => {
  const source = "const buffer=new ArrayBuffer(4,{maxByteLength:8});const view=new Uint8Array(buffer,4,0);const copy=structuredClone(view);return [copy.length,copy.byteOffset,copy.buffer.byteLength,copy.buffer!==buffer]";
  expect(await run(source)).toMatchObject({ok:true,returnValue:Function(source)()});
});

it.each([
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const view=new Uint8Array(buffer,4);buffer.resize(2);",
  "const buffer=new ArrayBuffer(8);const view=new Uint8Array(buffer);buffer.transfer();",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const view=new Uint8Array(buffer,4,0);buffer.resize(2);"
])("rejects invalid length-tracking, detached and zero-length view clones: %s", setup => {
  const source = `${setup}try{structuredClone(view);return "accepted"}catch(error){return [error.name,error.code]}`;
  return expect(run(source)).resolves.toMatchObject({ok:true,returnValue:Function(source)()});
});

it("reads the native DOMException code without invoking a replacement getter", () => {
  const failure = new DOMException("invalid clone", "DataCloneError");
  Object.defineProperty(failure, "code", { get() { throw new Error("Untrusted code getter ran"); } });
  expect(coerceThrownValue(failure, new Budget(), [])).toMatchObject({ name:"DataCloneError", code:25 });
  const ordinary = Object.assign(new Error("ordinary"), { code:25 });
  expect(coerceThrownValue(ordinary, new Budget(), [])).not.toHaveProperty("code");
});
