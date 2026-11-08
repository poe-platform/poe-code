import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../run.js";
import { createRealm } from "../realm.js";
import { Budget } from "./budget.js";

const cases = [
  ["globalThis.this=7;return this", undefined],
  ["globalThis.this=7;return (()=>this)()", undefined],
  ["globalThis.this=7;return (function(){return this})()", undefined],
  ["return globalThis.globalThis===globalThis && globalThis.Math===Math", true],
  ["globalThis.value=7;return value", 7],
  ["globalThis.Math=7;return Math", 7],
  ["Math=7;return globalThis.Math", 7],
  ["let value=7;return Object.hasOwn(globalThis,'value')", false],
  ["globalThis.value=3;let value=7;return [value,globalThis.value]", [7,3]],
  ["Object.defineProperty(globalThis,'value',{get(){return 7}});return value", 7],
  ["const events=[];Object.defineProperty(globalThis,'value',{set(v){events.push(v)}});value=7;return events", [7]],
  ["globalThis.value=1;value+=2;return [value,globalThis.value]", [3,3]],
  ["globalThis.value=1;({value}={value:7});return globalThis.value", 7],
  ["globalThis.value=1;delete globalThis.value;return typeof value", "undefined"],
  ["globalThis.value=1;try{value=(delete globalThis.value,7)}catch(error){return error.name}", "ReferenceError"],
  ["return [typeof globalThis.process,typeof globalThis.require,typeof globalThis.Buffer]", ["undefined","undefined","undefined"]],
  ["const descriptor=Object.getOwnPropertyDescriptor(globalThis,'Math');return [descriptor.writable,descriptor.enumerable,descriptor.configurable]", [true,false,true]],
  ["try{globalThis.undefined=7}catch(error){return error.name}", "TypeError"],
  ["globalThis.value=1;return [value++,++value,globalThis.value]", [1,3,3]],
  ["globalThis.value=0;value ||= 7;value &&= 8;value ??= 9;return globalThis.value", 8],
  ["globalThis.value=1;try{value+=(delete globalThis.value,7)}catch(error){return [error.name,Object.hasOwn(globalThis,'value')]}", ["ReferenceError",false]],
  ["const events=[];try{missing=(events.push('rhs'),7)}catch(error){events.push(error.name)}return events", ["rhs","ReferenceError"]],
  ["globalThis.value=3;try{return value;let value}catch(error){return error.name}", "ReferenceError"],
  ["globalThis.value=3;function read(value){return [value,globalThis.value]}return read(7)", [7,3]],
  ["var value=7;return Object.hasOwn(globalThis,'value')", false],
  ["globalThis.method=function(){return this===undefined};return [method(),globalThis.method()]", [true,false]],
  ["const events=[];globalThis.marker=3;Object.defineProperty(globalThis,'value',{get(){events.push(this.marker);return 7},set(v){events.push(this.marker,v)}});const read=value;value=8;return [read,events]", [7,[3,3,8]]],
  ["Object.defineProperty(globalThis,'value',{value:7,writable:false});try{value=8}catch(error){return [error.name,value]}", ["TypeError",7]],
  ["const saved=globalThis;globalThis=7;return [globalThis,saved.globalThis]", [7,7]],
  ["const saved=globalThis;delete saved.globalThis;return typeof globalThis", "undefined"],
  ["delete globalThis.Math;return typeof Math", "undefined"],
  ["Object.defineProperty(globalThis,'value',{get(){throw new RangeError('getter')}});try{return typeof value}catch(error){return error.message}", "getter"]
] as const;

it.each(cases)("validates the native global-object control: %s", (source, expected) => {
  expect(runInNewContext(`(function(){'use strict';${source}})()`)).toEqual(expected);
});

it.each(cases)("implements isolated global-object semantics: %s", async (source, expected) => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:expected});
});

it("uses the guest global object as the accessor receiver", async () => {
  // Node VM contexts wrap the global object, so receiver identity is checked
  // separately from the contextified native controls above.
  const source = "const events=[];Object.defineProperty(globalThis,'value',{get(){events.push(this===globalThis);return 7},set(v){events.push(this===globalThis,v)}});const read=value;value=8;return [read,events]";
  expect(await run(source)).toMatchObject({ok:true,returnValue:[7,[true,true,8]]});
});

it("keeps global object mutations isolated between runs", async () => {
  expect(await run("globalThis.value=7;return value")).toMatchObject({ok:true,returnValue:7});
  expect(await run("return typeof value")).toMatchObject({ok:true,returnValue:"undefined"});
});

it("retains global object mutations in a persistent realm", async () => {
  const realm=createRealm();
  try {
    expect(await realm.evaluate("globalThis.value=7;return value")).toMatchObject({ok:true,returnValue:7});
    expect(await realm.evaluate("return value")).toMatchObject({ok:true,returnValue:7});
  } finally {await realm.close();}
});

it.each([
  ["globalThis.value=1;value += await Promise.resolve(6);return globalThis.value", 7],
  ["Object.defineProperty(globalThis,'value',{get(){return Promise.resolve(7)}});return await value", 7],
  ["globalThis.value=1;({value=await Promise.resolve(7)}={});return globalThis.value", 7],
  ["Object.setPrototypeOf(globalThis,{inherited:7});return inherited", 7],
  ["globalThis.host=7;try{host=9}catch(error){return [error.name,host,globalThis.host]}", ["TypeError",3,7]]
] as const)("supports global-object asynchronous and inherited bindings: %s", async (source, expected) => {
  expect(await run(source,{bindings:{host:3}})).toMatchObject({ok:true,returnValue:expected});
});

it("charges guest data retained only by global object properties", async () => {
  const source = "for(let i=0;i<8;i++)globalThis['value'+i]='x'.repeat(15000);return 7";
  await expect(run(source,{budget:new Budget({dataSize:100000})}))
    .rejects.toMatchObject({code:"budgetExceeded",budget:"dataSize"});
});
