import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { deepCopyFromSandbox, isSandboxClosure } from "../values.js";

const methods = ["slice()", "map(x=>x)", "filter(x=>true)", "flat()", "flatMap(x=>x)", "splice(0,1)", "concat(9)"];
const receivers = [
  "const source={0:3,2:1,length:3};",
  "const source=[3,,1];source.constructor=undefined;",
  "const source=[3,,1];source.constructor={[Symbol.species]:null};"
];

it.each(methods.flatMap(method => receivers.map(receiver => [method, receiver])))(
  "retains default result realm for %s with %s", async (method, receiver) => {
    const call = `Array.prototype.${method.replace("(", ".call(source,")}`;
    const source = `return [()=>{${receiver}return ${call}},Array.prototype,()=>{Array.prototype.marker=9}]`;
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
    const copy = deepCopyFromSandbox(result);
    expect(copy).toEqual(expected);
    expect(Object.keys(copy as object)).toEqual(Object.keys(expected));
    await exported[2].call([], context);
    expect(await reader.call([result], context)).toBe(9);
    expect(() => deepCopyFromSandbox(result)).toThrow();
  }
);

it.each(methods)("preserves custom species results for %s", async method => {
  const source = `const result=Object.create(null);const source=[3,,1];source.constructor={[Symbol.species]:function(){return result}};return [()=>source.${method},result]`;
  const native = runInNewContext(`(()=>{${source}})()`);
  expect(native[0]() === native[1]).toBe(true);
  expect(Object.getPrototypeOf(native[1])).toBe(null);
  const exported = (await run(source)).returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!Array.isArray(exported) || !isSandboxClosure(exported[0]) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
  const context = { stack: [], thisValue: undefined };
  const result = await exported[0].call([], context);
  expect(result === exported[1]).toBe(true);
  expect(await getter.call([result], context)).toBe(null);
  expect(deepCopyFromSandbox(result)).toEqual(native[1]);
});
