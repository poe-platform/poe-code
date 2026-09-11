import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";
import { isSandboxClosure, measureSandboxData } from "./values.js";
import { Budget } from "./budget.js";
import { declareHostOperation } from "./host-bridge.js";

it.each([
  "const value=new Float32Array([1,2,3]);const trace=[];value.constructor={[Symbol.species]:function(length){trace.push([length,arguments.length]);return new Float32Array(4)}};const result=value.slice(1);return [trace,Array.from(result)]",
  "const value=new Float32Array([1,2,3]);const trace=[];value.constructor={[Symbol.species]:function(buffer,offset,length){trace.push([buffer===value.buffer,offset,length,arguments.length]);return new Float32Array(buffer,offset,length)}};const result=value.subarray(1);result[0]=7;return [trace,Array.from(value)]",
  "const value=new Float32Array([1,2,3]);value.constructor={[Symbol.species]:function(){return new Float32Array(1)}};try{value.slice(0);return 'accepted'}catch(error){return error.name}",
  "const buffer=new ArrayBuffer(16);const value=new Float32Array(buffer,0,3);value.set([1,2,3]);value.constructor={[Symbol.species]:function(){return new Float32Array(buffer,4,3)}};const result=value.slice();return [Array.from(result),Array.from(new Float32Array(buffer))]"
])("matches custom species allocation and storage: %s", async source => {
  expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext(`(function(){${source}})()`) });
});

it.each(["slice", "subarray"])("preserves inherited %s species", async method => {
  const source = `class Samples extends Float32Array{};const value=new Samples([1,2,3]);const result=value.${method}(1);return [result instanceof Samples,Array.from(result)]`;
  expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext(`(function(){${source}})()`) });
});

it.each(["slice", "subarray"])("reads %s species after coercing bounds", async method => {
  const source = `const trace=[];const value=new Float32Array([1,2,3]);value.constructor={get [Symbol.species](){trace.push('species');return Float32Array}};const result=value.${method}({valueOf(){trace.push('start');return 1}},{valueOf(){trace.push('end');return 3}});return [Array.from(result),trace]`;
  expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext(`(function(){${source}})()`) });
});

it.each(["slice", "subarray"])("rejects invalid %s constructors and species", async method => {
  const source = `return [7,null,{[Symbol.species]:7},{[Symbol.species]:()=>new Float32Array(2)},{[Symbol.species]:function(){return {}}}].map(constructor=>{const value=new Float32Array([1,2,3]);value.constructor=constructor;try{value.${method}(1);return 'accepted'}catch(error){return error.name}})`;
  expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext(`(function(){${source}})()`) });
});

it.each(["slice", "subarray"])("uses the default %s constructor for absent species", async method => {
  const source = `return [undefined,{}, {[Symbol.species]:null},{[Symbol.species]:undefined}].map(constructor=>{const value=new Float32Array([1,2,3]);value.constructor=constructor;return Array.from(value.${method}(1))})`;
  expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext(`(function(){${source}})()`) });
});

it.each([
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer);const trace=[];value.constructor={[Symbol.species]:function(...args){trace.push([args.length,args[0]===buffer,args[1]]);return new Float32Array(...args)}};const result=value.subarray(1);buffer.resize(16);return [trace,result.length]",
  "const value=new Float32Array([1,2,3]);value.constructor={[Symbol.species]:function(length){value[1]=7;return new Float32Array(length)}};return Array.from(value.slice(1))",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer,4,1);value.constructor={get [Symbol.species](){buffer.resize(0);return Float32Array}};try{value.slice();return 'accepted'}catch(error){return error.name}",
  "const value=new Float32Array([1,2,3]);value.constructor={[Symbol.species]:function(){const buffer=new ArrayBuffer(8,{maxByteLength:16});const result=new Float32Array(buffer,4,1);buffer.resize(0);return result}};try{value.subarray();return 'accepted'}catch(error){return error.name}",
  "const value=new Float32Array([1,2,3]);value.constructor={[Symbol.species]:function(){return new Float32Array(0)}};return value.subarray().length"
])("matches species callback and resizable layout behavior: %s", async source => {
  expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext(`(function(){${source}})()`) });
});

it.each(["slice", "subarray"])("preserves %s species through snapshots", async method => {
  const source = `class Samples extends Float32Array{};const value=new Samples([1,2,3]);return ()=>{const result=value.${method}(1);return [result instanceof Samples,Array.from(result)]}`;
  const expected = runInNewContext(`(function(){${source}})()()`);
  let read = (await run(source)).returnValue;
  for (let round = 0; round < 2; round++) {
    const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "external", bindings: { read } }], callStack: [], pendingPromises: [], moduleBindings: {} });
    const result = restore(JSON.parse(JSON.stringify(saved)), { source }).currentScope.lookup("read");
    if (!result.found || !isSandboxClosure(result.value)) throw new Error("Missing restored reader");
    expect(await result.value.call([])).toEqual(expected);
    read = result.value;
  }
});

it.each(["slice", "subarray"])("retains %s storage during species calls and releases it afterward", async method => {
  for (const throws of [false, true]) {
    const budget = new Budget({ dataSize: 100000 });
    const retained: number[] = [];
    const inspect = declareHostOperation(() => { retained.push(measureSandboxData(budget.retainedValues())); }, "re-issue");
    const source = `function make(){const value=new Float32Array(3000);value.constructor={[Symbol.species]:function(){inspect();${throws ? "throw 7" : "return new Float32Array(1)"}}};return value}try{make().${method}(0,1)}catch(error){if(error!==7)throw error}inspect();return true`;
    expect(await run(source, { budget, bindings: { inspect } })).toMatchObject({ ok: true, returnValue: true });
    expect(retained[0]).toBeGreaterThan(12000);
    expect(retained[1]).toBeLessThan(1000);
  }
});
