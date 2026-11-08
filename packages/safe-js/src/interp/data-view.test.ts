import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { deepCopyToSandbox, deepCopyFromSandbox, isSandboxClosure, measureSandboxData } from "./values.js";
import { encodeReplayData, decodeReplayData } from "../snapshot/replay-data.js";
import { serialize } from "../snapshot/serialize.js";
import { restore as restoreRuntime } from "../snapshot/restore.js";
import { declareHostOperation } from "./host-bridge.js";
import { digestHostCallArguments } from "./host-call.js";
import { decodeDataViewStorage } from "../snapshot/data-view.js";
import { Budget } from "./budget.js";

it.each([
  'const buffer=new ArrayBuffer(8);const view=new DataView(buffer,2,4);return [view.buffer===buffer,view.byteOffset,view.byteLength,ArrayBuffer.isView(view),view instanceof DataView]',
  'const buffer=new ArrayBuffer(8);const view=new DataView(buffer);view.setUint32(0,0x12345678);view.setUint32(4,0x12345678,true);return [Array.from(new Uint8Array(buffer)),view.getUint32(0),view.getUint32(4,true)]',
  'const view=new DataView(new ArrayBuffer(8));view.setInt8(0,-1);view.setInt16(1,-32768,true);view.setInt32(3,-2147483648);return [view.getInt8(0),view.getUint8(0),view.getInt16(1,true),view.getInt32(3)]',
  'const view=new DataView(new ArrayBuffer(16));view.setFloat32(1,Math.PI,true);view.setFloat64(5,-0);return [view.getFloat32(1,true),Object.is(view.getFloat64(5),-0)]',
  'const view=new DataView(new ArrayBuffer(2));const errors=[];try{view.getUint32(0)}catch(error){errors.push(error.name)}try{view.setUint16(1,123)}catch(error){errors.push(error.name)}return [errors,view.getUint16(0)]',
  'const buffer=new ArrayBuffer(8,{maxByteLength:16});const tracking=new DataView(buffer,2);const fixed=new DataView(buffer,2,4);buffer.resize(3);let error;try{fixed.byteLength}catch(caught){error=caught.name}return [tracking.byteLength,error]'
])("matches native DataView behavior: %s", async source => {
  const expected=Function(source)();
  expect(await run(source)).toMatchObject({ok:true,returnValue:expected});
});

it("supports BigInt getters and setters without Number coercion", async () => {
  const source='const view=new DataView(new ArrayBuffer(16));view.setBigInt64(0,-1n,true);view.setBigUint64(8,"18446744073709551615");let error;try{view.setBigInt64(0,1)}catch(caught){error=caught.name}return [String(view.getBigInt64(0,true)),String(view.getBigUint64(8)),error]';
  expect(await run(source)).toMatchObject({ok:true,returnValue:Function(source)()});
});

it("supports Float16 rounding and endian conversion without native Float16 APIs", async () => {
  expect(await run('const view=new DataView(new ArrayBuffer(8));view.setFloat16(1,1+2**-11,true);view.setFloat16(3,-0);view.setFloat16(5,65520);return [view.getFloat16(1,true),view.getUint16(1,true),Object.is(view.getFloat16(3),-0),view.getFloat16(5)]'))
    .toMatchObject({ok:true,returnValue:[1,0x3c00,true,Infinity]});
});

it("preserves mixed backing aliases in data copying and replay", () => {
  const buffer=new ArrayBuffer(8);
  const view=new DataView(buffer,1,4);
  view.setUint32(0,0x12345678);
  const graph={buffer,view,bytes:new Uint8Array(buffer),alias:view};
  const copied=deepCopyToSandbox(graph);
  for (const value of [deepCopyFromSandbox(copied),decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(copied))))] as Array<typeof graph>) {
    expect(value.view).toBeInstanceOf(DataView);
    expect(value.view).toBe(value.alias);
    expect(value.view.buffer).toBe(value.buffer);
    expect(value.bytes.buffer).toBe(value.buffer);
    expect(value.buffer).not.toBe(buffer);
    expect(value.view.byteOffset).toBe(1);
    expect(value.view.getUint32(0)).toBe(0x12345678);
  }
});

it("preserves intrinsic methods, shared buffers and accessors through public snapshots", async () => {
  const source='const buffer=new ArrayBuffer(8);const view=new DataView(buffer,1,4);const get=view.getUint16;Object.defineProperty(view,"extra",{get(){return 7}});view.setUint16(0,1234);await 0;return [view.buffer===buffer,get===view.getUint16,get.call(view,0),view.extra]';
  const result=await run(source);
  expect(result).toMatchObject({ok:true,returnValue:[true,true,1234,7]});
  const snapshot=restore(JSON.parse(await dump(result)),{source});
  expect(await run(source,{snapshot})).toMatchObject({ok:true,returnValue:[true,true,1234,7]});
});

