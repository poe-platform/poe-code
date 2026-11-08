import { expect, it } from "vitest";
import { run } from "../../run.js";
import { isSandboxClosure } from "../values.js";
import { getSandboxPrototype } from "../object-model.js";

it.each(["ArrayBuffer", "Uint8Array", "Float32Array"].flatMap(name => [
  'new Proxy({}, {get(t,k,r){if(k===Symbol.species)return r===holder?C:undefined}})',
  'Object.create(new Proxy({}, {get(t,k,r){if(k===Symbol.species)return r===holder?C:undefined}}))',
  'new Proxy({}, {get get(){return (t,k)=>k===Symbol.species?C:undefined}})',
  '({[Symbol.species]:new Proxy(C,{construct(t,args,n){return Reflect.construct(t,args,n)}})})',
  '({[Symbol.species]:C})'
].map(holder => ({ name, holder }))))("honors species in SDK $name.slice: $holder", async ({ name, holder }) => {
  const setup = `class C extends ${name}{};const value=new ${name}(4);const holder=${holder};value.constructor=holder;`;
  expect(new Function(`${setup}return value.slice(1) instanceof C`)()).toBe(true);
  const result = await run(`${setup}return [value.slice,value,C.prototype]`);
  const values = result.returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0])) throw new Error("Expected SDK slice");
  const sliced = await values[0].call([1], { stack: [], thisValue: values[1] });
  expect(getSandboxPrototype(sliced)).toBe(values[2]);
});

it.each(["ArrayBuffer", "Uint8Array", "Float32Array"])("rejects revoked SDK %s species lookup", async name => {
  const setup = `const value=new ${name}(4);const r=Proxy.revocable({},{});value.constructor=r.proxy;r.revoke();`;
  expect(() => new Function(`${setup}return value.slice(1)`)()).toThrow(TypeError);
  const result = await run(`${setup}return [value.slice,value]`);
  const values = result.returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0])) throw new Error("Expected SDK slice");
  await expect(values[0].call([1], { stack: [], thisValue: values[1] })).rejects.toThrow(TypeError);
});
