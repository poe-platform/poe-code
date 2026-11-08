import { expect, it } from "vitest";
import { run } from "../../run.js";
import { getSandboxPrototype } from "../object-model.js";
import { deepCopyFromSandbox, isSandboxClosure } from "../values.js";
import { encodeReplayData } from "../../snapshot/replay-data.js";

it.each(["Uint8Array","Float32Array","BigInt64Array"])("preserves constructed %s prototype after run cleanup", async name => {
  expect(new Function(`return Object.getPrototypeOf(new ${name}(2))===${name}.prototype`)()).toBe(true);
  const values=(await run(`return [new ${name}(2),${name}.prototype]`)).returnValue;
  if(!Array.isArray(values)||values[0]===null||typeof values[0]!=="object") throw new Error("Expected constructed value");
  expect(getSandboxPrototype(values[0])).toBe(values[1]);
});

it.each(["Uint8Array", "Float32Array", "BigInt64Array"])("copies pristine %s default prototypes as data", async name => {
  const value = (await run(`return new ${name}(2)`)).returnValue;
  expect(() => deepCopyFromSandbox(value)).not.toThrow();
  expect(() => encodeReplayData(value)).not.toThrow();
});

it.each([
  "Uint8Array.prototype.marker=7",
  "Object.getPrototypeOf(Uint8Array.prototype).marker=7",
  "Uint8Array.prototype.map.marker=7",
  "Object.prototype.marker=7",
  "Object.setPrototypeOf(value,{marker:7})"
])("rejects lossy data copies after prototype mutation: %s", async mutation => {
  const value = (await run(`const value=new Uint8Array(2);${mutation};return value`)).returnValue;
  expect(() => deepCopyFromSandbox(value)).toThrow();
  expect(() => encodeReplayData(value)).toThrow();
});

it("keeps the originating typed-array prototype and its later mutations", async () => {
  const values=(await run('const value=new Uint8Array([3,5]);return [value,Uint8Array.prototype,()=>{Uint8Array.prototype.marker=7;}]')).returnValue;
  if(!Array.isArray(values)||values[0]===null||typeof values[0]!=="object"||!isSandboxClosure(values[2])) throw new Error("Expected SDK values");
  const other=(await run('return Uint8Array.prototype')).returnValue;
  await values[2].call([],{stack:[],thisValue:undefined});
  expect(getSandboxPrototype(values[0])).toBe(values[1]);
  expect(getSandboxPrototype(values[0])).not.toBe(other);
  expect((values[1] as {marker?:number}).marker).toBe(7);
  expect(() => deepCopyFromSandbox(values[0])).toThrow();
  expect(() => encodeReplayData(values[0])).toThrow();
});
