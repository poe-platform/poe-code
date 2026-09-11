import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
import { run } from "../run.js";
import { isSandboxClosure, measureSandboxData } from "./values.js";
import { Budget } from "./budget.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it.each([
  "const value=new Float32Array([1,2,3]);const result=value.reverse();return [result===value,Array.from(value),Float32Array.prototype.reverse.length]",
  "const value=new Float32Array([1,2,3,4]);value.reverse();return Array.from(value)",
  "const value=new Float32Array(0);return [value.reverse()===value,value.length]",
  "const buffer=new ArrayBuffer(20);const value=new Float32Array(buffer,4,3);value.set([1,2,3]);value.reverse();return Array.from(new Float32Array(buffer))",
  "class Samples extends Float32Array{};const value=new Samples([1,2]);return [value.reverse()===value,value instanceof Samples,Array.from(value)]"
])("matches native Float32 reverse: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(function(){${source}})()`)});
});

it.each([
  "const buffer=new ArrayBuffer(16,{maxByteLength:24});const value=new Float32Array(buffer,4);value.set([1,2,3]);buffer.resize(12);value.reverse();return Array.from(new Float32Array(buffer))",
  "const buffer=new ArrayBuffer(16,{maxByteLength:24});const value=new Float32Array(buffer,4,3);buffer.resize(8);try{value.reverse();return 'accepted'}catch(error){return error.name}",
  "const value=new Float32Array([1,2]);value.reverse({valueOf(){throw 7}});return Array.from(value)",
  "const value=new Float32Array([1]);Object.defineProperty(value,'length',{get(){throw 7}});return [value.reverse()===value,value[0]]"
])("matches reverse view and argument behavior: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(function(){${source}})()`)});
});

it.each([3,4])("preserves raw bits in direct reverse calls (length: %s)", async length => {
  const values=(await run(`return [Float32Array.prototype.reverse,new Float32Array(${length})]`)).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing reverse method");
  const receiver=values[1] as Float32Array;
  const bits=[0x7fa12345,0x80000000,0xffc0ffff,0x3f800000].slice(0,length);
  new Uint32Array(receiver.buffer).set(bits);
  const reference=new Float32Array(length);
  new Uint32Array(reference.buffer).set(bits);
  reference.reverse();
  expect(await values[0].call([],{stack:[],thisValue:receiver})).toBe(receiver);
  expect(Array.from(new Uint8Array(receiver.buffer))).toEqual(Array.from(new Uint8Array(reference.buffer)));
});

it("rejects detached and non-typed receivers in direct calls", async () => {
  const values=(await run("return [Float32Array.prototype.reverse,new Float32Array(0)]")).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing reverse method");
  const reverse=values[0];
  const receiver=values[1] as Float32Array;
  structuredClone(receiver.buffer,{transfer:[receiver.buffer]});
  expect(()=>reverse.call([],{stack:[],thisValue:receiver})).toThrow(TypeError);
  expect(()=>reverse.call([],{stack:[],thisValue:[]})).toThrow(TypeError);
});

it("preserves reverse through two snapshot round-trips", async () => {
  const source="const value=new Float32Array([1,2,3]);return ()=>{value.set([1,2,3]);return Array.from(value.reverse())}";
  let read=(await run(source)).returnValue;
  for(let round=0;round<2;round++){
    const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{read}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const restored=restore(saved,{source}).currentScope.lookup("read");
    if(!restored.found||!isSandboxClosure(restored.value))throw new Error("Missing restored reader");
    expect(await restored.value.call([])).toEqual([3,2,1]);
    read=restored.value;
  }
});

it.each([false,true])("retains reversal storage and releases it after completion or budget failure (%s)", async limited => {
  const budget=new Budget({dataSize:100000,...(limited?{maxSteps:100}:{})});
  const values=(await run("return [Float32Array.prototype.reverse,new Float32Array(3000)]",{budget})).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing reverse method");
  const reverse=values[0];
  let retained=0;
  const visit=budget.visitNode.bind(budget);
  const spy=vi.spyOn(budget,"visitNode").mockImplementation(()=>{
    if(retained===0)retained=measureSandboxData(budget.retainedValues());
    return visit();
  });
  try{
    if(limited)expect(()=>reverse.call([],{stack:[],thisValue:values[1]})).toThrow(expect.objectContaining({code:"budgetExceeded",budget:"steps"}));
    else expect(reverse.call([],{stack:[],thisValue:values[1]})).toBe(values[1]);
    expect(retained).toBeGreaterThan(12000);
    expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
  }finally{spy.mockRestore();}
});
