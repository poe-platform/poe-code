import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { createSandboxClosure, isSandboxClosure, measureSandboxData } from "./values.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it.each([
  'const value=new Float32Array([1,2,3]);const seen=[];const result=value.findLast((item,index,array)=>{seen.push([item,index,array===value]);return item<3});return [result,seen,Float32Array.prototype.findLast.length]',
  'return [new Float32Array(0).findLast(()=>{throw 7}),new Float32Array([1]).findLast(()=>false)]',
  'const receiver={tag:7};return new Float32Array([1,2]).findLast(function(item){return this===receiver&&item===2},receiver)',
  'const value=new Float32Array([1,2]);return [value.findLast((item,index)=>{value[index]=7;return true}),Array.from(value)]',
  'return [Object.is(new Float32Array([-0]).findLast(()=>true),-0),Number.isNaN(new Float32Array([NaN]).findLast(()=>true))]',
  'const buffer=new ArrayBuffer(12,{maxByteLength:16});const value=new Float32Array(buffer);const seen=[];const result=value.findLast((item,index)=>{seen.push([item,index]);if(index===2)buffer.resize(0);return item===undefined});return [result,seen]',
  'const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer);const seen=[];const result=value.findLast((item,index)=>{seen.push(index);buffer.resize(16);return false});return [result,seen]',
  'return new Float32Array([1]).findLast(()=>({get then(){throw 7},valueOf(){throw 8}}))',
  'return [undefined,null,0,{}].map(callback=>{try{new Float32Array(0).findLast(callback)}catch(error){return error.name}})',
  'const seen=[];try{new Float32Array([1,2]).findLast(item=>{seen.push(item);throw 7})}catch(error){seen.push(error)}return seen',
  'class Samples extends Float32Array{};const value=new Samples([1,2]);Object.defineProperty(value,"length",{get(){throw 7}});return value.findLast(item=>item===2)'
])("matches native Float32 findLast: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(function(){${source}})()`)});
});

it("treats returned promises as truthy without awaiting their results", async () => {
  const source="const seen=[];const pending=[];const result=new Float32Array([1,2]).findLast(item=>{const promise=(async()=>{seen.push('start'+item);await 0;seen.push('end'+item);return false})();pending.push(promise);return promise});seen.push('after');await Promise.all(pending);return [result,seen]";
  expect(await run(source)).toMatchObject({ok:true,returnValue:await runInNewContext(`(async function(){${source}})()`)});
});

it.each([true,false])("handles direct detachment with predicate result %s", async match => {
  const budget=new Budget({dataSize:100000});
  const values=(await run("const value=new Float32Array(new ArrayBuffer(12000),0,2);value.set([1,2]);return [Float32Array.prototype.findLast,value]",{budget})).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing findLast method");
  const method=values[0];
  const receiver=values[1] as Float32Array;
  const seen: unknown[]=[];
  const callback=createSandboxClosure({call:args=>{
    seen.push([args[0],args[1]]);
    if(seen.length===1){
      expect(measureSandboxData(budget.retainedValues())).toBeGreaterThan(12000);
      structuredClone(receiver.buffer,{transfer:[receiver.buffer]});
    }
    return match;
  }});
  expect(await method.call([callback],{stack:[],thisValue:receiver})).toBe(match?2:undefined);
  expect(seen).toEqual(match?[[2,1]]:[[2,1],[undefined,0]]);
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
  expect(()=>method.call([callback],{stack:[],thisValue:receiver})).toThrow(TypeError);
  expect(()=>method.call([callback],{stack:[],thisValue:[]})).toThrow(TypeError);
});

it("preserves findLast through two snapshot round-trips", async () => {
  const source="const value=new Float32Array([1,2,3]);return ()=>value.findLast(item=>item<3)";
  let read=(await run(source)).returnValue;
  for(let round=0;round<2;round++){
    const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{read}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const restored=restore(saved,{source}).currentScope.lookup("read");
    if(!restored.found||!isSandboxClosure(restored.value))throw new Error("Missing restored reader");
    expect(await restored.value.call([])).toBe(2);
    read=restored.value;
  }
});

it("enforces traversal step limits and releases storage", async () => {
  const budget=new Budget({dataSize:100000,maxSteps:100});
  const values=(await run("return [Float32Array.prototype.findLast,new Float32Array(3000),()=>false]",{budget})).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing findLast method");
  await expect(values[0].call([values[2]],{stack:[],thisValue:values[1]})).rejects.toMatchObject({code:"budgetExceeded",budget:"steps"});
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
});
