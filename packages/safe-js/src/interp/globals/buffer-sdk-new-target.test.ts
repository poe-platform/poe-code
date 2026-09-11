import { expect, it } from "vitest";
import { run } from "../../run.js";
import { isSandboxClosure } from "../values.js";
import { getSandboxPrototype } from "../object-model.js";

it.each(["ArrayBuffer", "Uint8Array", "Float32Array"].flatMap(name => [
  'new Proxy(Target,{get(t,k,r){return k==="prototype"?prototype:Reflect.get(t,k,r)}})',
  'new Proxy(new Proxy(Target,{get(t,k,r){return k==="prototype"?prototype:Reflect.get(t,k,r)}}),{})',
  'new Proxy(Target,{get get(){return (t,k,r)=>k==="prototype"?prototype:Reflect.get(t,k,r)}})',
  '(Target.prototype=prototype,Target)'
].map(target => ({ name, target }))))("uses newTarget.prototype in SDK $name construction: $target", async ({ name, target }) => {
  const setup = `const prototype={marker:7};function Target(){};const NewTarget=${target};`;
  const native = new Function(`${setup}return Object.getPrototypeOf(Reflect.construct(${name},[4],NewTarget))===prototype`)();
  expect(native).toBe(true);
  const result = await run(`${setup}return [${name},NewTarget,prototype]`);
  const values = result.returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0]) || !isSandboxClosure(values[1]))
    throw new Error("Expected SDK constructors");
  const constructed = await values[0].construct!([4], { stack: [], thisValue: undefined, newTarget: values[1] });
  expect(getSandboxPrototype(constructed)).toBe(values[2]);
});

it.each(["ArrayBuffer", "Uint8Array", "Float32Array"])("rejects a revoked SDK %s newTarget", async name => {
  const result = await run(`const r=Proxy.revocable(function(){},{});r.revoke();return [${name},r.proxy]`);
  const values = result.returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0]) || !isSandboxClosure(values[1]))
    throw new Error("Expected SDK constructors");
  await expect(values[0].construct!([4], { stack: [], thisValue: undefined, newTarget: values[1] }))
    .rejects.toThrow(TypeError);
});

it.each(["Uint8Array", "Float32Array", "BigInt64Array"].flatMap(name =>
  ["undefined", "null", "7"].map(prototype => ({ name, prototype }))
))("uses the SDK $name intrinsic fallback for primitive prototype $prototype after run", async ({ name, prototype }) => {
  const setup = `function Target(){};Target.prototype=${prototype};`;
  expect(new Function(`${setup}return Object.getPrototypeOf(Reflect.construct(${name},[2],Target))===${name}.prototype`)()).toBe(true);
  const result = await run(`${setup}return [${name},Target,${name}.prototype]`);
  const values = result.returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0]) || !isSandboxClosure(values[1]))
    throw new Error("Expected SDK constructors");
  const constructed = await values[0].construct!([2], { stack: [], thisValue: undefined, newTarget: values[1] });
  expect(getSandboxPrototype(constructed)).toBe(values[2]);
});
