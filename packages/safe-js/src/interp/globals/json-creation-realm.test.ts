import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { deepCopyFromSandbox, isSandboxClosure } from "../values.js";

it.each([false, true].flatMap(reviver => [
  ["{}", "", "Object"], ["[]", "", "Array"],
  ['{"a":[{"b":1}]}', ".a", "Array"],
  ['{"a":[{"b":1}]}', ".a[0]", "Object"]
].map(([json, suffix, prototype]) => ({ reviver, json, suffix, prototype }))))(
  "retains JSON container realm ($json, path: $suffix, reviver: $reviver)", async ({ reviver, json, suffix, prototype }) => {
    const expression = `JSON.parse(${JSON.stringify(json)}${reviver ? ", (key,value)=>value" : ""})${suffix}`;
    const source = `return [()=>${expression},${prototype}.prototype,()=>{${prototype}.prototype.marker=9}]`;
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
  }
);

it("retains reviver holder and context object realms", async () => {
  const source = `const observed=[];JSON.parse('1',function(key,value,context){observed.push(this,context);return value});return [observed,Object.prototype]`;
  const native = runInNewContext(`(()=>{${source}})()`);
  for (const value of native[0]) expect(Object.getPrototypeOf(value) === native[1]).toBe(true);
  const exported = (await run(source)).returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!Array.isArray(exported) || !Array.isArray(exported[0]) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
  for (const value of exported[0]) expect(await getter.call([value], { stack: [], thisValue: undefined }) === exported[1]).toBe(true);
});

it("preserves reviver replacements, deletion and special-key data properties", async () => {
  const source = `const replacement=Object.create(null);const result=JSON.parse('{"child":{},"delete":1,"__proto__":2}',(key,value)=>key==='child'?replacement:key==='delete'?undefined:value);const root=JSON.parse('{}',()=>replacement);return [result.child===replacement,root===replacement,Object.getPrototypeOf(replacement)===null,Object.keys(result),Object.getOwnPropertyDescriptor(result,'__proto__')]`;
  expect(deepCopyFromSandbox((await run(source)).returnValue)).toEqual(runInNewContext(`(()=>{${source}})()`));
});
