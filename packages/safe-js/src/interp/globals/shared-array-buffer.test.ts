import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { Budget } from "../budget.js";
import { getSandboxPrototype } from "../object-model.js";
import { createSandboxClosure, isSandboxClosure } from "../values.js";
import { cloneSharedArrayBufferStorage, isSandboxSharedArrayBuffer, sharedArrayBufferStorage } from "../shared-array-buffer.js";
import { createSharedArrayBufferGlobal } from "./shared-array-buffer.js";

it("constructs and grows standalone shared buffers", async () => {
  const constructor=createSharedArrayBufferGlobal(new Budget());
  const buffer=await constructor.construct!([4,{maxByteLength:8}]);
  if (!isSandboxSharedArrayBuffer(buffer)) throw new Error("Expected shared storage");
  const prototype=getSandboxPrototype(buffer)!;
  const grow=Object.getOwnPropertyDescriptor(prototype,"grow")!.value;
  if (!isSandboxClosure(grow)) throw new Error("Expected grow intrinsic");
  await grow.call([8],{stack:[],thisValue:buffer});
  expect(sharedArrayBufferStorage(buffer)).toMatchObject({byteLength:8,maxByteLength:8,growable:true});
  expect(()=>constructor.call([])).toThrow(TypeError);
});

it("copies bytes through standalone shared slice", async () => {
  const constructor=createSharedArrayBufferGlobal(new Budget());
  const buffer=await constructor.construct!([4]);
  if (!isSandboxSharedArrayBuffer(buffer)) throw new Error("Expected shared storage");
  new Uint8Array(buffer).set([1,2,3,4]);
  const slice=Object.getOwnPropertyDescriptor(getSandboxPrototype(buffer)!,"slice")!.value;
  if (!isSandboxClosure(slice)) throw new Error("Expected slice intrinsic");
  const copied=await slice.call([1,3],{stack:[],thisValue:buffer});
  if (!isSandboxSharedArrayBuffer(copied)) throw new Error("Expected shared slice");
  expect(Array.from(new Uint8Array(copied))).toEqual([2,3]);
  expect(sharedArrayBufferStorage(copied).block).not.toBe(sharedArrayBufferStorage(buffer).block);
});

it("rejects standalone slice species aliasing the source block", async () => {
  const constructor=createSharedArrayBufferGlobal(new Budget());
  const buffer=await constructor.construct!([4]);
  if (!isSandboxSharedArrayBuffer(buffer)) throw new Error("Expected shared storage");
  const alias=cloneSharedArrayBufferStorage(buffer);
  const species=createSandboxClosure({call:()=>alias,construct:()=>alias});
  Object.defineProperty(buffer,"constructor",{value:{[Symbol.species]:species}});
  const slice=Object.getOwnPropertyDescriptor(getSandboxPrototype(buffer)!,"slice")!.value;
  if (!isSandboxClosure(slice)) throw new Error("Expected slice intrinsic");
  await expect(slice.call([0,1],{stack:[],thisValue:buffer})).rejects.toThrow(TypeError);
});

