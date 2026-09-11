import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { deepCopyFromSandbox, isSandboxClosure } from "../values.js";

const helpers = ["map(x=>x)", "filter(x=>true)", "take(1)", "drop(0)", "flatMap(x=>[x])"];
const sequences = [["next", "next", "next"], ["return", "return"], ["next", "return", "next"]];

it.each(helpers.flatMap(helper => sequences.map(operations => ({ helper, operations }))))(
  "retains borrowed helper result realms: $helper $operations", async ({ helper, operations }) => {
    const methodSource = `const it=[1].values().${helper};return [it.next,it.return,Object.prototype,()=>{Object.prototype.marker=9}]`;
    const receiverSource = `return [1].values().${helper}`;
    const nativeMethods = runInNewContext(`(()=>{${methodSource}})()`);
    const nativeReceiver = runInNewContext(`(()=>{${receiverSource}})()`);
    const methods = (await run(methodSource)).returnValue;
    const receiver = (await run(receiverSource)).returnValue;
    const getter = (await run("return Object.getPrototypeOf")).returnValue;
    const reader = (await run("return value=>value.marker")).returnValue;
    if (!Array.isArray(methods) || !isSandboxClosure(methods[0]) || !isSandboxClosure(methods[1]) || !isSandboxClosure(methods[3]) || !isSandboxClosure(getter) || !isSandboxClosure(reader)) throw new Error("Expected SDK exports");
    const context = { stack: [], thisValue: undefined };
    const results = [];
    for (const operation of operations) {
      const methodIndex = operation === "next" ? 0 : 1;
      const expected = nativeMethods[methodIndex].call(nativeReceiver);
      expect(Object.getPrototypeOf(expected) === nativeMethods[2]).toBe(true);
      const result = await methods[methodIndex].call([], { ...context, thisValue: receiver });
      expect(await getter.call([result], context) === methods[2]).toBe(true);
      expect(deepCopyFromSandbox(result)).toEqual(expected);
      results.push(result);
    }
    await methods[3].call([], context);
    for (const result of results) {
      expect(await reader.call([result], context)).toBe(9);
      expect(() => deepCopyFromSandbox(result)).toThrow();
    }
  }
);

it.each(helpers)("does not reuse input result records or re-prototype payloads: %s", async helper => {
  const source = `const value=Object.create(null);const result=Object.assign(Object.create(null),{value,done:false,extra:7});let calls=0;const input={next(){return calls++===0?result:{done:true}},return(){return {done:true}}};const it=Iterator.from(input).${helper};const actual=it.next();return [actual!==result,actual.value===value,Object.getPrototypeOf(actual)===Object.prototype,Object.getPrototypeOf(result)===null,Object.getPrototypeOf(value)===null,Reflect.ownKeys(actual)]`;
  expect(deepCopyFromSandbox((await run(source)).returnValue)).toEqual(runInNewContext(`(()=>{${source}})()`));
});

it.each(helpers)("retains helper result prototypes through public replay: %s", async helper => {
  const source = `const it=[1].values().${helper};await 0;return [[it.next(),it.return(),it.next()],Object.prototype]`;
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
