import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { createSandboxClosure, isSandboxClosure, measureSandboxData } from "./values.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it.each([
  'return new Float32Array([1234.5,-2]).toLocaleString("de-DE")',
  'return new Float32Array([1.5,2]).toLocaleString("en-US",{minimumFractionDigits:2})',
  'return [new Float32Array(0).toLocaleString(),Float32Array.prototype.toLocaleString.length]',
  'const seen=[];Number.prototype.toLocaleString=function(...args){seen.push([this,args]);return {toString(){return "x"}}};return [new Float32Array([1,2]).toLocaleString("de-DE",{tag:7}),seen]',
  'let calls=0;Object.defineProperty(Number.prototype,"toLocaleString",{get(){calls++;return function(){return this+10}}});return [new Float32Array([1,2]).toLocaleString(),calls]',
  'Number.prototype.toLocaleString=7;try{new Float32Array([1]).toLocaleString()}catch(error){return error.name}',
  'Number.prototype.toLocaleString=7;return new Float32Array(0).toLocaleString()',
  'const buffer=new ArrayBuffer(12,{maxByteLength:24});const value=new Float32Array(buffer);value.set([1,2,3]);Number.prototype.toLocaleString=function(){buffer.resize(0);return "x"};return value.toLocaleString()',
  'const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer);value.set([1,2]);Number.prototype.toLocaleString=function(){buffer.resize(16);return this};return value.toLocaleString()',
  'const value=new Float32Array([1234.5]);Object.defineProperty(value,"length",{get(){throw 7}});return value.toLocaleString("de-DE")'
])("matches native typed-array locale formatting: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(function(){"use strict";${source}})()`)});
});

it("keeps the originating number prototype for direct calls after realm cleanup", async () => {
  const values=(await run('Number.prototype.toLocaleString=function(){return "custom"};return [Float32Array.prototype.toLocaleString,new Float32Array([1,2])]')).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing locale method");
  expect(await values[0].call([],{stack:[],thisValue:values[1]})).toBe("custom,custom");
});

it("retains backing storage during formatting and handles detachment mid-call", async () => {
  const budget=new Budget({dataSize:100000});
  const values=(await run("return [Float32Array.prototype.toLocaleString,new Float32Array(new ArrayBuffer(12000),0,2)]",{budget})).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing locale method");
  const receiver=values[1] as Float32Array;
  let calls=0;
  const format=createSandboxClosure({call:()=>{
    calls++;
    expect(measureSandboxData(budget.retainedValues())).toBeGreaterThan(12000);
    structuredClone(receiver.buffer,{transfer:[receiver.buffer]});
    return "x";
  }});
  expect(await values[0].call([],{stack:[],thisValue:receiver,getProperty:()=>format})).toBe("x,");
  expect(calls).toBe(1);
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
});

it("preserves locale formatting through two snapshot round-trips", async () => {
  const source='const value=new Float32Array([1234.5]);return ()=>value.toLocaleString("de-DE")';
  let read=(await run(source)).returnValue;
  for(let round=0;round<2;round++){
    const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{read}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const restored=restore(saved,{source}).currentScope.lookup("read");
    if(!restored.found||!isSandboxClosure(restored.value))throw new Error("Missing restored reader");
    expect(await restored.value.call([])).toBe("1.234,5");
    read=restored.value;
  }
});

it("validates direct receivers and enforces traversal limits without retaining storage", async () => {
  const budget=new Budget({dataSize:100000,maxSteps:100});
  const values=(await run("return [Float32Array.prototype.toLocaleString,new Float32Array(3000)]",{budget})).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing locale method");
  const method=values[0];
  const receiver=values[1] as Float32Array;
  await expect(method.call([],{stack:[],thisValue:receiver})).rejects.toMatchObject({code:"budgetExceeded",budget:"steps"});
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
  structuredClone(receiver.buffer,{transfer:[receiver.buffer]});
  expect(()=>method.call([],{stack:[],thisValue:receiver})).toThrow(TypeError);
  expect(()=>method.call([],{stack:[],thisValue:[]})).toThrow(TypeError);
});

it("enforces the combined output string limit and releases retained values", async () => {
  const budget=new Budget({dataSize:100000,stringLength:100});
  const values=(await run('return [Float32Array.prototype.toLocaleString,new Float32Array(3)]',{budget})).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing locale method");
  const format=createSandboxClosure({call:()=>"x".repeat(40)});
  await expect(values[0].call([],{stack:[],thisValue:values[1],getProperty:()=>format})).rejects.toMatchObject({code:"budgetExceeded",budget:"stringLength"});
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
});
