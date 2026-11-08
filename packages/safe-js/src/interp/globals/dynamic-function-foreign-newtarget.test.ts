import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { isSandboxClosure, isSandboxPromise } from "../values.js";

it.each(["function(){}","async function(){}","function*(){}","async function*(){}"]
  .flatMap(expression => ["7","null","({custom:true})"].map(prototype=>({expression,prototype}))))(
  "uses foreign dynamic constructor defaults: $expression $prototype", async ({expression,prototype}) => {
    const source = `const Constructor=(${expression}).constructor;return Target=>Reflect.construct(Constructor,["return 7"],Target)`;
    const targetSource = `function Target(){}Target.prototype=${prototype};return [Target,Object.getPrototypeOf(${expression}),Target.prototype]`;
    const nativeFactory = runInNewContext(`(()=>{${source}})()`);
    const nativeTarget = runInNewContext(`(()=>{${targetSource}})()`);
    const expectedIndex = prototype === "({custom:true})" ? 2 : 1;
    expect(Object.getPrototypeOf(nativeFactory(nativeTarget[0]))).toBe(nativeTarget[expectedIndex]);
    const factory = (await run(source)).returnValue;
    const target = (await run(targetSource)).returnValue;
    const getter = (await run("return Object.getPrototypeOf")).returnValue;
    if (!isSandboxClosure(factory) || !Array.isArray(target) || !isSandboxClosure(getter)) throw new Error("Expected function exports");
    const context = {stack:[],thisValue:undefined};
    const value = await factory.call([target[0]],context);
    expect(await getter.call([value],context)).toBe(target[expectedIndex]);
  }
);

it.each(["function(){}","async function(){}","function*(){}","async function*(){}"])(
  "keeps the body realm distinct from the prototype realm after replay: %s", async expression => {
    const resultExpression = expression.includes("*") ? "(await fn().next()).value" : "await fn()";
    const source = `globalThis.marker=7;const Constructor=(${expression}).constructor;await 0;
      return async Target=>{const fn=Reflect.construct(Constructor,["return globalThis.marker"],Target);return [fn,${resultExpression}]}`;
    const targetSource = `globalThis.marker=9;const Target=(class {}).bind(null);Target.prototype=7;await 0;
      return [Target,Object.getPrototypeOf(${expression})]`;
    const nativeFactory = await runInNewContext(`(async()=>{${source}})()`);
    const nativeTarget = await runInNewContext(`(async()=>{${targetSource}})()`);
    const nativeValue = await nativeFactory(nativeTarget[0]);
    expect(nativeValue[1]).toBe(7);
    expect(Object.getPrototypeOf(nativeValue[0])).toBe(nativeTarget[1]);
    const original = await run(source);
    const originalTarget = await run(targetSource);
    expect(original.ok).toBe(true);
    expect(originalTarget.ok).toBe(true);
    const replayed = await run(source,{snapshot:JSON.parse(await dump(original))});
    const replayedTarget = await run(targetSource,{snapshot:JSON.parse(await dump(originalTarget))});
    expect(replayed.ok).toBe(true);
    expect(replayedTarget.ok).toBe(true);
    const getter = (await run("return Object.getPrototypeOf")).returnValue;
    if (!isSandboxClosure(getter)) throw new Error("Expected prototype getter");
    const context = {stack:[],thisValue:undefined};
    for (const factoryResult of [original,replayed]) {
      const factory = factoryResult.returnValue;
      if (!isSandboxClosure(factory)) throw new Error("Expected factory");
      for (const targetResult of [originalTarget,replayedTarget]) {
        const target = targetResult.returnValue;
        if (!Array.isArray(target)) throw new Error("Expected target exports");
        const promise = await factory.call([target[0]],context);
        if (!isSandboxPromise(promise)) throw new Error("Expected async result");
        const values = await promise.promise;
        if (!Array.isArray(values)) throw new Error("Expected function and execution result");
        expect(values[1]).toBe(7);
        expect(await getter.call([values[0]],context)).toBe(target[1]);
      }
    }
  }
);
