import { expect, it } from "vitest";
import { Budget } from "../interp/budget.js";
import { cloneSharedArrayBufferStorage, createSharedArrayBufferStorage, sharedArrayBufferStorage } from "../interp/shared-array-buffer.js";
import { decodeSharedArrayBufferStorage, encodeSharedArrayBufferStorage } from "./shared-array-buffer.js";

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
