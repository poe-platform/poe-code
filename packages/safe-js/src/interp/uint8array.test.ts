import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";
import { isSandboxClosure, deepCopyToSandbox, deepCopyFromSandbox } from "./values.js";
import { encodeReplayData, decodeReplayData } from "../snapshot/replay-data.js";
import { digestHostCallArguments } from "./host-call.js";
import { Budget } from "./budget.js";
import { declareHostOperation } from "./host-bridge.js";
import { decodeTypedArrayStorage } from "../snapshot/typed-array.js";

const cases = [
  'const value=new Uint8Array([257,-1,3.9,NaN]);return [Array.from(value),value.length,value.byteLength,value.BYTES_PER_ELEMENT,Uint8Array.BYTES_PER_ELEMENT]',
  'const buffer=new ArrayBuffer(8);const bytes=new Uint8Array(buffer,1,3);bytes.set([1,2,3]);return [Array.from(new Uint8Array(buffer)),bytes.byteOffset,bytes.buffer===buffer,ArrayBuffer.isView(bytes)]',
  'const value=new Uint8Array([3,1,2]);return [Array.from(value.map(x=>x+256)),Array.from(value.filter(x=>x>1)),Array.from(value.toSorted()),Array.from(value.toReversed()),Array.from(value.with(1,258)),Array.from(value)]',
  'const value=new Uint8Array([1,2,3,4]);const view=value.subarray(1,3);view[0]=9;const copy=value.slice(1,3);return [Array.from(value),Array.from(copy),view.buffer===value.buffer,copy.buffer!==value.buffer]',
  'const value=new Uint8Array([3,1,2]);value.sort();value.reverse();value.copyWithin(1,0,2);value.fill(257,2);return [Array.from(value),Array.from(value.entries()),value.join("-")]',
  'return [Object.getPrototypeOf(Uint8Array)===Object.getPrototypeOf(Float32Array),Object.getPrototypeOf(Uint8Array.prototype)===Object.getPrototypeOf(Float32Array.prototype),Uint8Array.prototype.map===Float32Array.prototype.map,new Uint8Array(1) instanceof Float32Array]',
  'class Bytes extends Uint8Array{};const value=new Bytes([1,2]);return [value instanceof Bytes,value instanceof Uint8Array,value.map(x=>x+1) instanceof Bytes,value.toSorted() instanceof Bytes,Object.prototype.toString.call(value)]',
  'return [Array.from(Uint8Array.from([1,2],x=>x+256)),Array.from(Uint8Array.of(257,-1)),Array.from(new Float32Array(new Uint8Array([1,2]))),Array.from(new Uint8Array(new Float32Array([1.5,-1])))]',
  'const buffer=new ArrayBuffer(4,{maxByteLength:8});const value=new Uint8Array(buffer,1);value[0]=7;buffer.resize(6);const length=value.length;buffer.transfer();let error;try{value.values()}catch(caught){error=caught.name}return [length,value.length,value.buffer===buffer,error]',
  'const value=new Uint8Array(2);value[0]={valueOf(){return 257}};Object.defineProperty(value,"1",{value:{valueOf(){return -1}}});return Array.from(value)',
  'class Bytes extends Uint8Array{static get [Symbol.species](){return Float32Array}};const value=new Bytes([3,4]);return [Array.from(value.slice()),value.slice() instanceof Float32Array,value.map(x=>x+0.5) instanceof Float32Array,Array.from(value.map(x=>x+0.5)),Array.from(value.filter(x=>x>3))]',
  'class Floats extends Float32Array{static get [Symbol.species](){return Uint8Array}};const value=new Floats([257.5,-1]);return [Array.from(value.slice()),value.slice() instanceof Uint8Array,Array.from(value.map(x=>x)),Array.from(value.filter(x=>true))]',
  'const value=new Uint8Array([1,2]);value.join=0;return String(value)',
  'const value=new Uint8Array([1,2]);value.extra=7;value.callback=()=>3;const copy=structuredClone(value);return [Array.from(copy),Object.keys(copy)]',
  'class Bytes extends Uint8Array{};const value=new Bytes([1,2]);Object.defineProperty(value,"extra",{get(){throw 1}});Object.defineProperty(value.buffer,"extra",{get(){throw 2}});const copied=structuredClone([value,value.buffer]);return [Array.from(copied[0]),copied[0] instanceof Bytes,copied[0].buffer===copied[1],Object.keys(copied[1])]',
  'const buffer=new ArrayBuffer(8);Object.defineProperty(buffer,"callback",{value:()=>1});const value=new Uint8Array(buffer);const copied=structuredClone([buffer,value]);return [copied[1].buffer===copied[0],Object.keys(copied[0])]',
  'const value=new Float32Array([1,2]);value.callback=()=>1;return Array.from(structuredClone(value))'
];

