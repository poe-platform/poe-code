import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { deepCopyFromSandbox, isSandboxClosure, isSandboxPromise } from "../values.js";

it.each(["resolve", "reject"].flatMap(initial => ["resolve", "reject"].map(cleanup => ({initial, cleanup}))))(
  "observes foreign finally cleanup species: initial=$initial cleanup=$cleanup", async ({initial, cleanup}) => {
    const methodSource = `return [Promise.prototype.finally,()=>({then(resolve,reject){${cleanup}(9)}})]`;
    const receiverSource = `const calls=[];const original=Promise.prototype.then;
      Promise.prototype.then=function(...args){calls.push(Object.getPrototypeOf(this)===Promise.prototype);return Reflect.apply(original,this,args)};
      const promise=Promise.${initial}(7);original.call(promise,()=>{},()=>{});return [promise,calls,original]`;
    const nativeA = runInNewContext(`(()=>{${methodSource}})()`);
    const nativeB = runInNewContext(`(()=>{${receiverSource}})()`);
    const nativeResult = nativeA[0].call(nativeB[0], nativeA[1]);
    const expected = await new Promise(resolve => nativeB[2].call(nativeResult,
      (value: unknown) => resolve(["fulfilled", value]), (reason: unknown) => resolve(["rejected", reason])));
    const a = (await run(methodSource)).returnValue;
    const b = (await run(receiverSource)).returnValue;
    if (!Array.isArray(a) || !isSandboxClosure(a[0]) || !Array.isArray(b)) throw new Error("Expected SDK exports");
    const result = await a[0].call([a[1]], {stack:[],thisValue:b[0]});
    if (!isSandboxPromise(result)) throw new Error("Expected finally Promise");
    const actual = await result.promise.then(value => ["fulfilled", value], reason => ["rejected", reason]);
    expect(actual).toEqual(expected);
    expect(deepCopyFromSandbox(b[1])).toEqual(Array.from(nativeB[1]));
  }
);

it("retains local finally cleanup Promise prototypes under foreign inspection", async () => {
  const source = `return inspect=>{const calls=[];const original=Promise.prototype.then;
    Promise.prototype.then=function(...args){calls.push(inspect(this)===Promise.prototype);return Reflect.apply(original,this,args)};
    return [Promise.resolve(7).finally(()=>9),calls,original]}`;
  const nativeFactory = runInNewContext(`(()=>{${source}})()`);
  const nativeGetter = runInNewContext("Object.getPrototypeOf");
  const native = nativeFactory(nativeGetter);
  const expected = await new Promise(resolve => native[2].call(native[0], resolve));
  const factory = (await run(source)).returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!isSandboxClosure(factory) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
  const result = await factory.call([getter], {stack:[],thisValue:undefined});
  if (!Array.isArray(result) || !isSandboxPromise(result[0])) throw new Error("Expected finally result");
  expect(await result[0].promise).toBe(expected);
  expect(deepCopyFromSandbox(result[1])).toEqual(Array.from(native[1]));
});
