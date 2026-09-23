import { isDeepStrictEqual } from "node:util";
import { addCustomEqualityTesters } from "@vitest/expect";

const byteIterator = Uint8Array.prototype[Symbol.iterator];
const byteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "length")!.get!;

// Preserve the original oracle: only native, property-free byte views can take
// a positive shortcut. All mismatches and custom objects use normal equality.
function plainByteEquality(actual: unknown, expected: unknown): true | undefined {
  if (!ArrayBuffer.isView(actual) || !ArrayBuffer.isView(expected)
    || Object.getPrototypeOf(actual) !== Uint8Array.prototype
    || Object.getPrototypeOf(expected) !== Uint8Array.prototype
    || Object.getOwnPropertySymbols(actual).length || Object.getOwnPropertySymbols(expected).length) return undefined;
  try {
    if (Object.getOwnPropertyNames(actual).length !== byteLength.call(actual)
      || Object.getOwnPropertyNames(expected).length !== byteLength.call(expected)
      || Reflect.get(actual, Symbol.iterator) !== byteIterator
      || Reflect.get(expected, Symbol.iterator) !== byteIterator) return undefined;
    return isDeepStrictEqual(actual, expected) ? true : undefined;
  } catch {
    return undefined;
  }
}

addCustomEqualityTesters([plainByteEquality]);
