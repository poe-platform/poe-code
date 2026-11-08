import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { createSandboxClosure, isSandboxClosure, measureSandboxData } from "./values.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it.each([
  "const value=new Float32Array([1,2,3]);const seen=[];const result=value.some((item,index,array)=>{seen.push([item,index,array===value]);return item===2});return [result,seen,Float32Array.prototype.some.length]",
  "return [new Float32Array(0).some(()=>{throw 7}),new Float32Array([1,2]).some(()=>false)]",
  "const receiver={tag:7};return new Float32Array([1]).some(function(item,index,array){return this===receiver&&item===1&&index===0&&array.length===1},receiver)",
  "return new Float32Array([1]).some(function(){'use strict';return this===undefined})",
  "return [undefined,null,false,0,-0,NaN,'',BigInt(0),1,'x',{},[],BigInt(1)].map(answer=>new Float32Array([1]).some(()=>answer))",
  "const value=new Float32Array([1,2,3]);const seen=[];const result=value.some((item,index)=>{seen.push(item);if(index===0)value[1]=7;return item===7});return [result,seen]",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer);value.set([1,2]);const seen=[];const result=value.some((item,index)=>{seen.push(item);if(index===0)buffer.resize(16);return item===0});return [result,seen]",
  "const buffer=new ArrayBuffer(12,{maxByteLength:16});const value=new Float32Array(buffer);value.set([1,2,3]);const seen=[];const result=value.some((item,index)=>{seen.push(item);if(index===0)buffer.resize(0);return item===undefined});return [result,seen]",
  "const seen=[];try{new Float32Array([1,2,3]).some(item=>{seen.push(item);if(item===2)throw 7;return false})}catch(error){seen.push(error)}return seen",
  "return new Float32Array([1]).some(()=>({get then(){throw 7},valueOf(){throw 8}}))",
  "return [undefined,null,0,{}].map(callback=>{try{new Float32Array(0).some(callback)}catch(error){return error.name}})",
  "class Samples extends Float32Array{};const value=new Samples([1,2]);Object.defineProperty(value,'length',{get(){throw 7}});return value.some(item=>item===2)",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer,4,1);buffer.resize(0);const seen=[];try{value.some(item=>seen.push(item))}catch(error){return [error.name,seen]}"
])("matches native Float32 some: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(function(){${source}})()`)});
});

it("short-circuits on a promise without awaiting its false result", async () => {
  const source="const seen=[];const pending=[];const result=new Float32Array([1,2]).some(item=>{const promise=(async()=>{seen.push('start'+item);await 0;seen.push('end'+item);return false})();pending.push(promise);return promise});seen.push('after');await Promise.all(pending);return [result,seen]";
  expect(await run(source)).toMatchObject({ok:true,returnValue:await runInNewContext(`(async function(){${source}})()`)});
});

it("supports direct detachment and releases retained storage", async () => {
  const budget=new Budget({dataSize:100000});
  const values=(await run("return [Float32Array.prototype.some,new Float32Array(new ArrayBuffer(12000),0,2)]",{budget})).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing some method");
  const some=values[0];
  const receiver=values[1] as Float32Array;
  const seen:unknown[]=[];
  const callback=createSandboxClosure({call:args=>{
    seen.push(args[0]);
    if(args[1]===0){
      expect(measureSandboxData(budget.retainedValues())).toBeGreaterThan(12000);
      structuredClone(receiver.buffer,{transfer:[receiver.buffer]});
    }
    return args[0]===undefined;
  }});
  expect(await some.call([callback],{stack:[],thisValue:receiver})).toBe(true);
  expect(seen).toEqual([0,undefined]);
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
  expect(()=>some.call([callback],{stack:[],thisValue:receiver})).toThrow(TypeError);
});

it("preserves some through two snapshot round-trips", async () => {
  const source="const value=new Float32Array([1,2,3]);return ()=>value.some(item=>item===2)";
  let read=(await run(source)).returnValue;
  for(let round=0;round<2;round++){
    const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{read}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const restored=restore(saved,{source}).currentScope.lookup("read");
    if(!restored.found||!isSandboxClosure(restored.value))throw new Error("Missing restored reader");
    expect(await restored.value.call([])).toBe(true);
    read=restored.value;
  }
});

it("enforces traversal step limits and releases storage", async () => {
  const budget=new Budget({dataSize:100000,maxSteps:100});
  const values=(await run("return [Float32Array.prototype.some,new Float32Array(3000),()=>false]",{budget})).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing some method");
  await expect(values[0].call([values[2]],{stack:[],thisValue:values[1]})).rejects.toMatchObject({code:"budgetExceeded",budget:"steps"});
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
});
