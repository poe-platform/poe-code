import { expect, it } from "vitest";
import { run } from "../../run.js";
import { isSandboxClosure } from "../values.js";
import { isNumericTypedArray } from "../typed-array.js";

it.each([
  'new Proxy({length:2,0:7,1:9},{get(t,k,r){return Reflect.get(t,k,r)}})',
  'Object.create(new Proxy({length:2,0:7,1:9},{get(t,k,r){return Reflect.get(t,k,r)}}))',
  'new Proxy({*[Symbol.iterator](){yield 7;yield 9}},{get(t,k,r){return Reflect.get(t,k,r)}})',
  '({[Symbol.iterator]:new Proxy(function*(){yield 7;yield 9},{apply(t,r,a){return Reflect.apply(t,r,a)}})})',
  '({[Symbol.iterator](){let i=0;return new Proxy({next(){return {done:i===2,value:7+2*i++}}},{get(t,k,r){return Reflect.get(t,k,r)}})}})',
  'new Proxy({length:2,0:7,1:9},{get get(){return (t,k,r)=>Reflect.get(t,k,r)}})',
  'new Proxy(new Proxy({length:2,0:7,1:9},{get(t,k,r){return Reflect.get(t,k,r)}}),{})',
  '({[Symbol.iterator](){let i=0;return {next(){return new Proxy({done:i===2,value:7+2*i++},{get(t,k,r){return Reflect.get(t,k,r)}})}}}})',
  '(()=>{const value=Object.create(new Proxy({get length(){if(this!==value)throw Error("receiver");return 2},0:7,1:9},{}));return value})()'
])("constructs SDK typed arrays from Proxy input: %s", async input => {
  const native = new Function(`return Array.from(new Uint8Array(${input}))`)();
  expect(native).toEqual([7,9]);
  const result = await run(`return [Uint8Array,${input}]`);
  const values = result.returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0])) throw new Error("Expected SDK constructor");
  const output = await values[0].construct!([values[1]], { stack: [], thisValue: undefined });
  if (!isNumericTypedArray(output)) throw new Error("Expected typed storage");
  expect([...output]).toEqual(native);
});

it("rejects a revoked SDK typed-array input", async () => {
  const setup = 'const pair=Proxy.revocable({length:2,0:7,1:9},{});pair.revoke();';
  expect(() => new Function(`${setup}return new Uint8Array(pair.proxy)`)()).toThrow(TypeError);
  const result = await run(`${setup}return [Uint8Array,pair.proxy]`);
  const values = result.returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0])) throw new Error("Expected SDK constructor");
  await expect(values[0].construct!([values[1]], { stack: [], thisValue: undefined })).rejects.toThrow(TypeError);
});