it.each([
  ["fixed buffer metadata", 'const b=new SharedArrayBuffer(8);return [b.byteLength,b.maxByteLength,b.growable,Object.prototype.toString.call(b)]'],
  ["zero initialization", 'return Array.from(new Uint8Array(new SharedArrayBuffer(4)))'],
  ["integer view aliases", 'const b=new SharedArrayBuffer(4);const a=new Int32Array(b);const c=new Int32Array(b);a[0]=7;return [c[0],a.buffer===c.buffer,ArrayBuffer.isView(a)]'],
  ["DataView aliases", 'const b=new SharedArrayBuffer(4);const d=new DataView(b);d.setUint16(0,513,true);return [Array.from(new Uint8Array(b)),d.buffer===b]'],
  ["slice copies storage", 'const b=new SharedArrayBuffer(4);const a=new Uint8Array(b);a.set([1,2,3,4]);const c=b.slice(1,3);new Uint8Array(c)[0]=9;return [Array.from(a),Array.from(new Uint8Array(c)),c instanceof SharedArrayBuffer]'],
  ["grow preserves existing bytes", 'const b=new SharedArrayBuffer(4,{maxByteLength:8});const a=new Uint8Array(b);a[0]=7;b.grow(8);return [b.byteLength,b.maxByteLength,b.growable,Array.from(a)]'],
  ["fixed-length views do not grow", 'const b=new SharedArrayBuffer(4,{maxByteLength:8});const fixed=new Uint8Array(b,0,2);const tracking=new Uint8Array(b);b.grow(8);return [fixed.length,tracking.length]'],
  ["grow cannot shrink", 'const b=new SharedArrayBuffer(4,{maxByteLength:8});try{b.grow(2)}catch(e){return [e.name,b.byteLength]}'],
  ["grow cannot exceed capacity", 'const b=new SharedArrayBuffer(4,{maxByteLength:8});try{b.grow(9)}catch(e){return [e.name,b.byteLength]}'],
  ["fixed storage cannot grow", 'const b=new SharedArrayBuffer(4);try{b.grow(4)}catch(e){return e.name}'],
  ["ordinary buffer methods reject shared receivers", 'const b=new SharedArrayBuffer(4);try{ArrayBuffer.prototype.slice.call(b)}catch(e){return e.name}'],
  ["shared buffer methods reject ordinary receivers", 'try{SharedArrayBuffer.prototype.slice.call(new ArrayBuffer(4))}catch(e){return e.name}'],
  ["constructor conversion order", 'const calls=[];const b=new SharedArrayBuffer({valueOf(){calls.push("length");return 4}},{get maxByteLength(){calls.push("maximum");return 8}});return [calls,b.byteLength,b.maxByteLength]'],
  ["integer atomics share storage", 'const b=new SharedArrayBuffer(4);const a=new Int32Array(b);const c=new Int32Array(b);return [Atomics.add(a,0,7),Atomics.load(c,0)]'],
  ["BigInt atomics share storage", 'const b=new SharedArrayBuffer(8);const a=new BigInt64Array(b);const c=new BigInt64Array(b);return [String(Atomics.add(a,0,7n)),String(Atomics.load(c,0))]'],
  ["waitAsync unequal value completes synchronously", 'const a=new Int32Array(new SharedArrayBuffer(4));const result=Atomics.waitAsync(a,0,1);return [result.async,result.value]'],
  ["waitAsync zero timeout completes synchronously", 'const a=new Int32Array(new SharedArrayBuffer(4));const result=Atomics.waitAsync(a,0,0,0);return [result.async,result.value]']
])("supports shared storage: %s", async (_name, source) => {
  const expected = runInNewContext(`(()=>{${source}})()`);
  expect(expected).not.toBeUndefined();
  expect(await run(source)).toMatchObject({ok:true,returnValue:expected});
});

it("restores shared-buffer identity, aliases, and growth capacity", async () => {
  const source = `const b=new SharedArrayBuffer(4,{maxByteLength:8});
    const a=new Uint8Array(b);const d=new DataView(b);a[0]=7;
    await 0;b.grow(8);d.setUint8(1,9);
    return [a.buffer===b,d.buffer===b,b.maxByteLength,Array.from(a)]`;
  const expected = [true,true,8,[7,9,0,0,0,0,0,0]];
  const result = await run(source);
  expect(result).toMatchObject({ok:true,returnValue:expected});
  expect(await run(source,{snapshot:JSON.parse(await dump(result))}))
    .toMatchObject({ok:true,returnValue:expected});
});

it("settles an async atomic waiter after notification through an alias", async () => {
  const source = `const b=new SharedArrayBuffer(4);const a=new Int32Array(b);
    const alias=new Int32Array(b);const waiter=Atomics.waitAsync(a,0,0);
    const count=Atomics.notify(alias,0,1);
    return [waiter.async,count,await waiter.value]`;
  expect(await runInNewContext(`(async()=>{${source}})()`)).toEqual([true,1,"ok"]);
  expect(await run(source)).toMatchObject({ok:true,returnValue:[true,1,"ok"]});
});

