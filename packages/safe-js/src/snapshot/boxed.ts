import { boxedDataProperties, boxedValue, type SandboxBox } from "../interp/boxed.js";
import type { SandboxValue } from "../interp/values.js";

export type BoxedData<T> = {
  kind: "boxed";
  value: T;
  properties: Record<
    string,
    { value: T; configurable: boolean; enumerable: boolean; writable: boolean }
  >;
  extensible: boolean;
};

export function encodeBoxedData<T>(
  value: SandboxBox,
  encode: (value: SandboxValue, key: string) => T
): BoxedData<T> {
  const properties: BoxedData<T>["properties"] = Object.create(null);
  for (const [key, descriptor] of boxedDataProperties(value)) {
    if (!("value" in descriptor)) throw new TypeError("Boxed data cannot contain accessors.");
    properties[key] = {
      value: encode(descriptor.value, key),
      configurable: descriptor.configurable === true,
      enumerable: descriptor.enumerable === true,
      writable: descriptor.writable === true
    };
  }
  return {
    kind: "boxed",
    value: encode(boxedValue(value), "<payload>"),
    properties,
    extensible: Object.isExtensible(value)
  };
}

export function restoreBoxedProperties<T>(
  value: SandboxBox,
  data: BoxedData<T>,
  decode: (value: T) => unknown
): void {
  for (const [key, descriptor] of Object.entries(data.properties))
    Object.defineProperty(value, key, { ...descriptor, value: decode(descriptor.value) });
  if (!data.extensible) Object.preventExtensions(value);
}

export function validateBoxedProperties(data: Record<string, unknown>): void {
  if (
    !Object.hasOwn(data, "kind") ||
    data.kind !== "boxed" ||
    !Object.hasOwn(data, "value") ||
    !Object.hasOwn(data, "extensible") ||
    !Object.hasOwn(data, "properties") ||
    Object.keys(data).length !== 4 ||
    typeof data.extensible !== "boolean" ||
    typeof data.properties !== "object" ||
    data.properties === null ||
    Array.isArray(data.properties)
  )
    throw new TypeError("Invalid boxed primitive properties.");
  for (const descriptor of Object.values(data.properties)) {
    if (
      typeof descriptor !== "object" ||
      descriptor === null ||
      !Object.hasOwn(descriptor, "value") ||
      !Object.hasOwn(descriptor, "writable") ||
      !Object.hasOwn(descriptor, "enumerable") ||
      !Object.hasOwn(descriptor, "configurable") ||
      typeof descriptor.writable !== "boolean" ||
      typeof descriptor.enumerable !== "boolean" ||
      typeof descriptor.configurable !== "boolean" ||
      Object.keys(descriptor).length !== 4
    )
      throw new TypeError("Invalid boxed primitive descriptor.");
  }
}
