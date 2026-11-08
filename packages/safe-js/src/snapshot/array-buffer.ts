import { arrayBufferDetached, arrayBufferLength, arrayBufferOptions, isSandboxArrayBuffer } from "../interp/array-buffer.js";
import { typedArrayStorage, isNumericTypedArray } from "../interp/typed-array.js";
import { getSandboxPrototype, hasExplicitSandboxPrototype } from "../interp/object-model.js";
import { serializePropertyDescriptors } from "./property-descriptors.js";
import { capturePrivateElements, type GuestObjectState } from "./guest-heap.js";
import { privateElements } from "../interp/private-state.js";
import type { Budget } from "../interp/budget.js";

export type ArrayBufferData<TReference> = { kind: "arraybuffer" } & ({ bytes: number[]; maxByteLength?: number; detached?: true } | { buffer: TReference });

export function captureArrayBufferState<T>(value: ArrayBufferLike, encode: (value: unknown) => T): GuestObjectState<T> {
  return { properties: serializePropertyDescriptors(value, encode),
    ...(privateElements.has(value) ? { privateElements: capturePrivateElements(privateElements.get(value)!, encode) } : {}),
    ...(hasExplicitSandboxPrototype(value) ? { prototype: encode(getSandboxPrototype(value)) } : {}) };
}

export function encodeArrayBufferStorage<T>(value: ArrayBuffer, id: number, buffers: WeakMap<ArrayBuffer, number>, reference: (id: number) => T): ArrayBufferData<T> {
  arrayBufferLength(value);
  const existing = buffers.get(value);
  if (existing === undefined) buffers.set(value, id);
  const detached = arrayBufferDetached(value);
  return { kind: "arraybuffer", ...(existing === undefined ? {
    bytes: detached ? [] : Array.from(new Uint8Array(value)), ...arrayBufferOptions(value),
    ...(detached ? { detached: true as const } : {})
  } : { buffer: reference(existing) }) };
}

export function validateArrayBufferStorage(value: Record<string, unknown>): void {
  if (Object.hasOwn(value, "detached") && (value.detached !== true || !Array.isArray(value.bytes) ||
      value.bytes.length !== 0 || (Object.hasOwn(value, "maxByteLength") && value.maxByteLength !== 0)))
    throw new TypeError("Invalid detached ArrayBuffer storage.");
  if (Object.hasOwn(value, "bytes") === Object.hasOwn(value, "buffer"))
    throw new TypeError("ArrayBuffer requires one backing storage description.");
  if (Object.hasOwn(value, "bytes") && (!Array.isArray(value.bytes) ||
      value.bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)))
    throw new TypeError("Invalid ArrayBuffer bytes.");
  if (Object.hasOwn(value, "maxByteLength") && (!Array.isArray(value.bytes) ||
      !Number.isSafeInteger(value.maxByteLength) || Number(value.maxByteLength) < value.bytes.length))
    throw new TypeError("Invalid ArrayBuffer maximum length.");
}

export function decodeArrayBufferStorage(value: Record<string, unknown>, resolve: (reference: unknown) => unknown, budget?: Budget, deferredDetachment?: Array<() => void>): ArrayBuffer {
  validateArrayBufferStorage(value);
  if (Array.isArray(value.bytes)) {
    budget?.allocateArrayLength(Number(value.maxByteLength ?? value.bytes.length));
    const buffer = Reflect.construct(ArrayBuffer, [value.bytes.length,
      Object.hasOwn(value, "maxByteLength") ? { maxByteLength: value.maxByteLength } : undefined]) as ArrayBuffer;
    if (Object.hasOwn(value, "maxByteLength") && arrayBufferOptions(buffer)?.maxByteLength !== value.maxByteLength)
      throw new TypeError("Resizable ArrayBuffer restoration is not supported by this host.");
    new Uint8Array(buffer).set(value.bytes);
    if (value.detached === true) {
      const detach = () => {
        budget?.visitNode();
        structuredClone(buffer, { transfer: [buffer] });
        if (!arrayBufferDetached(buffer)) throw new TypeError("Restored ArrayBuffer could not be detached.");
      };
      if (deferredDetachment === undefined) detach();
      else deferredDetachment.push(detach);
    }
    return buffer;
  }
  const referenced = resolve(value.buffer);
  if (isSandboxArrayBuffer(referenced)) return referenced;
  if (isNumericTypedArray(referenced)) {
    const buffer=typedArrayStorage(referenced).buffer;
    if (isSandboxArrayBuffer(buffer)) return buffer;
  }
  throw new TypeError("Invalid ArrayBuffer backing reference.");
}
