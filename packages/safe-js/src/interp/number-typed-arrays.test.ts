import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore as restoreRun } from "../restore.js";
import { deepCopyToSandbox, deepCopyFromSandbox } from "./values.js";
import { Budget } from "./budget.js";
import { createNumericTypedArrayGlobal } from "./globals/numeric-typed-array.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";
import { encodeReplayData, decodeReplayData } from "../snapshot/replay-data.js";
import { typedArrayViewLayouts } from "./typed-array.js";
import { arrayBufferDetached } from "./array-buffer.js";
import { declareHostOperation } from "./host-bridge.js";
import { decodeTypedArrayStorage } from "../snapshot/typed-array.js";

const constructors = { Int8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float64Array };
const scenarios = [
  'const value=new Type([NaN,Infinity,-Infinity,-0,-1,127,128,255,256,32767,32768,65535,65536,2147483647,2147483648,4294967295,4294967296,1.5,2.5,3.5,254.5,255.5]);return [Array.from(value),value.byteLength,value.BYTES_PER_ELEMENT,Type.BYTES_PER_ELEMENT]',
  'const value=Type.from([1,2],x=>x+256);value[0]={valueOf(){return -1}};Object.defineProperty(value,"1",{value:{valueOf(){return 3.5}}});return [Array.from(value),Array.from(Type.of(257,-1)),Object.getOwnPropertyDescriptor(value,"0")]',
  'const value=new Type([3,1,2]);return [Array.from(value.map(x=>x+0.5)),Array.from(value.filter(x=>x>1)),Array.from(value.toSorted()),Array.from(value.toReversed()),Array.from(value.with(1,258)),Array.from(value)]',
  'const value=new Type([1,2,3,4]);const part=value.subarray(1,3);part[0]=9;const copy=value.slice(1,3);value.copyWithin(2,0,1);value.fill(7,3);return [Array.from(value),Array.from(copy),part.buffer===value.buffer,copy.buffer!==value.buffer,Array.from(value.entries())]',
  'class Derived extends Type{};const value=new Derived([3,1,2]);return [value instanceof Derived,value instanceof Type,value.map(x=>x) instanceof Derived,value.toSorted() instanceof Derived,Object.prototype.toString.call(value),Object.getPrototypeOf(Type)===Object.getPrototypeOf(Float32Array),Type.prototype.map===Float32Array.prototype.map]',
  'class Derived extends Type{static get [Symbol.species](){return Uint8Array}};const value=new Derived([257.5,-1,3]);return [Array.from(value.slice()),Array.from(value.map(x=>x)),value.filter(x=>true) instanceof Uint8Array,Array.from(new Type(new Float32Array([1.5,-1])))]',
  'const size=Type.BYTES_PER_ELEMENT;const buffer=new ArrayBuffer(size*4,{maxByteLength:size*8});const fixed=new Type(buffer,size,2);const tracking=new Type(buffer,size);fixed[0]=7;buffer.resize(size*6);const grown=[fixed.length,tracking.length,tracking[0]];buffer.resize(size);const shrunk=[fixed.length,tracking.length];buffer.resize(size*4);const revived=[fixed.length,tracking.length];buffer.transfer();return [grown,shrunk,revived,fixed.length,tracking.length]',
  'const value=new Type([3,-0,0,NaN,2]);value.sort();const copy=structuredClone(value);return [Array.from(value),Array.from(copy),copy instanceof Type,copy.buffer!==value.buffer,Array.from(value.keys()),value.includes(NaN)]'
];

it.each(Object.keys(constructors).flatMap(name => scenarios.map(body => ({name, body}))))
  ("matches native $name: $body", async ({name, body}) => {
    const source = `const Type=${name};${body}`;
    const expected = Function(source)();
    expect(await run(source)).toMatchObject({ok:true,returnValue:expected});
  });

it.each(Object.entries(constructors))("preserves %s aliases across copy, snapshot and replay", (name, Native) => {
  const buffer = new ArrayBuffer(Native.BYTES_PER_ELEMENT * 4);
  const value = new Native(buffer, Native.BYTES_PER_ELEMENT, 2);
  value.set([7,3]);
  const original = {buffer,value,alias:value,bytes:new Uint8Array(buffer)};
  for (const route of ["copy", "snapshot", "replay"]) {
    let graph = original;
    for (let round = 0; round < 2; round++) {
      if (route === "copy") graph = deepCopyFromSandbox(deepCopyToSandbox(graph)) as typeof graph;
      else if (route === "replay") graph = decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(graph)))) as typeof graph;
      else {
        const source = "return 0";
        const saved = serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{graph}}],callStack:[],pendingPromises:[],moduleBindings:{}});
        const binding = restore(JSON.parse(JSON.stringify(saved)),{source}).currentScope.lookup("graph");
        if (!binding.found) throw new Error("Missing restored graph");
        graph = binding.value as typeof graph;
      }
      expect(graph.value.constructor.name).toBe(name);
      expect(graph.value).toBe(graph.alias);
      expect(graph.value.buffer).toBe(graph.buffer);
      expect(graph.bytes.buffer).toBe(graph.buffer);
      expect(graph.buffer).not.toBe(original.buffer);
      expect(graph.value.byteOffset).toBe(Native.BYTES_PER_ELEMENT);
      expect(Array.from(graph.value)).toEqual([7,3]);
    }
  }
});

