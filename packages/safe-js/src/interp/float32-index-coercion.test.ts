import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { createSandboxClosure, isSandboxClosure, measureSandboxData } from "./values.js";
import { setSandboxProperty } from "./interpreter.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it.each([
  'const value=new Float32Array([1]);const replacement={valueOf(){return 7}};const result=value[0]=replacement;return [value[0],result===replacement]',
  'const value=new Float32Array([1]);value[0]={[Symbol.toPrimitive](hint){if(hint!=="number")throw 7;return 3}};return value[0]',
  'const events=[];const value=new Float32Array(0);value[0]={valueOf(){events.push("value");return 7}};return events',
  'const events=[];const value=new Float32Array([1]);value["-0"]={valueOf(){events.push("value");return 7}};return [events,value[0]]',
  'const buffer=new ArrayBuffer(4,{maxByteLength:8});const value=new Float32Array(buffer);value[0]={valueOf(){buffer.resize(0);return 7}};return value.length',
  'const value=new Float32Array([1]);value[0]={valueOf(){return {}},toString(){return "7"}};return value[0]',
  'const value=new Float32Array([1]);try{value[0]={valueOf(){throw 7}}}catch(error){return [error,value[0]]}',
  'return [Symbol("x"),BigInt(1)].map(item=>{const value=new Float32Array([1]);try{value[0]={valueOf(){return item}}}catch(error){return [error.name,value[0]]}})',
  'const value=new Float32Array([1]);try{value[0]={[Symbol.toPrimitive](){return {}}}}catch(error){return [error.name,value[0]]}',
  'const value=new Float32Array([1]);const item={valueOf(){throw 7}};value["01"]=item;value.label=item;const key=Symbol("x");value[key]=item;return [value["01"]===item,value.label===item,value[key]===item,value[0]]',
  'const events=[];Float32Array.prototype.valueOf=function(){events.push("wrong")};Object.defineProperty(Float32Array.prototype,"-1",{set(){events.push("setter")}});const value=new Float32Array([1]);value[-1]={valueOf(){events.push("convert");return 7}};return events',
  'const value=new Float32Array([1]);value[0]={get valueOf(){return function(){return 7}}};return value[0]',
  'const value=new Float32Array([1]);Object.assign(value,{0:{valueOf(){return 7}}});return value[0]',
  'const value=new Float32Array([1]);[value[0]]=[{valueOf(){return 7}}];return value[0]',
  'const value=new Float32Array([1]);for(value[0] of [{valueOf(){return 7}}]){};return value[0]'
])("matches native indexed Float32 assignment: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(function(){${source}})()`)});
});

it("writes to an index made valid during conversion (2026 spec and Node 24)", async () => {
  expect(await run('const buffer=new ArrayBuffer(4,{maxByteLength:8});const value=new Float32Array(buffer);value[1]={valueOf(){buffer.resize(8);return 7}};return Array.from(value)')).toMatchObject({ok:true,returnValue:[0,7]});
});

it("converts promises without awaiting their resolved values", async () => {
  const source='const value=new Float32Array([1]);const promise=Promise.resolve(7);value[0]=promise;await promise;return Number.isNaN(value[0])';
  expect(await run(source)).toMatchObject({ok:true,returnValue:await runInNewContext(`(async function(){${source}})()`)});
});

it("retains receiver backing and releases it after detachment during direct conversion", async () => {
  const budget=new Budget({dataSize:100000});
  const receiver=new Float32Array(new ArrayBuffer(12000),0,1);
  let conversions=0;
  const replacement={valueOf:createSandboxClosure({call:()=>{
    if(conversions++===0){
      expect(measureSandboxData(budget.retainedValues())).toBeGreaterThan(12000);
      structuredClone(receiver.buffer,{transfer:[receiver.buffer]});
    }
    return 7;
  }})};
  await setSandboxProperty(receiver,"0",replacement,budget);
  await setSandboxProperty(receiver,"0",replacement,budget);
  expect(conversions).toBe(2);
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
});

it("preserves object conversion through two snapshot round-trips", async () => {
  const source='const value=new Float32Array([1]);const item={valueOf(){return 7}};return ()=>{const result=value[0]=item;return [value[0],result===item]}';
  let read=(await run(source)).returnValue;
  for(let round=0;round<2;round++){
    const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{read}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const restored=restore(saved,{source}).currentScope.lookup("read");
    if(!restored.found||!isSandboxClosure(restored.value))throw new Error("Missing restored reader");
    expect(await restored.value.call([])).toEqual([7,true]);
    read=restored.value;
  }
});

it("bounds conversion work and releases retained receiver on failure", async () => {
  const budget=new Budget({maxSteps:100,dataSize:100000});
  const receiver=new Float32Array([1]);
  const replacement={valueOf:createSandboxClosure({call:()=>{
    for(let index=0;index<200;index++)budget.visitNode();
    return 7;
  }})};
  await expect(setSandboxProperty(receiver,"0",replacement,budget)).rejects.toMatchObject({code:"budgetExceeded",budget:"steps"});
  expect(receiver[0]).toBe(1);
  expect(measureSandboxData(budget.retainedValues())).toBeLessThan(1000);
});