it("preserves fixed and length-tracking layouts when snapshotted out of bounds", async () => {
  const source='const buffer=new ArrayBuffer(8,{maxByteLength:16});const fixed=new DataView(buffer,2,4);const tracking=new DataView(buffer,2);buffer.resize(1);return ()=>{buffer.resize(12);return [fixed.byteOffset,fixed.byteLength,tracking.byteLength,fixed.buffer===tracking.buffer]}';
  let read=(await run(source)).returnValue;
  for (let round=0;round<2;round++) {
    const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{read}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const binding=restoreRuntime(JSON.parse(JSON.stringify(saved)),{source}).currentScope.lookup("read");
    if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("Missing restored closure");
    expect(await binding.value.call([])).toEqual([2,4,10,true]);
    read=binding.value;
  }
});

it.each([
  'const trace=[];const buffer=new ArrayBuffer(4);const view=new DataView(buffer);try{view.setUint16({valueOf(){trace.push("offset");return 0}},{valueOf(){trace.push("value");buffer.transfer();return 1}})}catch(error){trace.push(error.name)}return trace',
  'const trace=[];try{DataView.prototype.getUint8.call({}, {valueOf(){trace.push("offset");return 0}})}catch(error){trace.push(error.name)}return trace',
  'const trace=[];try{new DataView({}, {valueOf(){trace.push("offset");return 0}})}catch(error){trace.push(error.name)}return trace',
  'const trace=[];try{new DataView(new ArrayBuffer(1),2,{valueOf(){trace.push("length");return 0}})}catch(error){trace.push(error.name)}return trace',
  'const buffer=new ArrayBuffer(4,{maxByteLength:8});const view=new DataView(buffer);view.setUint16(2,{valueOf(){buffer.resize(3);return 123}});return 1',
  'class View extends DataView{};const view=new View(new ArrayBuffer(8));view.setUint32(0,7);return [view instanceof View,view instanceof DataView,Object.prototype.toString.call(view),view.getUint32(0)]',
  'const view=new DataView(new ArrayBuffer(4));Object.defineProperty(view,"buffer",{get(){throw 1}});Object.defineProperty(view,"byteLength",{value:0});view.setUint16(0,123);view[0]=9;return [view.getUint16(0),view[0],Object.keys(view)]',
  'const buffer=new ArrayBuffer(4);const view=new DataView(buffer);const copy=structuredClone([view,buffer]);return [copy[0].buffer===copy[1],copy[0].buffer!==buffer,copy[0].byteLength]',
  'class View extends DataView{};const view=new View(new ArrayBuffer(4));Object.defineProperty(view,"extra",{get(){throw 1}});const copy=structuredClone(view);return [copy instanceof View,copy instanceof DataView,Object.keys(copy)]'
])("preserves native brands, coercion and cloning: %s", async source => {
  const wrapped=`try{${source}}catch(error){return error.name}`;
  expect(await run(wrapped)).toMatchObject({ok:true,returnValue:Function(wrapped)()});
});

it.each(["getUint8(0)","getUint16(-1)","setUint16(0,1)","byteLength","byteOffset"])("handles detached DataView access %s", async operation => {
  const source=`const buffer=new ArrayBuffer(4);const view=new DataView(buffer);buffer.transfer();try{return view.${operation}}catch(error){return [error.name,view.buffer===buffer]}`;
  expect(await run(source)).toMatchObject({ok:true,returnValue:Function(source)()});
});

it.each(["buffer.transfer()", "buffer.resize(1)"])("rejects structured cloning invalid views after %s", operation =>
  expect(run(`const buffer=new ArrayBuffer(4,{maxByteLength:8});const view=new DataView(buffer,2,2);${operation};try{structuredClone(view);return "accepted"}catch(error){return [error.name,error.code]}`))
    .resolves.toMatchObject({ok:true,returnValue:["DataCloneError",25]}));

it("round trips DataView through an actual host operation", async () => {
  let calls=0;
  const echo=declareHostOperation((value: {view:DataView;buffer:ArrayBuffer}) => {
    expect(value.view).toBeInstanceOf(DataView);
    expect(value.view.buffer).toBe(value.buffer);
    expect(value.view.getUint16(0,true)).toBe(1234);
    calls++;
    return value;
  },"re-issue");
  const source='const buffer=new ArrayBuffer(8);const view=new DataView(buffer,1,4);view.setUint16(0,1234,true);const result=await echo({view,buffer});return [result.view instanceof DataView,result.view.buffer===result.buffer,result.view.getUint16(0,true)]';
  expect(await run(source,{bindings:{echo}})).toMatchObject({ok:true,returnValue:[true,true,1234]});
  expect(calls).toBe(1);
});

