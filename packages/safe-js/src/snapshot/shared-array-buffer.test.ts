import { expect, it } from "vitest";
import { Budget } from "../interp/budget.js";
import { cloneSharedArrayBufferStorage, createSharedArrayBufferStorage, sharedArrayBufferStorage } from "../interp/shared-array-buffer.js";
import { decodeSharedArrayBufferStorage, encodeSharedArrayBufferStorage } from "./shared-array-buffer.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";
import { encodeReplayData, decodeReplayData } from "./replay-data.js";
import { restoreDataView } from "../interp/data-view.js";
import { restoreTypedArrayView } from "../interp/typed-array.js";

it.each([false,true])("preserves shared aliases through replay transport (view first: %s)", viewFirst => {
  const original=createSharedArrayBufferStorage(4,undefined,new Budget());
  const clone=cloneSharedArrayBufferStorage(original);
  const view=new Uint8Array(clone);
  view[0]=7;
  const values=viewFirst?[view,original,clone]:[original,clone,view];
  const restored=decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(values))));
  if (!Array.isArray(restored)) throw new Error("Missing replay array");
  const a=restored[viewFirst?1:0] as SharedArrayBuffer;
  const b=restored[viewFirst?2:1] as SharedArrayBuffer;
  const c=restored[viewFirst?0:2] as Uint8Array;
  expect(a).not.toBe(b);
  expect(c.buffer).toBe(b);
  c[0]=9;
  expect(new Uint8Array(a)[0]).toBe(9);
  expect(new Uint8Array(original)[0]).toBe(7);
});

it("round-trips shared wrappers and view aliases through actual snapshot dispatch", () => {
  const original=createSharedArrayBufferStorage(4,undefined,new Budget());
  const clone=cloneSharedArrayBufferStorage(original);
  Object.defineProperty(original,"peer",{value:clone});
  Object.defineProperty(clone,"peer",{value:original});
  const view=new Uint8Array(clone);
  view[0]=7;
  const source="return 0";
  const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{values:[original,clone,view]}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const restored=restore(JSON.parse(JSON.stringify(saved)),{source}).currentScope.lookup("values");
  if (!restored.found||!Array.isArray(restored.value)) throw new Error("Missing restored aliases");
  const [a,b,c]=restored.value as [SharedArrayBuffer,SharedArrayBuffer,Uint8Array];
  expect(a).not.toBe(b);
  expect(Object.getOwnPropertyDescriptor(a,"peer")?.value).toBe(b);
  expect(Object.getOwnPropertyDescriptor(b,"peer")?.value).toBe(a);
  expect(c.buffer).toBe(b);
  c[0]=9;
  expect(new Uint8Array(a)[0]).toBe(9);
  expect(new Uint8Array(original)[0]).toBe(7);
});

it("preserves shared growth, tracking views and wrapper properties in replay", () => {
  const original=createSharedArrayBufferStorage(4,8,new Budget());
  const clone=cloneSharedArrayBufferStorage(original);
  const tracking=restoreDataView(clone,0);
  const fixed=restoreTypedArrayView(original,0,4,undefined,Uint8Array);
  Object.defineProperty(original,"alias",{value:clone,enumerable:false,writable:false,configurable:true});
  Object.preventExtensions(original);
  const restored=decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData([original,clone,tracking,fixed]))));
  if (!Array.isArray(restored)) throw new Error("Missing replay array");
  const [a,b,c,d]=restored as [SharedArrayBuffer,SharedArrayBuffer,DataView,Uint8Array];
  expect(Object.getOwnPropertyDescriptor(a,"alias")).toEqual({value:b,enumerable:false,writable:false,configurable:true});
  expect(Object.isExtensible(a)).toBe(false);
  a.grow(8);
  expect(b.byteLength).toBe(8);
  expect(c.buffer).toBe(b);
  expect(c.byteLength).toBe(8);
  expect(d.buffer).toBe(a);
  expect(d.length).toBe(4);
  expect(original.byteLength).toBe(4);
});

it.each([1,2])("rejects cyclic shared block references of length %s in replay", length => {
  const nodes=Array.from({length},(_,id)=>({kind:"sharedarraybuffer",block:{tag:"ref",id:(id+1)%length},properties:{},extensible:true}));
  expect(()=>decodeReplayData({root:{tag:"ref",id:0},nodes})).toThrow(TypeError);
});

