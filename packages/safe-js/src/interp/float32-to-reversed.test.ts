import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { isSandboxClosure, measureSandboxData } from "./values.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it.each([
  'const value=new Float32Array([1,2,3]);const result=value.toReversed();return [Array.from(result),Array.from(value),result!==value,result.buffer!==value.buffer,Float32Array.prototype.toReversed.length]',
  'return [[],[7],[1,2],[1,2,3,4]].map(items=>Array.from(new Float32Array(items).toReversed()))',
  'const result=new Float32Array([NaN,-0,0]).toReversed();return [Object.is(result[0],0),Object.is(result[1],-0),Number.isNaN(result[2])]',
  'const value=new Float32Array([1,2]);const result=value.toReversed();result[0]=7;return [Array.from(value),Array.from(result)]',
  'const value=new Float32Array([1,2]);Object.defineProperty(value,"length",{get(){throw 7}});Object.defineProperty(value,"constructor",{get(){throw 8}});return Array.from(value.toReversed())',
  'class Samples extends Float32Array{static get [Symbol.species](){throw 7}};const result=new Samples([1,2]).toReversed();return [result instanceof Samples,result instanceof Float32Array,Array.from(result)]',
  'const buffer=new ArrayBuffer(16,{maxByteLength:24});const value=new Float32Array(buffer,4);value.set([1,2,3]);buffer.resize(12);const result=value.toReversed();return [Array.from(result),result.buffer.resizable]',
  'const buffer=new ArrayBuffer(16,{maxByteLength:24});const value=new Float32Array(buffer,4,2);value.set([1,2]);return Array.from(value.toReversed())',
  'const buffer=new ArrayBuffer(8,{maxByteLength:16});const value=new Float32Array(buffer,0,2);buffer.resize(0);try{value.toReversed()}catch(error){return error.name}',
  'return Array.from(new Float32Array([1,2]).toReversed({valueOf(){throw 7}}))'
])("matches native Float32 toReversed: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(function(){${source}})()`)});
});

it("retains backing storage during copying and validates direct receivers", async () => {
  const budget=new Budget({dataSize:100000});
  const values=(await run("const value=new Float32Array(new ArrayBuffer(12000),0,2);value.set([1,2]);return [Float32Array.prototype.toReversed,value]",{budget})).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing toReversed method");
  const method=values[0];
  const receiver=values[1] as Float32Array;
  const visit=budget.visitNode.bind(budget);
  const spy=vi.spyOn(budget,"visitNode").mockImplementation(()=>{
    expect(measureSandboxData(budget.retainedValues())).toBeGreaterThan(12000);
    visit();
  });
  try {
    const result=method.call([],{stack:[],thisValue:receiver}) as Float32Array;
    expect(Array.from(result)).toEqual([2,1]);
    expect(result.buffer).not.toBe(receiver.buffer);
    // Two element copies plus validation of the three intrinsic prototype links.
    expect(spy).toHaveBeenCalledTimes(5);
  } finally { spy.mockRestore(); }
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
  structuredClone(receiver.buffer,{transfer:[receiver.buffer]});
  expect(()=>method.call([],{stack:[],thisValue:receiver})).toThrow(TypeError);
  expect(()=>method.call([],{stack:[],thisValue:[]})).toThrow(TypeError);
});

it("preserves toReversed through two snapshot round-trips", async () => {
  const source="const value=new Float32Array([1,2,3]);return ()=>value.toReversed()";
  let read=(await run(source)).returnValue;
  for(let round=0;round<2;round++){
    const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{read}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const restored=restore(saved,{source}).currentScope.lookup("read");
    if(!restored.found||!isSandboxClosure(restored.value))throw new Error("Missing restored reader");
    const result=await restored.value.call([]) as Float32Array;
    expect(Array.from(result)).toEqual([3,2,1]);
    result[0]=7;
    read=restored.value;
  }
});

it("enforces traversal limits without modifying source storage", async () => {
  const budget=new Budget({dataSize:100000,maxSteps:100});
  const method=(await run("return Float32Array.prototype.toReversed",{budget})).returnValue;
  if(!isSandboxClosure(method))throw new Error("Missing toReversed method");
  const receiver=Float32Array.from({length:300},(_,index)=>index);
  const before=Float32Array.from(receiver);
  expect(()=>method.call([],{stack:[],thisValue:receiver})).toThrow(expect.objectContaining({code:"budgetExceeded",budget:"steps"}));
  expect(receiver).toEqual(before);
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
});

it.each([
  {limits:{arrayLength:100},length:101,kind:"arrayLength"},
  {limits:{dataSize:2000},length:300,kind:"dataSize"}
])("bounds copied storage by $kind", async ({limits,length,kind}) => {
  const budget=new Budget(limits);
  const method=(await run("return Float32Array.prototype.toReversed",{budget})).returnValue;
  if(!isSandboxClosure(method))throw new Error("Missing toReversed method");
  expect(()=>method.call([],{stack:[],thisValue:new Float32Array(length)})).toThrow(expect.objectContaining({code:"budgetExceeded",budget:kind}));
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
});
