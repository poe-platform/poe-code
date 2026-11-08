import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { createSandboxClosure, isSandboxClosure, measureSandboxData } from "./values.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it.each([
  'const value=new Float32Array([1,2,3]);const seen=[];const result=value.map((item,index,array)=>{seen.push([item,index,array===value]);return item*2});return [Array.from(result),Array.from(value),result!==value,seen,Float32Array.prototype.map.length]',
  'const receiver={tag:7};return Array.from(new Float32Array([1,2]).map(function(item){return this===receiver?item+7:0},receiver))',
  'return Array.from(new Float32Array([1,2]).map(item=>({valueOf(){return item+0.1}})))',
  'const value=new Float32Array([1,2]);return [Array.from(value.map((item,index)=>{value[1]=7;return item})),Array.from(value)]',
  'const seen=[];class Samples extends Float32Array{static get [Symbol.species](){seen.push("species");return function(length){seen.push(length);return new Float32Array(length)}}};const result=new Samples(0).map(()=>{throw 7});return [result.length,seen]',
  'const seen=[];const value=new Float32Array([1,2]);value.constructor={[Symbol.species]:function(length){seen.push(length);return value}};const result=value.map(item=>item*2);return [result===value,Array.from(result),seen]',
  'const value=new Float32Array([1,2]);value.constructor={[Symbol.species]:function(){return new Float32Array(1)}};try{value.map(()=>{throw 7})}catch(error){return error.name}',
  'const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer);const seen=[];const result=value.map((item,index)=>{seen.push(item);if(index===0)buffer.resize(0);return item});return [Array.from(result),seen]',
  'const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer);const seen=[];const result=value.map((item,index)=>{seen.push(index);buffer.resize(16);return index});return [Array.from(result),seen]',
  'const value=new Float32Array(0);Object.defineProperty(value,"constructor",{get(){throw 7}});try{value.map(null)}catch(error){return error.name}',
  'const seen=[];try{new Float32Array([1,2]).map(item=>{seen.push(item);throw 7})}catch(error){seen.push(error)}return seen',
  'const value=new Float32Array([1,2]);Object.defineProperty(value,"length",{get(){throw 7}});return Array.from(value.map(item=>item))',
  'const seen=[];const value=new Float32Array([1,2]);value.constructor={[Symbol.species]:function(length){seen.push("allocate"+length);return new Float32Array(length+1)}};const result=value.map(item=>{seen.push(item);return item});return [Array.from(result),seen]',
  'const buffer=new ArrayBuffer(12);const value=new Float32Array(buffer,0,2);value.set([1,2]);value.constructor={[Symbol.species]:function(){return new Float32Array(buffer,4,2)}};return Array.from(value.map(item=>item*2))',
  'const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer);value.constructor={[Symbol.species]:function(length){buffer.resize(0);return new Float32Array(length)}};return Array.from(value.map(item=>item))',
  'const buffer=new ArrayBuffer(8,{maxByteLength:16});const target=new Float32Array(buffer,0,2);const value=new Float32Array([1,2]);value.constructor={[Symbol.species]:function(){return target}};const seen=[];const result=value.map(item=>{buffer.resize(0);return {valueOf(){seen.push(item);return item}}});return [result===target,result.length,seen]',
  'const value=new Float32Array([1]);return [null,{},7,()=>{}].map(species=>{value.constructor={[Symbol.species]:species};try{return Array.from(value.map(item=>item))}catch(error){return error.name}})',
  'return [Symbol("x"),BigInt(1)].map(result=>{try{new Float32Array([1]).map(()=>result)}catch(error){return error.name}})',
  'const seen=[];try{new Float32Array([1,2]).map(item=>({valueOf(){seen.push(item);throw 7}}))}catch(error){seen.push(error)}return seen'
])("matches native Float32 map: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(function(){${source}})()`)});
});

it("converts returned promises without awaiting their results", async () => {
  const source="const seen=[];const pending=[];const result=new Float32Array([1,2]).map(item=>{const promise=(async()=>{seen.push('start'+item);await 0;seen.push('end'+item);return item})();pending.push(promise);return promise});seen.push('after');await Promise.all(pending);return [Array.from(result),seen]";
  expect(await run(source)).toMatchObject({ok:true,returnValue:await runInNewContext(`(async function(){${source}})()`)});
});

it("retains backing storage and continues mapping after direct source detachment", async () => {
  const budget=new Budget({dataSize:100000});
  const values=(await run("return [Float32Array.prototype.map,new Float32Array(new ArrayBuffer(12000),0,2)]",{budget})).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing map method");
  const method=values[0];
  const receiver=values[1] as Float32Array;
  const seen: unknown[]=[];
  const callback=createSandboxClosure({call:args=>{
    seen.push(args[0]);
    if(seen.length===1){
      expect(measureSandboxData(budget.retainedValues())).toBeGreaterThan(12000);
      structuredClone(receiver.buffer,{transfer:[receiver.buffer]});
    }
    return args[0];
  }});
  expect(Array.from(await method.call([callback],{stack:[],thisValue:receiver}) as Float32Array)).toEqual([0,NaN]);
  expect(seen).toEqual([0,undefined]);
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
  expect(()=>method.call([callback],{stack:[],thisValue:receiver})).toThrow(TypeError);
  expect(()=>method.call([callback],{stack:[],thisValue:[]})).toThrow(TypeError);
});

it("preserves map through two snapshot round-trips", async () => {
  const source="const value=new Float32Array([1,2,3]);return ()=>value.map(item=>item*2)";
  let read=(await run(source)).returnValue;
  for(let round=0;round<2;round++){
    const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{read}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const restored=restore(saved,{source}).currentScope.lookup("read");
    if(!restored.found||!isSandboxClosure(restored.value))throw new Error("Missing restored reader");
    expect(Array.from(await restored.value.call([]) as Float32Array)).toEqual([2,4,6]);
    read=restored.value;
  }
});

it("enforces traversal limits and releases source and output storage", async () => {
  const budget=new Budget({dataSize:100000,maxSteps:100});
  const values=(await run("return [Float32Array.prototype.map,new Float32Array(3000),item=>item]",{budget})).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing map method");
  await expect(values[0].call([values[2]],{stack:[],thisValue:values[1]})).rejects.toMatchObject({code:"budgetExceeded",budget:"steps"});
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
});

it("accounts for source and mapped output together during interpreted execution", async () => {
  const budget=new Budget({dataSize:10000});
  await expect(run("const value=new Float32Array(2000);return value.map(item=>item)",{budget})).rejects.toMatchObject({code:"budgetExceeded",budget:"dataSize"});
});

it.each([
  {limits:{arrayLength:100},length:101,kind:"arrayLength"},
  {limits:{dataSize:10000},length:3000,kind:"dataSize"}
])("checks output allocation against $kind before callbacks", async ({limits,length,kind}) => {
  const budget=new Budget(limits);
  const method=(await run("return Float32Array.prototype.map",{budget})).returnValue;
  if(!isSandboxClosure(method))throw new Error("Missing map method");
  let calls=0;
  const callback=createSandboxClosure({call:()=>{calls++;return 0}});
  await expect(method.call([callback],{stack:[],thisValue:new Float32Array(length)})).rejects.toMatchObject({code:"budgetExceeded",budget:kind});
  expect(calls).toBe(0);
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
});
