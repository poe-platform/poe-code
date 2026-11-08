import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { createSandboxClosure, isSandboxClosure, measureSandboxData } from "./values.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it.each([
  'const value=new Float32Array([1,2,3]);const seen=[];const result=value.filter((item,index,array)=>{seen.push([item,index,array===value]);return item>1});return [Array.from(result),Array.from(value),result!==value,seen,Float32Array.prototype.filter.length]',
  'return [new Float32Array(0).filter(()=>{throw 7}).length,new Float32Array([1]).filter(()=>false).length]',
  'const receiver={tag:7};return Array.from(new Float32Array([1,2]).filter(function(item){return this===receiver&&item===2},receiver))',
  'const value=new Float32Array([1,2]);return [Array.from(value.filter((item,index)=>{value[index]=7;return true})),Array.from(value)]',
  'const seen=[];const value=new Float32Array([1,2]);Object.defineProperty(value,"constructor",{get(){seen.push("constructor");return {[Symbol.species]:function(length){seen.push(length);return new Float32Array(length)}}}});const result=value.filter(item=>{seen.push(item);return item===2});return [Array.from(result),seen]',
  'const value=new Float32Array([1,2]);value.constructor={[Symbol.species]:function(){return value}};const result=value.filter(item=>item===2);return [result===value,Array.from(result)]',
  'const value=new Float32Array([1,2]);value.constructor={[Symbol.species]:function(){return new Float32Array(1)}};const seen=[];try{value.filter(item=>{seen.push(item);return true})}catch(error){return [error.name,seen]}',
  'const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer);const seen=[];const result=value.filter((item,index)=>{seen.push(item);if(index===0)buffer.resize(0);return true});return [Array.from(result),seen]',
  'const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer);const seen=[];const result=value.filter((item,index)=>{seen.push(index);buffer.resize(16);return true});return [Array.from(result),seen]',
  'return Array.from(new Float32Array([1]).filter(()=>({get then(){throw 7},valueOf(){throw 8}})))',
  'const value=new Float32Array(0);Object.defineProperty(value,"constructor",{get(){throw 7}});try{value.filter(null)}catch(error){return error.name}',
  'const seen=[];try{new Float32Array([1,2]).filter(item=>{seen.push(item);throw 7})}catch(error){seen.push(error)}return seen',
  'const value=new Float32Array([1,2]);Object.defineProperty(value,"length",{get(){throw 7}});return Array.from(value.filter(()=>true))',
  'const seen=[];const value=new Float32Array(0);value.constructor={[Symbol.species]:function(length){seen.push(length);return new Float32Array(length)}};return [value.filter(()=>{throw 7}).length,seen]',
  'const value=new Float32Array([1,2]);value.constructor={[Symbol.species]:function(){throw 7}};const result=value.filter(item=>{value.constructor={[Symbol.species]:Float32Array};return true});return Array.from(result)',
  'const seen=[];const value=new Float32Array([1,2]);Object.defineProperty(value,"constructor",{get(){seen.push("species");throw 7}});try{value.filter(item=>{seen.push(item);throw 8})}catch(error){seen.push(error)}return seen',
  'const result=new Float32Array([-0,NaN]).filter(()=>true);return [Object.is(result[0],-0),Number.isNaN(result[1])]',
  'class Samples extends Float32Array{};const result=new Samples([1,2]).filter(()=>true);return [result instanceof Samples,Array.from(result)]'
])("matches native Float32 filter: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(function(){${source}})()`)});
});

it("treats returned promises as truthy without awaiting their false results", async () => {
  const source="const seen=[];const pending=[];const result=new Float32Array([1,2]).filter(item=>{const promise=(async()=>{seen.push('start'+item);await 0;seen.push('end'+item);return false})();pending.push(promise);return promise});seen.push('after');await Promise.all(pending);return [Array.from(result),seen]";
  expect(await run(source)).toMatchObject({ok:true,returnValue:await runInNewContext(`(async function(){${source}})()`)});
});

it("retains backing storage and captured values across direct source detachment", async () => {
  const budget=new Budget({dataSize:100000});
  const values=(await run("const value=new Float32Array(new ArrayBuffer(12000),0,2);value[0]=7;return [Float32Array.prototype.filter,value]",{budget})).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing filter method");
  const method=values[0];
  const receiver=values[1] as Float32Array;
  const seen: unknown[]=[];
  const callback=createSandboxClosure({call:args=>{
    seen.push(args[0]);
    if(seen.length===1){
      expect(measureSandboxData(budget.retainedValues())).toBeGreaterThan(12000);
      structuredClone(receiver.buffer,{transfer:[receiver.buffer]});
    }
    return true;
  }});
  expect(Array.from(await method.call([callback],{stack:[],thisValue:receiver}) as Float32Array)).toEqual([7,NaN]);
  expect(seen).toEqual([7,undefined]);
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
  expect(()=>method.call([callback],{stack:[],thisValue:receiver})).toThrow(TypeError);
  expect(()=>method.call([callback],{stack:[],thisValue:[]})).toThrow(TypeError);
});

it("preserves filter through two snapshot round-trips", async () => {
  const source="const value=new Float32Array([1,2,3]);return ()=>value.filter(item=>item>1)";
  let read=(await run(source)).returnValue;
  for(let round=0;round<2;round++){
    const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{read}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const restored=restore(saved,{source}).currentScope.lookup("read");
    if(!restored.found||!isSandboxClosure(restored.value))throw new Error("Missing restored reader");
    expect(Array.from(await restored.value.call([]) as Float32Array)).toEqual([2,3]);
    read=restored.value;
  }
});

it("enforces traversal limits and releases source and captured values", async () => {
  const budget=new Budget({dataSize:100000,maxSteps:100});
  const values=(await run("return [Float32Array.prototype.filter,new Float32Array(3000),()=>true]",{budget})).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing filter method");
  await expect(values[0].call([values[2]],{stack:[],thisValue:values[1]})).rejects.toMatchObject({code:"budgetExceeded",budget:"steps"});
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
});

it.each([true,false])("bounds collected values rather than input length: selected=%s", async selected => {
  const budget=new Budget({arrayLength:100});
  const method=(await run("return Float32Array.prototype.filter",{budget})).returnValue;
  if(!isSandboxClosure(method))throw new Error("Missing filter method");
  const callback=createSandboxClosure({call:()=>selected});
  const result=method.call([callback],{stack:[],thisValue:new Float32Array(101)});
  if(selected)await expect(result).rejects.toMatchObject({code:"budgetExceeded",budget:"arrayLength"});
  else expect(Array.from(await result as Float32Array)).toEqual([]);
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
});

it("accounts for collected values with source storage during interpreted execution", async () => {
  const budget=new Budget({dataSize:1000});
  await expect(run("const value=new Float32Array(200);return value.filter(()=>true)",{budget})).rejects.toMatchObject({code:"budgetExceeded",budget:"dataSize"});
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
});
