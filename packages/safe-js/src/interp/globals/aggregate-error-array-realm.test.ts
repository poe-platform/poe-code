import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { deepCopyFromSandbox, isSandboxClosure } from "../values.js";

it.each(["[]", "[1,2]"])("retains AggregateError errors-array realm for %s", async input => {
  const source = `return [new AggregateError(${input}),()=>new AggregateError(${input}),Array.prototype]`;
  const native = runInNewContext(`(()=>{${source}})()`);
  expect(Object.getPrototypeOf(native[0].errors)).toBe(native[2]);
  expect(Object.getPrototypeOf(native[1]().errors)).toBe(native[2]);
  const exported = (await run(source)).returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!Array.isArray(exported) || !isSandboxClosure(exported[1]) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
  const context = {stack:[],thisValue:undefined};
  for (const error of [exported[0], await exported[1].call([], context)]) {
    const descriptor = Object.getOwnPropertyDescriptor(error, "errors");
    expect(descriptor).toMatchObject({writable:true,enumerable:false,configurable:true});
    expect.soft(await getter.call([descriptor!.value], context) === exported[2]).toBe(true);
    expect(deepCopyFromSandbox(descriptor!.value)).toEqual(native[0].errors);
  }
});

it("preserves AggregateError element identity and custom error prototypes", async () => {
  const source = `const reason=Object.create(null),prototype={};function Target(){}Target.prototype=prototype;
    const error=Reflect.construct(AggregateError,[[reason]],Target);
    return [error.errors[0]===reason,Object.getPrototypeOf(reason)===null,Object.getPrototypeOf(error)===prototype]`;
  expect(deepCopyFromSandbox((await run(source)).returnValue)).toEqual(runInNewContext(`(()=>{${source}})()`));
});

it("separates a foreign custom error prototype from the constructor's errors-array realm", async () => {
  const constructorSource = "return [Reflect.construct,AggregateError,Array.prototype]";
  const targetSource = "function Target(){}Target.prototype={foreign:true};return [Target,Target.prototype]";
  const nativeA = runInNewContext(`(()=>{${constructorSource}})()`);
  const nativeB = runInNewContext(`(()=>{${targetSource}})()`);
  const expected = nativeA[0](nativeA[1],[[7]],nativeB[0]);
  expect(Object.getPrototypeOf(expected)).toBe(nativeB[1]);
  expect(Object.getPrototypeOf(expected.errors)).toBe(nativeA[2]);
  const a = (await run(constructorSource)).returnValue;
  const b = (await run(targetSource)).returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!Array.isArray(a) || !isSandboxClosure(a[0]) || !Array.isArray(b) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
  const context = {stack:[],thisValue:undefined};
  const error = await a[0].call([a[1],[[7]],b[0]],context);
  const errors = Object.getOwnPropertyDescriptor(error,"errors")!.value;
  expect(await getter.call([error],context)).toBe(b[1]);
  expect(await getter.call([errors],context)).toBe(a[2]);
});

it("rejects lossy errors-array copies after its originating prototype changes", async () => {
  const exported = (await run("return [new AggregateError([7]).errors,()=>{Array.prototype.marker=9}]")).returnValue;
  if (!Array.isArray(exported) || !isSandboxClosure(exported[1])) throw new Error("Expected SDK exports");
  expect(deepCopyFromSandbox(exported[0])).toEqual([7]);
  await exported[1].call([], {stack:[],thisValue:undefined});
  expect(() => deepCopyFromSandbox(exported[0])).toThrow("cannot be copied as data");
});

it("retains an exported AggregateError factory through replay", async () => {
  const source = "const factory=()=>new AggregateError([7]);await 0;return [factory,Array.prototype]";
  const original = await run(source);
  expect(original.ok).toBe(true);
  const replayed = await run(source, {snapshot: JSON.parse(await dump(original))});
  expect(replayed.ok).toBe(true);
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!isSandboxClosure(getter)) throw new Error("Expected prototype getter");
  for (const result of [original,replayed]) {
    const exported = result.returnValue;
    if (!Array.isArray(exported) || !isSandboxClosure(exported[0])) throw new Error("Expected SDK exports");
    const context = {stack:[],thisValue:undefined};
    const error = await exported[0].call([], context);
    const errors = Object.getOwnPropertyDescriptor(error,"errors")!.value;
    expect.soft(await getter.call([errors],context) === exported[1]).toBe(true);
  }
});
