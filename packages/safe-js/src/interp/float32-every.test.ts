import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { createSandboxClosure, isSandboxClosure, measureSandboxData } from "./values.js";
import { Budget } from "./budget.js";
import { declareHostOperation } from "./host-bridge.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it.each([
  "const value=new Float32Array([1,2,3]);const seen=[];const result=value.every((item,index,array)=>{seen.push([item,index,array===value]);return item<2});return [result,seen,Float32Array.prototype.every.length]",
  "const seen=[];const receiver={label:'receiver'};const result=new Float32Array([1,2]).every(function(item,index){seen.push([this===receiver,item,index]);return true},receiver);return [result,seen]",
  "return [new Float32Array(0).every(()=>{throw 7}),new Float32Array([1]).every(function(){'use strict';return this===undefined})]",
  "return [undefined,null,false,0,-0,NaN,'',BigInt(0),1,'x',{},[],BigInt(1)].map(answer=>new Float32Array([1]).every(()=>answer))",
  "const seen=[];const value=new Float32Array([1,2,3]);const result=value.every((item,index)=>{seen.push(item);if(index===0)value[1]=7;return item<5});return [result,seen]",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer);value.set([1,2]);const seen=[];const result=value.every((item,index)=>{seen.push(item);if(index===0)buffer.resize(16);return item>0});return [result,seen]",
  "const buffer=new ArrayBuffer(12,{maxByteLength:16});const value=new Float32Array(buffer);value.set([1,2,3]);const seen=[];const result=value.every((item,index)=>{seen.push(item);if(index===0)buffer.resize(0);return true});return [result,seen]",
  "const seen=[];try{new Float32Array([1,2,3]).every(item=>{seen.push(item);if(item===2)throw 7;return true})}catch(error){seen.push(error)}return seen",
  "return new Float32Array([1]).every(()=>({get then(){throw 7},valueOf(){throw 8}}))",
  "return [undefined,null,0,{}].map(callback=>{try{new Float32Array(0).every(callback)}catch(error){return error.name}})",
  "class Samples extends Float32Array{};const value=new Samples([1,2]);Object.defineProperty(value,'length',{get(){throw 7}});return value.every(item=>item>0)",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer,4,1);buffer.resize(0);const seen=[];try{value.every(item=>seen.push(item))}catch(error){return [error.name,seen]}"
])("matches native Float32 every: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(function(){${source}})()`)});
});

it("treats returned promises as truthy without awaiting their false results", async () => {
  const source="const seen=[];const pending=[];const result=new Float32Array([1,2]).every(item=>{const promise=(async()=>{seen.push('start'+item);await 0;seen.push('end'+item);return false})();pending.push(promise);return promise});seen.push('after');await Promise.all(pending);return [result,seen]";
  expect(await run(source)).toMatchObject({ok:true,returnValue:await runInNewContext(`(async function(){${source}})()`)});
});

it("supports direct calls and observes callback detachment", async () => {
  const values=(await run("return [Float32Array.prototype.every,new Float32Array([1,2])]")).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing every method");
  const every=values[0];
  const receiver=values[1] as Float32Array;
  const thisValue={label:"callback"};
  const seen:unknown[]=[];
  const callback=createSandboxClosure({call:(args,context)=>{
    seen.push([args[0],args[1],args[2]===receiver,context?.thisValue===thisValue]);
    if(args[1]===0)structuredClone(receiver.buffer,{transfer:[receiver.buffer]});
    return args[0]!==undefined;
  }});
  expect(await every.call([callback,thisValue],{stack:[],thisValue:receiver})).toBe(false);
  expect(seen).toEqual([[1,0,true,true],[undefined,1,true,true]]);
  expect(()=>every.call([callback],{stack:[],thisValue:receiver})).toThrow(TypeError);
  expect(()=>every.call([callback],{stack:[],thisValue:[]})).toThrow(TypeError);
});

it("preserves every through two snapshot round-trips", async () => {
  const source="const value=new Float32Array([1,2,3]);return ()=>value.every(item=>item>0)";
  let read=(await run(source)).returnValue;
  for(let round=0;round<2;round++){
    const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{read}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const restored=restore(saved,{source}).currentScope.lookup("read");
    if(!restored.found||!isSandboxClosure(restored.value))throw new Error("Missing restored reader");
    expect(await restored.value.call([])).toBe(true);
    read=restored.value;
  }
});

it.each(["true","false","throw"])("retains every storage during callbacks and releases it (%s)", outcome => {
  const budget=new Budget({dataSize:100000});
  const retained:number[]=[];
  const inspect=declareHostOperation(()=>{retained.push(measureSandboxData(budget.retainedValues()));},"re-issue");
  return run(`try{new Float32Array(new ArrayBuffer(12000),0,1).every(()=>{inspect();${outcome === "throw" ? "throw 7" : `return ${outcome}`}})}catch(error){if(error!==7)throw error}inspect();return true`,{budget,bindings:{inspect}}).then(result=>{
    expect(result).toMatchObject({ok:true,returnValue:true});
    expect(retained[0]).toBeGreaterThan(12000);
    expect(retained[1]).toBeLessThan(1000);
  });
});

it("enforces step limits and releases storage after predicate traversal fails", async () => {
  const budget=new Budget({dataSize:100000,maxSteps:100});
  const values=(await run("return [Float32Array.prototype.every,new Float32Array(3000),()=>true]",{budget})).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing every method");
  await expect(values[0].call([values[2]],{stack:[],thisValue:values[1]})).rejects.toMatchObject({code:"budgetExceeded",budget:"steps"});
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
});
