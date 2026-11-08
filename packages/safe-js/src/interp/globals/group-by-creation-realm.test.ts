import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { deepCopyFromSandbox, isSandboxClosure } from "../values.js";

it.each([
  "Object.groupBy([1,2,3],x=>x%2)[1]",
  "Map.groupBy([1,2,3],x=>x%2).get(1)"
])("retains group bucket creation realm: %s", async expression => {
  const source = `return [()=>${expression},Array.prototype,()=>{Array.prototype.marker=9}]`;
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

it("preserves group keys, element identities, and the null-prototype Object result", async () => {
  const source = `const value=Object.create(null);const key=Object.create(null);const symbol=Symbol('key');const object=Object.groupBy([value],()=> '__proto__');const symbols=Object.groupBy([value],()=>symbol);const map=Map.groupBy([value,value],()=>key);return [Object.getPrototypeOf(object)===null,object.__proto__[0]===value,symbols[symbol][0]===value,map.get(key)[0]===value,map.get(key)[1]===value,Object.getPrototypeOf(value)===null,Object.getPrototypeOf(key)===null]`;
  expect(deepCopyFromSandbox((await run(source)).returnValue)).toEqual(runInNewContext(`(()=>{${source}})()`));
});
