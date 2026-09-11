import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { declareHostOperation } from "./host-bridge.js";
import { isSandboxClosure, measureSandboxData } from "./values.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it.each([
  "const value=new Float32Array([1,2,3]);value.set({length:2,get 0(){return value[0]},get 1(){return value[1]}},1);return Array.from(value)",
  "const trace=[];const input={get length(){trace.push('length');return 0}};try{new Float32Array(2).set(input,Infinity)}catch(error){return [error.name,trace]}",
  "const trace=[];const input={get length(){trace.push('length');return 0}};try{new Float32Array(2).set(input,-1)}catch(error){return [error.name,trace]}",
  "const value=new Float32Array(2);return [null,undefined].map(source=>{try{value.set(source,Infinity)}catch(error){return error.name}})",
  "const value=new Float32Array(2);return [true,7,Symbol('x'),BigInt(2)].map(source=>{value.set(source);return Array.from(value)})",
  "const trace=[];try{Float32Array.prototype.set.call({},[],{valueOf(){trace.push('offset');return 0}})}catch(error){return [error.name,trace]}",
  "const value=new Float32Array(3);const input={length:2,get 0(){this.length=0;this[1]=4;return 2}};value.set(input);return Array.from(value)",
  "const value=new Float32Array(3);const source=Object.assign(Object.create({1:4}),{0:2,length:2});value.set(source);return Array.from(value)",
  "const value=new Float32Array(2);try{value.set([7,Symbol('x')])}catch(error){return [error.name,Array.from(value)]}",
  "const value=new Float32Array(3);value.set({0:2,1:4,length:2},1);return Array.from(value)",
  "const value=new Float32Array(2);value.set('24');return Array.from(value)",
  "const value=new Float32Array(2);value.set([{valueOf(){return 2}},4]);return Array.from(value)",
  "const trace=[];const value=new Float32Array(3);const input={get length(){trace.push('length');return 2},get 0(){trace.push('0');return 2},get 1(){trace.push('1');return 4},get [Symbol.iterator](){throw 7}};value.set(input,{valueOf(){trace.push('offset');return 1}});return [Array.from(value),trace]",
  "const value=new Float32Array(2);try{value.set({length:2,0:7,get 1(){throw 3}})}catch(error){return [error,Array.from(value)]}",
  "const value=new Float32Array([1,2,3]);value.set(value.subarray(0,2),1);return Array.from(value)",
  "const value=new Float32Array(2);try{value.set([1,2,3])}catch(error){return [error.name,Array.from(value)]}"
])("matches native Float32Array.set input semantics: %s", async source => {
  const expected = runInNewContext(`(function(){${source}})()`);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it.each([false, true])("retains target storage through getters and releases it (throw=%s)", async throws => {
  const budget = new Budget({ dataSize: 100000 });
  const retained: number[] = [];
  const inspect = declareHostOperation(() => { retained.push(measureSandboxData(budget.retainedValues())); }, "re-issue");
  const source = `try{Float32Array.prototype.set.call(new Float32Array(3000),{length:1,get 0(){inspect();${throws ? "throw 7" : "return 2"}}},{valueOf(){inspect();return 0}})}catch(error){if(error!==7)throw error}inspect();return true`;
  expect(await run(source, { budget, bindings: { inspect } })).toMatchObject({ ok: true, returnValue: true });
  expect(retained[0]).toBeGreaterThan(12000);
  expect(retained[1]).toBeGreaterThan(12000);
  expect(retained[2]).toBeLessThan(1000);
});

it.each(["'24'", "({get length(){return 2},get 0(){return 2},get 1(){return 4}})"])("supports direct method calls: %s", async input => {
  const values = (await run(`return [Float32Array.prototype.set,new Float32Array(2),${input}]`)).returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0])) throw new Error("Missing method");
  expect(await values[0].call([values[2]], { stack: [], thisValue: values[1] })).toBeUndefined();
  expect(values[1]).toEqual(new Float32Array([2,4]));
});

it("preserves set identity and aliased storage through snapshots", async () => {
  const source = "const value=new Float32Array([1,2,3]);const view=value.subarray(1);const method=value.set;return ()=>{method.call(value,{0:7,length:1},1);return [method===value.set,view[0],Array.from(value)]}";
  let read = (await run(source)).returnValue;
  for (let round = 0; round < 2; round++) {
    const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "external", bindings: { read } }], callStack: [], pendingPromises: [], moduleBindings: {} });
    const result = restore(JSON.parse(JSON.stringify(saved)), { source }).currentScope.lookup("read");
    if (!result.found || !isSandboxClosure(result.value)) throw new Error("Missing restored reader");
    expect(await result.value.call([])).toEqual([true, 7, [1,7,3]]);
    read = result.value;
  }
});
