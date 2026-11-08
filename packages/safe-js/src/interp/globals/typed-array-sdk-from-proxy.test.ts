import { expect, it } from "vitest";
import { run } from "../../run.js";
import { isSandboxClosure } from "../values.js";
import { isNumericTypedArray } from "../typed-array.js";

it.each([
  { input: 'new Proxy({length:2,0:3,1:5},{})', mapper: 'x=>x*2', target: 'Uint8Array' },
  { input: 'new Proxy({*[Symbol.iterator](){yield 3;yield 5}}, {})', mapper: 'x=>x*2', target: 'Uint8Array' },
  { input: '[3,5]', mapper: 'new Proxy(x=>x*2,{apply(t,r,a){return Reflect.apply(t,r,a)}})', target: 'Uint8Array' },
  { input: '[3,5]', mapper: 'x=>x*2', target: 'new Proxy(Uint8Array,{construct(t,a,n){return Reflect.construct(t,a,n)}})' },
  { input: 'Object.create(new Proxy({length:2,0:3,1:5},{}))', mapper: 'x=>x*2', target: 'Uint8Array' },
  { input: 'new Proxy({length:2,0:3,1:5},{get get(){return (t,k,r)=>Reflect.get(t,k,r)}})', mapper: 'x=>x*2', target: 'Uint8Array' },
  { input: '[3,5]', mapper: 'new Proxy(x=>x*2,{get apply(){return (t,r,a)=>Reflect.apply(t,r,a)}})', target: 'Uint8Array' },
  { input: '[3,5]', mapper: 'x=>x*2', target: 'new Proxy(new Proxy(Uint8Array,{}),{get construct(){return (t,a,n)=>Reflect.construct(t,a,n)}})' }
])("handles SDK TypedArray.from Proxy operations: $input / $mapper / $target", async ({ input, mapper, target }) => {
  const native = new Function(`return Array.from(Uint8Array.from.call(${target},${input},${mapper}))`)();
  expect(native).toEqual([6,10]);
  const values = (await run(`return [Uint8Array.from,${target},${input},${mapper}]`)).returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0])) throw new Error("Expected SDK method");
  const output = await values[0].call([values[2],values[3]], { stack: [], thisValue: values[1] });
  if (!isNumericTypedArray(output)) throw new Error("Expected typed storage");
  expect([...output]).toEqual(native);
});

it("preserves the SDK Proxy mapper receiver and index", async () => {
  const setup = 'const receiver={factor:2};const mapper=new Proxy(function(x,i){if(this!==receiver)throw Error("receiver");return x*this.factor+i},{apply(t,r,a){return Reflect.apply(t,r,a)}});';
  const native = new Function(`${setup}return Array.from(Uint8Array.from([3,5],mapper,receiver))`)();
  expect(native).toEqual([6,11]);
  const values = (await run(`${setup}return [Uint8Array.from,Uint8Array,[3,5],mapper,receiver]`)).returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0])) throw new Error("Expected SDK method");
  const output = await values[0].call([values[2],values[3],values[4]], { stack: [], thisValue: values[1] });
  if (!isNumericTypedArray(output)) throw new Error("Expected typed storage");
  expect([...output]).toEqual(native);
});

it.each(["input", "mapper", "target"])("rejects a revoked SDK TypedArray.from %s", async role => {
  const setup = `const pair=Proxy.revocable(${role === "input" ? "[3,5]" : role === "mapper" ? "x=>x*2" : "Uint8Array"},{});pair.revoke();`;
  const input = role === "input" ? "pair.proxy" : "[3,5]";
  const mapper = role === "mapper" ? "pair.proxy" : "x=>x*2";
  const target = role === "target" ? "pair.proxy" : "Uint8Array";
  expect(() => new Function(`${setup}return Uint8Array.from.call(${target},${input},${mapper})`)()).toThrow(TypeError);
  const values = (await run(`${setup}return [Uint8Array.from,${target},${input},${mapper}]`)).returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0])) throw new Error("Expected SDK method");
  await expect(values[0].call([values[2],values[3]], { stack: [], thisValue: values[1] })).rejects.toThrow(TypeError);
});
