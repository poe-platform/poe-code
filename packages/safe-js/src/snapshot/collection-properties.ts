import { getCollectionProperties } from "../interp/collection-properties.js";
import { getSandboxPrototype, hasExplicitSandboxPrototype } from "../interp/object-model.js";
import type { SandboxMap, SandboxSet } from "../interp/values.js";
import { serializePropertyDescriptors, type PropertyDescriptorData } from "./property-descriptors.js";

export function serializeCollectionProperties<T>(value: SandboxMap | SandboxSet, encode: (value: unknown) => T, dataOnly = false): { propertyState?: PropertyDescriptorData<T>; prototype?: T } {
  const properties = getCollectionProperties(value);
  const prototype = hasExplicitSandboxPrototype(value) ? { prototype: encode(getSandboxPrototype(value)) } : {};
  if (Reflect.ownKeys(properties).length === 0 && Object.isExtensible(properties)) return prototype;
  if (dataOnly && Reflect.ownKeys(properties).some(key => !("value" in Object.getOwnPropertyDescriptor(properties, key)!)))
    throw new TypeError("Collection accessor properties cannot be serialized as replay data.");
  return { ...prototype, propertyState: serializePropertyDescriptors(properties, encode) };
}
