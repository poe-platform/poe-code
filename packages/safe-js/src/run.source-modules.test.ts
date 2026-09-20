import {expect,it} from "vitest";
import {run} from "./run.js";

it("executes source modules through the run SDK without invoking default exports",async()=>{
  const result=await run("import {x} from 'dep';export const result=x+1;export default function(){throw 7}",{
    sourceType:"module",sourceResolver:()=>({id:"dep",source:"export const x=6"})});
  expect(result).toMatchObject({ok:true,returnValue:{result:7}});
});
it("preserves registered capability imports in source modules",async()=>{
  expect(await run("import {read} from 'cap';export const result=await read()",{
    sourceType:"module",modules:{cap:{read:async()=>7}}})).toMatchObject({ok:true,returnValue:{result:7}});
});
it("does not silently ignore a source resolver on the legacy harness path",async()=>{
  await expect(run("return 1",{sourceResolver:()=>undefined})).rejects.toThrow("sourceType");
});

it.each(["steps","dataSize"] as const)("does not turn a dynamic module %s failure into a catchable guest error",async budget=>{
  const {Budget}=await import("./interp/budget.js");
  await expect(run("try{await import('dep')}catch{} export const survived=true",{
    sourceType:"module",budget:new Budget(budget === "steps" ? {maxSteps:1000} : {dataSize:5000}),
    sourceResolver:()=>({id:"dep",source:`/*${"x".repeat(10000)}*/export const x=1`})}))
    .rejects.toMatchObject({code:"budgetExceeded",budget});
});

it("preserves the identity of a cached module evaluation error",async()=>{
  expect(await run("let first;try{await import('dep')}catch(e){first=e}let same;try{await import('dep')}catch(e){same=first===e}export {same}",{
    sourceType:"module",sourceResolver:()=>({id:"dep",source:"throw new Error('module failure')"})}))
    .toMatchObject({ok:true,returnValue:{same:true}});
});

it("settles an unawaited source load before disposing a one-shot run",async()=>{
  const events:string[]=[];
  expect(await run("import('dep');export const value=1",{sourceType:"module",modules:{cap:{mark:()=>{events.push("loaded");}}},
    sourceResolver:()=>new Promise(resolve=>setImmediate(()=>resolve({id:"dep",source:"import {mark} from 'cap';mark()"})))}))
    .toMatchObject({ok:true});
  expect(events).toEqual(["loaded"]);
});

it("propagates and caches an async cycle's failure through every member",async()=>{
  const sources:Record<string,string>={root:"import 'leaf';await 0;throw new Error('cycle failure')",leaf:"import 'root';export const x=1"};
  expect(await run("let first;try{await import('root')}catch(e){first=e}let same=false;try{await import('leaf')}catch(e){same=e===first}export {same}",{
    sourceType:"module",sourceResolver:specifier=>({id:specifier,source:sources[specifier]!})}))
    .toMatchObject({ok:true,returnValue:{same:true}});
});
it("denies dynamic attributes before invoking the source resolver",async()=>{
  const calls:string[]=[];
  expect(await run("let name;try{await import('dep',{with:{type:'json'}})}catch(e){name=e.name}export {name}",{
    sourceType:"module",sourceResolver:specifier=>{calls.push(specifier);return {id:specifier,source:"export const x=1"};}}))
    .toMatchObject({ok:true,returnValue:{name:"TypeError"}});
  expect(calls).toEqual([]);
});

it("keeps an unawaited source import's data-budget failure fatal",async()=>{
  const {Budget}=await import("./interp/budget.js");
  await expect(run("import('dep');export const survived=true",{
    sourceType:"module",budget:new Budget({dataSize:5000}),
    sourceResolver:()=>({id:"dep",source:`/*${"x".repeat(10000)}*/export const x=1`})}))
    .rejects.toMatchObject({code:"budgetExceeded",budget:"dataSize"});
});
