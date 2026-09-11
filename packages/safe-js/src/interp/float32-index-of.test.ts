import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
import { run } from "../run.js";
import { createSandboxClosure, isSandboxClosure, measureSandboxData } from "./values.js";
import { Budget } from "./budget.js";
import { declareHostOperation } from "./host-bridge.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it.each(["-0", "-0.5", "-Number.MIN_VALUE"])("returns positive zero for a match starting at %s", index => {
  const source = `return Object.is(new Float32Array([1]).indexOf(1,${index}),-0)`;
  return expect(run(source)).resolves.toMatchObject({ok:true,returnValue:runInNewContext(`(function(){${source}})()`)});
});

it.each([
  "const value=new Float32Array([1,2,2]);return [value.indexOf(2),value.indexOf(4),Float32Array.prototype.indexOf.length]",
  "const value=new Float32Array([NaN,-0,Infinity]);return [value.indexOf(NaN),value.indexOf(0),value.indexOf(-0),value.indexOf(Infinity)]",
  "const value=new Float32Array([0.1]);return [value.indexOf(0.1),value.indexOf(Math.fround(0.1)),value.indexOf('0.1'),value.indexOf(BigInt(0))]",
  "const value=new Float32Array([1,2,3]);return [undefined,NaN,Infinity,-Infinity,1.9,-1.9,3,-8].map(index=>value.indexOf(2,index))",
  "const trace=[];const value=new Float32Array([1,2]);return [value.indexOf({valueOf(){throw 7}},{valueOf(){trace.push('index');return 0}}),trace]",
  "const trace=[];return [new Float32Array(0).indexOf(0,{valueOf(){trace.push('index');throw 7}}),trace]",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer);value.set([1,2]);return value.indexOf(0,{valueOf(){buffer.resize(16);return 0}})",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer);return value.indexOf(undefined,{valueOf(){buffer.resize(0);return 0}})",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer,4,1);buffer.resize(0);const trace=[];try{value.indexOf(0,{valueOf(){trace.push('index');return 0}})}catch(error){return [error.name,trace]}",
  "return [Symbol('x'),BigInt(1)].map(index=>{try{new Float32Array(1).indexOf(0,index)}catch(error){return error.name}})",
  "class Samples extends Float32Array{};const value=new Samples([1,2]);Object.defineProperty(value,'length',{get(){throw 7}});return value.indexOf(2,-1)"
])("matches native Float32 indexOf: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(function(){${source}})()`)});
});

it("supports direct getter conversion and skips detached elements", async () => {
  const values=(await run("return [Float32Array.prototype.indexOf,new Float32Array([1,2]),{get valueOf(){return ()=>-1}}]")).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing indexOf method");
  const indexOf=values[0];
  const receiver=values[1] as Float32Array;
  expect(await indexOf.call([2,values[2]],{stack:[],thisValue:receiver})).toBe(1);
  const convert=createSandboxClosure({call:()=>{structuredClone(receiver.buffer,{transfer:[receiver.buffer]});return 0;}});
  expect(await indexOf.call([undefined,{valueOf:convert}],{stack:[],thisValue:receiver})).toBe(-1);
  expect(()=>indexOf.call([0],{stack:[],thisValue:receiver})).toThrow(TypeError);
  expect(()=>indexOf.call([0],{stack:[],thisValue:[]})).toThrow(TypeError);
});

it("preserves indexOf through two snapshot round-trips", async () => {
  const source="const value=new Float32Array([1,NaN,3]);return ()=>value.indexOf(3)";
  let read=(await run(source)).returnValue;
  for(let round=0;round<2;round++){
    const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{read}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const restored=restore(saved,{source}).currentScope.lookup("read");
    if(!restored.found||!isSandboxClosure(restored.value))throw new Error("Missing restored reader");
    expect(await restored.value.call([])).toBe(2);
    read=restored.value;
  }
});

it.each([false,true])("retains indexOf storage during coercion and releases it (throws: %s)", async throws => {
  const budget=new Budget({dataSize:100000});
  const retained:number[]=[];
  const inspect=declareHostOperation(()=>{retained.push(measureSandboxData(budget.retainedValues()));},"re-issue");
  expect(await run(`try{new Float32Array(3000).indexOf(0,{valueOf(){inspect();${throws ? "throw 7" : "return -1"}}})}catch(error){if(error!==7)throw error}inspect();return true`,{budget,bindings:{inspect}}))
    .toMatchObject({ok:true,returnValue:true});
  expect(retained[0]).toBeGreaterThan(12000);
  expect(retained[1]).toBeLessThan(1000);
});

it.each([false,true])("budgets index searches and releases storage (limited: %s)", async limited => {
  const budget=new Budget({dataSize:100000,...(limited?{maxSteps:100}:{})});
  const values=(await run("return [Float32Array.prototype.indexOf,new Float32Array(3000)]",{budget})).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing indexOf method");
  const indexOf=values[0];
  let retained=0;
  const visit=budget.visitNode.bind(budget);
  const spy=vi.spyOn(budget,"visitNode").mockImplementation(()=>{
    if(retained===0)retained=measureSandboxData(budget.retainedValues());
    return visit();
  });
  try{
    if(limited)await expect(indexOf.call([1],{stack:[],thisValue:values[1]})).rejects.toMatchObject({code:"budgetExceeded",budget:"steps"});
    else expect(await indexOf.call([1],{stack:[],thisValue:values[1]})).toBe(-1);
    expect(retained).toBeGreaterThan(12000);
    expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
  }finally{spy.mockRestore();}
});
