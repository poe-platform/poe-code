import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { deepCopyFromSandbox, isSandboxClosure } from "./values.js";

it("retains the default constructed matcher's RegExp prototype after cleanup", async () => {
  const exported = (await run('return [new RegExp("a","g"),RegExp.prototype]')).returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!Array.isArray(exported) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
  expect(await getter.call([exported[0]], { stack: [], thisValue: undefined }) === exported[1]).toBe(true);
});

it("supports pristine data copies of RegExp objects constructed after cleanup", async () => {
  const factory = (await run('return ()=>new RegExp("a","g")')).returnValue;
  if (!isSandboxClosure(factory)) throw new Error("Expected SDK factory");
  const result = await factory.call([], { stack: [], thisValue: undefined });
  expect(() => deepCopyFromSandbox(result)).not.toThrow();
});

it.each(["g", "", "dg", "d"])("uses the exec realm for match payloads with flags %s", async flags => {
  const expression = `/a/${flags}[Symbol.matchAll]("a")`;
  const nativeMethod = runInNewContext(`[(/a/g[Symbol.matchAll]("a")).next,Object.prototype]`);
  const nativeReceiver = runInNewContext(`[${expression},Array.prototype]`);
  const expected = nativeMethod[0].call(nativeReceiver[0]);
  expect(Object.getPrototypeOf(expected) === nativeMethod[1]).toBe(true);
  expect(Object.getPrototypeOf(expected.value) === nativeReceiver[1]).toBe(true);
  if (flags.includes("d")) {
    expect(Object.getPrototypeOf(expected.value.indices) === nativeReceiver[1]).toBe(true);
    expect(Object.getPrototypeOf(expected.value.indices[0]) === nativeReceiver[1]).toBe(true);
  }
  const method = (await run('return [(/a/g[Symbol.matchAll]("a")).next,Object.prototype]')).returnValue;
  const receiver = (await run(`return [${expression},Array.prototype,()=>{Array.prototype.marker=9}]`)).returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  const reader = (await run("return result=>[result.value,result.value.indices,result.value.indices?.[0]]")).returnValue;
  if (!Array.isArray(method) || !isSandboxClosure(method[0]) || !Array.isArray(receiver) || !isSandboxClosure(receiver[2]) || !isSandboxClosure(getter) || !isSandboxClosure(reader)) throw new Error("Expected SDK exports");
  const context = { stack: [], thisValue: undefined };
  const result = await method[0].call([], { ...context, thisValue: receiver[0] });
  expect(await getter.call([result], context) === method[1]).toBe(true);
  const payloads = await reader.call([result], context);
  if (!Array.isArray(payloads)) throw new Error("Expected payload list");
  for (const payload of flags.includes("d") ? payloads : payloads.slice(0, 1)) {
    expect(await getter.call([payload], context) === receiver[1]).toBe(true);
  }
  expect(deepCopyFromSandbox(result)).toEqual(expected);
  await receiver[2].call([], context);
  expect(() => deepCopyFromSandbox(result)).toThrow();
});

it.each([true, false])("selects the execution realm for callable exec=%s", async callable => {
  const factorySource = 'return exec=>RegExp.prototype[Symbol.matchAll].call({flags:"dg",lastIndex:0,constructor:{[Symbol.species]:function(){const matcher=/a/dg;matcher.exec=exec;return matcher}}},"a")';
  const nativeMethod = runInNewContext('[(/a/g[Symbol.matchAll]("a")).next,Array.prototype,Object.prototype]');
  const nativeExec = runInNewContext('[RegExp.prototype.exec,Array.prototype]');
  const nativeFactory = runInNewContext(`(()=>{${factorySource}})()`);
  const expected = nativeMethod[0].call(nativeFactory(callable ? nativeExec[0] : null));
  const nativeArray = callable ? nativeExec[1] : nativeMethod[1];
  expect(Object.getPrototypeOf(expected.value) === nativeArray).toBe(true);
  expect(Object.getPrototypeOf(expected.value.indices) === nativeArray).toBe(true);
  expect(Object.getPrototypeOf(expected.value.indices[0]) === nativeArray).toBe(true);

  const method = (await run('return [(/a/g[Symbol.matchAll]("a")).next,Array.prototype,Object.prototype]')).returnValue;
  const exec = (await run("return [RegExp.prototype.exec,Array.prototype]")).returnValue;
  const factory = (await run(factorySource)).returnValue;
  const reader = (await run("return result=>[Object.getPrototypeOf(result),Object.getPrototypeOf(result.value),Object.getPrototypeOf(result.value.indices),Object.getPrototypeOf(result.value.indices[0])]")).returnValue;
  if (!Array.isArray(method) || !isSandboxClosure(method[0]) || !Array.isArray(exec) || !isSandboxClosure(factory) || !isSandboxClosure(reader)) throw new Error("Expected SDK exports");
  const context = { stack: [], thisValue: undefined };
  const receiver = await factory.call([callable ? exec[0] : null], context);
  const result = await method[0].call([], { ...context, thisValue: receiver });
  const prototypes = await reader.call([result], context);
  if (!Array.isArray(prototypes)) throw new Error("Expected prototype list");
  expect(prototypes[0] === method[2]).toBe(true);
  for (const prototype of prototypes.slice(1)) expect(prototype === (callable ? exec[1] : method[1])).toBe(true);
  expect(deepCopyFromSandbox(result)).toEqual(expected);
});
