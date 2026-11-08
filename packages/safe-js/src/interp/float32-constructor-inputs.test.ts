import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { isSandboxClosure, measureSandboxData } from "./values.js";
import { Budget } from "./budget.js";
import { declareHostOperation } from "./host-bridge.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it.each([
  "const trace=[];const input={get [Symbol.iterator](){trace.push('iterator');return null},get length(){trace.push('length');return 1},get 0(){trace.push('0');return 2}};return [Array.from(new Float32Array(input)),trace]",
  "const trace=[];const input={get [Symbol.iterator](){trace.push('iterator');return 3},get length(){trace.push('length');return 1}};try{new Float32Array(input)}catch(error){return [error.name,trace]}",
  "const input=Object.assign(Object.create({1:4}),{0:2,length:2});return Array.from(new Float32Array(input))",
  "class Custom extends Float32Array{field=7}const value=new Custom({0:2,length:1});return [value instanceof Custom,value.field,Array.from(value)]",
  "const input={length:3,get 0(){this.length=1;this[1]=4;return 2}};return Array.from(new Float32Array(input))",
  "return Array.from(new Float32Array({0:2,1:4,length:2}))",
  "const input=[2,4];input[Symbol.iterator]=function*(){yield 7};return Array.from(new Float32Array(input))",
  "return Array.from(new Float32Array({*[Symbol.iterator](){yield 2;yield 4}}))",
  "return Array.from(new Float32Array(new Number(3)))",
  "const trace=[];const input={get length(){trace.push('length');return {valueOf(){trace.push('number');return 2}}},get 0(){trace.push('0');return 2},get 1(){trace.push('1');return 4}};return [Array.from(new Float32Array(input)),trace]",
  "const trace=[];const input={*[Symbol.iterator](){trace.push('first');yield {valueOf(){trace.push('convert');return 2}};trace.push('done')}};return [Array.from(new Float32Array(input)),trace]",
  "return Array.from(new Float32Array([{valueOf(){return 2.5}}]))",
  "const input=new Float32Array([2,4]);input[Symbol.iterator]=()=>{throw 7};return Array.from(new Float32Array(input))",
  "return Array.from(new Float32Array('3'))"
])("matches native Float32Array constructor input semantics: %s", async source => {
  const expected = runInNewContext(`(function(){${source}})()`);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it.each([false, true])("retains collected constructor inputs until conversion and releases them (throw=%s)", async throws => {
  const budget = new Budget({ dataSize: 100000 });
  const retained: number[] = [];
  const inspect = declareHostOperation(() => { retained.push(measureSandboxData(budget.retainedValues())); }, "re-issue");
  const source = `function* input(){yield {payload:'x'.repeat(10000),valueOf(){inspect();${throws ? "throw 7" : "return 2"}}};inspect();yield 4}try{new Float32Array(input())}catch(error){if(error!==7)throw error}inspect();return true`;
  expect(await run(source, { budget, bindings: { inspect } })).toMatchObject({ ok: true, returnValue: true });
  expect(retained[0]).toBeGreaterThan(10000);
  expect(retained[1]).toBeGreaterThan(10000);
  expect(retained[2]).toBeLessThan(1000);
});

it("preserves constructor input getters and subclass identity across snapshots", async () => {
  const source = "class Custom extends Float32Array{}const input={get length(){return 1},get 0(){return {valueOf(){return 2.5}}}};return ()=>{const value=new Custom(input);return [value instanceof Custom,Array.from(value)]}";
  let read = (await run(source)).returnValue;
  for (let round = 0; round < 2; round++) {
    const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "external", bindings: { read } }], callStack: [], pendingPromises: [], moduleBindings: {} });
    const result = restore(JSON.parse(JSON.stringify(saved)), { source }).currentScope.lookup("read");
    if (!result.found || !isSandboxClosure(result.value)) throw new Error("Missing restored reader");
    expect(await result.value.call([])).toEqual([true, [2.5]]);
    read = result.value;
  }
});

it.each([-1, Infinity, Symbol("invalid")])("matches native prototype lookup for invalid primitive length: %s", async input => {
  const nativeTrace: string[] = [];
  const nativeTarget = function () {}.bind(null);
  Object.defineProperty(nativeTarget, "prototype", { get() { nativeTrace.push("prototype"); return {}; } });
  expect(() => Reflect.construct(Float32Array, [input], nativeTarget)).toThrow();
  const constructor = (await run("return Float32Array")).returnValue;
  if (!isSandboxClosure(constructor) || constructor.construct === undefined) throw new Error("Missing constructor");
  const trace: string[] = [];
  await expect(constructor.construct([input], { stack: [], thisValue: undefined,
    getProperty: () => { trace.push("prototype"); return {}; }
  })).rejects.toThrow();
  expect(trace).toEqual(nativeTrace);
});