it("structuredClone creates a distinct buffer wrapper sharing the same data", async () => {
  const source = `const b=new SharedArrayBuffer(4);const c=structuredClone(b);
    new Uint8Array(c)[0]=7;
    return [b!==c,new Uint8Array(b)[0],c instanceof SharedArrayBuffer]`;
  expect(runInNewContext(`(()=>{${source}})()`,{structuredClone,SharedArrayBuffer})).toEqual([true,7,true]);
  expect(await run(source)).toMatchObject({ok:true,returnValue:[true,7,true]});
});

it("restores sharing between distinct structured-cloned buffer wrappers", async () => {
  const source = `const b=new SharedArrayBuffer(4);const c=structuredClone(b);
    const original=new Uint8Array(b);const cloned=new Uint8Array(c);
    await 0;cloned[0]=9;return [b!==c,original[0],cloned[0]]`;
  const result = await run(source);
  expect(result).toMatchObject({ok:true,returnValue:[true,9,9]});
  expect(await run(source,{snapshot:JSON.parse(await dump(result))}))
    .toMatchObject({ok:true,returnValue:[true,9,9]});
});

it("rejects slice species returning a different wrapper of the same shared block", async () => {
  const source = `const b=new SharedArrayBuffer(4);const alias=structuredClone(b);
    b.constructor={[Symbol.species]:function(){return alias}};
    try{b.slice(0,1)}catch(error){return error.name}`;
  expect(runInNewContext(`(()=>{${source}})()`,{structuredClone,SharedArrayBuffer})).toBe("TypeError");
  expect(await run(source)).toMatchObject({ok:true,returnValue:"TypeError"});
});

it("checks growth against changes made during argument conversion", async () => {
  const source = `const b=new SharedArrayBuffer(4,{maxByteLength:8});
    try{b.grow({valueOf(){b.grow(8);return 6}})}
    catch(error){return [error.name,b.byteLength]}`;
  expect(runInNewContext(`(()=>{${source}})()`)).toEqual(["RangeError",8]);
  expect(await run(source)).toMatchObject({ok:true,returnValue:["RangeError",8]});
});

it("shares Float16Array storage with byte-level views", async () => {
  const source=`const b=new SharedArrayBuffer(4);const a=new Float16Array(b);
    const d=new DataView(b);a[0]=1.5;d.setUint16(2,0x4000,true);
    return [a.buffer===b,Array.from(a),d.getUint16(0,true)]`;
  expect(await run(source)).toMatchObject({ok:true,returnValue:[true,[1.5,2],0x3e00]});
});

it("grows tracking Float16Array aliases without extending fixed views", async () => {
  const source=`const b=new SharedArrayBuffer(4,{maxByteLength:8});
    const a=new Float16Array(b);const fixed=new Float16Array(b,0,2);
    a[0]=1.5;b.grow(8);a[3]=2;return [Array.from(a),Array.from(fixed)]`;
  expect(await run(source)).toMatchObject({ok:true,returnValue:[[1.5,0,0,2],[1.5,0]]});
});

it("preserves Float16Array shared backing through structuredClone and replay", async () => {
  const source=`const b=new SharedArrayBuffer(4);const a=new Float16Array(b);
    const c=structuredClone(a);c[0]=1.5;await 0;
    return [a.buffer!==c.buffer,Array.from(a),Array.from(c)]`;
  const result=await run(source);
  expect(result).toMatchObject({ok:true,returnValue:[true,[1.5,0],[1.5,0]]});
  expect(await run(source,{snapshot:JSON.parse(await dump(result))}))
    .toMatchObject({ok:true,returnValue:[true,[1.5,0],[1.5,0]]});
});

it("rejects shared transfer without detaching ordinary transfer entries", async () => {
  const source=`const shared=new SharedArrayBuffer(4);const ordinary=new ArrayBuffer(4);
    try{structuredClone({shared,ordinary},{transfer:[ordinary,shared]})}
    catch(error){return [error.name,ordinary.byteLength,shared.byteLength]}`;
  expect(runInNewContext(`(()=>{${source}})()`,{structuredClone,SharedArrayBuffer}))
    .toEqual(["DataCloneError",4,4]);
  expect(await run(source)).toMatchObject({ok:true,returnValue:["DataCloneError",4,4]});
});
