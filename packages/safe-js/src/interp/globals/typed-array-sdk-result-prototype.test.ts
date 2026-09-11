import { expect, it } from "vitest";
import { run } from "../../run.js";
import { isSandboxClosure } from "../values.js";
import { getSandboxPrototype } from "../object-model.js";
import { isNumericTypedArray } from "../typed-array.js";

it.each(["Uint8Array", "Float32Array", "BigInt64Array"].flatMap(name =>
  ["slice", "subarray", "toReversed", "toSorted", "with", "map", "filter"].map(method => ({ name, method }))
))("preserves SDK $name / $method result prototypes and values", async ({ name, method }) => {
  const big = name === "BigInt64Array";
  const input = big ? "[3n,1n,2n]" : "[3,1,2]";
  const nativeArgs = method === "map" || method === "filter" ? "x=>x" : method === "with" ? `0,${big ? "9n" : "9"}` : "";
  const native = new Function(`const value=new ${name}(${input});const result=value.${method}(${nativeArgs});return [Object.getPrototypeOf(result)===${name}.prototype,Array.from(result)]`)();
  expect(native[0]).toBe(true);
  const source = `const value=new ${name}(${input});return [value.${method},value,${name}.prototype,${method === "map" || method === "filter" ? "x=>x" : "0"}]`;
  const result = await run(source);
  const values = result.returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0])) throw new Error("Expected SDK method");
  const args = method === "map" || method === "filter" ? [values[3]] : method === "with" ? [0, big ? 9n : 9] : [];
  const output = await values[0].call(args, { stack: [], thisValue: values[1] });
  expect(getSandboxPrototype(output)).toBe(values[2]);
  if (!isNumericTypedArray(output)) throw new Error("Expected typed storage");
  expect([...output]).toEqual(native[1]);
});

it.each(["[]", "[1]"])("preserves SDK toSorted prototypes on the short path: %s", async input => {
  const result = await run(`const value=new Uint8Array(${input});return [value.toSorted,value,Uint8Array.prototype]`);
  const values = result.returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0])) throw new Error("Expected SDK method");
  const output = await values[0].call([], { stack: [], thisValue: values[1] });
  expect(getSandboxPrototype(output)).toBe(values[2]);
});
