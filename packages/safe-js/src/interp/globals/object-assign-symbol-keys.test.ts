import { expect, it } from "vitest";
import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { createObjectArrayGlobals } from "./object-array.js";
import { getSandboxDataProperty } from "../object-model.js";
import { type SandboxClosure, type SandboxObject } from "../values.js";

it.each(["{}","Promise.resolve(1)","new Map()","new Set()","/x/"])("assigns symbol keys to %s", async expression => {
  const source=`const value=${expression};const key=Symbol("key");Object.assign(value,{[key]:7});return value[key]`;
  expect((await run(source)).returnValue).toBe(7);
});

it("reads string keys before symbols and copies only enumerable properties", async () => {
  const source=`const calls=[];const key=Symbol("key");const hidden=Symbol("hidden");
    const source={get first(){calls.push("string");return 1},get [key](){calls.push("symbol");return 2}};
    Object.defineProperty(source,hidden,{get(){throw new Error("hidden")}});
    const value=Object.assign({},source);return [calls,value.first,value[key],Object.hasOwn(value,hidden)]`;
  expect((await run(source)).returnValue).toEqual([["string","symbol"],1,2,false]);
});

it("snapshots all keys but checks enumerability when each key is visited", async () => {
  const source=`const key=Symbol("key");const added=Symbol("added");
    const source={get first(){Object.defineProperty(source,key,{enumerable:true});source[added]=3;return 1}};
    Object.defineProperty(source,key,{value:2,enumerable:false,configurable:true});
    const value=Object.assign({},source);return [value.first,value[key],Object.hasOwn(value,added)]`;
  expect((await run(source)).returnValue).toEqual([1,2,false]);
});

it("skips symbol properties deleted by an earlier getter", async () => {
  const source=`const key=Symbol("key");const source={get first(){delete source[key];return 1},[key]:2};
    const value=Object.assign({},source);return [value.first,Object.hasOwn(value,key)]`;
  expect((await run(source)).returnValue).toEqual([1,false]);
});

it("copies symbol keys through the direct builtin adapter", async () => {
  const globals=createObjectArrayGlobals({budget:new Budget()});
  const assign=getSandboxDataProperty(globals.Object,"assign") as SandboxClosure;
  const key=Symbol("key");const target:SandboxObject={};
  expect(await assign.call([target,{[key]:42}])).toBe(target);
  expect(target[key]).toBe(42);
});
