import { types } from "node:util";
import type { SandboxObject } from "./values.js";

export type BoxedPrimitive = string | number | boolean;
export type BoxedKind = "string" | "number" | "boolean";
declare const boxedPrimitiveBrand: unique symbol;
export type SandboxBox = SandboxObject & { readonly [boxedPrimitiveBrand]: true };
const boxes = new WeakSet<object>();
const numberValue = Number.prototype.valueOf;
const stringValue = String.prototype.valueOf;
const booleanValue = Boolean.prototype.valueOf;

export function nativeBoxedValue(value: unknown): BoxedPrimitive | undefined {
  if (types.isNumberObject(value)) return Reflect.apply(numberValue, value, []);
  if (types.isStringObject(value)) return Reflect.apply(stringValue, value, []);
  if (types.isBooleanObject(value)) return Reflect.apply(booleanValue, value, []);
  return undefined;
}

export function createSandboxBox(value: unknown): SandboxBox {
  if (typeof value !== "number" && typeof value !== "string" && typeof value !== "boolean")
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

export function boxedDataProperties(value: object): Array<[string, PropertyDescriptor]> {
  const primitive = nativeBoxedValue(value);
  return Object.entries(Object.getOwnPropertyDescriptors(value)).filter(([key]) => {
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
