import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { isSandboxClosure } from "../values.js";

it.each(["Error", "TypeError", "Number", "String", "Boolean", "Object", "Array", "Date", "RegExp", "Map", "Set"].flatMap(constructor =>
  ["function Target(){}", "const Target = (class {}).bind(null);", "const Target = (function(){}).bind(null);", "const Target = new Proxy(function(){},{});"].flatMap(target =>
    ["7", "null", "({custom:true})"].map(prototype => ({constructor,prototype,target}))))) (
  "uses foreign newTarget defaults: $constructor prototype=$prototype target=$target", async ({constructor,prototype,target}) => {
    const constructorSource = `return [Reflect.construct,${constructor}]`;
    // Binding allows a class target to have a replaceable prototype property.
    // Its visible function prototype chain must not determine its realm.
    const targetSource = `${target}Target.prototype=${prototype};Object.setPrototypeOf(Target,null);return [Target,${constructor}.prototype,Target.prototype]`;
    const nativeA = runInNewContext(`(()=>{${constructorSource}})()`);
    const nativeB = runInNewContext(`(()=>{${targetSource}})()`);
    const expected = nativeA[0](nativeA[1],[],nativeB[0]);
    const expectedIndex = prototype === "({custom:true})" ? 2 : 1;
    expect(Object.getPrototypeOf(expected)).toBe(nativeB[expectedIndex]);
    const a = (await run(constructorSource)).returnValue;
    const b = (await run(targetSource)).returnValue;
    const getter = (await run("return Object.getPrototypeOf")).returnValue;
    if (!Array.isArray(a) || !isSandboxClosure(a[0]) || !Array.isArray(b) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
    const context = {stack:[],thisValue:undefined};
    const actual = await a[0].call([a[1],[],b[0]],context);
    expect(await getter.call([actual],context) === b[expectedIndex]).toBe(true);
  }
);

it.each(["function Target(){}", "const Target = (function(){}).bind(null);", "const Target = (class {}).bind(null);"])(
  "keeps foreign newTarget realm through replay: %s", async target => {
    const source = `${target}Target.prototype=7;Object.setPrototypeOf(Target,null);
      const prototype=TypeError.prototype;globalThis.TypeError=undefined;
      await 0;return [Target,prototype,()=>{function Later(){}Later.prototype=7;return Later}]`;
    const original = await run(source);
    expect(original.ok).toBe(true);
    const replayed = await run(source, {snapshot:JSON.parse(await dump(original))});
    expect(replayed.ok).toBe(true);
    const constructors = (await run("return [Reflect.construct,TypeError,Object.getPrototypeOf]")).returnValue;
    if (!Array.isArray(constructors) || !isSandboxClosure(constructors[0]) || !isSandboxClosure(constructors[2]))
      throw new Error("Expected constructor exports");
    const context = {stack:[],thisValue:undefined};
    for (const result of [original,replayed]) {
      const values = result.returnValue;
      if (!Array.isArray(values) || !isSandboxClosure(values[2])) throw new Error("Expected target exports");
      const later = await values[2].call([],context);
      for (const newTarget of [values[0],later]) {
        const value = await constructors[0].call([constructors[1],[],newTarget],context);
        expect(await constructors[2].call([value],context)).toBe(values[1]);
      }
    }
  }
);
