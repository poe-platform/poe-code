import type { Budget } from "../interp/budget.js";
import { cloneSharedArrayBufferStorage, createSharedArrayBufferStorage, isSandboxSharedArrayBuffer, sharedArrayBufferStorage } from "../interp/shared-array-buffer.js";

export type SharedArrayBufferData<TReference> = {kind:"sharedarraybuffer"} & (
  {bytes:number[];maxByteLength?:number} | {block:TReference}
);

export function encodeSharedArrayBufferStorage<TReference>(
  value: SharedArrayBuffer, id: number, blocks: WeakMap<object,number>, reference: (id:number)=>TReference
): SharedArrayBufferData<TReference> {
  const storage = sharedArrayBufferStorage(value);
  const existing = blocks.get(storage.block);
  if (existing !== undefined) return {kind:"sharedarraybuffer",block:reference(existing)};
  blocks.set(storage.block,id);
  return {kind:"sharedarraybuffer",bytes:Array.from(new Uint8Array(value)),
    ...(storage.growable ? {maxByteLength:storage.maxByteLength} : {})};
}

export function decodeSharedArrayBufferStorage(
  value: Record<string,unknown>, resolve:(reference:unknown)=>unknown, budget:Budget
): SharedArrayBuffer {
  const inline = Object.hasOwn(value,"bytes");
  if (value.kind !== "sharedarraybuffer" || inline === Object.hasOwn(value,"block") ||
      Object.hasOwn(value,"detached")) throw new TypeError("Invalid shared backing storage.");
  if (!inline) {
    if (Object.hasOwn(value,"maxByteLength")) throw new TypeError("Shared references cannot redefine capacity.");
    const target = resolve(value.block);
    if (!isSandboxSharedArrayBuffer(target)) throw new TypeError("Invalid shared backing reference.");
    budget.provisionDataUsage(1)();
    return cloneSharedArrayBufferStorage(target);
  }
  if (!Array.isArray(value.bytes)) throw new TypeError("Invalid shared buffer bytes.");
  for (const byte of value.bytes) {
    budget.visitNode();
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw new TypeError("Invalid shared buffer byte.");
  }
  const maximum = Object.hasOwn(value,"maxByteLength") ? value.maxByteLength : undefined;
  if (Object.hasOwn(value,"maxByteLength") &&
      (!Number.isSafeInteger(maximum) || (maximum as number) < value.bytes.length))
    throw new TypeError("Invalid shared buffer maximum length.");
  const buffer = createSharedArrayBufferStorage(value.bytes.length,maximum as number | undefined,budget);
  new Uint8Array(buffer).set(value.bytes);
  return buffer;
}
