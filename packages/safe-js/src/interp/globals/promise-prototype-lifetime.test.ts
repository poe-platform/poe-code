import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { Budget } from "../budget.js";
import { createBuiltinBindings } from "../globals.js";
import { createPendingPromiseCapability } from "../promise.js";
import { getSandboxDataProperty, getSandboxPrototype, releaseObjectPrototype } from "../object-model.js";
import { isSandboxClosure, isSandboxPromise } from "../values.js";

it.each([
  "new Promise(resolve=>resolve(7))", "Promise.resolve(7)",
  "Promise.all([])", "Promise.allSettled([7])", "Promise.any([7])", "Promise.race([7])",
  "(async()=>7)()", "(async function*(){yield 7})().next()",
  "Promise.resolve(7).then(value=>value)", "Promise.resolve(7).catch(()=>0)",
  "Promise.resolve(7).finally(()=>undefined)"
])("preserves Promise creation realm after cleanup: %s", async expression => {
  const source = `return [()=>${expression},Promise.prototype]`;
  const native = runInNewContext(`(()=>{${source}})()`);
  const expected = native[0]();
  expect(Object.getPrototypeOf(expected)).toBe(native[1]);
  await expected;
  const exported = (await run(source)).returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!Array.isArray(exported) || !isSandboxClosure(exported[0]) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
  const context = {stack:[],thisValue:undefined};
  const result = await exported[0].call([], context);
  if (!isSandboxPromise(result)) throw new Error("Expected Promise result");
  await result.promise;
  expect(await getter.call([result], context) === exported[1]).toBe(true);
});

it("uses a foreign receiver's intrinsic species for a borrowed then call", async () => {
  const methodSource = "return [Promise.prototype.then,Promise.prototype]";
  const receiverSource = "return [Promise.resolve(7),Promise.prototype]";
  const nativeA = runInNewContext(`(()=>{${methodSource}})()`);
  const nativeB = runInNewContext(`(()=>{${receiverSource}})()`);
  const expected = nativeA[0].call(nativeB[0]);
  expect(Object.getPrototypeOf(expected)).toBe(nativeB[1]);
  expect(await expected).toBe(7);
  const a = (await run(methodSource)).returnValue;
  const b = (await run(receiverSource)).returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!Array.isArray(a) || !isSandboxClosure(a[0]) || !Array.isArray(b) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
  const context = {stack:[],thisValue:undefined};
  const result = await a[0].call([], {...context,thisValue:b[0]});
  if (!isSandboxPromise(result)) throw new Error("Expected chained Promise");
  expect(await result.promise).toBe(7);
  expect(await getter.call([result], context) === b[1]).toBe(true);
});

it.each(["resolve", "reject"])("uses the receiver realm for borrowed Promise.%s", async method => {
  const methodSource = `return Promise.${method}`;
  const receiverSource = "return [Promise,Promise.prototype]";
  const nativeMethod = runInNewContext(`(()=>{${methodSource}})()`);
  const nativeReceiver = runInNewContext(`(()=>{${receiverSource}})()`);
  const expected = nativeMethod.call(nativeReceiver[0], 7);
  const expectedValue = await expected.catch((reason: unknown) => reason);
  expect(Object.getPrototypeOf(expected)).toBe(nativeReceiver[1]);
  const operation = (await run(methodSource)).returnValue;
  const receiver = (await run(receiverSource)).returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!isSandboxClosure(operation) || !Array.isArray(receiver) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
  const context = {stack:[],thisValue:undefined};
  const result = await operation.call([7], {...context,thisValue:receiver[0]});
  if (!isSandboxPromise(result)) throw new Error("Expected Promise result");
  expect(await result.promise.catch((reason: unknown) => reason)).toBe(expectedValue);
  expect(await getter.call([result], context) === receiver[1]).toBe(true);
});

it("retains the prototype of a rejection created after cleanup", async () => {
  const exported = (await run("return [()=>Promise.reject(7),Promise.prototype]")).returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!Array.isArray(exported) || !isSandboxClosure(exported[0]) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
  const context = {stack:[],thisValue:undefined};
  const result = await exported[0].call([], context);
  if (!isSandboxPromise(result)) throw new Error("Expected rejected Promise");
  expect(await result.promise.catch((reason: unknown) => reason)).toBe(7);
  expect(await getter.call([result], context) === exported[1]).toBe(true);
});

it("releases Promise accounting roots while retaining the live creation lookup", () => {
  const budget = new Budget();
  const bindings = createBuiltinBindings({budget});
  const prototype = getSandboxDataProperty(bindings.Promise, "prototype", budget);
  if (prototype === null || typeof prototype !== "object") throw new Error("Expected Promise prototype");
  Object.defineProperty(prototype, "marker", {value:"retained-promise-data",configurable:true});
  expect([...budget.retainedValues()]).toContain("retained-promise-data");
  releaseObjectPrototype(budget);
  expect([...budget.retainedValues()]).toEqual([]);
  const capability = createPendingPromiseCapability(budget);
  expect(getSandboxPrototype(capability.promise, budget)).toBe(prototype);
  capability.resolve.call([]);
});

it("retains Promise factories through replay and subsequent cleanup", async () => {
  const source = "const factory=()=>Promise.resolve(7).then(value=>value);await 0;return [factory,Promise.prototype]";
  const original = await run(source);
  expect(original.ok).toBe(true);
  const replayed = await run(source, {snapshot: JSON.parse(await dump(original))});
  expect(replayed.ok).toBe(true);
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!isSandboxClosure(getter)) throw new Error("Expected prototype getter");
  for (const completed of [original, replayed]) {
    const exported = completed.returnValue;
    if (!Array.isArray(exported) || !isSandboxClosure(exported[0])) throw new Error("Expected SDK factory");
    const context = {stack:[],thisValue:undefined};
    const result = await exported[0].call([], context);
    if (!isSandboxPromise(result)) throw new Error("Expected Promise result");
    expect(await result.promise).toBe(7);
    expect(await getter.call([result], context) === exported[1]).toBe(true);
  }
});
