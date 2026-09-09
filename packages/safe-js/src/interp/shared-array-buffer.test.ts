import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import {
  cloneSharedArrayBufferStorage, createSharedArrayBufferStorage,
  isSandboxSharedArrayBuffer, sharedArrayBufferStorage
} from "./shared-array-buffer.js";

it("tracks distinct wrappers for a single shared data block", () => {
  const original = createSharedArrayBufferStorage(4, undefined, new Budget());
  const clone = cloneSharedArrayBufferStorage(original);
  const again = cloneSharedArrayBufferStorage(clone);
  expect(clone).not.toBe(original);
  expect(again).not.toBe(clone);
  expect(sharedArrayBufferStorage(clone).block).toBe(sharedArrayBufferStorage(original).block);
  expect(sharedArrayBufferStorage(again).block).toBe(sharedArrayBufferStorage(original).block);
  new Uint8Array(clone)[0] = 7;
  expect(new Uint8Array(original)[0]).toBe(7);
  expect(new Uint8Array(again)[0]).toBe(7);
});

it("does not merge distinct blocks with equal bytes", () => {
  const first = createSharedArrayBufferStorage(4, undefined, new Budget());
  const second = createSharedArrayBufferStorage(4, undefined, new Budget());
  expect(sharedArrayBufferStorage(first).block).not.toBe(sharedArrayBufferStorage(second).block);
});

it("retains growth metadata through shared clones", () => {
  const original = createSharedArrayBufferStorage(4, 8, new Budget());
  const clone = cloneSharedArrayBufferStorage(original);
  Reflect.apply(Reflect.get(SharedArrayBuffer.prototype,"grow"),clone,[8]);
  expect(sharedArrayBufferStorage(original)).toMatchObject({byteLength:8,maxByteLength:8,growable:true});
  expect(sharedArrayBufferStorage(clone)).toMatchObject({byteLength:8,maxByteLength:8,growable:true});
});

it("does not admit untracked host storage or proxy wrappers", () => {
  const external = new SharedArrayBuffer(4);
  const internal = createSharedArrayBufferStorage(4, undefined, new Budget());
  for (const value of [external,new ArrayBuffer(4),{},new Proxy(internal,{})]) {
    expect(isSandboxSharedArrayBuffer(value)).toBe(false);
    expect(() => sharedArrayBufferStorage(value as SharedArrayBuffer)).toThrow(TypeError);
    expect(() => cloneSharedArrayBufferStorage(value as SharedArrayBuffer)).toThrow(TypeError);
  }
  expect(isSandboxSharedArrayBuffer(internal)).toBe(true);
});

it("reads metadata without invoking wrapper accessors", () => {
  const buffer = createSharedArrayBufferStorage(4, 8, new Budget());
  Object.defineProperty(buffer,"byteLength",{get(){throw new Error("guest getter");}});
  Object.defineProperty(buffer,"maxByteLength",{value:99});
  expect(sharedArrayBufferStorage(buffer)).toMatchObject({byteLength:4,maxByteLength:8,growable:true});
  const clone = cloneSharedArrayBufferStorage(buffer);
  expect(Reflect.ownKeys(clone)).toEqual([]);
  expect(sharedArrayBufferStorage(clone).block).toBe(sharedArrayBufferStorage(buffer).block);
});

it.each([
  [-1,undefined], [1.5,undefined], [Infinity,undefined], [NaN,undefined],
  [4,3], [4,4.5], [4,Infinity], [4,-1]
])("rejects invalid internal storage dimensions %s/%s", (length,maximum) => {
  expect(() => createSharedArrayBufferStorage(length!,maximum,new Budget())).toThrow(RangeError);
});

it("checks maximum allocation capacity before creating growable storage", () => {
  expect(() => createSharedArrayBufferStorage(4,8,new Budget({arrayLength:7})))
    .toThrow(expect.objectContaining({code:"budgetExceeded",budget:"arrayLength"}));
});

it("checks retained byte capacity before allocating shared storage", () => {
  expect(() => createSharedArrayBufferStorage(4,undefined,new Budget({dataSize:4})))
    .toThrow(expect.objectContaining({code:"budgetExceeded",budget:"dataSize"}));
});
