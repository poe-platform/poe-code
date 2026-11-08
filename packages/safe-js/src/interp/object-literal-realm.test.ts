import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { deepCopyFromSandbox, isSandboxClosure } from "./values.js";

it.each(["({})", "({a:7})", "({...{a:7},b:2})", "({__proto__:7,a:1})"])(
  "retains object literal realm identity: %s", async expression => {
    const native = runInNewContext(`(()=>{const value=${expression};return [Object.getPrototypeOf(value)===Object.prototype,value]})()`);
    expect(native[0]).toBe(true);
    const exported = (await run(`return [${expression},()=>${expression},Object.prototype]`)).returnValue;
    const getter = (await run("return Object.getPrototypeOf")).returnValue;
    if (!Array.isArray(exported) || !isSandboxClosure(exported[1]) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
    const context = { stack: [], thisValue: undefined };
    for (const value of [exported[0], await exported[1].call([], context)]) {
      expect(await getter.call([value], context)).toBe(exported[2]);
      expect(deepCopyFromSandbox(value)).toEqual(native[1]);
    }
  }
);

it("keeps object literal prototype mutations visible after cleanup", async () => {
  const exported = (await run("const value={};return [value,()=>{Object.prototype.marker=7},value=>value.marker]")).returnValue;
  if (!Array.isArray(exported) || !isSandboxClosure(exported[1]) || !isSandboxClosure(exported[2])) throw new Error("Expected SDK exports");
  const context = { stack: [], thisValue: undefined };
  await exported[1].call([], context);
  expect(await exported[2].call([exported[0]], context)).toBe(7);
  expect(() => deepCopyFromSandbox(exported[0])).toThrow();
});

it("keeps explicit null literal prototypes", async () => {
  const exported = (await run("return ()=>({__proto__:null,a:7})")).returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!isSandboxClosure(exported) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
  const context = { stack: [], thisValue: undefined };
  const value = await exported.call([], context);
  expect(await getter.call([value], context)).toBeNull();
  expect(Object.getPrototypeOf(deepCopyFromSandbox(value))).toBeNull();
});
