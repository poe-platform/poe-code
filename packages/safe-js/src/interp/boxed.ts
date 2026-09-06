import { types } from "node:util";
import type { SandboxObject } from "./values.js";

export type BoxedPrimitive = string | number | bigint | boolean | symbol;
export type BoxedKind = "string" | "number" | "bigint" | "boolean" | "symbol";
declare const boxedPrimitiveBrand: unique symbol;
export type SandboxBox = SandboxObject & { readonly [boxedPrimitiveBrand]: true };
const boxes = new WeakSet<object>();
const numberValue = Number.prototype.valueOf;
const stringValue = String.prototype.valueOf;
const booleanValue = Boolean.prototype.valueOf;
const symbolValue = Symbol.prototype.valueOf;
const bigintValue = BigInt.prototype.valueOf;

export function nativeBoxedValue(value: unknown): BoxedPrimitive | undefined {
  if (types.isNumberObject(value)) return Reflect.apply(numberValue, value, []);
  if (types.isStringObject(value)) return Reflect.apply(stringValue, value, []);
  if (types.isBooleanObject(value)) return Reflect.apply(booleanValue, value, []);
  if (types.isSymbolObject(value)) return Reflect.apply(symbolValue, value, []);
  if (types.isBigIntObject(value)) return Reflect.apply(bigintValue, value, []);
  return undefined;
}

export function createSandboxBox(value: unknown): SandboxBox {
  if (typeof value !== "number" && typeof value !== "bigint" && typeof value !== "string" && typeof value !== "boolean" && typeof value !== "symbol")
    throw new TypeError("Invalid boxed primitive payload.");
  const box = Object(value) as SandboxBox;
  Object.setPrototypeOf(box, null);
  boxes.add(box);
  return box;
}

export function isSandboxBox(value: unknown): value is SandboxBox {
  return typeof value === "object" && value !== null && boxes.has(value);
}

export function boxedValue(value: object): BoxedPrimitive {
  if (!boxes.has(value)) throw new TypeError("Expected a sandbox boxed primitive.");
  return nativeBoxedValue(value)!;
}

export function primitiveReceiver(value: unknown, kind: BoxedKind): BoxedPrimitive {
  const primitive = isSandboxBox(value) ? boxedValue(value) : value;
  if (typeof primitive !== kind) throw new TypeError(`${kind} method requires a ${kind} receiver.`);
  return primitive as BoxedPrimitive;
}

export function boxedDataProperties(value: object): Array<[string, PropertyDescriptor]>;
export function boxedDataProperties(value: object, includeSymbols: true): Array<[string | symbol, PropertyDescriptor]>;
export function boxedDataProperties(value: object, includeSymbols = false): Array<[string | symbol, PropertyDescriptor]> {
  const primitive = nativeBoxedValue(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = includeSymbols ? Reflect.ownKeys(descriptors) : Object.keys(descriptors);
  return keys.map(key => [key, Object.getOwnPropertyDescriptor(descriptors, key)!.value] as [string | symbol, PropertyDescriptor]).filter(([key]) => {
    if (typeof key === "symbol") return true;
    if (typeof primitive !== "string") return true;
    if (key === "length") return false;
    const index = Number(key);
    return !(
      Number.isInteger(index) &&
      index >= 0 &&
      index < primitive.length &&
      String(index) === key
    );
  });
}
