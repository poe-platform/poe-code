import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { createSandboxClosure, isSandboxClosure, measureSandboxData, type SandboxValue } from "./values.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it.each([
  'const source=new ArrayBuffer(8);new Float32Array(source).set([1,2]);const result=source.transfer();return [source.detached,source.byteLength,Array.from(new Float32Array(result)),result.resizable,ArrayBuffer.prototype.transfer.length]',
  'return [0,4,12].map(length=>{const source=new ArrayBuffer(8);new Float32Array(source).set([1,2]);const result=source.transfer(length);return [source.detached,result.byteLength,Array.from(new Float32Array(result))]})',
  'const source=new ArrayBuffer(4,{maxByteLength:12});new Float32Array(source)[0]=7;const result=source.transfer(8);return [source.detached,result.resizable,result.maxByteLength,Array.from(new Float32Array(result))]',
  'const source=new ArrayBuffer(4,{maxByteLength:8});try{source.transfer(12)}catch(error){return [error.name,source.detached,source.byteLength]}',
  'const source=new ArrayBuffer(4);const result=source.transfer({valueOf(){return 8}});return [source.detached,result.byteLength]',
  'const source=new ArrayBuffer(4);Object.defineProperty(source,"constructor",{get(){throw 7}});const result=source.transfer();return [source.detached,result.byteLength]',
  'class Buffer extends ArrayBuffer{static get [Symbol.species](){throw 7}};const source=new Buffer(4);const result=source.transfer();return [source.detached,result instanceof Buffer,result instanceof ArrayBuffer]',
  'const source=new ArrayBuffer(4);source.transfer();try{source.transfer({valueOf(){throw 7}})}catch(error){return error}',
  'return [-1,Infinity,Symbol("x"),BigInt(1)].map(length=>{const source=new ArrayBuffer(4);try{source.transfer(length)}catch(error){return [error.name,source.detached]}})',
  'const source=new ArrayBuffer(8,{maxByteLength:12});new Float32Array(source).set([1,2]);const result=source.transfer({valueOf(){source.resize(4);return 8}});return [source.detached,Array.from(new Float32Array(result))]',
  'return [undefined,NaN,-0,-0.5,4.9].map(length=>{const source=new ArrayBuffer(4);const result=source.transfer(length);return [result.byteLength,source.detached]})',
  'const source=new ArrayBuffer(4);try{source.transfer({valueOf(){source.transfer();return 4}})}catch(error){return [error.name,source.detached]}',
  'const source=new ArrayBuffer(4);const view=new Float32Array(source);view[0]=7;const result=source.transfer();return [view.length,source.detached,new Float32Array(result)[0]]',
  'const source=new ArrayBuffer(4);Object.defineProperty(source,"byteLength",{get(){throw 7}});return source.transfer().byteLength',
  'const source=new ArrayBuffer(4);source.label=7;const result=source.transfer();return [source.label,result.label]',
  'const source=new ArrayBuffer(4);const result=source.transfer(Promise.resolve(8));return [source.detached,result.byteLength]'
])("matches native ArrayBuffer transfer: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(function(){${source}})()`)});
});

it("copies exact bytes, retains source during conversion and clears its views", async () => {
  const budget=new Budget({dataSize:100000});
  const method=(await run('return ArrayBuffer.prototype.transfer',{budget})).returnValue;
  if(!isSandboxClosure(method))throw new Error("Missing transfer method");
  const source=new ArrayBuffer(12000);
  const view=new Uint8Array(source);
  view.set([1,2,3,4,5]);
  const length={valueOf:createSandboxClosure({call:()=>{
    expect(measureSandboxData(budget.retainedValues())).toBeGreaterThan(12000);
    return 5;
  }})};
  const result=await method.call([length],{stack:[],thisValue:source}) as ArrayBuffer;
  expect(Array.from(new Uint8Array(result))).toEqual([1,2,3,4,5]);
  expect(view.length).toBe(0);
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
});

it("rejects wrong receivers before converting length", async () => {
  const method=(await run('return ArrayBuffer.prototype.transfer')).returnValue;
  if(!isSandboxClosure(method))throw new Error("Missing transfer method");
  let calls=0;
  const length={valueOf:createSandboxClosure({call:()=>{calls++;return 0}})};
  for(const receiver of [[],new SharedArrayBuffer(0)]){
    await expect(method.call([length],{stack:[],thisValue:receiver as SandboxValue})).rejects.toThrow(TypeError);
  }
  expect(calls).toBe(0);
});

it("rejects non-detachable host storage without modifying it", async () => {
  const method=(await run('return ArrayBuffer.prototype.transfer')).returnValue;
  if(!isSandboxClosure(method))throw new Error("Missing transfer method");
  const source=new WebAssembly.Memory({initial:1}).buffer;
  const bytes=new Uint8Array(source);
  bytes[0]=7;
  await expect(method.call([],{stack:[],thisValue:source})).rejects.toThrow(TypeError);
  expect(source.byteLength).toBe(65536);
  expect(bytes[0]).toBe(7);
});

it.each([
  {limits:{arrayLength:100},length:101,kind:"arrayLength"},
  {limits:{dataSize:2000},length:1200,kind:"dataSize"},
  {limits:{maxSteps:100},length:300,kind:"steps"}
])("checks $kind before detaching source", async ({limits,length,kind}) => {
  const budget=new Budget(limits);
  const method=(await run('return ArrayBuffer.prototype.transfer',{budget})).returnValue;
  if(!isSandboxClosure(method))throw new Error("Missing transfer method");
  const source=new ArrayBuffer(length);
  new Uint8Array(source)[0]=7;
  await expect(method.call([],{stack:[],thisValue:source})).rejects.toMatchObject({code:"budgetExceeded",budget:kind});
  expect(source.byteLength).toBe(length);
  expect(new Uint8Array(source)[0]).toBe(7);
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
});

it("checks preserved maximum capacity before detaching", async () => {
  const budget=new Budget({arrayLength:100});
  const method=(await run('return ArrayBuffer.prototype.transfer',{budget})).returnValue;
  if(!isSandboxClosure(method))throw new Error("Missing transfer method");
  const source=Reflect.construct(ArrayBuffer,[4,{maxByteLength:1024}]) as ArrayBuffer;
  await expect(method.call([],{stack:[],thisValue:source})).rejects.toMatchObject({code:"budgetExceeded",budget:"arrayLength"});
  expect(source.byteLength).toBe(4);
});

it("checks result prototype attachment before detaching an empty source", async () => {
  const budget=new Budget({maxSteps:100});
  const method=(await run('return ArrayBuffer.prototype.transfer',{budget})).returnValue;
  if(!isSandboxClosure(method))throw new Error("Missing transfer method");
  budget.visitNode(100-budget.stepsUsed);
  const source=new ArrayBuffer(0);
  await expect(method.call([],{stack:[],thisValue:source})).rejects.toMatchObject({code:"budgetExceeded",budget:"steps"});
  expect(()=>new Uint8Array(source)).not.toThrow();
});

it("preserves transferred result storage through two snapshot round-trips", async () => {
  const source='const result=new ArrayBuffer(8).transfer();new Float32Array(result).set([1,2]);return ()=>[result.detached,Array.from(new Float32Array(result))]';
  let read=(await run(source)).returnValue;
  for(let round=0;round<2;round++){
    const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{read}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const restored=restore(saved,{source}).currentScope.lookup("read");
    if(!restored.found||!isSandboxClosure(restored.value))throw new Error("Missing restored reader");
    expect(await restored.value.call([])).toEqual([false,[1,2]]);
    read=restored.value;
  }
});
