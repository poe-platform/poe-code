import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { declareHostOperation } from "./host-bridge.js";
import { Budget, SandboxError } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createSandboxClosure, isSandboxClosure, reconcileCompiledValues } from "./values.js";
import { getSandboxPrototype, materializeFunctionProperties, releaseObjectPrototype } from "./object-model.js";
import { serialize } from "../snapshot/serialize.js";
import { restore as restoreGraph } from "../snapshot/restore.js";
import { getIntrinsicIdentity, resolveIntrinsicIdentity } from "./intrinsics.js";
import { runResources, withRunResources } from "./resources.js";
import { getFunctionMember } from "./methods/function.js";

it.each([
  "const f=()=>1;return [typeof Object.getPrototypeOf(f),f.call===f.call,f.call.name,f.call.length]",
  "function f(a,b){}const prototype=Object.getPrototypeOf(f);return [prototype(),prototype.name,prototype.length,Object.getPrototypeOf(prototype)===Object.prototype]",
  "const f=()=>1;const prototype=Object.getPrototypeOf(f);return [Object.getPrototypeOf(()=>2)===prototype,Object.getPrototypeOf(Math.abs)===prototype,Object.getPrototypeOf(f.bind(null))===prototype]",
  "function f(a,b){return [this.value,a,b]}return [f.call({value:1},2,3),f.apply({value:4},[5,6]),f.bind({value:7},8)(9)]",
  "const f=()=>1;const prototype=Object.getPrototypeOf(f);return [prototype.call.name,prototype.call.length,prototype.apply.name,prototype.apply.length,prototype.bind.name,prototype.bind.length,prototype.toString.name,prototype.toString.length]",
  "const f=()=>1;const prototype=Object.getPrototypeOf(f);prototype.call=function(){return 7};return f.call()",
  "const f=()=>1;delete Object.getPrototypeOf(f).call;return typeof f.call",
  "const f=()=>1;const prototype=Object.getPrototypeOf(f);const descriptor=Object.getOwnPropertyDescriptor(prototype,'call');return [descriptor.writable,descriptor.enumerable,descriptor.configurable]",
  "function named(a,b){}return [named.name,named.length,typeof named.prototype,named.prototype.constructor===named]",
  "function named(a,b){}delete named.name;delete named.length;return [named.name,named.length]",
  "const f=()=>1;const prototype=Object.getPrototypeOf(f);try{new prototype.call()}catch(error){return error.name}",
  "const f=()=>1;const prototype=Object.getPrototypeOf(f);try{prototype.call.call({})}catch(error){return error.name}",
  "const f=()=>1;Object.freeze(Object.getPrototypeOf(f));return [f.call(),f.apply(null,[]),f.bind(null)()]",
  "const call=(()=>{}).call;return call.call(function(){return arguments.length},null,1,2)",
  "function f(){}Object.setPrototypeOf(f,null);return [typeof f.call,typeof f.apply,typeof f.bind]",
  "function f(){}return [f instanceof Object,Object.prototype.isPrototypeOf(f)]",
  "const f=()=>1;Object.getPrototypeOf(f).toString=()=> 'shared';return String(f)",
  "const f=()=>1;Object.getPrototypeOf(f).valueOf=()=>7;return +f"
])("shares the callable function prototype: %s", async source => {
  expect((await run(source)).returnValue).toEqual(runInNewContext(`(function(){${source}})()`));
});

it("does not charge prototype installation as guest execution", async () => {
  expect((await run("return 1", { budget: new Budget({ maxSteps: 2 }) })).returnValue).toBe(1);
});

it("preserves legacy function-prototype and source-text behavior", async () => {
  await withRunResources(undefined, async () => {
    runResources.getStore()!.functionSourceText = false;
    const budget = new Budget();
    createBuiltinBindings({ budget });
    const target = createSandboxClosure({ guest: true, call: () => undefined });
    try {
      expect(getSandboxPrototype(target, budget)).toBeNull();
      expect(getFunctionMember(target, "toString", { budget, callClosure: () => undefined })).toBeUndefined();
    } finally { releaseObjectPrototype(budget); }
  });
});

it("retains mutated shared function properties under the data budget", () => {
  const budget = new Budget({ dataSize: 100 });
  createBuiltinBindings({ budget });
  const target = createSandboxClosure({ guest: true, call: () => undefined });
  const prototype = getSandboxPrototype(target, budget);
  if (!isSandboxClosure(prototype)) throw new Error("Missing function prototype");
  try {
    materializeFunctionProperties(prototype).extra = "x".repeat(1000);
    expect(() => reconcileCompiledValues(budget, [])).toThrow(SandboxError);
  } finally { releaseObjectPrototype(budget); }
});

it("restores a borrowed invocation method by intrinsic identity", async () => {
  const method = (await run("return (()=>1).call")).returnValue;
  if (!isSandboxClosure(method)) throw new Error("Missing call method");
  const source = "await task()";
  const snapshot = serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: { method } }], callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restoreGraph(JSON.parse(JSON.stringify(snapshot)), { source });
  const binding = restored.currentScope.lookup("method");
  if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("Missing restored method");
  expect(binding.value).toBe(resolveIntrinsicIdentity(restored.budget, getIntrinsicIdentity(method)!));
  const target = createSandboxClosure({ call: ([value]) => Number(value) + 1 });
  expect(await binding.value.call([undefined, 2], { stack: [], thisValue: target })).toBe(3);
});

it("preserves shared method mutations across a pending effect", async () => {
  const source = "const f=()=>1;const prototype=Object.getPrototypeOf(f);prototype.call=function(){return 7};await pause();return [f.call(),prototype===Object.getPrototypeOf(()=>2)]";
  let release!: () => void;
  let signalEntered!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { signalEntered = resolve; });
  const pause = declareHostOperation(async () => { signalEntered(); await pending; }, "re-issue");
  const execution = run(source, { bindings: { pause } });
  void execution.catch(() => undefined);
  let serialized: string;
  try {
    await Promise.race([entered, execution]);
    serialized = await dump(execution, { mode: "replay" });
  } finally { release(); }
  expect((await execution).returnValue).toEqual([7, true]);
  expect((await run(source, { snapshot: restore(JSON.parse(serialized), { source }),
    bindings: { pause: declareHostOperation(async () => undefined, "re-issue") } })).returnValue).toEqual([7, true]);
});

it("does not expose a dynamic host Function constructor", async () => {
  const result = await run("function f(){}return [typeof Function,f.constructor===Function,Math.abs.constructor===Function,Array.constructor===Function,Function.constructor===Function,Function('return [typeof process,typeof require,typeof Buffer]')(),Function.kind,Function.properties]");
  expect(result.returnValue).toEqual(["function", true, true, true, true, ["undefined", "undefined", "undefined"], undefined, undefined]);
});
