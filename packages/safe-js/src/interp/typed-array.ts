import type { Budget } from "./budget.js";
import { arrayBufferLength, arrayBufferOptions, copyArrayBufferStorage } from "./array-buffer.js";
import { float16BackingViews, Float16Array } from "./float16-array.js";
import { isSandboxSharedArrayBuffer } from "./shared-array-buffer.js";

import { numericTypedArrayConstructors, type NumericTypedArrayConstructor, type NumericTypedArray } from "./typed-array-constructors.js";
export { numericTypedArrayConstructors, type NumericTypedArrayConstructor, type NumericTypedArray } from "./typed-array-constructors.js";

const typedArrayPrototype = Object.getPrototypeOf(Float32Array.prototype);
const readLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "length")!.get!;
const readOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")!.get!;
const readBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!;
const readTag = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)!.get!;
const createValuesIterator = Object.getOwnPropertyDescriptor(typedArrayPrototype, "values")!.value;
export const typedArrayViewLayouts = new WeakMap<NumericTypedArray, { byteOffset: number; length?: number }>();
const resizeBuffer = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resize")?.value as ((length: number) => void) | undefined;

export function restoreTypedArrayView(buffer: ArrayBufferLike, byteOffset: number, length?: number, budget?: Budget, Native: NumericTypedArrayConstructor = Float32Array): NumericTypedArray {
  const originalLength = arrayBufferLength(buffer);
  const required = byteOffset + (length ?? 0) * Native.BYTES_PER_ELEMENT;
  const options = arrayBufferOptions(buffer);
  const grow = required > originalLength;
  if (grow) {
    if (isSandboxSharedArrayBuffer(buffer) || resizeBuffer === undefined || options === undefined || required > options.maxByteLength)
      throw new RangeError("Float32Array layout exceeds backing capacity.");
    budget?.allocateArrayLength(Math.ceil(required / Native.BYTES_PER_ELEMENT));
    budget?.provisionDataUsage(required - originalLength)();
    Reflect.apply(resizeBuffer, buffer, [required]);
  }
  try {
    const view = Reflect.construct(Native,[buffer,byteOffset,length]) as NumericTypedArray;
    if (options !== undefined) typedArrayViewLayouts.set(view, { byteOffset, ...(length === undefined ? {} : { length }) });
    return view;
  } finally {
    if (grow) Reflect.apply(resizeBuffer!, buffer, [originalLength]);
  }
}

export function isNumericTypedArray(value: unknown): value is NumericTypedArray {
  if (typeof value === "object" && value !== null && float16BackingViews.has(value))
    return Object.getPrototypeOf(value) === Float16Array.prototype;
  if (!ArrayBuffer.isView(value)) return false;
  const tag = Reflect.apply(readTag, value, []);
  return Object.hasOwn(numericTypedArrayConstructors, tag) &&
    Object.getPrototypeOf(value) === numericTypedArrayConstructors[tag as keyof typeof numericTypedArrayConstructors].prototype;
}

export function typedArrayStorage(value: NumericTypedArray, requireInBounds = false): {
  buffer: ArrayBufferLike;
  byteOffset: number;
  length: number;
  byteLength: number;
  Native: NumericTypedArrayConstructor;
  elementSize: number;
} {
  const backingView = float16BackingViews.get(value);
  const view = backingView ?? value;
  if (requireInBounds) Reflect.apply(createValuesIterator, view, []);
  const buffer = Reflect.apply(readBuffer, view, []) as ArrayBufferLike;
  if (
    Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype && !isSandboxSharedArrayBuffer(buffer)
  ) {
    throw new TypeError("Float32Array requires a non-shared ArrayBuffer.");
  }
  const Native = backingView === undefined
    ? numericTypedArrayConstructors[Reflect.apply(readTag, value, []) as keyof typeof numericTypedArrayConstructors]
    : Float16Array;
  return {
    Native,
    elementSize: Native.BYTES_PER_ELEMENT,
    buffer,
    byteOffset: Reflect.apply(readOffset, view, []) as number,
    length: Reflect.apply(readLength, view, []) as number,
    byteLength: arrayBufferLength(buffer)
  };
}

export function typedArrayProperties(value: NumericTypedArray): Array<[PropertyKey, PropertyDescriptor]> {
  const properties: Array<[PropertyKey, PropertyDescriptor]> = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "string" && isTypedArrayIndex(key)) continue;
    properties.push([key, Object.getOwnPropertyDescriptor(value, key)!]);
  }
  return properties;
}

export function typedArrayDataProperties(value: NumericTypedArray): Array<[string, PropertyDescriptor]> {
  if (Object.getOwnPropertySymbols(value).length > 0)
    throw new TypeError("Float32Array symbol properties are not supported.");
  const properties: Array<[string, PropertyDescriptor]> = [];
  for (const [key, descriptor] of typedArrayProperties(value)) {
    if (typeof key !== "string") throw new TypeError("Float32Array symbol properties are not supported.");
    if (!("value" in descriptor))
      throw new TypeError(`Float32Array accessor property '${key}' is not supported.`);
    properties.push([key, descriptor]);
  }
  return properties;
}

export function isTypedArrayIndex(key: string): boolean {
  return key === "-0" || String(Number(key)) === key;
}

export function typedArrayNumber(value: unknown): number {
  if (
    (value !== null && typeof value === "object") ||
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint"
  ) {
    throw new TypeError(
      "Float32Array numeric arguments must be primitive numeric-coercible values."
    );
  }
  return Number(value);
}

export function checkTypedArrayAllocation(length: number, budget: Budget, elementSize = Float32Array.BYTES_PER_ELEMENT): void {
  budget.allocateArrayLength(length);
  budget.provisionDataUsage(length * elementSize + 1)();
}

export function copyTypedArrayStorage<TValue>(
  value: NumericTypedArray,
  state: {
    seen: WeakMap<object, TValue>;
    float32Buffers?: WeakMap<ArrayBufferLike, ArrayBufferLike>;
  }
): NumericTypedArray {
  const storage = typedArrayStorage(value);
  const buffer = copyArrayBufferStorage(storage.buffer, state);
  if (arrayBufferOptions(storage.buffer) !== undefined) {
    const layout = typedArrayViewLayouts.get(value);
    if (layout === undefined) throw new TypeError("Resizable Float32Array copies require known view layout.");
    return restoreTypedArrayView(buffer, layout.byteOffset, layout.length, undefined, storage.Native);
  }
  return Reflect.construct(storage.Native,[buffer,storage.byteOffset,storage.length]) as NumericTypedArray;
}

export function requireUint8Array(value: unknown): Uint8Array<ArrayBuffer> {
  if (!isNumericTypedArray(value) || typedArrayStorage(value).Native !== Uint8Array)
    throw new TypeError("Conversion requires a Uint8Array receiver.");
  return value as Uint8Array<ArrayBuffer>;
}
