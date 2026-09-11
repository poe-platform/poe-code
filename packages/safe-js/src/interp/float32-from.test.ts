import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { declareHostOperation } from "./host-bridge.js";
import { isSandboxClosure, measureSandboxData } from "./values.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it.each([
  "const iterator=(function*(){yield 2})();Object.setPrototypeOf(iterator,null);try{Float32Array.from({[Symbol.iterator](){return iterator}})}catch(error){return error.name}",
  "const parent=Object.getPrototypeOf(Float32Array);const d=Object.getOwnPropertyDescriptor(parent,'from');return [Object.hasOwn(Float32Array,'from'),Float32Array.from===parent.from,Float32Array.from.name,Float32Array.from.length,d.writable,d.enumerable,d.configurable]",
  "const trace=[];const source={get [Symbol.iterator](){trace.push('iterator');return null}};try{Float32Array.from.call(()=>{},source,3)}catch(error){return [error.name,trace]}",
  "const trace=[];const source={get [Symbol.iterator](){trace.push('iterator');return null}};try{Float32Array.from(source,3)}catch(error){return [error.name,trace]}",
  "const trace=[];function C(){trace.push('construct');return []}try{Float32Array.from.call(C,{length:1,get 0(){trace.push('index');return 2}},()=>trace.push('map'))}catch(error){return [error.name,trace]}",
  "const trace=[];function C(){trace.push('construct');return new Float32Array(0)}try{Float32Array.from.call(C,{length:1,get 0(){trace.push('index');return 2}})}catch(error){return [error.name,trace]}",
  "const trace=[];const source={*[Symbol.iterator](){try{yield 2;yield 4}finally{trace.push('done')}}};try{Float32Array.from(source,()=>{trace.push('map');throw 7})}catch(error){return [error,trace]}",
  "const trace=[];const source={[Symbol.iterator](){return {next(){trace.push('next');throw 7},return(){trace.push('close');return {done:true}}}}};try{Float32Array.from(source)}catch(error){return [error,trace]}",
  "const input={0:2,1:4,length:2,[Symbol.iterator]:null};return Array.from(Float32Array.from(input))",
  "return Array.from(Float32Array.from({length:2,0:{valueOf(){return 2.5}},1:{[Symbol.toPrimitive](hint){return hint==='number'?4:0}}}))",
  "return [null,undefined].map(source=>{try{Float32Array.from(source)}catch(error){return error.name}})",
  "return Array.from(Float32Array.from([2,4]))",
  "return Array.from(Float32Array.from({0:2,1:4,length:2},x=>x+1))",
  "return Array.from(Float32Array.from('24'))",
  "class Custom extends Float32Array{}const value=Custom.from([2]);return [value instanceof Custom,Array.from(value)]",
  "return Array.from(Float32Array.from([2,4],function(value,index){return this.base+value+index},{base:7}))",
  "const trace=[];const input={*[Symbol.iterator](){trace.push('first');yield 2;trace.push('second');yield 4;trace.push('done')}};function C(n){trace.push('construct');return new Float32Array(n)}const value=Float32Array.from.call(C,input,x=>{trace.push('map');return x});return [trace,Array.from(value)]",
  "const trace=[];const input={get length(){trace.push('length');return 2},get 0(){trace.push('0');return 2},get 1(){trace.push('1');return 4}};function C(n){trace.push('construct');return new Float32Array(n)}const value=Float32Array.from.call(C,input,x=>{trace.push('map');return x});return [trace,Array.from(value)]"
])("matches native TypedArray.from: %s", async source => {
  const expected = runInNewContext(`(function(){${source}})()`);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it("preserves factory identity and mapped subclass construction across snapshots", async () => {
  const source = "const factory=Float32Array.from;class Custom extends Float32Array{}return ()=>{const value=factory.call(Custom,{0:2,length:1},x=>x+1);return [factory===Custom.from,value instanceof Custom,Array.from(value)]}";
  let read = (await run(source)).returnValue;
  for (let round = 0; round < 2; round++) {
    const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "external", bindings: { read } }], callStack: [], pendingPromises: [], moduleBindings: {} });
    const result = restore(JSON.parse(JSON.stringify(saved)), { source }).currentScope.lookup("read");
    if (!result.found || !isSandboxClosure(result.value)) throw new Error("Missing restored reader");
    expect(await result.value.call([])).toEqual([true, true, [3]]);
    read = result.value;
  }
});

it.each([
  "({get length(){return 2},get 0(){return 2},get 1(){return 4}})",
  "({get [Symbol.iterator](){return function*(){yield 2;yield 4}}})"
])("supports guest accessors through direct factory calls: %s", async input => {
  const values = (await run(`return [Float32Array.from,Float32Array,${input}]`)).returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0])) throw new Error("Missing factory");
  expect(await values[0].call([values[2]], { stack: [], thisValue: values[1] })).toEqual(new Float32Array([2,4]));
});

it.each([false, true])("retains collected items and releases them after mapping (throw=%s)", async throws => {
  const budget = new Budget({ dataSize: 100000 });
  const retained: number[] = [];
  const inspect = declareHostOperation(() => { retained.push(measureSandboxData(budget.retainedValues())); }, "re-issue");
  const source = `function* input(){yield '2'.repeat(10000);inspect();yield 3}try{Float32Array.from(input(),(value,index)=>{if(index===0){inspect();${throws ? "throw 7" : "return 2"}}return value})}catch(error){if(error!==7)throw error}inspect();return true`;
  expect(await run(source, { budget, bindings: { inspect } })).toMatchObject({ ok: true, returnValue: true });
  expect(retained[0]).toBeGreaterThan(10000);
  expect(retained[1]).toBeGreaterThan(10000);
  expect(retained[2]).toBeLessThan(1000);
});

it("enforces collection allocation before constructing or mapping", async () => {
  const calls: string[] = [];
  const inspect = declareHostOperation((value: string) => { calls.push(value); }, "re-issue");
  await expect(run("function* input(){yield 1;yield 2;yield 3;yield 4}function C(n){inspect('construct');return new Float32Array(n)}Float32Array.from.call(C,input(),value=>{inspect('map');return value})", {
    budget: new Budget({ arrayLength: 3 }), bindings: { inspect }
  })).rejects.toMatchObject({ budget: "arrayLength" });
  expect(calls).toEqual([]);
});
