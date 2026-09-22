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
// Only SDK-created views are registered. Their native targets never escape,
// so every metadata mutation (including trusted SDK writes) crosses these traps.
const ownedViews = new WeakMap<
  object,
  { view: NumericTypedArray; keys: Set<PropertyKey> }
>();

export function createOwnedTypedArray(
  Native: NumericTypedArrayConstructor,
  args: unknown[],
): NumericTypedArray {
  const view = Reflect.construct(Native, args) as NumericTypedArray;
  const keys = new Set<PropertyKey>();
  const methods = new WeakMap<object, (...args: unknown[]) => unknown>();
  const owned = new Proxy(view, {
    get(target, key, receiver) {
      // Preserve native SDK reads and iteration without publishing the target.
      const intrinsic = Object.getOwnPropertyDescriptor(
        typedArrayPrototype,
        key,
      );
      if (!Object.hasOwn(target, key) && intrinsic !== undefined) {
        if (intrinsic.get !== undefined)
          return Reflect.get(target, key, target);
        if (key !== "constructor" && typeof intrinsic.value === "function") {
          const method = Reflect.get(target, key, target);
          const cached = methods.get(method);
          if (cached !== undefined) return cached;
          const wrapper = function (this: unknown, ...args: unknown[]) {
            const native =
              typeof this === "object" && this !== null
                ? (ownedViews.get(this)?.view ?? this)
                : this;
            const callbackReceiver = native === target ? receiver : this;
            // Native callback methods pass their receiver to user code. Keep that
            // alias owned too, and remap in-place methods' returned receiver.
            if (
              [
                "forEach",
                "map",
                "filter",
                "every",
                "some",
                "find",
                "findIndex",
                "findLast",
                "findLastIndex",
                "reduce",
                "reduceRight",
              ].includes(String(key)) &&
              typeof args[0] === "function"
            ) {
              const callback = args[0] as (...values: unknown[]) => unknown;
              args[0] = function (this: unknown, ...values: unknown[]) {
                return Reflect.apply(
                  callback,
                  this,
                  values.map((value) =>
                    value === native ? callbackReceiver : value,
                  ),
                );
              };
            }
            const result = Reflect.apply(method, native, args);
            return result === native ? callbackReceiver : result;
          };
          methods.set(method, wrapper);
          return wrapper;
        }
      }
      return Reflect.get(target, key, receiver);
    },
    defineProperty(target, key, descriptor) {
      const changed = Reflect.defineProperty(target, key, descriptor);
      if (changed && !(typeof key === "string" && isTypedArrayIndex(key)))
        keys.add(key);
      return changed;
    },
    deleteProperty(target, key) {
      const changed = Reflect.deleteProperty(target, key);
      if (changed) keys.delete(key);
      return changed;
    },
  });
  ownedViews.set(owned, { view, keys });
  const backing = float16BackingViews.get(view);
  if (backing !== undefined) float16BackingViews.set(owned, backing);
  return owned;
}

export function nativeTypedArrayView<T extends object>(value: T): T {
  return (ownedViews.get(value)?.view ?? value) as T;
}

const resizeBuffer = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resize")?.value as ((length: number) => void) | undefined;

export function restoreTypedArrayView(buffer: ArrayBufferLike, byteOffset: number, length?: number, budget?: Budget, Native: NumericTypedArrayConstructor = Float32Array, owned = false): NumericTypedArray {
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
    const args = [buffer,byteOffset,length];
    const view = owned ? createOwnedTypedArray(Native,args) : Reflect.construct(Native,args) as NumericTypedArray;
    if (options !== undefined) typedArrayViewLayouts.set(view, { byteOffset, ...(length === undefined ? {} : { length }) });
    return view;
  } finally {
    if (grow) Reflect.apply(resizeBuffer!, buffer, [originalLength]);
  }
}

export function isNumericTypedArray(value: unknown): value is NumericTypedArray {
  if (typeof value === "object" && value !== null && float16BackingViews.has(value))
    return Object.getPrototypeOf(value) === Float16Array.prototype;
  if (typeof value === "object" && value !== null && ownedViews.has(value))
    return isNumericTypedArray(ownedViews.get(value)!.view);
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
  const view = backingView ?? nativeTypedArrayView(value);
  if (requireInBounds) Reflect.apply(createValuesIterator, view, []);
  const buffer = Reflect.apply(readBuffer, view, []) as ArrayBufferLike;
  if (
    Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype && !isSandboxSharedArrayBuffer(buffer)
  ) {
    throw new TypeError("Float32Array requires a non-shared ArrayBuffer.");
  }
  const Native = backingView === undefined
    ? numericTypedArrayConstructors[Reflect.apply(readTag, view, []) as keyof typeof numericTypedArrayConstructors]
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

export function typedArrayProperties(
  value: NumericTypedArray,
): Array<[PropertyKey, PropertyDescriptor]> {
  const properties: Array<[PropertyKey, PropertyDescriptor]> = [];
  const tracked = ownedViews.get(value);
  // Ordinary host views retain the conservative scan. Owned views preserve the
  // normal ownKeys operation for reflection, but accounting uses metadata only.
  const keys =
    tracked === undefined
      ? Reflect.ownKeys(value)
      : [
          ...[...tracked.keys].filter((key) => typeof key === "string"),
          ...[...tracked.keys].filter((key) => typeof key === "symbol"),
        ];
  for (const key of keys) {
    if (typeof key === "string" && isTypedArrayIndex(key)) continue;
    properties.push([key, Object.getOwnPropertyDescriptor(value, key)!]);
  }
  return properties;
}

export function typedArraySymbolKeys(value: NumericTypedArray): symbol[] {
  const tracked = ownedViews.get(value);
  return tracked === undefined
    ? Object.getOwnPropertySymbols(value)
    : [...tracked.keys].filter((key): key is symbol => typeof key === "symbol");
}

export function typedArrayDataProperties(value: NumericTypedArray): Array<[string, PropertyDescriptor]> {
  if (typedArraySymbolKeys(value).length > 0)
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

// Track sandbox-bound copies only; outbound BufferSources must remain native.
export function copyTypedArrayStorage<TValue>(
  value: NumericTypedArray,
  state: {
    seen: WeakMap<object, TValue>;
    float32Buffers?: WeakMap<ArrayBufferLike, ArrayBufferLike>;
  },
  owned = false
): NumericTypedArray {
  const storage = typedArrayStorage(value);
  const buffer = copyArrayBufferStorage(storage.buffer, state);
  if (arrayBufferOptions(storage.buffer) !== undefined) {
    const layout = typedArrayViewLayouts.get(value);
    if (layout === undefined) throw new TypeError("Resizable Float32Array copies require known view layout.");
    return restoreTypedArrayView(buffer, layout.byteOffset, layout.length, undefined, storage.Native, owned);
  }
  const args = [buffer,storage.byteOffset,storage.length];
  return owned ? createOwnedTypedArray(storage.Native,args) : Reflect.construct(storage.Native,args) as NumericTypedArray;
}

export function requireUint8Array(value: unknown): Uint8Array<ArrayBuffer> {
  if (!isNumericTypedArray(value) || typedArrayStorage(value).Native !== Uint8Array)
    throw new TypeError("Conversion requires a Uint8Array receiver.");
  return value as Uint8Array<ArrayBuffer>;
}
