import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { createSandboxClosure, isSandboxClosure, measureSandboxData } from "./values.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it.each([
  'const value=new Float32Array([1,2,3]);const seen=[];const result=value.findIndex((item,index,array)=>{seen.push([item,index,array===value]);return item===2});return [result,seen,Float32Array.prototype.findIndex.length]',
  'return [new Float32Array(0).findIndex(()=>{throw 7}),new Float32Array([1]).findIndex(()=>false)]',
  'const receiver={tag:7};return new Float32Array([1,2]).findIndex(function(item){return this===receiver&&item===2},receiver)',
  'const value=new Float32Array([1,2]);return [value.findIndex((item,index)=>{value[index]=7;return item===1}),Array.from(value)]',
  'return Object.is(new Float32Array([1]).findIndex(()=>true),0)',
  'const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer);const seen=[];const result=value.findIndex((item,index)=>{seen.push(item);if(index===0)buffer.resize(0);return item===undefined});return [result,seen]',
  'const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer);const seen=[];const result=value.findIndex((item,index)=>{seen.push(index);buffer.resize(16);return false});return [result,seen]',
  'return new Float32Array([1]).findIndex(()=>({get then(){throw 7},valueOf(){throw 8}}))',
  'return [undefined,null,0,{}].map(callback=>{try{new Float32Array(0).findIndex(callback)}catch(error){return error.name}})',
  'const seen=[];try{new Float32Array([1,2]).findIndex(item=>{seen.push(item);throw 7})}catch(error){seen.push(error)}return seen',
  'class Samples extends Float32Array{};const value=new Samples([1,2]);Object.defineProperty(value,"length",{get(){throw 7}});return value.findIndex(item=>item===2)'
])("matches native Float32 findIndex: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(function(){${source}})()`)});
});

it("treats returned promises as truthy without awaiting their results", async () => {
  const source="const seen=[];const pending=[];const result=new Float32Array([1,2]).findIndex(item=>{const promise=(async()=>{seen.push('start'+item);await 0;seen.push('end'+item);return false})();pending.push(promise);return promise});seen.push('after');await Promise.all(pending);return [result,seen]";
  expect(await run(source)).toMatchObject({ok:true,returnValue:await runInNewContext(`(async function(){${source}})()`)});
});

it("keeps visiting captured indices after direct callback detachment", async () => {
  const budget=new Budget({dataSize:100000});
  const values=(await run("return [Float32Array.prototype.findIndex,new Float32Array(new ArrayBuffer(12000),0,2)]",{budget})).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing findIndex method");
  const method=values[0];
  const receiver=values[1] as Float32Array;
  const seen: unknown[]=[];
  const callback=createSandboxClosure({call:args=>{
    seen.push(args[0]);
    if(seen.length===1){
      expect(measureSandboxData(budget.retainedValues())).toBeGreaterThan(12000);
      structuredClone(receiver.buffer,{transfer:[receiver.buffer]});
    }
    return args[0]===undefined;
  }});
  expect(await method.call([callback],{stack:[],thisValue:receiver})).toBe(1);
  expect(seen).toEqual([0,undefined]);
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
  expect(()=>method.call([callback],{stack:[],thisValue:receiver})).toThrow(TypeError);
  expect(()=>method.call([callback],{stack:[],thisValue:[]})).toThrow(TypeError);
});

it("preserves findIndex through two snapshot round-trips", async () => {
  const source="const value=new Float32Array([1,2,3]);return ()=>value.findIndex(item=>item>1)";
  let read=(await run(source)).returnValue;
  for(let round=0;round<2;round++){
    const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{read}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const restored=restore(saved,{source}).currentScope.lookup("read");
    if(!restored.found||!isSandboxClosure(restored.value))throw new Error("Missing restored reader");
    expect(await restored.value.call([])).toBe(1);
    read=restored.value;
  }
});

it("enforces traversal step limits and releases storage", async () => {
  const budget=new Budget({dataSize:100000,maxSteps:100});
  const values=(await run("return [Float32Array.prototype.findIndex,new Float32Array(3000),()=>false]",{budget})).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing findIndex method");
  await expect(values[0].call([values[2]],{stack:[],thisValue:values[1]})).rejects.toMatchObject({code:"budgetExceeded",budget:"steps"});
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
});
