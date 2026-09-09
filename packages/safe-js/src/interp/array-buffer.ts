import { types } from "node:util";
import type { Budget } from "./budget.js";
import type { SandboxObject } from "./values.js";
import { cloneSharedArrayBufferStorage, isSandboxSharedArrayBuffer, sharedArrayBufferStorage, snapshotSharedArrayBufferStorage } from "./shared-array-buffer.js";

const readLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const readResizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;
const readMaxLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "maxByteLength")?.get;
const readDetached = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "detached")?.get;

export const arrayBufferPrototypes = new WeakMap<Budget, SandboxObject>();

export function isSandboxArrayBuffer(value: unknown): value is ArrayBuffer {
  return types.isArrayBuffer(value) && Object.getPrototypeOf(value) === ArrayBuffer.prototype;
}

export function arrayBufferLength(value: ArrayBufferLike): number {
  if (isSandboxSharedArrayBuffer(value)) return sharedArrayBufferStorage(value).byteLength;
  return Reflect.apply(readLength, value, []) as number;
}

export function arrayBufferDetached(value: ArrayBufferLike): boolean {
  if (isSandboxSharedArrayBuffer(value)) return false;
  if (readDetached !== undefined) return Reflect.apply(readDetached, value, []) as boolean;
  try {
    new Uint8Array(value, 0, 0);
    return false;
  } catch (error) {
    if (error instanceof TypeError) return true;
    throw error;
  }
}

export function arrayBufferOptions(value: ArrayBufferLike): { maxByteLength: number } | undefined {
  if (isSandboxSharedArrayBuffer(value)) {
    const storage=sharedArrayBufferStorage(value);
    return storage.growable?{maxByteLength:storage.maxByteLength}:undefined;
  }
  return readResizable !== undefined && Reflect.apply(readResizable, value, [])
    ? { maxByteLength: Reflect.apply(readMaxLength!, value, []) as number } : undefined;
}

export function copyArrayBufferStorage<T extends ArrayBufferLike>(value: T, state: { float32Buffers?: WeakMap<ArrayBufferLike, ArrayBufferLike>; sharedBufferSnapshots?: WeakMap<object, SharedArrayBuffer> }): T {
  state.float32Buffers ??= new WeakMap();
  let copy = state.float32Buffers.get(value);
  if (copy === undefined) {
    copy = isSandboxSharedArrayBuffer(value) ? state.sharedBufferSnapshots === undefined
      ? cloneSharedArrayBufferStorage(value) : snapshotSharedArrayBufferStorage(value,state.sharedBufferSnapshots)
      : Reflect.construct(ArrayBuffer, [arrayBufferLength(value), arrayBufferOptions(value)]) as ArrayBuffer;
    if (!isSandboxSharedArrayBuffer(value)) new Uint8Array(copy).set(new Uint8Array(value));
    state.float32Buffers.set(value, copy);
  }
  return copy as T;
}

export function arrayBufferDataProperties(value: ArrayBufferLike): Array<[string | symbol, PropertyDescriptor]> {
  return Reflect.ownKeys(value).map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor)) throw new TypeError("ArrayBuffer accessors cannot be copied as data.");
    return [key, descriptor];
  });
}
