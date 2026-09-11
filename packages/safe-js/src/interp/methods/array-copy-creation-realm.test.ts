import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { deepCopyFromSandbox, isSandboxClosure } from "../values.js";

const methods = ["toReversed()", "toSorted()", "toSpliced(1,1,9)", "with(1,9)"];

it.each(methods)("preserves the creation realm of %s results", async method => {
  for (const borrowed of [false, true]) {
    const call = borrowed
      ? `Array.prototype.${method.replace("(", ".call({0:3,2:1,length:3},")}`
      : `source.${method}`;
    const source = `const source=[3,,1];Object.defineProperty(source,'constructor',{get(){throw Error('constructor read')}});return [()=>${call},Array.prototype,()=>{Array.prototype.marker=9}]`;
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
    expect(deepCopyFromSandbox(result)).toEqual(Array.from(expected));
    expect(Object.keys(deepCopyFromSandbox(result) as object)).toEqual(Object.keys(expected));
    await exported[2].call([], context);
    expect(await reader.call([result], context)).toBe(9);
    expect(() => deepCopyFromSandbox(result)).toThrow();
  }
});