it.each(cases)("matches native Uint8Array behavior: %s", async source => {
  const expected = runInNewContext(`(function(){${source}})()`, {structuredClone});
  expect(await run(source)).toMatchObject({ok:true,returnValue:expected});
});

it("copies mixed native view graphs without losing aliases or exposing host storage", () => {
  const buffer = new ArrayBuffer(8);
  const bytes = new Uint8Array(buffer,1,3);
  bytes[0] = 7;
  const floats = new Float32Array(buffer);
  const graph = {buffer,bytes,floats,alias:bytes};
  for (const copied of [deepCopyFromSandbox(deepCopyToSandbox(graph)),decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(deepCopyToSandbox(graph)))))] as Array<typeof graph>) {
    expect(copied.bytes).toBeInstanceOf(Uint8Array);
    expect(copied.floats).toBeInstanceOf(Float32Array);
    expect(copied.bytes.buffer).toBe(copied.buffer);
    expect(copied.floats.buffer).toBe(copied.buffer);
    expect(copied.bytes).toBe(copied.alias);
    expect(copied.buffer).not.toBe(buffer);
    expect(copied.bytes.byteOffset).toBe(1);
    expect(Array.from(copied.bytes)).toEqual([7,0,0]);
  }
});

it("distinguishes byte and float views in host-call identities", () => {
  const buffer = new ArrayBuffer(4);
  expect(digestHostCallArguments([new Uint8Array(buffer,0,1)]))
    .not.toBe(digestHostCallArguments([new Float32Array(buffer)]));
});

it("imports and exports Uint8Array through an actual host operation", async () => {
  let calls = 0;
  const echo = declareHostOperation((value: Uint8Array) => {
    expect(value).toBeInstanceOf(Uint8Array);
    expect(Array.from(value)).toEqual([1,255]);
    calls++;
    return value;
  }, "re-issue");
  expect(await run('const value=await echo(new Uint8Array([257,-1]));return [value instanceof Uint8Array,Array.from(value)]',{bindings:{echo}}))
    .toMatchObject({ok:true,returnValue:[true,[1,255]]});
  expect(calls).toBe(1);
});

it.each([
  {source:"return new Uint8Array(3)",limits:{arrayLength:2},budget:"arrayLength"},
  {source:"return new Uint8Array(4096)",limits:{dataSize:2048},budget:"dataSize"}
])("bounds Uint8Array allocation with $budget", async ({source,limits,budget}) => {
  await expect(run(source,{budget:new Budget(limits)})).rejects.toMatchObject({code:"budgetExceeded",budget});
});

it.each([undefined,"Float128Array","constructor","__proto__",1])("rejects unregistered snapshot type %j", arrayType => {
  expect(()=>decodeTypedArrayStorage({kind:"typedarray",arrayType,bytes:[0],byteOffset:0,length:1},()=>undefined)).toThrow("Invalid typed array storage type.");
});

it("preserves mixed views and their concrete kinds through repeated snapshots", async () => {
  const source = 'const buffer=new ArrayBuffer(8);const bytes=new Uint8Array(buffer);const floats=new Float32Array(buffer);bytes[0]=7;return ()=>[bytes instanceof Uint8Array,floats instanceof Float32Array,bytes.buffer===floats.buffer,bytes[0],bytes.byteLength,floats.length]';
  let read = (await run(source)).returnValue;
  for (let round = 0; round < 2; round++) {
    const saved = serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{read}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const binding = restore(JSON.parse(JSON.stringify(saved)),{source}).currentScope.lookup("read");
    if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("Missing restored closure");
    expect(await binding.value.call([])).toEqual([true,true,true,7,8,2]);
    read = binding.value;
  }
});
