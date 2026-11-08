import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { Budget } from "./budget.js";
import { createStructuredCloneGlobal } from "./globals/structured-clone.js";
import { arrayBufferDetached } from "./array-buffer.js";

it("transfers ArrayBuffer ownership through structuredClone options", async () => {
  const source='const buffer=new ArrayBuffer(4);new Uint8Array(buffer)[0]=7;const copy=structuredClone(buffer,{transfer:[buffer]});return [buffer.byteLength,copy.byteLength,new Uint8Array(copy)[0]]';
  expect(await run(source)).toMatchObject({ok:true,returnValue:Function(source)()});
});

it.each([
  'const buffer=new ArrayBuffer(4);structuredClone(17,{transfer:[buffer]});return [buffer.detached,buffer.byteLength]',
  'const buffer=new ArrayBuffer(8);const bytes=new Uint8Array(buffer);const view=new DataView(buffer,1,4);bytes[1]=7;const value={buffer,bytes,view};value.self=value;const copy=structuredClone(value,{transfer:[buffer]});return [buffer.detached,bytes.length,copy.self===copy,copy.bytes.buffer===copy.buffer,copy.view.buffer===copy.buffer,copy.view.getUint8(0)]',
  'const buffer=new ArrayBuffer(4,{maxByteLength:8});const copy=structuredClone(buffer,{transfer:[buffer]});copy.resize(6);return [buffer.detached,copy.resizable,copy.maxByteLength,copy.byteLength]',
  'const buffer=new ArrayBuffer(1);const trace=[];structuredClone(null,{get transfer(){trace.push("transfer");return new Set([buffer])}});return [trace,buffer.detached]',
  'const buffer=new ArrayBuffer(1);const trace=[];const list={*[Symbol.iterator](){trace.push("start");yield buffer;trace.push("done")}};structuredClone(null,{transfer:list});return [trace,buffer.detached]',
  'const buffer=new ArrayBuffer(1);let error;try{structuredClone(buffer,{transfer:[buffer,buffer]})}catch(e){error=e.name}return [error,buffer.detached]',
  'const buffer=new ArrayBuffer(1);let error;try{structuredClone(buffer,{transfer:[buffer,{}]})}catch(e){error=e.name}return [error,buffer.detached]',
  'const buffer=new ArrayBuffer(1);let error;try{structuredClone(buffer,{transfer:[new Uint8Array(buffer)]})}catch(e){error=e.name}return [error,buffer.detached]',
  'const buffer=new ArrayBuffer(1);const trace=[];const list={*[Symbol.iterator](){try{yield 1;trace.push("after")}finally{trace.push("closed")}}};try{structuredClone(buffer,{transfer:list})}catch(e){trace.push(e.name)}return [trace,buffer.detached]',
  'const buffer=new ArrayBuffer(1);const trace=[];const list={*[Symbol.iterator](){yield buffer;yield buffer;trace.push("exhausted");throw "iterator-error"}};try{structuredClone(buffer,{transfer:list})}catch(e){trace.push(e)}return [trace,buffer.detached]',
  'const buffer=new ArrayBuffer(1);let error;try{structuredClone({callback(){},buffer},{transfer:[buffer]})}catch(e){error=e.name}return [error,buffer.detached]',
  'const buffer=new ArrayBuffer(1);buffer.transfer();try{structuredClone(null,{transfer:[buffer]})}catch(e){return [e.name,e.code]}',
  'const buffer=new ArrayBuffer(1);const result=structuredClone(buffer,null);return [buffer.detached,result.byteLength]',
  'const buffer=new ArrayBuffer(1);Object.defineProperty(buffer,"extra",{get(){throw 1}});const result=structuredClone(buffer,{transfer:[buffer]});return [buffer.detached,Object.keys(result)]'
])("matches native transfer behavior: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:Function(source)()});
});

it.each(['1','""','{transfer:null}','{transfer:1}','{transfer:"x"}','{transfer:[null]}','{transfer:[1]}','{transfer:{length:0}}'])
  ("rejects invalid options or transfer sequence %s", options => expect(run(`try{structuredClone(1,${options});return "accepted"}catch(error){return error.name}`))
    .resolves.toMatchObject({ok:true,returnValue:"TypeError"}));

it("reports the standard required argument and function length", async () => {
  expect(await run('let error;try{structuredClone()}catch(e){error=e.name}return [error,structuredClone.length,structuredClone(undefined)]'))
    .toMatchObject({ok:true,returnValue:["TypeError",1,undefined]});
});

it("applies transfer-list detachment in the HTML algorithm's order", async () => {
  // HTML 2.7.7 checks detachment in its per-item transfer pass, after cloning.
  // Node 22 prevalidates the entire list, so it is not an oracle for this case.
  expect(await run('const a=new ArrayBuffer(1);const b=new ArrayBuffer(1);b.transfer();let error;try{structuredClone(null,{transfer:[a,b]})}catch(e){error=e.name}return [error,a.detached,b.detached]'))
    .toMatchObject({ok:true,returnValue:["DataCloneError",true,true]});
});

it.each([{maxSteps: 1}, {dataSize: 8}, {arrayLength: 2}])("does not detach originals when budget preflight fails: %j", async limits => {
  const buffer = new ArrayBuffer(16);
  new Uint8Array(buffer)[0] = 7;
  const clone = createStructuredCloneGlobal(new Budget(limits));
  await expect(clone.call([buffer, {transfer: [buffer]}])).rejects.toMatchObject({code: "budgetExceeded"});
  expect(arrayBufferDetached(buffer)).toBe(false);
  expect(new Uint8Array(buffer)[0]).toBe(7);
});

it("preserves transferred backing aliases and detached originals across public snapshots", async () => {
  const source = 'const buffer=new ArrayBuffer(8);const view=new DataView(buffer);view.setUint16(0,1234);const copy=structuredClone({buffer,view,bytes:new Uint8Array(buffer)},{transfer:[buffer]});await 0;return [buffer.detached,copy.view.buffer===copy.buffer,copy.bytes.buffer===copy.buffer,copy.view.getUint16(0)]';
  const result = await run(source);
  expect(result).toMatchObject({ok:true,returnValue:[true,true,true,1234]});
  const snapshot = restore(JSON.parse(await dump(result)), {source});
  expect(await run(source, {snapshot})).toMatchObject({ok:true,returnValue:[true,true,true,1234]});
});
