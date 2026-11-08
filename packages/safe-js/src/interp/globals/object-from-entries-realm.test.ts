import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { deepCopyFromSandbox, isSandboxClosure } from "../values.js";

it.each(["[]", "[['a',7]]", "[['__proto__',7],['a',1],['a',2]]"])(
  "preserves Object.fromEntries creation realm: %s", async entries => {
    const expression = `Object.fromEntries(${entries})`;
    const native = runInNewContext(`(()=>{const value=${expression};return [Object.getPrototypeOf(value)===Object.prototype,value]})()`);
    expect(native[0]).toBe(true);
    const result = (await run(`return [${expression},()=>${expression},Object.prototype]`)).returnValue;
    const getter = (await run("return Object.getPrototypeOf")).returnValue;
    if (!Array.isArray(result) || !isSandboxClosure(result[1]) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
    const context = { stack: [], thisValue: undefined };
    for (const value of [result[0], await result[1].call([], context)]) {
      expect(await getter.call([value], context)).toBe(result[2]);
      expect(Object.getOwnPropertyDescriptors(deepCopyFromSandbox(value) as object))
        .toEqual(Object.getOwnPropertyDescriptors(native[1]));
    }
  }
);

it("keeps later prototype mutations visible on fromEntries results", async () => {
  const result = (await run("const value=Object.fromEntries([]);return [value,()=>{Object.prototype.marker=7},value=>value.marker]")).returnValue;
  if (!Array.isArray(result) || !isSandboxClosure(result[1]) || !isSandboxClosure(result[2])) throw new Error("Expected SDK exports");
  const context = { stack: [], thisValue: undefined };
  await result[1].call([], context);
  expect(await result[2].call([result[0]], context)).toBe(7);
  expect(() => deepCopyFromSandbox(result[0])).toThrow();
});

it("preserves the realm on synchronous direct SDK adapter results", async () => {
  const result = (await run("return [Object.fromEntries,Object.prototype]")).returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!Array.isArray(result) || !isSandboxClosure(result[0]) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
  const value = result[0].call([[["a", 7]]]);
  expect(value).not.toBeInstanceOf(Promise);
  expect(await getter.call([value], { stack: [], thisValue: undefined })).toBe(result[1]);
  expect(deepCopyFromSandbox(value)).toEqual({ a: 7 });
});
