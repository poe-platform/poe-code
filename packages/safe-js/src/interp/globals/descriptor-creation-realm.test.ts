import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { deepCopyFromSandbox, isSandboxClosure } from "../values.js";

it.each([
  "Object.getOwnPropertyDescriptor({a:1},'a')",
  "Reflect.getOwnPropertyDescriptor({a:1},'a')",
  "Object.getOwnPropertyDescriptors({a:1})",
  "Object.getOwnPropertyDescriptors({a:1}).a",
  "Object.getOwnPropertyDescriptor(Object.defineProperty({},'a',{get:undefined}),'a')",
  "Reflect.getOwnPropertyDescriptor(Object.defineProperty({},'a',{get:undefined}),'a')"
])("retains descriptor creation realm: %s", async expression => {
  const source = `return [()=>${expression},Object.prototype,()=>{Object.prototype.marker=9}]`;
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
  expect(Object.keys(deepCopyFromSandbox(result) as object)).toEqual(Object.keys(expected));
  await exported[2].call([], context);
  expect(await reader.call([result], context)).toBe(9);
  expect(() => deepCopyFromSandbox(result)).toThrow();
});

it("preserves exposed values and accessor functions without invoking getters", async () => {
  const source = `let calls=0;const value=Object.create(null);const get=function(){calls++;return value};const set=function(v){};const input={value};Object.defineProperty(input,'accessor',{get,set,enumerable:true});const a=Object.getOwnPropertyDescriptor(input,'accessor');const b=Reflect.getOwnPropertyDescriptor(input,'accessor');const all=Object.getOwnPropertyDescriptors(input);return [a.get===get,a.set===set,b.get===get,b.set===set,all.accessor.get===get,all.value.value===value,calls,Object.getPrototypeOf(value)===null]`;
  expect(deepCopyFromSandbox((await run(source)).returnValue)).toEqual(runInNewContext(`(()=>{${source}})()`));
});
