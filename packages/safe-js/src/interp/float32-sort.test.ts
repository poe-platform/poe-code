import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { createSandboxClosure, isSandboxClosure, measureSandboxData } from "./values.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it.each([
  'const value=new Float32Array([10,2,-1,0]);const result=value.sort();return [result===value,Array.from(result),Float32Array.prototype.sort.length]',
  'return Array.from(new Float32Array([NaN,Infinity,-Infinity,2,NaN]).sort())',
  'return Array.from(new Float32Array([0,-0,0,-0]).sort()).map(item=>Object.is(item,-0))',
  'return [Array.from(new Float32Array(0).sort()),Array.from(new Float32Array([7]).sort())]',
  'return Array.from(new Float32Array([1,3,2]).sort((left,right)=>right-left))',
  'return Array.from(new Float32Array([1,3,2]).sort((left,right)=>({valueOf(){return right-left}})))',
  'return [NaN,undefined].map(result=>Array.from(new Float32Array([3,1,2]).sort(()=>result)))',
  'return Array.from(new Float32Array([21,11,22,12]).sort((left,right)=>Math.floor(left/10)-Math.floor(right/10)))',
  'const value=new Float32Array([3,1,2]);const result=value.sort((left,right)=>{value.fill(7);return left-right});return [result===value,Array.from(result)]',
  'const value=new Float32Array([3,1,2]);try{value.sort(()=>{throw 7})}catch(error){return [error,Array.from(value)]}',
  'return [null,0,{}].map(comparator=>{try{new Float32Array(0).sort(comparator)}catch(error){return error.name}})',
  'const value=new Float32Array([2,1]);Object.defineProperty(value,"length",{get(){throw 7}});Object.defineProperty(value,"constructor",{get(){throw 8}});return Array.from(value.sort())',
  'const buffer=new ArrayBuffer(12,{maxByteLength:16});const value=new Float32Array(buffer);value.set([3,1,2]);value.sort((left,right)=>{buffer.resize(0);return left-right});return value.length',
  'const buffer=new ArrayBuffer(12,{maxByteLength:16});const value=new Float32Array(buffer);value.set([3,1,2]);value.sort((left,right)=>{buffer.resize(16);return left-right});return Array.from(value)',
  'return [Symbol("x"),BigInt(1)].map(result=>{try{new Float32Array([2,1]).sort(()=>result)}catch(error){return error.name}})',
  'const value=new Float32Array([2,1]);try{value.sort(()=>({valueOf(){throw 7}}))}catch(error){return [error,Array.from(value)]}',
  'return Array.from(new Float32Array([2,1]).sort(function(left,right){"use strict";if(this!==undefined)throw 7;return left-right}))'
])("matches native Float32 sort: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(function(){${source}})()`)});
});

it("converts a returned promise without awaiting its numeric result", async () => {
  const source="const pending=[];const value=new Float32Array([2,1]);value.sort(()=>{const promise=Promise.resolve(-1);pending.push(promise);return promise});await Promise.all(pending);return Array.from(value)";
  expect(await run(source)).toMatchObject({ok:true,returnValue:await runInNewContext(`(async function(){${source}})()`)});
});

it.each([3,7,32,129,1024])("sorts %s elements stably within a merge-sort comparison bound", async length => {
  const budget=new Budget({dataSize:100000,maxSteps:50000});
  const method=(await run("return Float32Array.prototype.sort",{budget})).returnValue;
  if(!isSandboxClosure(method))throw new Error("Missing sort method");
  const receiver=Float32Array.from({length},(_,index)=>(index*37)%101);
  const expected=Float32Array.from(receiver).sort((a,b)=>Math.floor(a/10)-Math.floor(b/10));
  let calls=0;
  const comparator=createSandboxClosure({call:args=>{calls++;return Math.floor(Number(args[0])/10)-Math.floor(Number(args[1])/10)}});
  expect(await method.call([comparator],{stack:[],thisValue:receiver})).toBe(receiver);
  expect(receiver).toEqual(expected);
  expect(calls).toBeLessThanOrEqual(length*Math.ceil(Math.log2(length)));
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
});

it("retains original storage and completes comparisons after direct detachment", async () => {
  const budget=new Budget({dataSize:100000});
  const values=(await run("const value=new Float32Array(new ArrayBuffer(12000),0,2);value.set([2,1]);return [Float32Array.prototype.sort,value]",{budget})).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing sort method");
  const method=values[0];
  const receiver=values[1] as Float32Array;
  const comparator=createSandboxClosure({call:args=>{
    expect(measureSandboxData(budget.retainedValues())).toBeGreaterThan(12000);
    expect(args).toEqual([2,1]);
    structuredClone(receiver.buffer,{transfer:[receiver.buffer]});
    return 1;
  }});
  expect(await method.call([comparator],{stack:[],thisValue:receiver})).toBe(receiver);
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
  expect(()=>method.call([],{stack:[],thisValue:receiver})).toThrow(TypeError);
  expect(()=>method.call([],{stack:[],thisValue:[]})).toThrow(TypeError);
});

it("preserves sort through two snapshot round-trips", async () => {
  const source="const value=new Float32Array([3,1,2]);return ()=>value.sort()";
  let read=(await run(source)).returnValue;
  for(let round=0;round<2;round++){
    const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{read}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const restored=restore(saved,{source}).currentScope.lookup("read");
    if(!restored.found||!isSandboxClosure(restored.value))throw new Error("Missing restored reader");
    expect(Array.from(await restored.value.call([]) as Float32Array)).toEqual([1,2,3]);
    read=restored.value;
  }
});

it("enforces step limits before writeback and releases scratch storage", async () => {
  const budget=new Budget({dataSize:100000,maxSteps:200});
  const method=(await run("return Float32Array.prototype.sort",{budget})).returnValue;
  if(!isSandboxClosure(method))throw new Error("Missing sort method");
  const receiver=Float32Array.from({length:64},(_,index)=>64-index);
  const before=Float32Array.from(receiver);
  await expect(method.call([],{stack:[],thisValue:receiver})).rejects.toMatchObject({code:"budgetExceeded",budget:"steps"});
  expect(receiver).toEqual(before);
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
});

it.each([
  {limits:{arrayLength:100},length:101,kind:"arrayLength"},
  {limits:{dataSize:2000},length:200,kind:"dataSize"}
])("bounds sort scratch storage by $kind", async ({limits,length,kind}) => {
  const budget=new Budget(limits);
  const method=(await run("return Float32Array.prototype.sort",{budget})).returnValue;
  if(!isSandboxClosure(method))throw new Error("Missing sort method");
  await expect(method.call([],{stack:[],thisValue:new Float32Array(length)})).rejects.toMatchObject({code:"budgetExceeded",budget:kind});
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
});