it("includes backing bytes and offsets in host-call identities", () => {
  const buffer=new ArrayBuffer(4);
  const a=new DataView(buffer,0,2), b=new DataView(buffer,1,2);
  expect(digestHostCallArguments([a])).not.toBe(digestHostCallArguments([b]));
  const previous=digestHostCallArguments([a]);
  a.setUint8(0,1);
  expect(digestHostCallArguments([a])).not.toBe(previous);
});

it("accounts for backing storage once across mixed aliases", () => {
  const buffer=new ArrayBuffer(100);
  const view=new DataView(buffer,50,1);
  expect(measureSandboxData([view])).toBe(102);
  expect(measureSandboxData([view,buffer])).toBe(102);
  expect(measureSandboxData([view,new Uint8Array(buffer)])).toBe(103);
});

it.each([{byteOffset:-1,byteLength:0},{byteOffset:0,byteLength:1.5},{byteOffset:0,byteLength:1,lengthTracking:true},{byteOffset:0,byteLength:0,lengthTracking:false}])
  ("rejects invalid snapshot layout %j", layout => expect(()=>decodeDataViewStorage({kind:"dataview",buffer:1,...layout},()=>new ArrayBuffer(8))).toThrow(TypeError));

it("bounds imported backing capacity and rejects shared storage", async () => {
  const view=new DataView(new ArrayBuffer(32));
  await expect(run('return view.byteLength',{bindings:{view},budget:new Budget({arrayLength:16})}))
    .rejects.toMatchObject({code:"budgetExceeded",budget:"arrayLength"});
  expect(()=>deepCopyToSandbox(new DataView(new SharedArrayBuffer(8)))).toThrow(TypeError);
});

it("restores detached views with their backing aliases", async () => {
  const source='const buffer=new ArrayBuffer(4);const view=new DataView(buffer);buffer.transfer();return ()=>{try{return view.byteLength}catch(error){return [error.name,view.buffer===buffer,buffer.detached]}}';
  const read=(await run(source)).returnValue;
  const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{read}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const binding=restoreRuntime(JSON.parse(JSON.stringify(saved)),{source}).currentScope.lookup("read");
  if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("Missing restored closure");
  expect(await binding.value.call([])).toEqual(["TypeError",true,true]);
});

it("preserves property descriptors and buffer cycles in replay data", () => {
  const buffer=new ArrayBuffer(4);
  const view=new DataView(buffer);
  Object.defineProperty(buffer,"view",{value:view});
  Object.defineProperty(view,"hidden",{value:7});
  const key=Symbol("data-view-test");
  Object.defineProperty(view,key,{value:view});
  Object.preventExtensions(view);
  const graph=decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData({view,key})))) as {view:DataView;key:symbol};
  const copied=graph.view;
  expect(Object.getOwnPropertyDescriptor(copied,"hidden")).toEqual({value:7,writable:false,configurable:false,enumerable:false});
  expect(graph.key).not.toBe(key);
  expect(graph.key.description).toBe("data-view-test");
  expect(Object.getOwnPropertyDescriptor(copied,graph.key)?.value).toBe(copied);
  expect(Object.getOwnPropertyDescriptor(copied.buffer,"view")?.value).toBe(copied);
  expect(Object.isExtensible(copied)).toBe(false);
});

it.each([
  [0,0],[-0,0x8000],[2**-24,1],[2**-25,0],[3*2**-25,2],
  [2**-14,0x400],[1,0x3c00],[1+2**-11,0x3c00],[1+3*2**-11,0x3c02],
  [65504,0x7bff],[65520,0x7c00],[-Infinity,0xfc00],[Infinity,0x7c00]
])("encodes binary16 boundary %s as %s", async (value,bits) => {
  expect(await run('const view=new DataView(new ArrayBuffer(4));view.setFloat16(0,value);view.setFloat16(2,value,true);return [view.getUint16(0),view.getUint16(2,true),Object.is(view.getFloat16(0),Math.f16round(value))]',{bindings:{value}}))
    .toMatchObject({ok:true,returnValue:[bits,bits,true]});
});

it("provides every standard DataView method and descriptor", async () => {
  const types=["Int8","Uint8","Int16","Uint16","Int32","Uint32","Float16","Float32","Float64","BigInt64","BigUint64"];
  const methods=types.flatMap(type=>["get"+type,"set"+type]);
  expect(await run(`return ${JSON.stringify(methods)}.map(name=>{const d=Object.getOwnPropertyDescriptor(DataView.prototype,name);return [d.value.name,d.value.length,d.writable,d.enumerable,d.configurable]})`))
    .toMatchObject({ok:true,returnValue:methods.map(name=>[name,name.startsWith("set")?2:1,true,false,true])});
});
