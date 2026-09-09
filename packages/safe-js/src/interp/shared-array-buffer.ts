import { Budget } from "./budget.js";
import type { SandboxObject } from "./values.js";

export const sharedArrayBufferPrototypes = new WeakMap<Budget,SandboxObject>();

const readByteLength = Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype,"byteLength")!.get!;
const readMaxByteLength = Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype,"maxByteLength")?.get;
const readGrowable = Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype,"growable")?.get;
const cloneStorage = structuredClone;
// A block record deliberately does not retain any wrapper or its guest properties.
// Different wrappers can refer to the same native shared memory.
const sharedBlocks = new WeakMap<SharedArrayBuffer, object>();

export function isSandboxSharedArrayBuffer(value: unknown): value is SharedArrayBuffer {
  return typeof value === "object" && value !== null && sharedBlocks.has(value as SharedArrayBuffer);
}

export function createSharedArrayBufferStorage(length: number, maxByteLength: number | undefined, budget: Budget): SharedArrayBuffer {
  if (!Number.isSafeInteger(length) || length < 0 ||
      (maxByteLength !== undefined && (!Number.isSafeInteger(maxByteLength) || maxByteLength < length)))
    throw new RangeError("Invalid SharedArrayBuffer capacity.");
  if (maxByteLength !== undefined && readGrowable === undefined)
    throw new TypeError("Growable SharedArrayBuffer requires host runtime support.");
  budget.allocateArrayLength(maxByteLength ?? length);
  budget.provisionDataUsage(length + 1)();
  const buffer = Reflect.construct(SharedArrayBuffer,[length,
    maxByteLength === undefined ? undefined : {maxByteLength}]) as SharedArrayBuffer;
  sharedBlocks.set(buffer, {});
  return buffer;
}

export function sharedArrayBufferStorage(value: SharedArrayBuffer): {
  block: object; byteLength: number; maxByteLength: number; growable: boolean;
} {
  const block = sharedBlocks.get(value);
  if (block === undefined) throw new TypeError("Shared storage is not owned by the sandbox.");
  const byteLength = Reflect.apply(readByteLength,value,[]) as number;
  const growable = readGrowable !== undefined && Reflect.apply(readGrowable,value,[]) as boolean;
  return {block,byteLength,growable,
    maxByteLength: readMaxByteLength === undefined ? byteLength : Reflect.apply(readMaxByteLength,value,[]) as number};
}

export function cloneSharedArrayBufferStorage(value: SharedArrayBuffer): SharedArrayBuffer {
  const block = sharedBlocks.get(value);
  if (block === undefined) throw new TypeError("Shared storage is not owned by the sandbox.");
  const copy = cloneStorage(value);
  sharedBlocks.set(copy,block);
  return copy;
}

export function snapshotSharedArrayBufferStorage(value: SharedArrayBuffer, copies: WeakMap<object, SharedArrayBuffer>): SharedArrayBuffer {
  const storage=sharedArrayBufferStorage(value);
  const existing=copies.get(storage.block);
  if (existing !== undefined) return cloneSharedArrayBufferStorage(existing);
  const copy=createSharedArrayBufferStorage(storage.byteLength,storage.growable?storage.maxByteLength:undefined,new Budget());
  new Uint8Array(copy).set(new Uint8Array(value));
  copies.set(storage.block,copy);
  return copy;
}
