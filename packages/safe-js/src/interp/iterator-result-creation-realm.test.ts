import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { deepCopyFromSandbox, isSandboxClosure } from "./values.js";

const iterators = [
  "[3].values()", "[3].keys()", "[3].entries()",
  "new Uint8Array([3]).values()", "new Float32Array([3]).entries()",
  "new Map([[1,3]]).entries()", "new Set([3]).values()",
  '"😀"[Symbol.iterator]()'
];

it.each(iterators.flatMap(expression => [0, 1, 2].map(skip => ({ expression, skip }))))(
  "retains iterator result realm: $expression after $skip steps", async ({ expression, skip }) => {
    const source = `const iterator=${expression};for(let i=0;i<${skip};i++)iterator.next();return [()=>iterator.next(),Object.prototype,()=>{Object.prototype.marker=9}]`;
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

it.each(iterators)("uses the borrowed next method realm: %s", async expression => {
  const exported = (await run(`return [(${expression}).next,Object.prototype]`)).returnValue;
  const receiver = (await run(`return ${expression}`)).returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!Array.isArray(exported) || !isSandboxClosure(exported[0]) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
  for (let i = 0; i < 3; i++) {
    const result = await exported[0].call([], { stack: [], thisValue: receiver });
    expect(await getter.call([result], { stack: [], thisValue: undefined }) === exported[1]).toBe(true);
  }
});

it("preserves iterator result descriptors, freshness and payload identity", async () => {
  const source = `const value=Object.create(null);const iterators=[[value].values(),new Map([[1,value]]).values(),new Set([value]).values()];return iterators.map(iterator=>{const first=iterator.next();const end=iterator.next();const again=iterator.next();return [first.value===value,Object.getPrototypeOf(value)===null,first!==end,end!==again,Reflect.ownKeys(first),Object.getOwnPropertyDescriptors(first),Object.getOwnPropertyDescriptors(end)]})`;
  expect(deepCopyFromSandbox((await run(source)).returnValue)).toEqual(runInNewContext(`(()=>{${source}})()`));
});

it.each(iterators)("preserves result realms through public replay: %s", async expression => {
  const source = `const iterator=${expression};await 0;return [[iterator.next(),iterator.next(),iterator.next()],Object.prototype]`;
  const original = await run(source);
  const replayed = await run(source, { snapshot: JSON.parse(await dump(original)) });
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!isSandboxClosure(getter)) throw new Error("Expected SDK getter");
  for (const execution of [original, replayed]) {
    expect(execution.ok).toBe(true);
    const exported = execution.returnValue;
    if (!Array.isArray(exported) || !Array.isArray(exported[0])) throw new Error("Expected exported results");
    for (const result of exported[0]) {
      expect(await getter.call([result], { stack: [], thisValue: undefined }) === exported[1]).toBe(true);
    }
  }
});
