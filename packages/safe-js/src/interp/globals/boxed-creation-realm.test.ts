import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { Budget, createRealm } from "../../core.js";
import { deepCopyFromSandbox, isSandboxClosure, measureSandboxData } from "../values.js";

it.each([
  ["new Number(7)", "Number"], ["new Number(-0)", "Number"],
  ["new Number(NaN)", "Number"], ["new Boolean(false)", "Boolean"],
  ["new String('ab')", "String"], ["Object(7)", "Number"],
  ["Object(true)", "Boolean"], ["Object('ab')", "String"],
  ["Object(7n)", "BigInt"], ["Object(Symbol.for('x'))", "Symbol"]
])("retains boxed creation realm: %s", async (expression, constructor) => {
  const native = runInNewContext(`(()=>{const value=${expression};return [Object.getPrototypeOf(value)===${constructor}.prototype,value]})()`);
  expect(native[0]).toBe(true);
  const exported = (await run(`return [${expression},()=>${expression},${constructor}.prototype]`)).returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!Array.isArray(exported) || !isSandboxClosure(exported[1]) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
  const context = { stack: [], thisValue: undefined };
  for (const value of [exported[0], await exported[1].call([], context)]) {
    expect(await getter.call([value], context) === exported[2]).toBe(true);
    const copy = deepCopyFromSandbox(value) as { valueOf(): unknown };
    const primitive = copy.valueOf();
    if (typeof primitive === "symbol") {
      expect(typeof native[1].valueOf()).toBe("symbol");
      expect(primitive.description).toBe(native[1].valueOf().description);
    } else expect(primitive).toBe(native[1].valueOf());
    expect(Object.getOwnPropertyDescriptors(copy)).toEqual(Object.getOwnPropertyDescriptors(native[1]));
  }
});

it.each([
  ["Number", "new Number(7)"], ["String", "new String(7)"], ["Boolean", "new Boolean(7)"],
  ["BigInt", "Object(7n)"], ["Symbol", "Object(Symbol.for('x'))"]
])("retains later %s prototype mutations", async (constructor, expression) => {
  const exported = (await run(`const value=${expression};return [value,()=>{${constructor}.prototype.marker=9},value=>value.marker]`)).returnValue;
  if (!Array.isArray(exported) || !isSandboxClosure(exported[1]) || !isSandboxClosure(exported[2])) throw new Error("Expected SDK exports");
  const context = { stack: [], thisValue: undefined };
  await exported[1].call([], context);
  expect(await exported[2].call([exported[0]], context)).toBe(9);
  expect(() => deepCopyFromSandbox(exported[0])).toThrow();
});

it.each(["Number", "String", "Boolean"])("preserves %s newTarget fallback and custom prototypes", async constructor => {
  for (const prototype of ["7", "null", "({marker:9})"]) {
    const source = `function Target(){}Target.prototype=${prototype};return [()=>Reflect.construct(${constructor},[7],Target),typeof Target.prototype==='object'&&Target.prototype!==null?Target.prototype:${constructor}.prototype]`;
    const native = runInNewContext(`(()=>{${source}})()`);
    expect(Object.getPrototypeOf(native[0]()) === native[1]).toBe(true);
    const exported = (await run(source)).returnValue;
    const getter = (await run("return Object.getPrototypeOf")).returnValue;
    if (!Array.isArray(exported) || !isSandboxClosure(exported[0]) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
    const context = { stack: [], thisValue: undefined };
    expect(await getter.call([await exported[0].call([], context)], context) === exported[1]).toBe(true);
  }
});

it.each(["new Number(3)", "Object(3)"])("measures shared prototype data once: %s", async expression => {
  const peaks: number[] = [];
  for (const length of [350, 700]) {
    const budget = new Budget();
    const realm = createRealm({ budget });
    try {
      const result = await realm.evaluate(`Number.prototype.extra='x'.repeat(${length});const value=${expression};return value.valueOf()`);
      expect(result).toMatchObject({ ok: true, returnValue: 3 });
      peaks.push(measureSandboxData(budget.retainedValues()));
    } finally {
      await realm.close();
    }
  }
  expect(peaks[1] - peaks[0]).toBe(350);
});
