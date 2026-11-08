import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { createSandboxClosure, isSandboxClosure, measureSandboxData } from "./values.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it.each([
  'const value=new Float32Array([1,2,3]);const seen=[];const result=value.reduceRight((acc,item,index,array)=>{seen.push([acc,item,index,array===value]);return acc-item},10);return [result,seen,Float32Array.prototype.reduceRight.length]',
  'const seen=[];const result=new Float32Array([1,2,3]).reduceRight((acc,item,index)=>{seen.push(index);return acc-item});return [result,seen]',
  'return [new Float32Array(0).reduceRight(()=>{throw 7},undefined),new Float32Array([7]).reduceRight(()=>{throw 8})]',
  'try{new Float32Array(0).reduceRight(()=>0)}catch(error){return error.name}',
  'return new Float32Array([1]).reduceRight((acc,item)=>[acc,item],undefined)',
  'const value=new Float32Array([1,2]);return value.reduceRight((acc,item,index)=>{value[0]=7;return acc+item},0)',
  'return new Float32Array([1]).reduceRight(function(acc,item){return [this===undefined,acc,item]},7)',
  'const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer);const seen=[];const result=value.reduceRight((acc,item,index)=>{seen.push(item);if(index===1)buffer.resize(0);return acc+1},0);return [result,seen]',
  'const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer);const seen=[];const result=value.reduceRight((acc,item,index)=>{seen.push(index);buffer.resize(16);return acc+1},0);return [result,seen]',
  'return [undefined,null,0,{}].map(callback=>{try{new Float32Array(0).reduceRight(callback,7)}catch(error){return error.name}})',
  'const seen=[];try{new Float32Array([1,2]).reduceRight((acc,item)=>{seen.push(item);throw 7},0)}catch(error){seen.push(error)}return seen',
  'const value=new Float32Array([1,2]);Object.defineProperty(value,"length",{get(){throw 7}});Object.defineProperty(value,"constructor",{get(){throw 8}});return value.reduceRight((acc,item)=>acc+item,0)',
  'const seed={get then(){throw 7},valueOf(){throw 8}};return [new Float32Array(0).reduceRight(()=>0,seed)===seed,new Float32Array([1,2]).reduceRight(()=>seed,0)===seed]',
  'const promise=Promise.resolve(7);return [new Float32Array(0).reduceRight(()=>0,promise)===promise,new Float32Array([1,2]).reduceRight(()=>promise,0)===promise]',
  'return [Object.is(new Float32Array([-0]).reduceRight(()=>7),-0),Number.isNaN(new Float32Array([NaN]).reduceRight(()=>7))]',
  'return new Float32Array([1,2]).reduceRight((acc,item)=>acc+BigInt(item),BigInt(0))'
])("matches native Float32 reduceRight: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(function(){"use strict";${source}})()`)});
});

it("passes returned promises to later callbacks without awaiting settlement", async () => {
  const source="const seen=[];const pending=[];const result=new Float32Array([1,2]).reduceRight((acc,item,index)=>{seen.push(index===1?acc===7:acc===pending[0]);const promise=(async()=>{seen.push('start'+item);await 0;seen.push('end'+item);return item})();pending.push(promise);return promise},7);seen.push(result===pending[1]);seen.push('after');await Promise.all(pending);return seen";
  expect(await run(source)).toMatchObject({ok:true,returnValue:await runInNewContext(`(async function(){${source}})()`)});
});

it("retains the accumulator and source across direct callback detachment", async () => {
  const budget=new Budget({dataSize:100000});
  const values=(await run("return [Float32Array.prototype.reduceRight,new Float32Array(new ArrayBuffer(12000),0,3)]",{budget})).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing reduceRight method");
  const method=values[0];
  const receiver=values[1] as Float32Array;
  const accumulator={data:"x".repeat(2000)};
  const seen: unknown[]=[];
  const callback=createSandboxClosure({call:args=>{
    seen.push(args[1]);
    if(seen.length===1){
      expect(measureSandboxData(budget.retainedValues())).toBeGreaterThan(12000);
      structuredClone(receiver.buffer,{transfer:[receiver.buffer]});
    }else{
      expect(args[0]).toBe(accumulator);
      expect(measureSandboxData(budget.retainedValues())).toBeGreaterThan(2000);
    }
    return accumulator;
  }});
  expect(await method.call([callback,0],{stack:[],thisValue:receiver})).toBe(accumulator);
  expect(seen).toEqual([0,undefined,undefined]);
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
  expect(()=>method.call([callback,0],{stack:[],thisValue:receiver})).toThrow(TypeError);
  expect(()=>method.call([callback,0],{stack:[],thisValue:[]})).toThrow(TypeError);
});

it("preserves reduceRight through two snapshot round-trips", async () => {
  const source="const value=new Float32Array([1,2,3]);return ()=>value.reduceRight((acc,item)=>acc+item,0)";
  let read=(await run(source)).returnValue;
  for(let round=0;round<2;round++){
    const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{read}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const restored=restore(saved,{source}).currentScope.lookup("read");
    if(!restored.found||!isSandboxClosure(restored.value))throw new Error("Missing restored reader");
    expect(await restored.value.call([])).toBe(6);
    read=restored.value;
  }
});

it("enforces traversal limits and releases retained values", async () => {
  const budget=new Budget({dataSize:100000,maxSteps:100});
  const values=(await run("return [Float32Array.prototype.reduceRight,new Float32Array(3000),acc=>acc]",{budget})).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing reduceRight method");
  await expect(values[0].call([values[2],0],{stack:[],thisValue:values[1]})).rejects.toMatchObject({code:"budgetExceeded",budget:"steps"});
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
});
