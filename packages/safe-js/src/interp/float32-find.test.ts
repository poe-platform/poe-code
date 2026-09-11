import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { createSandboxClosure, isSandboxClosure, measureSandboxData } from "./values.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it.each([
  "const value=new Float32Array([1,2,3]);const seen=[];const result=value.find((item,index,array)=>{seen.push([item,index,array===value]);return item>1});return [result,seen,Float32Array.prototype.find.length]",
  "return [new Float32Array(0).find(()=>{throw 7}),new Float32Array([1,2]).find(()=>false)]",
  "const receiver={tag:7};return new Float32Array([1,2]).find(function(item){return this===receiver&&item===2},receiver)",
  "const value=new Float32Array([1,2]);return [value.find((item,index)=>{value[index]=7;return true}),Array.from(value)]",
  "return [Object.is(new Float32Array([-0]).find(()=>true),-0),Number.isNaN(new Float32Array([NaN]).find(()=>true))]",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer);value.set([1,2]);const seen=[];const result=value.find((item,index)=>{seen.push(item);if(index===0)buffer.resize(16);return item===0});return [result,seen]",
  "const buffer=new ArrayBuffer(12,{maxByteLength:16});const value=new Float32Array(buffer);const seen=[];const result=value.find((item,index)=>{seen.push(index);if(index===0)buffer.resize(0);return item===undefined});return [result,seen]",
  "return new Float32Array([1]).find(()=>({get then(){throw 7},valueOf(){throw 8}}))",
  "return [undefined,null,0,{}].map(callback=>{try{new Float32Array(0).find(callback)}catch(error){return error.name}})",
  "const seen=[];try{new Float32Array([1,2,3]).find(item=>{seen.push(item);if(item===2)throw 7;return false})}catch(error){seen.push(error)}return seen",
  "class Samples extends Float32Array{};const value=new Samples([1,2]);Object.defineProperty(value,'length',{get(){throw 7}});return value.find(item=>item===2)"
])("matches native Float32 find: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(function(){${source}})()`)});
});

it("matches on a returned promise without awaiting its false result", async () => {
  const source="const seen=[];const pending=[];const result=new Float32Array([1,2]).find(item=>{const promise=(async()=>{seen.push('start'+item);await 0;seen.push('end'+item);return false})();pending.push(promise);return promise});seen.push('after');await Promise.all(pending);return [result,seen]";
  expect(await run(source)).toMatchObject({ok:true,returnValue:await runInNewContext(`(async function(){${source}})()`)});
});

it("returns the captured element after direct callback detachment", async () => {
  const budget=new Budget({dataSize:100000});
  const values=(await run("const value=new Float32Array(new ArrayBuffer(12000),0,2);value[0]=7;return [Float32Array.prototype.find,value]",{budget})).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing find method");
  const find=values[0];
  const receiver=values[1] as Float32Array;
  let calls=0;
  const callback=createSandboxClosure({call:()=>{
    calls++;
    expect(measureSandboxData(budget.retainedValues())).toBeGreaterThan(12000);
    structuredClone(receiver.buffer,{transfer:[receiver.buffer]});
    return true;
  }});
  expect(await find.call([callback],{stack:[],thisValue:receiver})).toBe(7);
  expect(calls).toBe(1);
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
  expect(()=>find.call([callback],{stack:[],thisValue:receiver})).toThrow(TypeError);
  expect(()=>find.call([callback],{stack:[],thisValue:[]})).toThrow(TypeError);
});

it("preserves find through two snapshot round-trips", async () => {
  const source="const value=new Float32Array([1,2,3]);return ()=>value.find(item=>item>1)";
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
  const values=(await run("return [Float32Array.prototype.find,new Float32Array(3000),()=>false]",{budget})).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing find method");
  await expect(values[0].call([values[2]],{stack:[],thisValue:values[1]})).rejects.toMatchObject({code:"budgetExceeded",budget:"steps"});
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
});
