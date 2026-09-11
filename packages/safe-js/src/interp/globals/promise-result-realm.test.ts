import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { deepCopyFromSandbox, isSandboxClosure, isSandboxPromise, type SandboxValue } from "../values.js";

it.each(["all", "allSettled", "any"].flatMap(method => [false, true].map(nonempty => ({method, nonempty})) ))(
  "preserves borrowed Promise.$method result realms: nonempty=$nonempty", async ({method, nonempty}) => {
    const input = !nonempty ? "[]" : method === "any"
      ? "[{then(resolve,reject){reject(1)}},{then(resolve,reject){reject(2)}}]"
      : method === "allSettled" ? "[1,{then(resolve,reject){reject(2)}}]" : "[1,2]";
    const methodSource = `return [Promise.${method},Array.prototype,Object.prototype,AggregateError.prototype]`;
    const receiverSource = `return [Promise,Promise.prototype,${input}]`;
    const nativeA = runInNewContext(`(()=>{${methodSource}})()`);
    const nativeB = runInNewContext(`(()=>{${receiverSource}})()`);
    const nativePromise = nativeA[0].call(nativeB[0], nativeB[2]);
    expect(Object.getPrototypeOf(nativePromise)).toBe(nativeB[1]);
    const nativeResult = await nativePromise.catch((error: unknown) => error);
    const nativeArray = method === "any" ? nativeResult.errors : nativeResult;
    expect(Object.getPrototypeOf(nativeArray)).toBe(nativeA[1]);
    const a = (await run(methodSource)).returnValue;
    const b = (await run(receiverSource)).returnValue;
    const getter = (await run("return Object.getPrototypeOf")).returnValue;
    if (!Array.isArray(a) || !isSandboxClosure(a[0]) || !Array.isArray(b) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
    const context = {stack:[],thisValue:undefined};
    const promise = await a[0].call([b[2]], {...context,thisValue:b[0]});
    if (!isSandboxPromise(promise)) throw new Error("Expected aggregate promise");
    expect.soft(await getter.call([promise], context) === b[1], "constructor realm").toBe(true);
    const result = await promise.promise.catch((error: SandboxValue) => error);
    const values = method === "any" ? (result as {errors: SandboxValue}).errors : result;
    expect.soft(await getter.call([values], context) === a[1], "array realm").toBe(true);
    expect(deepCopyFromSandbox(values)).toEqual(nativeArray);
    if (method === "any") {
      expect(Object.getPrototypeOf(nativeResult)).toBe(nativeA[3]);
      expect.soft(await getter.call([result], context) === a[3], "error realm").toBe(true);
    }
    if (method === "allSettled" && nonempty) {
      expect(Object.getPrototypeOf(nativeArray[0])).toBe(nativeA[2]);
      if (!Array.isArray(values)) throw new Error("Expected aggregate results");
      for (const value of values)
        expect.soft(await getter.call([value], context) === a[2], "settlement record realm").toBe(true);
    }
  }
);

it("separates withResolvers capability and constructed promise realms", async () => {
  const methodSource = "return [Promise.withResolvers,Object.prototype]";
  const receiverSource = "return [Promise,Promise.prototype]";
  const nativeA = runInNewContext(`(()=>{${methodSource}})()`);
  const nativeB = runInNewContext(`(()=>{${receiverSource}})()`);
  const expected = nativeA[0].call(nativeB[0]);
  expect(Object.getPrototypeOf(expected)).toBe(nativeA[1]);
  expect(Object.getPrototypeOf(expected.promise)).toBe(nativeB[1]);
  expected.resolve();
  const a = (await run(methodSource)).returnValue;
  const b = (await run(receiverSource)).returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!Array.isArray(a) || !isSandboxClosure(a[0]) || !Array.isArray(b) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
  const context = {stack:[],thisValue:undefined};
  const result = await a[0].call([], {...context,thisValue:b[0]}) as Record<string, SandboxValue>;
  expect.soft(await getter.call([result], context) === a[1], "capability realm").toBe(true);
  expect.soft(await getter.call([result.promise], context) === b[1], "constructor realm").toBe(true);
  expect(Object.keys(result)).toEqual(Object.keys(expected));
  if (!isSandboxClosure(result.resolve)) throw new Error("Expected resolver");
  await result.resolve.call([], context);
});

it.each(["all", "allSettled", "any"])("retains Promise.%s result prototypes through replay", async method => {
  const source = `const capability=Promise.withResolvers();const pending=Promise.${method}([capability.promise])${method === "any" ? ".catch(error=>error.errors)" : ""};
    await 0;capability.${method === "all" ? "resolve" : "reject"}(7);const values=await pending;
    return [Object.getPrototypeOf(capability)===Object.prototype,Object.getPrototypeOf(values)===Array.prototype,
      ${method === "allSettled" ? "Object.getPrototypeOf(values[0])===Object.prototype" : "true"},values]`;
  const expected = await runInNewContext(`(async()=>{${source}})()`);
  const original = await run(source);
  expect(original.ok).toBe(true);
  expect(deepCopyFromSandbox(original.returnValue)).toEqual(expected);
  const replayed = await run(source, {snapshot: JSON.parse(await dump(original))});
  expect(replayed.ok).toBe(true);
  expect(deepCopyFromSandbox(replayed.returnValue)).toEqual(expected);
});

it("preserves aggregate payload identity and null prototypes", async () => {
  const source = `const reason=Object.create(null);const rejected={then(resolve,reject){reject(reason)}};
    const all=await Promise.all([reason]);const settled=await Promise.allSettled([reason,rejected]);
    const error=await Promise.any([rejected]).catch(error=>error);
    return [all[0]===reason,settled[0].value===reason,settled[1].reason===reason,error.errors[0]===reason,
      Object.getPrototypeOf(reason)===null,Object.keys(settled[0]),Object.keys(settled[1])]`;
  const result = await run(source);
  expect(result.ok).toBe(true);
  expect(deepCopyFromSandbox(result.returnValue)).toEqual(await runInNewContext(`(async()=>{${source}})()`));
});

it.each(["all", "allSettled"])("rejects lossy Promise.%s result copies after prototype mutation", async method => {
  const exported = (await run(`return [()=>Promise.${method}([7]),()=>{Array.prototype.marker=9}]`)).returnValue;
  if (!Array.isArray(exported) || !isSandboxClosure(exported[0]) || !isSandboxClosure(exported[1])) throw new Error("Expected SDK exports");
  const context = {stack:[],thisValue:undefined};
  const promise = await exported[0].call([], context);
  if (!isSandboxPromise(promise)) throw new Error("Expected aggregate Promise");
  const values = await promise.promise;
  expect(() => deepCopyFromSandbox(values)).not.toThrow();
  await exported[1].call([], context);
  expect(() => deepCopyFromSandbox(values)).toThrow("cannot be copied as data");
});
