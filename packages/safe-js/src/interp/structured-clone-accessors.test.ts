import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { Budget } from "./budget.js";
import { accessorAdapter } from "./accessors.js";
import { createSandboxClosure } from "./values.js";
import { createStructuredCloneGlobal } from "./globals/structured-clone.js";

it.each([
  'let reads=0;const source={get value(){reads++;return 7}};const copy=structuredClone(source);return [reads,copy.value,Object.getOwnPropertyDescriptor(copy,"value")]',
  'const source={get self(){return this}};const copy=structuredClone(source);return copy.self===copy',
  'const trace=[];const source={get first(){trace.push("first");delete this.second;this.third=3;return 1},second:2};const copy=structuredClone(source);return [trace,Object.keys(copy)]',
  'const trace=[];const source={get first(){trace.push("first");return {get nested(){trace.push("nested");return 7}}},get last(){trace.push("last");return 2}};const copy=structuredClone(source);return [trace,copy.first.nested]',
  'const buffer=new ArrayBuffer(1);const bytes=new Uint8Array(buffer);const source={buffer,get change(){bytes[0]=7;return 1}};const copy=structuredClone(source,{transfer:[buffer]});return [buffer.detached,new Uint8Array(copy.buffer)[0]]',
  'const buffer=new ArrayBuffer(1);let error;try{structuredClone({get value(){throw "getter-error"}},{transfer:[buffer]})}catch(e){error=e}return [error,buffer.detached]',
  'const buffer=new ArrayBuffer(1);const bytes=new Uint8Array(buffer);const source={buffer,get change(){bytes[0]=7;return 1}};const copy=structuredClone(source);return [buffer.detached,new Uint8Array(copy.buffer)[0]]',
  'const buffer=new ArrayBuffer(2,{maxByteLength:8});const view=new Uint8Array(buffer);const source={view,buffer,get change(){buffer.resize(6);new Uint8Array(buffer)[5]=7;return 1}};const copy=structuredClone(source,{transfer:[buffer]});return [buffer.detached,copy.buffer.byteLength,copy.view.buffer===copy.buffer,copy.view.length,copy.view[5]]',
  'const map=new Map();const key={get value(){map.clear();return 7}};map.set(key,1);map.set("second",2);const copy=structuredClone(map);return [copy.size,Array.from(copy.values()),Array.from(copy.keys())[0].value]',
  'const set=new Set();const first={get value(){set.clear();return 7}};set.add(first);set.add(2);const copy=structuredClone(set);return [copy.size,Array.from(copy)[0].value,Array.from(copy)[1]]',
  'const source={get first(){Object.defineProperty(this,"second",{enumerable:false});return 1},second:2};return structuredClone(source)',
  'const source={get first(){return ()=>1},get second(){throw "too-late"}};try{structuredClone(source)}catch(e){return e.name}'
])("matches native guest getter cloning: %s", async body => {
  // Catch inside the guest so a rejected accessor remains observable as a result.
  const source = `try { ${body} } catch (error) { return {unexpected:error.name}; }`;
  expect(await run(source)).toMatchObject({ok:true,returnValue:Function(source)()});
});

it("restores the serialized DataView slots even when a later getter shrinks its transferred buffer", async () => {
  // HTML StructuredDeserialize creates the view's internal slots directly.
  // Node 22 instead fails with 'Unable to deserialize cloned data'.
  const source = 'const buffer=new ArrayBuffer(8,{maxByteLength:16});const view=new DataView(buffer,2,4);const source={view,buffer,get change(){buffer.resize(1);return 1}};const copy=structuredClone(source,{transfer:[buffer]});let error;try{copy.view.getUint8(0)}catch(e){error=e.name}return [buffer.detached,copy.buffer.byteLength,copy.view.buffer===copy.buffer,error]';
  expect(await run(source)).toMatchObject({ok:true,returnValue:[true,1,true,"TypeError"]});
});

it.each([{stringLength:3}, {dataSize:64}])("charges retained data before invoking later getters: %j", async limits => {
  let reads = 0;
  const value = {first: "x".repeat(100)};
  Object.defineProperty(value, "next", {enumerable:true, get:accessorAdapter(createSandboxClosure({call:()=>7}), "get")});
  const clone = createStructuredCloneGlobal(new Budget(limits));
  await expect(async () => clone.call([value], {stack:[],thisValue:undefined,invokeClosure:async()=>{reads++;return 7;}}))
    .rejects.toMatchObject({code:"budgetExceeded",budget:Object.keys(limits)[0]});
  expect(reads).toBe(0);
});

it("preserves getter-created cyclic graphs and transferred backing identity across public snapshots", async () => {
  const source = 'let reads=0;const buffer=new ArrayBuffer(2);const source={buffer,get self(){reads++;new Uint8Array(buffer)[1]=7;return this}};const copy=structuredClone(source,{transfer:[buffer]});await 0;return [reads,copy.self===copy,buffer.detached,new Uint8Array(copy.buffer)[1]]';
  const result = await run(source);
  expect(result).toMatchObject({ok:true,returnValue:[1,true,true,7]});
  const snapshot = restore(JSON.parse(await dump(result)), {source});
  expect(await run(source, {snapshot})).toMatchObject({ok:true,returnValue:[1,true,true,7]});
});

it("preserves the existing error brand when a getter returns an error", async () => {
  const source = 'const copy=structuredClone({get value(){return new TypeError("message")}});return [copy.value instanceof Error,copy.value.name]';
  expect(await run(source)).toMatchObject({ok:true,returnValue:Function(source)()});
});
