import { typedArrayProperties, typedArrayStorage, typedArrayViewLayouts, restoreTypedArrayView, isNumericTypedArray, isTypedArrayIndex, numericTypedArrayConstructors, type NumericTypedArray, type NumericTypedArrayConstructor } from "../interp/typed-array.js";
import { getSandboxPrototype, hasExplicitSandboxPrototype } from "../interp/object-model.js";
import { restorePropertyDescriptors, serializePropertyDescriptors } from "./property-descriptors.js";
import { capturePrivateElements, type GuestObjectState } from "./guest-heap.js";
import { privateElements } from "../interp/private-state.js";
import { arrayBufferDetached, arrayBufferOptions, isSandboxArrayBuffer } from "../interp/array-buffer.js";
import { isSandboxSharedArrayBuffer } from "../interp/shared-array-buffer.js";
import type { Budget } from "../interp/budget.js";

export function captureTypedArrayState<T>(value: NumericTypedArray, encode: (value: unknown) => T): GuestObjectState<T> {
  const metadata = Object.defineProperties(Object.create(null), Object.fromEntries(typedArrayProperties(value)));
  if (!Object.isExtensible(value)) Object.preventExtensions(metadata);
  return { properties: serializePropertyDescriptors(metadata, encode),
    ...(privateElements.has(value) ? { privateElements: capturePrivateElements(privateElements.get(value)!, encode) } : {}),
    ...(hasExplicitSandboxPrototype(value) ? { prototype: encode(getSandboxPrototype(value)) } : {}) };
}

export function restoreTypedArrayProperties<T>(value: NumericTypedArray, state: GuestObjectState<T>, decode: (value: T) => unknown): void {
  const metadata = Object.create(null) as object;
  restorePropertyDescriptors(metadata, state.properties, decode);
  const descriptors = Object.getOwnPropertyDescriptors(metadata);
  if (Object.keys(descriptors).some(isTypedArrayIndex)) throw new TypeError("Float32Array metadata cannot replace numeric storage.");
  Object.defineProperties(value, descriptors);
  if (!Object.isExtensible(metadata)) Object.preventExtensions(value);
}

type TypedArrayIdentity = { kind: "float32array" } |
  { kind: "typedarray"; arrayType: keyof typeof numericTypedArrayConstructors };

export type TypedArrayData<TReference> = TypedArrayIdentity & {
  byteOffset: number;
  length: number;
  lengthTracking?: true;
} & ({ bytes: number[] } | { buffer: TReference });

export function encodeTypedArrayLayout(value: NumericTypedArray): TypedArrayIdentity & { byteOffset: number; length: number; lengthTracking?: true } {
  const storage = typedArrayStorage(value);
  const identity = storage.Native === Float32Array ? { kind: "float32array" as const } :
    { kind: "typedarray" as const, arrayType: storage.Native.name as keyof typeof numericTypedArrayConstructors };
  if (arrayBufferDetached(storage.buffer)) return { ...identity, byteOffset: 0, length: 0 };
  if (arrayBufferOptions(storage.buffer) === undefined) return { ...identity, byteOffset: storage.byteOffset, length: storage.length };
  const layout = typedArrayViewLayouts.get(value);
  if (layout === undefined) throw new TypeError("Resizable Float32Array snapshots require known view layout.");
  return { ...identity, byteOffset: layout.byteOffset, length: layout.length ?? 0,
    ...(layout.length === undefined ? { lengthTracking: true as const } : {}) };
}

export function encodeTypedArrayStorage<TReference>(
  value: NumericTypedArray,
  id: number,
  buffers: WeakMap<ArrayBufferLike, number>,
  reference: (id: number) => TReference
): TypedArrayData<TReference> {
  const storage = typedArrayStorage(value);
  const existing = buffers.get(storage.buffer);
  if (existing === undefined) buffers.set(storage.buffer, id);
  return {
    ...encodeTypedArrayLayout(value),
    ...(existing === undefined
      ? { bytes: Array.from(new Uint8Array(storage.buffer)) }
      : { buffer: reference(existing) })
  };
}

export function validateTypedArrayStorage(value: Record<string, unknown>): void {
  const Native = snapshotTypedArrayConstructor(value);
  if (Object.hasOwn(value, "lengthTracking") && (value.lengthTracking !== true || value.length !== 0 || Object.hasOwn(value, "bytes")))
    throw new TypeError("Invalid Float32Array length-tracking layout.");
  if (
    !Number.isSafeInteger(value.length) ||
    Number(value.length) < 0 ||
    !Number.isSafeInteger(value.byteOffset) ||
    Number(value.byteOffset) < 0 ||
    Number(value.byteOffset) % Native.BYTES_PER_ELEMENT !== 0
  )
    throw new TypeError("Invalid Float32Array view dimensions.");
  if (Object.hasOwn(value, "bytes") === Object.hasOwn(value, "buffer"))
    throw new TypeError("Float32Array requires one backing storage description.");
  if (Object.hasOwn(value, "bytes")) {
    if (
      !Array.isArray(value.bytes) ||
      value.bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255) ||
      Number(value.length) > Math.floor((value.bytes.length - Number(value.byteOffset)) / Native.BYTES_PER_ELEMENT)
    )
      throw new TypeError("Invalid Float32Array backing bytes.");
  }
}

export function decodeTypedArrayStorage(
  value: Record<string, unknown>,
  resolve: (reference: unknown) => unknown,
  budget?: Budget
): NumericTypedArray {
  validateTypedArrayStorage(value);
  let buffer: ArrayBufferLike;
  if (Array.isArray(value.bytes)) {
    buffer = new ArrayBuffer(value.bytes.length);
    new Uint8Array(buffer).set(value.bytes);
  } else {
    const referenced = resolve(value.buffer);
    if (isSandboxArrayBuffer(referenced) || isSandboxSharedArrayBuffer(referenced)) buffer = referenced;
    else if (isNumericTypedArray(referenced)) buffer = typedArrayStorage(referenced).buffer;
    else throw new TypeError("Invalid Float32Array backing reference.");
  }
  if (value.lengthTracking === true && arrayBufferOptions(buffer) === undefined)
    throw new TypeError("Length-tracking layout requires resizable backing storage.");
  return restoreTypedArrayView(buffer, Number(value.byteOffset), value.lengthTracking === true ? undefined : Number(value.length), budget, snapshotTypedArrayConstructor(value));
}

function snapshotTypedArrayConstructor(value: Record<string, unknown>): NumericTypedArrayConstructor {
  if (value.kind !== "typedarray") {
    if (Object.hasOwn(value, "arrayType")) throw new TypeError("Legacy Float32Array storage cannot specify another array type.");
    return Float32Array;
  }
  if (typeof value.arrayType !== "string" || !Object.hasOwn(numericTypedArrayConstructors, value.arrayType))
    throw new TypeError("Invalid typed array storage type.");
  return numericTypedArrayConstructors[value.arrayType as keyof typeof numericTypedArrayConstructors];
}
