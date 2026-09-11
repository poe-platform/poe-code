import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { deepCopyFromSandbox, isSandboxClosure } from "../values.js";

it.each(["Object()", "Object(null)", "Object(undefined)", "new Object()", "new Object(null)"])(
  "preserves the constructor realm for %s", async expression => {
    expect(runInNewContext(`Object.getPrototypeOf(${expression})===Object.prototype`)).toBe(true);
    const exported = (await run(`return [${expression},()=>${expression},Object.prototype]`)).returnValue;
    const getter = (await run("return Object.getPrototypeOf")).returnValue;
    if (!Array.isArray(exported) || !isSandboxClosure(exported[1]) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
    const context = { stack: [], thisValue: undefined };
    for (const value of [exported[0], await exported[1].call([], context)]) {
      expect(await getter.call([value], context)).toBe(exported[2]);
      expect(deepCopyFromSandbox(value)).toEqual({});
    }
  }
);

it("keeps existing object inputs in their originating realm", async () => {
  const original = (await run("return [{a:7},Object.prototype]")).returnValue;
  const constructor = (await run("return Object")).returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!Array.isArray(original) || !isSandboxClosure(constructor) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
  const context = { stack: [], thisValue: undefined };
  const value = await constructor.call([original[0]], context);
  expect(value).toBe(original[0]);
  expect(await getter.call([value], context)).toBe(original[1]);
});

it("keeps prototype mutations on constructed objects and rejects lossy copies", async () => {
  const exported = (await run("const value=new Object();return [value,()=>{Object.prototype.marker=7},value=>value.marker]")).returnValue;
  if (!Array.isArray(exported) || !isSandboxClosure(exported[1]) || !isSandboxClosure(exported[2])) throw new Error("Expected SDK exports");
  const context = { stack: [], thisValue: undefined };
  await exported[1].call([], context);
  expect(await exported[2].call([exported[0]], context)).toBe(7);
  expect(() => deepCopyFromSandbox(exported[0])).toThrow();
});

it.each(["7", "null", "({marker:7})"])("keeps newTarget prototype selection: %s", async prototype => {
  const source = `function Target(){}Target.prototype=${prototype};const input={a:7};return [()=>Reflect.construct(Object,[input],Target),typeof Target.prototype==='object'&&Target.prototype!==null?Target.prototype:Object.prototype,input]`;
  const native = runInNewContext(`(()=>{${source}})()`);
  const nativeValue = native[0]();
  expect(Object.getPrototypeOf(nativeValue)).toBe(native[1]);
  expect(nativeValue).not.toBe(native[2]);
  const exported = (await run(source)).returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!Array.isArray(exported) || !isSandboxClosure(exported[0]) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
  const context = { stack: [], thisValue: undefined };
  const value = await exported[0].call([], context);
  expect(value).not.toBe(exported[2]);
  expect(await getter.call([value], context)).toBe(exported[1]);
});
