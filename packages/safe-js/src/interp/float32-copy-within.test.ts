import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { createSandboxClosure, isSandboxClosure, measureSandboxData } from "./values.js";
import { Budget } from "./budget.js";
import { declareHostOperation } from "./host-bridge.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it.each([
  "const value=new Float32Array([1,2,3,4]);const result=value.copyWithin(1,0,3);return [result===value,Array.from(value),Float32Array.prototype.copyWithin.length]",
  "const value=new Float32Array([1,2,3,4]);value.copyWithin(0,1);return Array.from(value)",
  "const value=new Float32Array([1,2,3,4]);value.copyWithin(-2,-3,-1);return Array.from(value)",
  "const buffer=new ArrayBuffer(24);const value=new Float32Array(buffer,4,4);value.set([1,2,3,4]);value.copyWithin(1,0,3);return Array.from(new Float32Array(buffer))",
  "const trace=[];const value=new Float32Array([1,2,3]);value.copyWithin({valueOf(){trace.push('target');return 0}},{valueOf(){trace.push('start');return 1}},{valueOf(){trace.push('end');return 3}});return [trace,Array.from(value)]",
  "const buffer=new ArrayBuffer(16,{maxByteLength:24});const value=new Float32Array(buffer);value.set([1,2,3,4]);value.copyWithin({valueOf(){buffer.resize(12);return 1}},0,3);return Array.from(value)"
])("matches native Float32 copyWithin: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(function(){${source}})()`)});
});

it.each([
  "const value=new Float32Array([1,2,3]);return [NaN,Infinity,-Infinity,-1.9,9].map(target=>Array.from(value.slice().copyWithin(target,0)))",
  "return [Symbol('x'),BigInt(1)].map(target=>{try{new Float32Array(0).copyWithin(target,0);return 'accepted'}catch(error){return error.name}})",
  "class Samples extends Float32Array{};const value=new Samples([1,2,3]);return [value.copyWithin(1,0)===value,value instanceof Samples,Array.from(value)]",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer);value.set([1,2]);value.copyWithin({valueOf(){buffer.resize(16);return 1}},0);return Array.from(value)",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer,4,1);try{value.copyWithin({valueOf(){buffer.resize(0);return 0}},0,0);return 'accepted'}catch(error){return error.name}",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer,4,1);try{value.copyWithin({valueOf(){buffer.resize(0);return 0}},0,1);return 'accepted'}catch(error){return error.name}",
  "const buffer=new ArrayBuffer(16,{maxByteLength:24});const value=new Float32Array(buffer);value.copyWithin({valueOf(){buffer.resize(4);return 2}},1,3);return Array.from(value)"
])("matches copyWithin bounds and resize behavior: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(function(){${source}})()`)});
});

it.each([[1,0,3],[0,1,4]])("preserves raw NaN payload bits for copyWithin(%s,%s,%s)", async (target,start,end) => {
  const values=(await run("return [Float32Array.prototype.copyWithin,new Float32Array(4)]")).returnValue;
  if (!Array.isArray(values)||!isSandboxClosure(values[0])) throw new Error("Missing method");
  const receiver=values[1] as Float32Array;
  const bits=[0x7fa12345,0xffc0ffff,0x80000000,0x3f800000];
  new Uint32Array(receiver.buffer).set(bits);
  const reference=new Float32Array(4);
  new Uint32Array(reference.buffer).set(bits);
  reference.copyWithin(target,start,end);
  expect(await values[0].call([target,start,end],{stack:[],thisValue:receiver})).toBe(receiver);
  expect(Array.from(new Uint8Array(receiver.buffer))).toEqual(Array.from(new Uint8Array(reference.buffer)));
});

it.each([0,2])("revalidates callback detachment only for positive copy count (end: %s)", async end => {
  const values=(await run("return [Float32Array.prototype.copyWithin,new Float32Array(2)]")).returnValue;
  if (!Array.isArray(values)||!isSandboxClosure(values[0])) throw new Error("Missing method");
  const receiver=values[1] as Float32Array;
  const convert=createSandboxClosure({call:()=>{structuredClone(receiver.buffer,{transfer:[receiver.buffer]});return 0;}});
  const result=values[0].call([{valueOf:convert},0,end],{stack:[],thisValue:receiver});
  if(end===0) await expect(result).resolves.toBe(receiver);
  else await expect(result).rejects.toThrow(TypeError);
});

it("coerces direct-call getter bounds after realm cleanup", async () => {
  const values=(await run("return [Float32Array.prototype.copyWithin,new Float32Array([1,2,3]),{get valueOf(){return ()=>1}}]")).returnValue;
  if (!Array.isArray(values)||!isSandboxClosure(values[0])) throw new Error("Missing method");
  expect(await values[0].call([values[2],0],{stack:[],thisValue:values[1]})).toBe(values[1]);
  expect(Array.from(values[1] as Float32Array)).toEqual([1,1,2]);
});

it("preserves copyWithin through two snapshot round-trips", async () => {
  const source="const value=new Float32Array([1,2,3]);return ()=>{value.set([1,2,3]);return Array.from(value.copyWithin(1,0))}";
  let read=(await run(source)).returnValue;
  for(let round=0;round<2;round++){
    const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{read}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const restored=restore(saved,{source}).currentScope.lookup("read");
    if(!restored.found||!isSandboxClosure(restored.value))throw new Error("Missing restored reader");
    expect(await restored.value.call([])).toEqual([1,1,2]);
    read=restored.value;
  }
});

it.each([false,true])("retains copyWithin storage during coercion and releases it (throws: %s)", async throws => {
  const budget=new Budget({dataSize:100000});
  const retained:number[]=[];
  const inspect=declareHostOperation(()=>{retained.push(measureSandboxData(budget.retainedValues()));},"re-issue");
  expect(await run(`try{new Float32Array(3000).copyWithin({valueOf(){inspect();${throws ? "throw 7" : "return 1"}}},0)}catch(error){if(error!==7)throw error}inspect();return true`,{budget,bindings:{inspect}}))
    .toMatchObject({ok:true,returnValue:true});
  expect(retained[0]).toBeGreaterThan(12000);
  expect(retained[1]).toBeLessThan(1000);
});

it("charges the step budget for byte copies", async () => {
  await expect(run("new Float32Array(1000).copyWithin(1,0)",{budget:new Budget({maxSteps:100})}))
    .rejects.toMatchObject({code:"budgetExceeded",budget:"steps"});
});
