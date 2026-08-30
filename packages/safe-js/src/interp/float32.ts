import type { Budget } from "./budget.js";

const typedArrayPrototype = Object.getPrototypeOf(Float32Array.prototype);
const readLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "length")!.get!;
const readOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")!.get!;
const readBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!;
const readTag = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)!.get!;
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const bufferResizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;

export function isFloat32Array(value: unknown): value is Float32Array {
  return (
    ArrayBuffer.isView(value) &&
    Object.getPrototypeOf(value) === Float32Array.prototype &&
    Reflect.apply(readTag, value, []) === "Float32Array"
  );
}

export function float32Storage(value: Float32Array): {
  buffer: ArrayBuffer;
  byteOffset: number;
  length: number;
  byteLength: number;
} {
  const buffer = Reflect.apply(readBuffer, value, []) as ArrayBuffer;
  if (
    Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype ||
    (bufferResizable !== undefined && Reflect.apply(bufferResizable, buffer, []))
  ) {
    throw new TypeError("Float32Array requires a fixed, non-shared ArrayBuffer.");
  }
  return {
    buffer,
    byteOffset: Reflect.apply(readOffset, value, []) as number,
    length: Reflect.apply(readLength, value, []) as number,
    byteLength: Reflect.apply(bufferLength, buffer, []) as number
  };
}

export function float32DataProperties(value: Float32Array): Array<[string, PropertyDescriptor]> {
  if (Object.getOwnPropertySymbols(value).length > 0)
    throw new TypeError("Float32Array symbol properties are not supported.");
  const properties: Array<[string, PropertyDescriptor]> = [];
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (isFloat32Index(key)) continue;
    if (!("value" in descriptor))
      throw new TypeError(`Float32Array accessor property '${key}' is not supported.`);
    properties.push([key, descriptor]);
  }
  return properties;
}

export function isFloat32Index(key: string): boolean {
  return key === "-0" || String(Number(key)) === key;
}

export function float32Number(value: unknown): number {
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

export function checkFloat32Allocation(length: number, budget: Budget): void {
  budget.allocateArrayLength(length);
  budget.provisionDataUsage(length * Float32Array.BYTES_PER_ELEMENT + 1)();
}

export function copyFloat32Storage<TValue>(
  value: Float32Array,
  state: {
    seen: WeakMap<object, TValue>;
    float32Buffers?: WeakMap<ArrayBuffer, ArrayBuffer>;
  }
): Float32Array {
  const storage = float32Storage(value);
  state.float32Buffers ??= new WeakMap();
  let buffer = state.float32Buffers.get(storage.buffer);
  if (buffer === undefined) {
    buffer = new ArrayBuffer(storage.byteLength);
    new Uint8Array(buffer).set(new Uint8Array(storage.buffer));
    state.float32Buffers.set(storage.buffer, buffer);
  }
  return new Float32Array(buffer, storage.byteOffset, storage.length);
}
