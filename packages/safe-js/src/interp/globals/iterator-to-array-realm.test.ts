import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { deepCopyFromSandbox, isSandboxClosure } from "../values.js";

it.each(["[1,2].values()", "[].values()", "[1,2].values().map(x=>x+1)"])(
  "retains toArray result realm: %s", async expression => {
    const source = `return [()=>(${expression}).toArray(),Array.prototype,()=>{Array.prototype.marker=9}]`;
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

it("preserves values from custom iterators without changing their prototypes", async () => {
  const source = `const value=[];Object.setPrototypeOf(value,null);let calls=0;const iterator={next(){calls++;return {value,done:calls>2}}};const result=Iterator.prototype.toArray.call(iterator);return [result[0]===value,result[1]===value,Object.getPrototypeOf(value)===null,calls]`;
  expect(deepCopyFromSandbox((await run(source)).returnValue)).toEqual(runInNewContext(`(()=>{${source}})()`));
});

it("uses the method realm for a direct SDK call with a foreign iterator", async () => {
  const exported = (await run("return [Iterator.prototype.toArray,Array.prototype]")).returnValue;
  const receiver = (await run("return [3,4].values()")).returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!Array.isArray(exported) || !isSandboxClosure(exported[0]) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
  const result = await exported[0].call([], { stack: [], thisValue: receiver });
  expect(await getter.call([result], { stack: [], thisValue: undefined }) === exported[1]).toBe(true);
  expect(deepCopyFromSandbox(result)).toEqual([3, 4]);
});
