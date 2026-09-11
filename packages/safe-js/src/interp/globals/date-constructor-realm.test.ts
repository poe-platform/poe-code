import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { deepCopyFromSandbox, isSandboxClosure } from "../values.js";

it.each(["new Date(0)", "new Date('2020-01-02T00:00:00Z')", "new Date(NaN)"])(
  "preserves Date realm identity before and after SDK construction: %s", async expression => {
    const native = runInNewContext(`(()=>{const value=${expression};return [Object.getPrototypeOf(value)===Date.prototype,value.getTime()]})()`);
    expect(native[0]).toBe(true);
    const exported = (await run(`return [${expression},()=>${expression},Date.prototype]`)).returnValue;
    const getter = (await run("return Object.getPrototypeOf")).returnValue;
    if (!Array.isArray(exported) || !isSandboxClosure(exported[1]) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
    const context = { stack: [], thisValue: undefined };
    for (const value of [exported[0], await exported[1].call([], context)]) {
      expect(await getter.call([value], context)).toBe(exported[2]);
      const copy = deepCopyFromSandbox(value);
      expect(copy).toBeInstanceOf(Date);
      expect((copy as Date).getTime()).toBe(native[1]);
    }
  }
);

it("preserves later Date prototype mutations and rejects lossy data copies", async () => {
  const exported = (await run("const value=new Date(0);return [value,()=>{Date.prototype.marker=7},value=>value.marker]")).returnValue;
  if (!Array.isArray(exported) || !isSandboxClosure(exported[1]) || !isSandboxClosure(exported[2])) throw new Error("Expected SDK exports");
  const context = { stack: [], thisValue: undefined };
  await exported[1].call([], context);
  expect(await exported[2].call([exported[0]], context)).toBe(7);
  expect(() => deepCopyFromSandbox(exported[0])).toThrow();
});

it.each(["7", "null", "({marker:7})"])("preserves SDK newTarget prototype selection: %s", async prototype => {
  const source = `function Target(){}Target.prototype=${prototype};return [()=>Reflect.construct(Date,[7],Target),typeof Target.prototype==='object'&&Target.prototype!==null?Target.prototype:Date.prototype]`;
  const native = runInNewContext(`(()=>{${source}})()`);
  expect(Object.getPrototypeOf(native[0]())).toBe(native[1]);
  const exported = (await run(source)).returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!Array.isArray(exported) || !isSandboxClosure(exported[0]) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
  const context = { stack: [], thisValue: undefined };
  const value = await exported[0].call([], context);
  expect(await getter.call([value], context)).toBe(exported[1]);
});
