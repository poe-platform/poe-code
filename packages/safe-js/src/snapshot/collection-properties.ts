import { getCollectionProperties } from "../interp/collection-properties.js";
import type { SandboxMap, SandboxSet } from "../interp/values.js";
import { serializePropertyDescriptors, type PropertyDescriptorData } from "./property-descriptors.js";

export function serializeCollectionProperties<T>(value: SandboxMap | SandboxSet, encode: (value: unknown) => T, dataOnly = false): { propertyState?: PropertyDescriptorData<T> } {
  const properties = getCollectionProperties(value);
  if (Reflect.ownKeys(properties).length === 0 && Object.isExtensible(properties)) return {};
  if (dataOnly && Reflect.ownKeys(properties).some(key => !("value" in Object.getOwnPropertyDescriptor(properties, key)!)))
    throw new TypeError("Collection accessor properties cannot be serialized as replay data.");
  return { propertyState: serializePropertyDescriptors(properties, encode) };
}
