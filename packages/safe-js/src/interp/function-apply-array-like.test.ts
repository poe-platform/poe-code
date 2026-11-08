import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { declareHostOperation } from "./host-bridge.js";
import { createSandboxClosure, measureSandboxData } from "./values.js";
import { callFunctionMethod } from "./methods/function.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each([
  "function f(a,b){return [this.tag,a,b]}return f.apply({tag:'receiver'},{0:'first',1:'second',length:2})",
  "const trace=[];const input={get length(){trace.push('length');return 2},get 0(){trace.push('0');return 3},get 1(){trace.push('1');return 4},[Symbol.iterator](){throw Error('must not iterate')}};function f(a,b){trace.push('call');return [a,b,trace]}return f.apply(null,input)",
  "function f(){return [arguments.length,arguments[0]]}return f.apply(null,{0:7,length:{valueOf(){return 1.9}}})",
  "function f(){return [...arguments]}return f.apply(null,Object.assign(Object.create({1:'inherited'}),{0:'own',length:3}))",
  "function f(){return [...arguments]}const input={length:3,get 0(){this.length=1;this[1]=7;return 3}};return f.apply(null,input)",
  "function f(){return arguments.length}return [-3,NaN,undefined,'0',null].map(length=>f.apply(null,{length}))",
  "function f(){return [...arguments]}return f.apply(null,new String('ab'))",
  "function f(){return [...arguments]}return f.apply(null,new Float32Array([1.5,2.5]))",
  "function f(){return [...arguments]}function input(a,b){}input[0]=7;return f.apply(null,input)",
  "function f(){return [...arguments]}return f.apply(null,{0:7,length:{[Symbol.toPrimitive](hint){if(hint!=='number')throw Error(hint);return 1}}})",
  "function f(){return 7}const trace=[];try{f.apply(null,{get length(){trace.push('length');throw 3},get 0(){trace.push('0')}})}catch(e){return [e,trace]}",
  "let called=false;function f(){called=true}const trace=[];try{f.apply(null,{length:2,get 0(){trace.push('0');throw 7},get 1(){trace.push('1')}})}catch(e){return [e,trace,called]}",
  "function f(){return arguments.length}return [1,true,'abc',Symbol('x'),BigInt(1)].map(input=>{try{f.apply(null,input)}catch(e){return e.name}})",
  "function f(){return arguments.length}return [Symbol('x'),BigInt(1)].map(length=>{try{f.apply(null,{length})}catch(e){return e.name}})",
  "function f(){return arguments.length}return [f.apply(null,null),f.apply(null,undefined),f.apply(null,{})]"
])("accepts an array-like apply argument list: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(function(){${source}})()`)});
});

it("accepts a low-level array-like call without an explicit budget", async () => {
  const target=createSandboxClosure({call:(args,context)=>[context?.thisValue,...args]});
  expect(await callFunctionMethod(target,"apply",["receiver",{0:3,length:1}],{
    callClosure:(callee,args,stack,thisValue)=>callee.call(args,{stack,thisValue})
  },[])).toEqual(["receiver",3]);
});

it.each([
  "return {get length(){return {valueOf(){return 1}}},get 0(){return 7}}",
  "return Object.defineProperty([],0,{get(){return 7},configurable:true})"
])("runs guest length and indexed getters through the low-level invocation route: %s", async source => {
  const input=(await run(source)).returnValue;
  const target=createSandboxClosure({call:args=>[...args]});
  expect(await callFunctionMethod(target,"apply",[null,input],{
    callClosure:(callee,args,stack,thisValue)=>callee.call(args,{stack,thisValue})
  },[])).toEqual([7]);
});

it("replays an applied async function across a pending effect", async () => {
  const source="const trace=[];const input={get length(){trace.push('length');return 2},get 0(){trace.push('0');return 3},get 1(){trace.push('1');return 4}};async function f(a,b){await pause();return [this.base+a+b,trace]}return await f.apply({base:2},input)";
  let release!:()=>void;
  let enter!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve});
  const entered=new Promise<void>(resolve=>{enter=resolve});
  const execution=run(source,{bindings:{pause:declareHostOperation(async()=>{enter();await gate},"re-issue")}});
  void execution.catch(()=>undefined);
  let saved:string;
  try{await Promise.race([entered,execution]);saved=await dump(execution,{mode:"replay"})}finally{release()}
  const expected=await runInNewContext(`(async function(){const pause=()=>{};${source}})()`);
  expect(await execution).toMatchObject({ok:true,returnValue:expected});
  expect(await run(source,{snapshot:restore(JSON.parse(saved),{source}),bindings:{pause:declareHostOperation(async()=>{},"re-issue")}}))
    .toMatchObject({ok:true,returnValue:expected});
});

it("checks array allocation before indexed getters", async () => {
  let visited=false;
  const inspect=declareHostOperation(()=>{visited=true},"re-issue");
  await expect(run("function f(){}f.apply(null,{length:4,get 0(){inspect();return 1}})",{
    budget:new Budget({arrayLength:3}),bindings:{inspect}
  })).rejects.toMatchObject({budget:"arrayLength"});
  expect(visited).toBe(false);
});

it.each([false,true])("retains collected arguments through later getters and releases them (throw=%s)", async throws => {
  const budget=new Budget({dataSize:100000});
  const retained:number[]=[];
  const inspect=declareHostOperation(()=>{retained.push(measureSandboxData(budget.retainedValues()))},"re-issue");
  const source=`function f(){}const input={length:2,get 0(){return 'x'.repeat(10000)},get 1(){inspect();${throws?"throw 7":"return 2"}}};try{f.apply(null,input)}catch(e){if(e!==7)throw e}inspect();return true`;
  expect(await run(source,{budget,bindings:{inspect}})).toMatchObject({ok:true,returnValue:true});
  expect(retained[0]).toBeGreaterThan(10000);
  expect(retained[1]).toBeLessThan(1000);
});
