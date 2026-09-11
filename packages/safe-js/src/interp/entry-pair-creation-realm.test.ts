import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { deepCopyFromSandbox, isSandboxClosure } from "./values.js";

it.each([
  "[3].entries()", "new Uint8Array([3]).entries()",
  "new Float32Array([3]).entries()", "new Map([[1,3]]).entries()",
  "new Set([3]).entries()"
])("retains iterator entry-pair realm: %s", async expression => {
  const source = `const iterator=${expression};return [()=>iterator.next().value,Array.prototype,()=>{Array.prototype.marker=9}]`;
  const native = runInNewContext(`(()=>{${source}})()`);
  const expected = native[0]();
  expect(Object.getPrototypeOf(expected) === native[1]).toBe(true);
  const exported = (await run(source)).returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  const reader = (await run("return value=>value.marker")).returnValue;
  if (!Array.isArray(exported) || !isSandboxClosure(exported[0]) || !isSandboxClosure(exported[2]) || !isSandboxClosure(getter) || !isSandboxClosure(reader)) throw new Error("Expected SDK exports");
  const context = { stack: [], thisValue: undefined };
  const result = await exported[0].call([], context);
  expect(await getter.call([result], context) === exported[1]).toBe(true);
  expect(deepCopyFromSandbox(result)).toEqual(expected);
  await exported[2].call([], context);
  expect(await reader.call([result], context)).toBe(9);
  expect(() => deepCopyFromSandbox(result)).toThrow();
});

it("preserves entry payloads and does not re-prototype values or keys", async () => {
  const source = `const value=[];Object.setPrototypeOf(value,null);const key=Object.create(null);const map=new Map([[key,value]]);const set=new Set([value]);return [[value].entries().next().value[1]===value,map.entries().next().value[0]===key,map.entries().next().value[1]===value,set.entries().next().value[0]===value,set.entries().next().value[1]===value,map.values().next().value===value,set.values().next().value===value,Object.getPrototypeOf(value)===null,Object.getPrototypeOf(key)===null]`;
  expect(deepCopyFromSandbox((await run(source)).returnValue)).toEqual(runInNewContext(`(()=>{${source}})()`));
});