it.each([1,2])("rejects cyclic shared block references of length %s in snapshot restore", length => {
  const source="return 0";
  const buffers=Array.from({length},()=>createSharedArrayBufferStorage(4,undefined,new Budget()));
  const saved=JSON.parse(JSON.stringify(serialize({source,currentAstNodeId:1,
    scopeChain:[{id:"external",bindings:{buffers}}],callStack:[],pendingPromises:[],moduleBindings:{}})));
  const nodes=Object.entries(saved.heap as Record<string,Record<string,unknown>>)
    .filter(([,node])=>node.kind==="sharedarraybuffer");
  expect(nodes).toHaveLength(length);
  for (let index=0;index<nodes.length;index++) {
    const node=nodes[index][1];
    delete node.bytes;
    node.block={kind:"ref",id:Number(nodes[(index+1)%nodes.length][0])};
  }
  expect(()=>restore(saved,{source})).toThrow(TypeError);
});

it("encodes shared bytes once while retaining distinct wrapper references", () => {
  const original = createSharedArrayBufferStorage(4,8,new Budget());
  const clone = cloneSharedArrayBufferStorage(original);
  new Uint8Array(original)[0]=7;
  const blocks = new WeakMap<object,number>();
  expect(encodeSharedArrayBufferStorage(original,1,blocks,id=>({id}))).toEqual({
    kind:"sharedarraybuffer",bytes:[7,0,0,0],maxByteLength:8
  });
  expect(encodeSharedArrayBufferStorage(clone,2,blocks,id=>({id}))).toEqual({
    kind:"sharedarraybuffer",block:{id:1}
  });
});

it("restores fixed shared storage", () => {
  const restored = decodeSharedArrayBufferStorage({kind:"sharedarraybuffer",bytes:[7,0]},()=>undefined,new Budget());
  expect(sharedArrayBufferStorage(restored)).toMatchObject({byteLength:2,maxByteLength:2,growable:false});
  expect(Array.from(new Uint8Array(restored))).toEqual([7,0]);
});

it("restores distinct wrappers with aliased storage and growth metadata", () => {
  const first = decodeSharedArrayBufferStorage({kind:"sharedarraybuffer",bytes:[7,0,0,0],maxByteLength:8},()=>undefined,new Budget());
  const second = decodeSharedArrayBufferStorage({kind:"sharedarraybuffer",block:{id:1}},()=>first,new Budget());
  expect(second).not.toBe(first);
  expect(sharedArrayBufferStorage(second).block).toBe(sharedArrayBufferStorage(first).block);
  new Uint8Array(second)[1]=9;
  Reflect.apply(Reflect.get(SharedArrayBuffer.prototype,"grow"),second,[8]);
  expect(Array.from(new Uint8Array(first))).toEqual([7,9,0,0,0,0,0,0]);
});

it.each([
  {}, {bytes:[0],block:1}, {bytes:[-1]}, {bytes:[256]}, {bytes:[1.5]},
  {bytes:[0],maxByteLength:0}, {bytes:[],maxByteLength:Infinity},
  {bytes:[],detached:true}, {block:1,maxByteLength:8}, {bytes:"00"}
])("rejects malformed shared storage %j", input => {
  expect(()=>decodeSharedArrayBufferStorage({kind:"sharedarraybuffer",...input},()=>undefined,new Budget())).toThrow(TypeError);
});

it("rejects references to ordinary or unregistered host storage", () => {
  for (const buffer of [new ArrayBuffer(4),new SharedArrayBuffer(4),{},undefined])
    expect(()=>decodeSharedArrayBufferStorage({kind:"sharedarraybuffer",block:1},()=>buffer,new Budget())).toThrow(TypeError);
});

it("checks allocation limits when restoring shared storage", () => {
  expect(()=>decodeSharedArrayBufferStorage({kind:"sharedarraybuffer",bytes:[0],maxByteLength:8},()=>undefined,new Budget({arrayLength:4})))
    .toThrow(expect.objectContaining({budget:"arrayLength"}));
});

it("rejects sparse byte arrays instead of treating holes as zero", () => {
  expect(()=>decodeSharedArrayBufferStorage({kind:"sharedarraybuffer",bytes:new Array(2)},()=>undefined,new Budget()))
    .toThrow(TypeError);
});

it("does not coalesce independent buffers containing equal bytes", () => {
  const blocks = new WeakMap<object,number>();
  for (const id of [1,2]) {
    const buffer = createSharedArrayBufferStorage(2,undefined,new Budget());
    expect(encodeSharedArrayBufferStorage(buffer,id,blocks,key=>({id:key}))).toEqual({kind:"sharedarraybuffer",bytes:[0,0]});
  }
});
