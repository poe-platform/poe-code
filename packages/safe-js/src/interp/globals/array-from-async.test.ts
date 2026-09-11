import { assert, expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { Budget } from "../budget.js";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

it.each([
  "return [typeof Array.fromAsync, Array.fromAsync.name, Array.fromAsync.length]",
  "return await Array.fromAsync([Promise.resolve(2), 4], async (value, index) => value + index)",
  "return await Array.fromAsync({0:Promise.resolve(2),2:6,length:3}, async (value,index) => [value,index])",
  "return await Array.fromAsync('a😀b')",
  "const d=Object.getOwnPropertyDescriptor(Array,'fromAsync');return [d.writable,d.enumerable,d.configurable,Array.fromAsync.prototype]",
  "const events=[];const input={get [Symbol.iterator](){events.push('get');return function(){events.push('call');return {next(){events.push('next');return {done:true}}}}}};const pending=Array.fromAsync(input);events.push('returned');await pending;return events",
  "const events=[];const input={get length(){events.push('length');return 2},get 0(){events.push('zero');return Promise.resolve(3)},get 1(){events.push('one');return 5}};function C(n){events.push(n)}const value=await Array.fromAsync.call(C,input,async(value,index)=>{events.push(index);await 0;return value});return [events,value instanceof C,value[0],value[1],value.length]",
  "const events=[];const input={get [Symbol.asyncIterator](){events.push('lookup');throw 'lookup'}};try{await Array.fromAsync(input,7)}catch(error){events.push(error.name)}return events",
  "const events=[];const input={[Symbol.iterator](){events.push('iterator');return {next(){events.push('next');return {done:true}},return(){events.push('close');return {done:true}}}}};function C(){throw 'constructor'}try{await Array.fromAsync.call(C,input)}catch(error){events.push(error)}return events",
  "return await Array.fromAsync.call(()=>{},[2,3])",
  "return await Array.fromAsync(new Set([2,3]),async value=>value*2)",
  "async function* source(){yield 2;await 0;yield 4} return await Array.fromAsync(source())",
  "const events=[];const input={[Symbol.iterator](){events.push('iterator');return [2][Symbol.iterator]()}};function C(){events.push('construct');} const value=await Array.fromAsync.call(C,input);return [events,value instanceof C,value[0],value.length]",
  "const events=[];const input={[Symbol.asyncIterator](){events.push('async');let n=0;return {async next(){return {done:n++>0,value:7}}}},get [Symbol.iterator](){throw 'sync lookup'}};return [await Array.fromAsync(input),events]",
  "const promise=Promise.resolve(3);const input={[Symbol.asyncIterator](){let n=0;return {async next(){return {done:n++>0,value:promise}}}}};const direct=await Array.fromAsync(input);const mapped=await Array.fromAsync(input,x=>x);return [direct[0]===promise,mapped]",
  "const events=[];const input={[Symbol.asyncIterator](){return {async next(){return {value:1,done:false}},async return(){await 0;events.push('closed');return {done:true}}}}};try{await Array.fromAsync(input,async()=>{throw 'mapper'})}catch(error){events.push(error)}return events",
  "const context={offset:5};return await Array.fromAsync([2],function(value,index){return value+index+this.offset},context)",
  "const events=[];let pending;try{pending=Array.fromAsync(null);events.push(pending instanceof Promise)}catch(error){events.push('sync throw')}try{await pending}catch(error){events.push(error.name)}return events"
])("matches native Array.fromAsync: %s", async source => {
  const expected = await new AsyncFunction("'use strict';" + source)();
  const result = await run(source);
  assert(result.ok, result.ok ? undefined : JSON.stringify(result));
  expect(result.returnValue).toEqual(expected);
});

it("propagates next rejection without closing, as specified", async () => {
  // Node 22 and 24 currently close here, unlike ECMA-262's direct abrupt return.
  const source = "const events=[];const input={[Symbol.asyncIterator](){return {async next(){throw 'next'},async return(){events.push('closed');return {done:true}}}}};try{await Array.fromAsync(input)}catch(error){events.push(error)}return events";
  const result = await run(source);
  assert(result.ok);
  expect(result.returnValue).toEqual(["next"]);
});

it("closes after output definition fails and preserves the original TypeError", async () => {
  const result=await run("const events=[];const input={[Symbol.asyncIterator](){let n=0;return {async next(){return {value:1,done:n++>0}},async return(){events.push('closed');return 4}}}};function C(){Object.preventExtensions(this)}try{await Array.fromAsync.call(C,input)}catch(error){events.push(error.name)}return events");
  assert(result.ok);
  expect(result.returnValue).toEqual(['closed','TypeError']);
});

it("preserves a mapper throw when async close rejects", async () => {
  const result=await run("const events=[];const input={[Symbol.asyncIterator](){let n=0;return {async next(){return {value:1,done:n++>0}},async return(){events.push('closed');throw 'close'}}}};try{await Array.fromAsync(input,()=>{throw 'mapper'})}catch(error){events.push(error)}return events");
  assert(result.ok);
  expect(result.returnValue).toEqual(['closed','mapper']);
});

it.each([
  "next(){return Promise.resolve(7)}",
  "next(){return {get done(){throw 'done'}}}",
  "next(){return {done:false,get value(){throw 'value'}}}"
])("does not close after malformed or throwing iterator result: %s", async next => {
  const source = "const events=[];const input={[Symbol.asyncIterator](){return {"+next+",return(){events.push('closed');return {done:true}}}}};try{await Array.fromAsync(input)}catch(error){events.push(typeof error==='string'?error:error.name)}return events";
  const result=await run(source);
  assert(result.ok);
  expect(result.returnValue).toEqual([next.includes('Promise.resolve') ? 'TypeError' : next.includes('get done') ? 'done' : 'value']);
});

it.each(["null", "undefined", "{[Symbol.asyncIterator]:7}", "{[Symbol.iterator]:7}", "{[Symbol.asyncIterator](){return 7}}"])("rejects invalid inputs through a promise: %s", async input => {
  const result=await run("const pending=Array.fromAsync("+input+");try{await pending}catch(error){return [pending instanceof Promise,error.name]}");
  assert(result.ok);
  expect(result.returnValue).toEqual([true,'TypeError']);
});

it("replays sequential async mapping through the public SDK", async () => {
  const source = "return await Array.fromAsync([Promise.resolve(2),4],async(value,index)=>{await 0;return value+index})";
  const result = await run(source);
  assert(result.ok);
  expect(result.returnValue).toEqual([2, 5]);
  const replay = await run(source, { snapshot: JSON.parse(await dump(result)) });
  assert(replay.ok);
  expect(replay.returnValue).toEqual(result.returnValue);
});

it("keeps incremental array-length limits fatal", async () => {
  await expect(run("try{return await Array.fromAsync({length:4})}catch(error){return 'caught'}", {
    budget: new Budget({ arrayLength: 3 })
  })).rejects.toMatchObject({code:'budgetExceeded',budget:'arrayLength'});
});

it("keeps mapped output charged across later awaits", async () => {
  const source="return (await Array.fromAsync([1,2],async()=>{await 0;const temporary='y'.repeat(2000);return {value:'x'.repeat(2000)}})).length";
  await expect(run(source,{budget:new Budget({dataSize:5000})})).rejects.toMatchObject({code:'budgetExceeded',budget:'dataSize'});
  const result=await run(source,{budget:new Budget({dataSize:10000})});
  assert(result.ok);
  expect(result.returnValue).toBe(2);
});

it("does not suppress a fatal budget error in async cleanup", async () => {
  await expect(run("async function* source(){try{yield 1}finally{while(true){}}}try{await Array.fromAsync(source(),()=>{throw 'mapper'})}catch(error){return 'caught'}", {
    budget: new Budget({maxSteps:1000})
  })).rejects.toMatchObject({code:'budgetExceeded',budget:'steps'});
});