it.each(Object.entries(constructors))("preserves %s resizable and detached view layouts", (_name, Native) => {
  for (const detached of [false,true]) {
    const width = Native.BYTES_PER_ELEMENT;
    const buffer = Reflect.construct(ArrayBuffer,[width*4,{maxByteLength:width*8}]) as ArrayBuffer;
    const value = new Native(buffer,width);
    typedArrayViewLayouts.set(value,{byteOffset:width});
    if (detached) structuredClone(buffer,{transfer:[buffer]});
    const graph = decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData({buffer,value})))) as {buffer:ArrayBuffer;value:typeof value};
    expect(graph.value.buffer).toBe(graph.buffer);
    expect(arrayBufferDetached(graph.buffer)).toBe(detached);
    if (detached) expect(()=>graph.value.values()).toThrow(TypeError);
    else {
      Reflect.apply(Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,"resize")!.value,graph.buffer,[width*6]);
      expect(graph.value.length).toBe(5);
    }
  }
});

it.each(Object.entries(constructors))("charges %s storage at its actual element width", (_name, Native) => {
  const width = Native.BYTES_PER_ELEMENT;
  const allowed = createNumericTypedArrayGlobal(new Budget({dataSize:width*16+1}),false,Native);
  expect((allowed.construct!([16]) as InstanceType<typeof Native>).byteLength).toBe(width*16);
  const denied = createNumericTypedArrayGlobal(new Budget({dataSize:width*16}),false,Native);
  expect(()=>denied.construct!([16])).toThrow(expect.objectContaining({code:"budgetExceeded",budget:"dataSize"}));
});

it.each(Object.keys(constructors))("restores a public %s run and transports host values", async name => {
  let calls = 0;
  const echo = declareHostOperation((value: unknown) => { calls++; return value; }, "re-issue");
  const source = `const value=await echo(new ${name}([3,7]));await 0;return [Array.from(value),value instanceof ${name}]`;
  const result = await run(source,{bindings:{echo}});
  expect(result).toMatchObject({ok:true,returnValue:[[3,7],true]});
  expect(calls).toBe(1);
  const snapshot = restoreRun(JSON.parse(await dump(result)),{source});
  expect(await run(source,{snapshot,bindings:{echo}})).toMatchObject({ok:true,returnValue:[[3,7],true]});
});

it("preserves Float64 precision, signed zero and raw NaN payload bytes", async () => {
  const source = "const value=new Float64Array([1+Number.EPSILON,-0,Number.MIN_VALUE]);return [value[0]===1+Number.EPSILON,Object.is(value[1],-0),value[2]===Number.MIN_VALUE]";
  expect(await run(source)).toMatchObject({ok:true,returnValue:[true,true,true]});
  const value = new Float64Array([NaN]);
  // Change a payload bit while preserving the native host's NaN representation.
  const bytes = new Uint8Array(value.buffer);
  const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  bytes[littleEndian ? 0 : 7] = 17;
  expect(Number.isNaN(value[0])).toBe(true);
  const copy = deepCopyFromSandbox(deepCopyToSandbox(value)) as Float64Array;
  const replay = decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(value)))) as Float64Array;
  for (const restored of [copy,replay]) expect(Array.from(new Uint8Array(restored.buffer))).toEqual(Array.from(bytes));
});

it.each(Object.entries(constructors))("validates %s snapshot dimensions using its element width", (name, Native) => {
  const width = Native.BYTES_PER_ELEMENT;
  expect(()=>decodeTypedArrayStorage({kind:"typedarray",arrayType:name,bytes:new Array(width).fill(0),byteOffset:0,length:2},()=>undefined))
    .toThrow(TypeError);
  if (width > 1)
    expect(()=>decodeTypedArrayStorage({kind:"typedarray",arrayType:name,bytes:new Array(width*2).fill(0),byteOffset:1,length:1},()=>undefined))
      .toThrow(TypeError);
});
