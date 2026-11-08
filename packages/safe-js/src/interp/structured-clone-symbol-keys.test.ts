import { expect, it } from "vitest";
import { run } from "../run.js";
import { deepCopyToSandbox, deepCopyFromSandbox } from "./values.js";

it.each(['{}', '[1,,3]'])("omits symbol-keyed data and accessors from %s", async initial => {
  const source = `const value=${initial};const key=Symbol("key");value[key]=Symbol("uncloneable");let reads=0;Object.defineProperty(value,Symbol("getter"),{enumerable:true,get(){reads++;throw 1}});value.extra=7;const copy=structuredClone(value);return [Object.keys(copy),copy.extra,Object.getOwnPropertySymbols(copy).length,reads];`;
  expect(await run(source)).toMatchObject({ok:true,returnValue:Function(source)()});
});

it("ignores a symbol-keyed closure during transfer validation", async () => {
  const source = 'const buffer=new ArrayBuffer(1);const value={buffer,[Symbol("callback")]:()=>1};const copy=structuredClone(value,{transfer:[buffer]});return [buffer.detached,copy.buffer.byteLength,Object.getOwnPropertySymbols(copy).length]';
  expect(await run(source)).toMatchObject({ok:true,returnValue:Function(source)()});
});

it("keeps symbol-keyed data in ordinary sandbox copying", () => {
  const key = Symbol("key");
  const source = { [key]: 7 };
  const copy = deepCopyFromSandbox(deepCopyToSandbox(source)) as typeof source;
  expect(copy[key]).toBe(7);
});

it("still rejects native symbol-keyed accessors during host imports", () => {
  let reads = 0;
  const source = {get [Symbol("key")]() { reads++; return 7; }};
  expect(() => deepCopyToSandbox(source)).toThrow("accessor property");
  expect(reads).toBe(0);
});
