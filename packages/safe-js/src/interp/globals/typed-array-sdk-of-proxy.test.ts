import { expect, it } from "vitest";
import { run } from "../../run.js";
import { isSandboxClosure } from "../values.js";
import { isNumericTypedArray } from "../typed-array.js";

it.each([
  { target: 'new Proxy(Uint8Array,{construct(t,a,n){return Reflect.construct(t,a,n)}})', input: '[3,5]' },
  { target: 'Uint8Array', input: '[new Proxy({valueOf(){return 3}},{}),5]' },
  { target: 'new Proxy(new Proxy(Uint8Array,{}),{})', input: '[3,5]' },
  { target: 'new Proxy(Uint8Array,{get construct(){return (t,a,n)=>Reflect.construct(t,a,n)}})', input: '[3,5]' }
])("handles SDK TypedArray.of Proxy operations: $target / $input", async ({ target, input }) => {
  const native = new Function(`return Array.from(Uint8Array.of.apply(${target},${input}))`)();
  expect(native).toEqual([3,5]);
  const values = (await run(`return [Uint8Array.of,${target},${input}]`)).returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0]) || !Array.isArray(values[2])) throw new Error("Expected SDK method and arguments");
  const output = await values[0].call(values[2], { stack: [], thisValue: values[1] });
  if (!isNumericTypedArray(output)) throw new Error("Expected typed storage");
  expect([...output]).toEqual(native);
});

it("preserves SDK TypedArray.of construction and coercion order", async () => {
  const setup = 'const events=[];let target;target=new Proxy(Uint8Array,{construct(t,a,n){events.push(n===target?"construct":"wrong target");return Reflect.construct(t,a,n)}});const input=[1,2].map(n=>new Proxy({[Symbol.toPrimitive](hint){events.push(hint+n);return n+2}},{}));';
  const native = new Function(`${setup}return [Array.from(Uint8Array.of.apply(target,input)),events]`)();
  expect(native).toEqual([[3,4],["construct","number1","number2"]]);
  const values = (await run(`${setup}return [Uint8Array.of,target,input,events]`)).returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0]) || !Array.isArray(values[2])) throw new Error("Expected SDK method and arguments");
  const output = await values[0].call(values[2], { stack: [], thisValue: values[1] });
  if (!isNumericTypedArray(output)) throw new Error("Expected typed storage");
  expect([[...output],values[3]]).toEqual(native);
});

it("converts SDK TypedArray.of Proxy BigInt inputs", async () => {
  const input = '[new Proxy({valueOf(){return 3n}},{}),5n]';
  const native = new Function(`return Array.from(BigInt64Array.of(...${input}))`)();
  const values = (await run(`return [BigInt64Array.of,BigInt64Array,${input}]`)).returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0]) || !Array.isArray(values[2])) throw new Error("Expected SDK method and arguments");
  const output = await values[0].call(values[2], { stack: [], thisValue: values[1] });
  if (!isNumericTypedArray(output)) throw new Error("Expected typed storage");
  expect([...output]).toEqual(native);
});

it.each(["target", "input"])("rejects a revoked SDK TypedArray.of %s", async role => {
  const setup = `const pair=Proxy.revocable(${role === "target" ? "Uint8Array" : "{valueOf(){return 3}}"},{});pair.revoke();`;
  const target = role === "target" ? "pair.proxy" : "Uint8Array";
  const input = role === "input" ? "[pair.proxy]" : "[3]";
  expect(() => new Function(`${setup}return Uint8Array.of.apply(${target},${input})`)()).toThrow(TypeError);
  const values = (await run(`${setup}return [Uint8Array.of,${target},${input}]`)).returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0]) || !Array.isArray(values[2])) throw new Error("Expected SDK method and arguments");
  await expect(values[0].call(values[2], { stack: [], thisValue: values[1] })).rejects.toThrow(TypeError);
});
