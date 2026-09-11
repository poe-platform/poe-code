import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { createSandboxClosure, isSandboxClosure, measureSandboxData } from "./values.js";
import { Budget } from "./budget.js";
import { declareHostOperation } from "./host-bridge.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it.each([
  "const value=new Float32Array([1,2,3]);const result=value.fill(0.1);return [result===value,Array.from(value),Float32Array.prototype.fill.length]",
  "const value=new Float32Array([1,2,3,4]);value.fill(-0,-3,-1);return Array.from(value)",
  "const trace=[];const value=new Float32Array(3);value.fill({valueOf(){trace.push('value');return 7}},{valueOf(){trace.push('start');return 1}},{valueOf(){trace.push('end');return 2}});return [trace,Array.from(value)]",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer);value.fill(7,{valueOf(){buffer.resize(4);return 0}});return Array.from(value)",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer,4,1);try{value.fill(7,{valueOf(){buffer.resize(0);return 0}},0);return 'accepted'}catch(error){return error.name}",
  "const value=new Float32Array(2);value.fill(undefined);return Array.from(value)"
])("matches native Float32 fill: %s", async source => {
  expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext(`(function(){${source}})()`) });
});

it("uses the initial length when value coercion grows a tracking view", async () => {
  // ECMAScript 2026 23.2.3.9 captures length before ToNumber(value).
  // Node 22 fills the newly grown suffix too; do not copy that engine behavior.
  expect(await run("const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer);value.fill({valueOf(){buffer.resize(16);return 7}});return Array.from(value)"))
    .toMatchObject({ ok: true, returnValue: [7,7,0,0] });
});

it.each([
  "return [NaN,Infinity,-Infinity,-2.9,9].map(start=>Array.from(new Float32Array([1,2,3]).fill(7,start)))",
  "return [Symbol('x'),BigInt(1)].map(value=>{try{new Float32Array(0).fill(value);return 'accepted'}catch(error){return error.name}})",
  "const trace=[];const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer,4,1);buffer.resize(0);try{value.fill({valueOf(){trace.push('value');return 7}})}catch(error){return [error.name,trace]}",
  "class Samples extends Float32Array{};const value=new Samples([1,2,3]);return [value.fill(7,1)===value,value instanceof Samples,Array.from(value)]",
  "const buffer=new ArrayBuffer(16);const value=new Float32Array(buffer,4,2);value.fill(7);return Array.from(new Float32Array(buffer))"
])("matches fill bounds, errors and view behavior: %s", async source => {
  expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext(`(function(){${source}})()`) });
});

it("coerces direct-call getter arguments after realm cleanup", async () => {
  const values = (await run("return [Float32Array.prototype.fill,new Float32Array(3),{get valueOf(){return ()=>7}},{get valueOf(){return ()=>1}}]")).returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0])) throw new Error("Missing fill method");
  expect(await values[0].call([values[2],values[3]], { stack: [], thisValue: values[1] })).toBe(values[1]);
  expect(Array.from(values[1] as Float32Array)).toEqual([0,7,7]);
});

it("rejects a detached receiver before direct-call coercion", async () => {
  const values = (await run("return [Float32Array.prototype.fill,new Float32Array(0)]")).returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0])) throw new Error("Missing fill method");
  const receiver = values[1] as Float32Array;
  const fill = values[0];
  structuredClone(receiver.buffer, { transfer: [receiver.buffer] });
  expect(() => fill.call([7], { stack: [], thisValue: receiver })).toThrow(TypeError);
});

it("rechecks detachment after value coercion even for an empty range", async () => {
  const values = (await run("return [Float32Array.prototype.fill,new Float32Array(2)]")).returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0])) throw new Error("Missing fill method");
  const receiver = values[1] as Float32Array;
  const convert = createSandboxClosure({call:()=>{
    structuredClone(receiver.buffer,{transfer:[receiver.buffer]});
    return 7;
  }});
  await expect(values[0].call([{valueOf:convert},0,0],{stack:[],thisValue:receiver})).rejects.toThrow(TypeError);
});

it("finishes bound coercions before reporting callback-induced out-of-bounds storage", async () => {
  // Published 2026 ordering: value, start, end, then the second bounds check.
  expect(await run("const trace=[];const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer,4,1);try{value.fill({valueOf(){trace.push('value');buffer.resize(0);return 7}},{valueOf(){trace.push('start');return 0}},{valueOf(){trace.push('end');return 0}})}catch(error){return [error.name,trace]}"))
    .toMatchObject({ok:true,returnValue:["TypeError",["value","start","end"]]});
});

it("preserves fill through two snapshot round-trips", async () => {
  const source = "const value=new Float32Array([1,2,3]);return ()=>Array.from(value.fill(7,1))";
  let read = (await run(source)).returnValue;
  for (let round=0;round<2;round++) {
    const saved=serialize({ source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{read}}],callStack:[],pendingPromises:[],moduleBindings:{} });
    const restored=restore(saved,{source}).currentScope.lookup("read");
    if (!restored.found || !isSandboxClosure(restored.value)) throw new Error("Missing restored reader");
    expect(await restored.value.call([])).toEqual([1,7,7]);
    read=restored.value;
  }
});

it.each([false,true])("retains fill storage during coercion and releases it (throws: %s)", async throws => {
  const budget=new Budget({dataSize:100000});
  const retained:number[]=[];
  const inspect=declareHostOperation(()=>{retained.push(measureSandboxData(budget.retainedValues()));},"re-issue");
  expect(await run(`try{new Float32Array(3000).fill({valueOf(){inspect();${throws ? "throw 7" : "return 7"}}})}catch(error){if(error!==7)throw error}inspect();return true`,{budget,bindings:{inspect}}))
    .toMatchObject({ok:true,returnValue:true});
  expect(retained[0]).toBeGreaterThan(12000);
  expect(retained[1]).toBeLessThan(1000);
});

it("charges the step budget for fill writes", async () => {
  await expect(run("new Float32Array(1000).fill(7)",{budget:new Budget({maxSteps:100})}))
    .rejects.toMatchObject({code:"budgetExceeded",budget:"steps"});
});
