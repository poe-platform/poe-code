import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { Budget } from "../budget.js";
import { createWeakCollectionGlobals } from "./weak-collections.js";
import { getSandboxPrototype } from "../object-model.js";
import { createSandboxClosure, type SandboxClosure } from "../values.js";
import { createWeakCollection, setWeakEntry, weakCollectionStates } from "../weak-collection.js";

it("returns existing undefined values and preserves key identity", async () => {
  expect(await run(`const m=new WeakMap(),a={},b={};return [m.getOrInsert(a,undefined),m.getOrInsert(a,7),
    m.getOrInsert(b,8),m.get(b),m.has(a)]`)).toMatchObject({ok:true,returnValue:[undefined,undefined,8,8,true]});
});

it.each(["{}","()=>{}","new Proxy({},{})","Symbol('unique')","Symbol.iterator"])("accepts weak key %s without coercion", async key => {
  expect(await run(`const key=${key},m=new WeakMap();let calls=0;const value=m.getOrInsertComputed(key,function(k){'use strict';calls++;return [k===key,this,arguments.length]});
    return [value,m.getOrInsertComputed(key,()=>{throw 'called'})===value,calls]`))
    .toMatchObject({ok:true,returnValue:[[true,undefined,1],true,1]});
});

it.each(["undefined","null","1","'key'","1n","Symbol.for('registered')"])("rejects invalid weak key %s without calling the callback", async key => {
  expect(await run(`const m=new WeakMap(),errors=[];let calls=0;for(const method of ['getOrInsert','getOrInsertComputed']){
    try{m[method](${key},()=>{calls++;return 1})}catch(e){errors.push(e.name)}}return [errors,calls]`))
    .toMatchObject({ok:true,returnValue:[["TypeError","TypeError"],0]});
});

it("validates callbacks on existing keys and does not call revoked callbacks on hits", async () => {
  expect(await run(`const k={},m=new WeakMap([[k,1]]),errors=[];for(const value of [undefined,null,{}]){
    try{m.getOrInsertComputed(k,value)}catch(e){errors.push(e.name)}}const {proxy,revoke}=Proxy.revocable(()=>2,{});revoke();
    return [errors,m.getOrInsertComputed(k,proxy)]`)).toMatchObject({ok:true,returnValue:[["TypeError","TypeError","TypeError"],1]});
});

it("overwrites callback-created entries and preserves callback effects on throws", async () => {
  expect(await run(`const k={},other={},m=new WeakMap();const value=m.getOrInsertComputed(k,key=>{m.set(key,2);return 3});
    let error;try{m.getOrInsertComputed(other,key=>{m.set(key,4);throw 5})}catch(e){error=e}return [value,m.get(k),m.get(other),error]`))
    .toMatchObject({ok:true,returnValue:[3,3,4,5]});
});

it("bypasses overridden collection methods and dispatches Proxy callbacks", async () => {
  expect(await run(`class Child extends WeakMap{get(){throw 'get'}has(){throw 'has'}set(){throw 'set'}}
    const m=new Child(),key={},events=[];const callback=new Proxy(()=>2,{apply(t,self,args){events.push([self,args[0]===key]);return 3}});
    return [m.getOrInsertComputed(key,callback),m.getOrInsert(key,9),events]`))
    .toMatchObject({ok:true,returnValue:[3,3,[[undefined,true]]]});
});

it("stores the async callback Promise without awaiting it", async () => {
  expect(await run(`const key={},m=new WeakMap();let resolve;const value=m.getOrInsertComputed(key,async()=>await new Promise(r=>{resolve=r}));
    const same=value===m.get(key);resolve(7);return [value instanceof Promise,same,await value]`))
    .toMatchObject({ok:true,returnValue:[true,true,7]});
});

it.each(["getOrInsert","getOrInsertComputed"])("checks %s receiver branding and metadata", async method => {
  expect(await run(`const d=Object.getOwnPropertyDescriptor(WeakMap.prototype,'${method}'),errors=[];
    for(const receiver of [{},new WeakSet(),new Proxy(new WeakMap(),{})]){try{d.value.call(receiver,{},()=>1)}catch(e){errors.push(e.name)}}
    try{new d.value()}catch(e){errors.push(e.name)}return [d.value.name,d.value.length,d.writable,d.enumerable,d.configurable,errors]`))
    .toMatchObject({ok:true,returnValue:[method,2,true,false,true,Array(4).fill("TypeError")]});
});

it("checks live entry limits after the callback without inserting the requested key", async () => {
  const budget=new Budget({arrayLength:1});
  const globals=createWeakCollectionGlobals(budget);
  const instance=await globals.WeakMap.construct!([], {stack:[]});
  const prototype=getSandboxPrototype(instance as object,budget)!;
  const method=Object.getOwnPropertyDescriptor(prototype,"getOrInsertComputed")!.value as SandboxClosure;
  const key={},other={};
  const callback=createSandboxClosure({call:()=>{setWeakEntry(instance as object,other,1);return 2;}});
  await expect(method.call([key,callback],{thisValue:instance,stack:[]})).rejects.toMatchObject({code:"budgetExceeded",budget:"arrayLength"});
  expect(weakCollectionStates.get(instance as object)!.entries.has(key)).toBe(false);
  expect(weakCollectionStates.get(instance as object)!.entries.get(other)!.value).toBe(1);
});

it("does not grow the weak index when a callback already inserted the key", async () => {
  const budget=new Budget({arrayLength:1}),globals=createWeakCollectionGlobals(budget);
  const instance=createWeakCollection("map"),key={};
  const constructed=await globals.WeakMap.construct!([],{stack:[]});
  const prototype=getSandboxPrototype(constructed as object,budget)!;
  const method=Object.getOwnPropertyDescriptor(prototype,"getOrInsertComputed")!.value as SandboxClosure;
  const callback=createSandboxClosure({call:()=>{setWeakEntry(instance,key,1);return 2;}});
  expect(await method.call([key,callback],{thisValue:instance,stack:[]})).toBe(2);
  expect(weakCollectionStates.get(instance)!.references.size).toBe(1);
});

it("replays computed entries while their keys remain strongly reachable", async () => {
  const source="const key={},m=new WeakMap();m.getOrInsertComputed(key,()=>({value:4}));await 0;return [m.get(key).value,m.getOrInsert(key,7)===m.get(key)]";
  const first=await run(source);expect(first).toMatchObject({ok:true,returnValue:[4,true]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:[4,true]});
});
