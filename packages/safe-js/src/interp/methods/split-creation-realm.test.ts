import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { deepCopyFromSandbox, isSandboxClosure } from "../values.js";

it.each([
  "'a,b'.split(',')", "'a,b'.split(',',0)", "'a,b'.split()",
  "''.split('')", "'a,b'.split(',',1)", "'a,b'.split(/,/)",
  "'a,b'.split(/,/,0)", "'a,b'.split(/(,)/)", "''.split(/x/)",
  "''.split(/(?:)/)", "'a,b'.split(/(,)/,2)",
  "RegExp.prototype[Symbol.split].call(/,/, 'a,b')"
])("preserves split result creation realm: %s", async expression => {
  const source = `return [()=>${expression},Array.prototype,()=>{Array.prototype.marker=9}]`;
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

it.each(["Object.create(null)", "[]", "37"])("preserves custom split result and dispatch order: %s", async resultExpression => {
  const source = `const result=${resultExpression};let calls=0;const receiver={toString(){throw Error('coerced')}};const splitter={[Symbol.split](value,limit){if(value!==receiver||limit!==0)throw Error('arguments');calls++;return result}};return [()=>String.prototype.split.call(receiver,splitter,0),result,()=>calls]`;
  const native = runInNewContext(`(()=>{${source}})()`);
  expect(native[0]() === native[1]).toBe(true);
  expect(native[2]()).toBe(1);
  const exported = (await run(source)).returnValue;
  if (!Array.isArray(exported) || !isSandboxClosure(exported[0]) || !isSandboxClosure(exported[2])) throw new Error("Expected SDK exports");
  const context = { stack: [], thisValue: undefined };
  expect(await exported[0].call([], context) === exported[1]).toBe(true);
  expect(await exported[2].call([], context)).toBe(1);
  if (resultExpression === "Object.create(null)") {
    const getter = (await run("return Object.getPrototypeOf")).returnValue;
    if (!isSandboxClosure(getter)) throw new Error("Expected SDK getter");
    expect(await getter.call([exported[1]], context)).toBe(null);
  }
});
