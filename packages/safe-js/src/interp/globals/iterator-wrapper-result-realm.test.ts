import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { deepCopyFromSandbox, isSandboxClosure } from "../values.js";

const inputs = ['{next(){return {done:true}}}', '{next(){return {done:true}},return:null}'];

it.each(inputs)("retains the borrowed wrapper return method realm: %s", async input => {
  const methodSource = 'return [Iterator.from({next(){return {done:true}}}).return,Object.prototype,()=>{Object.prototype.marker=9}]';
  const nativeMethod = runInNewContext(`(()=>{${methodSource}})()`);
  const nativeReceiver = runInNewContext(`Iterator.from(${input})`);
  const methods = (await run(methodSource)).returnValue;
  const receiver = (await run(`return Iterator.from(${input})`)).returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  const reader = (await run("return value=>value.marker")).returnValue;
  if (!Array.isArray(methods) || !isSandboxClosure(methods[0]) || !isSandboxClosure(methods[2]) || !isSandboxClosure(getter) || !isSandboxClosure(reader)) throw new Error("Expected SDK exports");
  const context = { stack: [], thisValue: undefined };
  const results = [];
  for (let i = 0; i < 2; i++) {
    const expected = nativeMethod[0].call(nativeReceiver, 7);
    expect(Object.getPrototypeOf(expected) === nativeMethod[1]).toBe(true);
    const result = await methods[0].call([7], { ...context, thisValue: receiver });
    expect(await getter.call([result], context) === methods[1]).toBe(true);
    expect(deepCopyFromSandbox(result)).toEqual(expected);
    results.push(result);
  }
  expect(results[0] === results[1]).toBe(false);
  await methods[2].call([], context);
  for (const result of results) {
    expect(await reader.call([result], context)).toBe(9);
    expect(() => deepCopyFromSandbox(result)).toThrow();
  }
});

it("forwards custom results and looks up return on every call", async () => {
  const source = `const events=[];const result=Object.assign(Object.create(null),{value:7,done:false});const input={next(){return result},get return(){events.push("get");return function(){events.push([this===input,arguments.length]);return result}}};const wrapper=Iterator.from(input);const next=wrapper.next();const first=wrapper.return(9);const second=wrapper.return();return [next===result,first===result,second===result,Object.getPrototypeOf(result)===null,events]`;
  expect(deepCopyFromSandbox((await run(source)).returnValue)).toEqual(runInNewContext(`(()=>{${source}})()`));
});

it.each(inputs)("preserves fallback result realm through public replay: %s", async input => {
  const source = `const wrapper=Iterator.from(${input});await 0;return [wrapper.return(),Object.prototype]`;
  const original = await run(source);
  const replayed = await run(source, { snapshot: JSON.parse(await dump(original)) });
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!isSandboxClosure(getter)) throw new Error("Expected SDK getter");
  for (const execution of [original, replayed]) {
    expect(execution.ok).toBe(true);
    const exported = execution.returnValue;
    if (!Array.isArray(exported)) throw new Error("Expected result exports");
    expect(await getter.call([exported[0]], { stack: [], thisValue: undefined }) === exported[1]).toBe(true);
  }
});
