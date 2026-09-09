import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { Budget } from "../budget.js";
import { callMapMethod } from "../methods/map.js";
import { createSandboxClosure, createSandboxMap } from "../values.js";

it("returns existing values including undefined and inserts defaults only once", async () => {
  expect(await run(`const m=new Map([['present',undefined]]), value={label:1};
    return [m.getOrInsert('present',7),m.getOrInsert('new',value)===value,
      m.getOrInsert('new',9)===value,m.size,[...m.keys()]]`))
    .toMatchObject({ok:true,returnValue:[undefined,true,true,2,["present","new"]]});
});

it("uses SameValueZero keys without coercing objects", async () => {
  expect(await run(`const m=new Map(),key={toString(){throw 'coerced'}};
    return [m.getOrInsert(-0,1),m.getOrInsert(0,2),m.getOrInsert(NaN,3),m.getOrInsert(NaN,4),
      m.getOrInsert(key,5),m.getOrInsert(key,6),1/[...m.keys()][0],m.size]`))
    .toMatchObject({ok:true,returnValue:[1,1,3,3,5,5,Infinity,3]});
});

it("calls computed defaults once with undefined this and a canonicalized key", async () => {
  expect(await run(`let calls=0;const m=new Map();
    const value=m.getOrInsertComputed(-0,function(key){'use strict';calls++;return [this,1/key,arguments.length]});
    return [value,m.getOrInsertComputed(0,()=>{throw 'called'})===value,calls]`))
    .toMatchObject({ok:true,returnValue:[[undefined,Infinity,1],true,1]});
});

it("validates callbacks even when the key exists", async () => {
  expect(await run(`const m=new Map([['x',1]]),names=[];for(const callback of [undefined,null,3,{}]){
    try{m.getOrInsertComputed('x',callback)}catch(e){names.push(e.name)}}return names`))
    .toMatchObject({ok:true,returnValue:["TypeError","TypeError","TypeError","TypeError"]});
});

it("rejects incompatible and Proxy-wrapped receivers", async () => {
  expect(await run(`const names=[];for(const name of ['getOrInsert','getOrInsertComputed']){
    for(const receiver of [{},new Set(),new Proxy(new Map(),{})]){
      try{Map.prototype[name].call(receiver,'x',()=>1)}catch(e){names.push(e.name)}}}return names`))
    .toMatchObject({ok:true,returnValue:Array(6).fill("TypeError")});
});

it("overwrites callback-created entries without changing their insertion position", async () => {
  expect(await run(`const m=new Map([['first',1]]);const result=m.getOrInsertComputed('key',key=>{
    m.set(key,'intermediate');m.set('last',3);return 'final'});return [result,[...m]]`))
    .toMatchObject({ok:true,returnValue:["final",[["first",1],["key","final"],["last",3]]]});
});

it("inserts after callback deletion and preserves callback effects on throw", async () => {
  expect(await run(`const m=new Map([['a',1]]);m.getOrInsertComputed('x',key=>{m.clear();m.set(key,2);m.delete(key);m.set('b',3);return 4});
    let caught;try{m.getOrInsertComputed('y',key=>{m.set(key,5);throw 6})}catch(e){caught=e}return [[...m],caught]`))
    .toMatchObject({ok:true,returnValue:[[["b",3],["x",4],["y",5]],6]});
});

it("does not call overridden get, has or set methods", async () => {
  expect(await run(`class Child extends Map{get(){throw 'get'}has(){throw 'has'}set(){throw 'set'}}
    const m=new Child();return [m.getOrInsert('a',1),m.getOrInsertComputed('b',()=>2),m.getOrInsert('a',3),m.size]`))
    .toMatchObject({ok:true,returnValue:[1,2,1,2]});
});

it("dispatches callable Proxy and bound callbacks", async () => {
  expect(await run(`const events=[];const callback=new Proxy(function(key){events.push(key);return 3},
    {apply(target,receiver,args){events.push(receiver);return Reflect.apply(target,receiver,args)}});
    const m=new Map();return [m.getOrInsertComputed('x',callback),m.getOrInsertComputed('y',(key=>key).bind(null)),events]`))
    .toMatchObject({ok:true,returnValue:[3,"y",[undefined,"x"]]});
});

it("stores an async callback Promise without awaiting its settlement", async () => {
  expect(await run(`const m=new Map();let release;const result=m.getOrInsertComputed('x',async()=>await new Promise(resolve=>{release=resolve}));
    const same=result===m.get('x');release(7);return [result instanceof Promise,same,await result]`))
    .toMatchObject({ok:true,returnValue:[true,true,7]});
});

it("does not call revoked callbacks for existing keys", async () => {
  expect(await run(`const {proxy,revoke}=Proxy.revocable(()=>2,{});revoke();const m=new Map([['x',1]]);
    const existing=m.getOrInsertComputed('x',proxy);let error;try{m.getOrInsertComputed('y',proxy)}catch(e){error=e.name}
    return [existing,error,m.has('y')]`)).toMatchObject({ok:true,returnValue:[1,"TypeError",false]});
});

it("checks the live size after a computed callback fills the map", async () => {
  const map=createSandboxMap([]);
  const callback=createSandboxClosure({call:()=>2});
  const options={budget:new Budget({arrayLength:1}),callClosure:async()=>{map.entries.set("other",1);return 2;}};
  await expect(callMapMethod(map,"getOrInsertComputed",["key",callback],options)).rejects.toMatchObject({code:"budgetExceeded",budget:"arrayLength"});
  expect([...map.entries]).toEqual([["other",1]]);
});

it("makes callback insertions visible to active forEach traversal", async () => {
  expect(await run(`const m=new Map([[1,1]]),visited=[];m.forEach((value,key)=>{visited.push(key);if(key===1)m.getOrInsertComputed(2,()=>2)});return visited`))
    .toMatchObject({ok:true,returnValue:[1,2]});
});

it.each(["getOrInsert","getOrInsertComputed"] as const)("enforces entry limits before %s insertion", async name => {
  const map=createSandboxMap([[1,1]]);
  const callback=createSandboxClosure({call:()=>2});
  const options={budget:new Budget({arrayLength:1}),callClosure:async()=>2};
  await expect(callMapMethod(map,name,[2,name==="getOrInsert"?2:callback],options)).rejects.toMatchObject({code:"budgetExceeded",budget:"arrayLength"});
  expect([...map.entries]).toEqual([[1,1]]);
});

it("installs nonconstructible methods with standard descriptors", async () => {
  expect(await run(`return ['getOrInsert','getOrInsertComputed'].map(name=>{const d=Object.getOwnPropertyDescriptor(Map.prototype,name);let error;
    try{new d.value()}catch(e){error=e.name}return [d.value.name,d.value.length,d.writable,d.enumerable,d.configurable,error]})`))
    .toMatchObject({ok:true,returnValue:[["getOrInsert",2,true,false,true,"TypeError"],["getOrInsertComputed",2,true,false,true,"TypeError"]]});
});

it("preserves inserted values and intrinsic method references in replay", async () => {
  const source="const m=new Map();const insert=Map.prototype.getOrInsertComputed;insert.call(m,'x',()=>({value:4}));await 0;return [m.get('x').value,insert===Map.prototype.getOrInsertComputed]";
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:[4,true]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:[4,true]});
});
