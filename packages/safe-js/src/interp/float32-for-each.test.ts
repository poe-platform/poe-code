import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { createSandboxClosure, isSandboxClosure, measureSandboxData } from "./values.js";
import { Budget } from "./budget.js";
import { declareHostOperation } from "./host-bridge.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it.each([
  "const value=new Float32Array([1,2]);const seen=[];const result=value.forEach((item,index,array)=>seen.push([item,index,array===value]));return [result,seen,Float32Array.prototype.forEach.length]",
  "const seen=[];const receiver={label:'receiver'};new Float32Array([1,2]).forEach(function(item,index){seen.push([this===receiver,item,index])},receiver);return seen",
  "const seen=[];new Float32Array([1]).forEach(function(){'use strict';seen.push(this)});return seen",
  "const seen=[];const value=new Float32Array([1,2,3]);value.forEach((item,index)=>{seen.push(item);if(index===0)value[1]=7;return false});return seen",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer);value.set([1,2]);const seen=[];value.forEach((item,index)=>{seen.push(item);if(index===0)buffer.resize(16)});return seen",
  "const buffer=new ArrayBuffer(12,{maxByteLength:16});const value=new Float32Array(buffer);value.set([1,2,3]);const seen=[];value.forEach((item,index)=>{seen.push(item);if(index===0)buffer.resize(0)});return seen",
  "const seen=[];try{new Float32Array([1,2,3]).forEach(item=>{seen.push(item);if(item===2)throw 7})}catch(error){seen.push(error)}return seen",
  "new Float32Array([1]).forEach(()=>({get then(){throw 7}}));return true",
  "return [undefined,null,0,{}].map(callback=>{try{new Float32Array(0).forEach(callback)}catch(error){return error.name}})",
  "class Samples extends Float32Array{};const value=new Samples([1,2]);Object.defineProperty(value,'length',{get(){throw 7}});const seen=[];value.forEach(item=>seen.push(item));return seen",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer,4,1);buffer.resize(0);const seen=[];try{value.forEach(item=>seen.push(item))}catch(error){return [error.name,seen]}"
])("matches native Float32 forEach: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(function(){${source}})()`)});
});

it("does not await promises returned by callbacks", async () => {
  const source="const seen=[];const pending=[];new Float32Array([1,2]).forEach(item=>{const promise=(async()=>{seen.push('start'+item);await 0;seen.push('end'+item)})();pending.push(promise);return promise});seen.push('after');await Promise.all(pending);return seen";
  expect(await run(source)).toMatchObject({ok:true,returnValue:await runInNewContext(`(async function(){${source}})()`)});
});

it("supports direct calls and keeps visiting after callback detachment", async () => {
  const values=(await run("return [Float32Array.prototype.forEach,new Float32Array([1,2])]")).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing forEach method");
  const forEach=values[0];
  const receiver=values[1] as Float32Array;
  const thisValue={label:"callback"};
  const seen:unknown[]=[];
  const callback=createSandboxClosure({call:(args,context)=>{
    seen.push([args[0],args[1],args[2]===receiver,context?.thisValue===thisValue]);
    if(args[1]===0)structuredClone(receiver.buffer,{transfer:[receiver.buffer]});
    return undefined;
  }});
  expect(await forEach.call([callback,thisValue],{stack:[],thisValue:receiver})).toBeUndefined();
  expect(seen).toEqual([[1,0,true,true],[undefined,1,true,true]]);
  expect(()=>forEach.call([callback],{stack:[],thisValue:receiver})).toThrow(TypeError);
  expect(()=>forEach.call([callback],{stack:[],thisValue:[]})).toThrow(TypeError);
});

it("preserves forEach through two snapshot round-trips", async () => {
  const source="const value=new Float32Array([1,2,3]);return ()=>{let sum=0;value.forEach(item=>{sum+=item});return sum}";
  let read=(await run(source)).returnValue;
  for(let round=0;round<2;round++){
    const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{read}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const restored=restore(saved,{source}).currentScope.lookup("read");
    if(!restored.found||!isSandboxClosure(restored.value))throw new Error("Missing restored reader");
    expect(await restored.value.call([])).toBe(6);
    read=restored.value;
  }
});

it.each([false,true])("retains forEach storage during callbacks and releases it (throws: %s)", async throws => {
  const budget=new Budget({dataSize:100000});
  const retained:number[]=[];
  const inspect=declareHostOperation(()=>{retained.push(measureSandboxData(budget.retainedValues()));},"re-issue");
  expect(await run(`try{new Float32Array(new ArrayBuffer(12000),0,1).forEach(()=>{inspect();${throws ? "throw 7" : ""}})}catch(error){if(error!==7)throw error}inspect();return true`,{budget,bindings:{inspect}}))
    .toMatchObject({ok:true,returnValue:true});
  expect(retained[0]).toBeGreaterThan(12000);
  expect(retained[1]).toBeLessThan(1000);
});

it("enforces step limits and releases storage after callback traversal fails", async () => {
  const budget=new Budget({dataSize:100000,maxSteps:100});
  const values=(await run("return [Float32Array.prototype.forEach,new Float32Array(3000),()=>0]",{budget})).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing forEach method");
  await expect(values[0].call([values[2]],{stack:[],thisValue:values[1]})).rejects.toMatchObject({code:"budgetExceeded",budget:"steps"});
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
});
