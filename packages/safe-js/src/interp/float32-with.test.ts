import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { createSandboxClosure, isSandboxClosure, measureSandboxData } from "./values.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it.each([
  'const value=new Float32Array([1,2,3]);const result=value.with(1,7);return [Array.from(result),Array.from(value),result.buffer!==value.buffer,Float32Array.prototype.with.length]',
  'return [-1,-3,0,-0,NaN,1.9,-1.9].map(index=>Array.from(new Float32Array([1,2,3]).with(index,7)))',
  'return [-4,3,Infinity,-Infinity].map(index=>{try{new Float32Array([1,2,3]).with(index,7)}catch(error){return error.name}})',
  'try{new Float32Array(0).with(0,{valueOf(){throw 7}})}catch(error){return error}',
  'class Samples extends Float32Array{static get [Symbol.species](){throw 7}};const result=new Samples([1,2]).with(0,3);return [result instanceof Samples,result instanceof Float32Array,Array.from(result)]',
  'const buffer=new ArrayBuffer(12,{maxByteLength:16});const value=new Float32Array(buffer);value.set([1,2,3]);const result=value.with(0,{valueOf(){buffer.resize(4);return 7}});return [Array.from(result),Array.from(value)]',
  'const buffer=new ArrayBuffer(12,{maxByteLength:16});const value=new Float32Array(buffer);try{value.with(1,{valueOf(){buffer.resize(4);return 7}})}catch(error){return error.name}',
  'return [Symbol("x"),BigInt(1)].map(value=>{try{new Float32Array([1]).with(0,value)}catch(error){return error.name}})',
  'const value=new Float32Array([1,2]);Object.defineProperty(value,"length",{get(){throw 7}});Object.defineProperty(value,"constructor",{get(){throw 8}});return Array.from(value.with(0,3))',
  'return Array.from(new Float32Array([1]).with())',
  'return Object.is(new Float32Array([1]).with(0,-0)[0],-0)'
])("matches native Float32 with: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(function(){${source}})()`)});
});

// Node 22 differs here; published ECMAScript 2026 and Node 24 agree.
it("converts index before replacement value", async () => {
  expect(await run('const events=[];const result=new Float32Array([1,2]).with({valueOf(){events.push("index");return 0}},{valueOf(){events.push("value");return 7}});return [events,Array.from(result)]')).toMatchObject({ok:true,returnValue:[["index","value"],[7,2]]});
});

it("validates against grown storage but copies the original length", async () => {
  expect(await run('const buffer=new ArrayBuffer(12,{maxByteLength:16});const value=new Float32Array(buffer);const result=value.with(3,{valueOf(){buffer.resize(16);return 7}});return [result.length,Array.from(result)]')).toMatchObject({ok:true,returnValue:[3,[0,0,0]]});
});

it("retains source storage during conversion and rejects detached storage with RangeError", async () => {
  const budget=new Budget({dataSize:100000});
  const values=(await run('const value=new Float32Array(new ArrayBuffer(12000),0,2);return [Float32Array.prototype.with,value]',{budget})).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing with method");
  const method=values[0];
  const receiver=values[1] as Float32Array;
  const replacement={valueOf:createSandboxClosure({call:()=>{
    expect(measureSandboxData(budget.retainedValues())).toBeGreaterThan(12000);
    structuredClone(receiver.buffer,{transfer:[receiver.buffer]});
    return 7;
  }})};
  await expect(method.call([0,replacement],{stack:[],thisValue:receiver})).rejects.toThrow(RangeError);
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
  expect(()=>method.call([0,7],{stack:[],thisValue:receiver})).toThrow(TypeError);
  expect(()=>method.call([0,7],{stack:[],thisValue:[]})).toThrow(TypeError);
});

it("preserves with through two snapshot round-trips without mutating the source", async () => {
  const source='const value=new Float32Array([1,2,3]);return ()=>[value.with(1,7),value]';
  let read=(await run(source)).returnValue;
  for(let round=0;round<2;round++){
    const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{read}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const restored=restore(saved,{source}).currentScope.lookup("read");
    if(!restored.found||!isSandboxClosure(restored.value))throw new Error("Missing restored reader");
    const values=await restored.value.call([]) as Float32Array[];
    expect(values.map(value=>Array.from(value))).toEqual([[1,7,3],[1,2,3]]);
    expect(values[0]!.buffer).not.toBe(values[1]!.buffer);
    read=restored.value;
  }
});

it("enforces step limits and leaves source unchanged", async () => {
  const budget=new Budget({dataSize:100000,maxSteps:100});
  const method=(await run('return Float32Array.prototype.with',{budget})).returnValue;
  if(!isSandboxClosure(method))throw new Error("Missing with method");
  const receiver=new Float32Array(300);
  await expect(method.call([0,7],{stack:[],thisValue:receiver})).rejects.toMatchObject({code:"budgetExceeded",budget:"steps"});
  expect(receiver.every(value=>value===0)).toBe(true);
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
});

it.each([
  {limits:{arrayLength:100},length:101,kind:"arrayLength"},
  {limits:{dataSize:2000},length:300,kind:"dataSize"}
])("bounds with output storage by $kind", async ({limits,length,kind}) => {
  const budget=new Budget(limits);
  const method=(await run('return Float32Array.prototype.with',{budget})).returnValue;
  if(!isSandboxClosure(method))throw new Error("Missing with method");
  await expect(method.call([0,7],{stack:[],thisValue:new Float32Array(length)})).rejects.toMatchObject({code:"budgetExceeded",budget:kind});
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
});
