import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { deepCopyFromSandbox, isSandboxClosure } from "./values.js";

it.each([
  "((...rest)=>rest)()",
  "((first,...rest)=>rest)(1,7,9)",
  "(function(...rest){return rest})(7)",
  "({method(...rest){return rest}}).method(7)",
  "(()=>{let saved;async function capture(...rest){saved=rest}capture(7);return saved})()",
  "(function*(...rest){yield rest})(7).next().value"
])("preserves function rest allocation realm: %s", async expression => {
  const native = await runInNewContext(`(async()=>{const value=${expression};return [Object.getPrototypeOf(value)===Array.prototype,value]})()`);
  expect(native[0]).toBe(true);
  const exported = (await run(`return [${expression},()=>{return ${expression}},Array.prototype]`)).returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!Array.isArray(exported) || !isSandboxClosure(exported[1]) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
  const context = { stack: [], thisValue: undefined };
  for (const value of [exported[0], await exported[1].call([], context)]) {
    expect(await getter.call([value], context)).toBe(exported[2]);
    expect(Object.getOwnPropertyDescriptors(deepCopyFromSandbox(value) as object))
      .toEqual(Object.getOwnPropertyDescriptors(native[1]));
  }
});

it("preserves prototype mutations and rejects lossy rest-array copies", async () => {
  const exported = (await run("const value=((...rest)=>rest)(7);return [value,()=>{Array.prototype.marker=9},value=>value.marker]")).returnValue;
  if (!Array.isArray(exported) || !isSandboxClosure(exported[1]) || !isSandboxClosure(exported[2])) throw new Error("Expected SDK exports");
  const context = { stack: [], thisValue: undefined };
  await exported[1].call([], context);
  expect(await exported[2].call([exported[0]], context)).toBe(9);
  expect(() => deepCopyFromSandbox(exported[0])).toThrow();
});
