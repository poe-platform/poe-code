import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { createSandboxClosure, isSandboxClosure, measureSandboxData } from "./values.js";
import { defineDataProperty } from "./globals/object-array.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it.each([
  'const value=new Float32Array([1]);const result=Object.defineProperty(value,"0",{value:{valueOf(){return 7}}});return [value[0],result===value]',
  'const value=new Float32Array([1]);Object.defineProperties(value,{0:{value:{[Symbol.toPrimitive](hint){if(hint!=="number")throw 7;return 3}}}});return value[0]',
  'const events=[];const value=new Float32Array(0);try{Object.defineProperty(value,"0",{value:{valueOf(){events.push("convert");return 7}}})}catch(error){return [error.name,events]}',
  'const value=new Float32Array([1]);try{Object.defineProperty(value,"0",{value:{valueOf(){throw 7}}})}catch(error){return [error,value[0]]}',
  'const buffer=new ArrayBuffer(4,{maxByteLength:8});const value=new Float32Array(buffer);Object.defineProperty(value,"0",{value:{valueOf(){buffer.resize(0);return 7}}});return value.length',
  'class Samples extends Float32Array{0={valueOf(){return 7}}};return new Samples(1)[0]',
  'return ["configurable","enumerable","writable"].map(flag=>{const events=[];const value=new Float32Array([1]);const descriptor={value:{valueOf(){events.push("convert");return 7}}};descriptor[flag]=false;try{Object.defineProperty(value,"0",descriptor)}catch(error){return [error.name,events,value[0]]}})',
  'return ["-0","NaN","Infinity","1.5","-1","1"].map(key=>{const events=[];const value=new Float32Array([1]);try{Object.defineProperty(value,key,{value:{valueOf(){events.push("convert");return 7}}})}catch(error){return [error.name,events,value[0]]}})',
  'const value=new Float32Array([1]);Object.defineProperty(value,"0",{value:{valueOf(){if(value[0]!==1)throw 7;return 3}},writable:true,enumerable:true,configurable:true});return Object.getOwnPropertyDescriptor(value,"0")',
  'const events=[];const value=new Float32Array([1,2]);Object.defineProperties(value,{get 0(){events.push("read0");return {value:{valueOf(){events.push("convert0");return 7}}}},get 1(){events.push("read1");return {value:{valueOf(){events.push("convert1");return 8}}}}});return [events,Array.from(value)]',
  'const value=new Float32Array([1]);const item={valueOf(){throw 7}};Object.defineProperty(value,"label",{value:item});return value.label===item',
  'const value=new Float32Array([1,2]);try{Object.defineProperties(value,{0:{value:{valueOf(){return 7}}},1:{value:{valueOf(){throw 8}}}})}catch(error){return [error,Array.from(value)]}',
  'class Samples extends Float32Array{0={valueOf(){return 7}};1=this[0]+1};return Array.from(new Samples(2))',
  'return [Symbol("x"),BigInt(1)].map(item=>{const value=new Float32Array([1]);try{Object.defineProperty(value,"0",{value:{valueOf(){return item}}})}catch(error){return [error.name,value[0]]}})',
  'const buffer=new ArrayBuffer(4,{maxByteLength:8});const value=new Float32Array(buffer);Object.defineProperty(value,"0",{value:{valueOf(){buffer.resize(8);return 7}}});return Array.from(value)'
])("matches native Float32 property definition: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(function(){${source}})()`)});
});

it("retains original backing and succeeds after detachment during conversion", async () => {
  const budget=new Budget({dataSize:100000});
  const receiver=new Float32Array(new ArrayBuffer(12000),0,1);
  let calls=0;
  const replacement={valueOf:createSandboxClosure({call:()=>{
    calls++;
    expect(measureSandboxData(budget.retainedValues())).toBeGreaterThan(12000);
    structuredClone(receiver.buffer,{transfer:[receiver.buffer]});
    return 7;
  }})};
  await defineDataProperty(receiver,"0",{value:replacement},budget);
  expect(calls).toBe(1);
  expect(()=>defineDataProperty(receiver,"0",{value:replacement},budget)).toThrow(TypeError);
  expect(calls).toBe(1);
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
});

it("converts promises without awaiting their resolved value", async () => {
  const source='const value=new Float32Array([1]);const promise=Promise.resolve(7);Object.defineProperty(value,"0",{value:promise});await promise;return Number.isNaN(value[0])';
  expect(await run(source)).toMatchObject({ok:true,returnValue:await runInNewContext(`(async function(){${source}})()`)});
});

it("preserves definitions through two snapshot round-trips", async () => {
  const source='const value=new Float32Array([1]);return ()=>{Object.defineProperty(value,"0",{value:{valueOf(){return 7}}});return value[0]}';
  let read=(await run(source)).returnValue;
  for(let round=0;round<2;round++){
    const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{read}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const restored=restore(saved,{source}).currentScope.lookup("read");
    if(!restored.found||!isSandboxClosure(restored.value))throw new Error("Missing restored reader");
    expect(await restored.value.call([])).toBe(7);
    read=restored.value;
  }
});

it("enforces conversion budgets without writing and releases storage", async () => {
  const budget=new Budget({maxSteps:100,dataSize:100000});
  const receiver=new Float32Array([1]);
  const replacement={valueOf:createSandboxClosure({call:()=>{
    for(let index=0;index<200;index++)budget.visitNode();
    return 7;
  }})};
  await expect(defineDataProperty(receiver,"0",{value:replacement},budget)).rejects.toMatchObject({code:"budgetExceeded",budget:"steps"});
  expect(receiver[0]).toBe(1);
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
});
