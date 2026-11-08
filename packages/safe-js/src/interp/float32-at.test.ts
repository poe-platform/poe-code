import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { createSandboxClosure, isSandboxClosure, measureSandboxData } from "./values.js";
import { Budget } from "./budget.js";
import { declareHostOperation } from "./host-bridge.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it.each([
  "const value=new Float32Array([1,2,3]);return [value.at(0),value.at(-1),value.at(3),Float32Array.prototype.at.length]",
  "const value=new Float32Array([1,2,3]);return [undefined,NaN,Infinity,-Infinity,1.9,-1.9,-0].map(index=>value.at(index))",
  "const trace=[];const value=new Float32Array([1,2]);return [value.at({valueOf(){trace.push('index');return -1}}),trace]",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer);value.set([1,2]);return value.at({valueOf(){buffer.resize(16);return -1}})",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer);return value.at({valueOf(){buffer.resize(0);return 0}})",
  "const value=new Float32Array([1,2]);Object.defineProperty(value,'length',{get(){throw 7}});return value.at(-1)"
])("matches native Float32 at: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(function(){${source}})()`)});
});

it.each([
  "return [Symbol('x'),BigInt(1)].map(index=>{try{new Float32Array(0).at(index);return 'accepted'}catch(error){return error.name}})",
  "const trace=[];const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer,4,1);buffer.resize(0);try{value.at({valueOf(){trace.push('index');return 0}})}catch(error){return [error.name,trace]}",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer);return value.at({valueOf(){buffer.resize(16);return 2}})",
  "class Samples extends Float32Array{};return new Samples([1,2]).at(-1)"
])("matches at errors and boundaries: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(function(){${source}})()`)});
});

it("supports direct getter coercion and callback detachment", async () => {
  const values=(await run("return [Float32Array.prototype.at,new Float32Array([1,2]),{get valueOf(){return ()=>-1}}]")).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing at method");
  const at=values[0];
  const receiver=values[1] as Float32Array;
  expect(await at.call([values[2]],{stack:[],thisValue:receiver})).toBe(2);
  const convert=createSandboxClosure({call:()=>{structuredClone(receiver.buffer,{transfer:[receiver.buffer]});return 0;}});
  expect(await at.call([{valueOf:convert}],{stack:[],thisValue:receiver})).toBeUndefined();
  expect(()=>at.call([0],{stack:[],thisValue:receiver})).toThrow(TypeError);
  expect(()=>at.call([0],{stack:[],thisValue:[]})).toThrow(TypeError);
});

it("preserves at through two snapshot round-trips", async () => {
  const source="const value=new Float32Array([1,2,3]);return ()=>value.at(-1)";
  let read=(await run(source)).returnValue;
  for(let round=0;round<2;round++){
    const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{read}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const restored=restore(saved,{source}).currentScope.lookup("read");
    if(!restored.found||!isSandboxClosure(restored.value))throw new Error("Missing restored reader");
    expect(await restored.value.call([])).toBe(3);
    read=restored.value;
  }
});

it.each([false,true])("retains at storage during coercion and releases it (throws: %s)", async throws => {
  const budget=new Budget({dataSize:100000});
  const retained:number[]=[];
  const inspect=declareHostOperation(()=>{retained.push(measureSandboxData(budget.retainedValues()));},"re-issue");
  expect(await run(`try{new Float32Array(3000).at({valueOf(){inspect();${throws ? "throw 7" : "return -1"}}})}catch(error){if(error!==7)throw error}inspect();return true`,{budget,bindings:{inspect}}))
    .toMatchObject({ok:true,returnValue:true});
  expect(retained[0]).toBeGreaterThan(12000);
  expect(retained[1]).toBeLessThan(1000);
});
