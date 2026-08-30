import type { Budget } from "../budget.js";
import {
  checkFloat32Allocation,
  float32Number,
  float32Storage,
  isFloat32Array,
  isFloat32Index
} from "../float32.js";
import { createSandboxClosure, type SandboxClosure, type SandboxValue } from "../values.js";

const constructors = new WeakSet<SandboxClosure>();

export function createFloat32ArrayGlobal(budget: Budget): SandboxClosure {
  const constructor = createSandboxClosure({
    sandbox: true,
    name: "Float32Array",
    length: 3,
    properties: { BYTES_PER_ELEMENT: 4 },
    call: () => {
      throw new TypeError("Constructor Float32Array requires 'new'.");
    },
    construct: ([source]) => {
      if (Array.isArray(source) || isFloat32Array(source)) {
        const length = isFloat32Array(source) ? float32Storage(source).length : source.length;
        checkFloat32Allocation(length, budget);
        if (isFloat32Array(source)) return new Float32Array(source);
        const result = new Float32Array(length);
        for (let index = 0; index < length; index += 1) {
          budget.visitNode();
          const descriptor = Object.getOwnPropertyDescriptor(source, index);
          if (descriptor !== undefined && !("value" in descriptor))
            throw new TypeError("Float32Array input accessors are not supported.");
          result[index] = float32Number(descriptor?.value);
        }
        return result;
      }
      const number = float32Number(source);
      const length = Number.isNaN(number) ? 0 : Math.trunc(number);
      if (length < 0 || !Number.isSafeInteger(length))
        throw new RangeError("Invalid typed array length.");
      checkFloat32Allocation(length, budget);
      return new Float32Array(length);
    }
  });
  constructors.add(constructor);
  return constructor;
}

export function isFloat32ArrayConstructor(value: unknown): boolean {
  return typeof value === "object" && value !== null && constructors.has(value as SandboxClosure);
}

export function getFloat32Member(
  value: Float32Array,
  property: string | number,
  budget: Budget
): SandboxValue {
  const key = String(property);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor !== undefined) {
    if (!("value" in descriptor)) throw new TypeError("Float32Array accessors are not supported.");
    return descriptor.value;
  }
  const storage = float32Storage(value);
  if (key === "length") return storage.length;
  if (key === "byteLength") return storage.length * 4;
  if (key === "byteOffset") return storage.byteOffset;
  if (key === "BYTES_PER_ELEMENT") return 4;
  if (!["set", "slice", "subarray"].includes(key)) return undefined;
  return createSandboxClosure({
    sandbox: true,
    name: key,
    length: key === "set" ? 1 : 2,
    call: (args, context) => {
      const receiver = context?.thisValue;
      if (!isFloat32Array(receiver))
        throw new TypeError(`Float32Array#${key} requires a Float32Array receiver.`);
      const storage = float32Storage(receiver);
      if (key === "set") {
        const [source, offsetValue = 0] = args;
        if (!Array.isArray(source) && !isFloat32Array(source))
          throw new TypeError("Float32Array#set requires an array or Float32Array.");
        const number = float32Number(offsetValue);
        const offset = Number.isNaN(number) ? 0 : Math.trunc(number);
        const length = isFloat32Array(source) ? float32Storage(source).length : source.length;
        if (offset < 0 || !Number.isSafeInteger(offset) || offset + length > storage.length)
          throw new RangeError("Float32Array#set source is out of bounds.");
        if (isFloat32Array(source)) {
          Float32Array.prototype.set.call(receiver, source, offset);
          return undefined;
        }
        checkFloat32Allocation(length, budget);
        const copied = new Float32Array(length);
        for (let index = 0; index < length; index += 1) {
          budget.visitNode();
          const entry = Object.getOwnPropertyDescriptor(source, index);
          if (entry !== undefined && !("value" in entry))
            throw new TypeError("Float32Array input accessors are not supported.");
          copied[index] = float32Number(entry?.value);
        }
        Float32Array.prototype.set.call(receiver, copied, offset);
        return undefined;
      }
      const start = relativeIndex(args[0], storage.length, 0);
      const end = relativeIndex(args[1], storage.length, storage.length);
      const length = Math.max(end - start, 0);
      if (key === "subarray")
        return new Float32Array(storage.buffer, storage.byteOffset + start * 4, length);
      checkFloat32Allocation(length, budget);
      const result = new Float32Array(length);
      new Uint8Array(result.buffer).set(
        new Uint8Array(storage.buffer, storage.byteOffset + start * 4, length * 4)
      );
      return result;
    }
  });
}

export function setFloat32Member(
  value: Float32Array,
  property: string | number,
  entry: SandboxValue
): void {
  const key = String(property);
  if (isFloat32Index(key)) {
    Reflect.set(value, key, float32Number(entry));
    return;
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (
    descriptor === undefined &&
    ["length", "byteLength", "byteOffset", "buffer", "BYTES_PER_ELEMENT"].includes(key)
  )
    throw new TypeError(`Cannot assign to read only property '${key}'.`);
  if (descriptor !== undefined && (!("value" in descriptor) || !descriptor.writable))
    throw new TypeError(`Cannot assign to read only property '${key}'.`);
  Object.defineProperty(
    value,
    key,
    descriptor === undefined
      ? { value: entry, configurable: true, enumerable: true, writable: true }
      : { value: entry }
  );
}

function relativeIndex(value: SandboxValue, length: number, fallback: number): number {
  if (value === undefined) return fallback;
  const numeric = float32Number(value);
  const integer = Number.isNaN(numeric) ? 0 : Math.trunc(numeric);
  return integer < 0 ? Math.max(length + integer, 0) : Math.min(integer, length);
}
