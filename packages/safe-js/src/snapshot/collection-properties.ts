import { getCollectionProperties } from "../interp/collection-properties.js";
import { getSandboxPrototype, hasExplicitSandboxPrototype } from "../interp/object-model.js";
import type { SandboxMap, SandboxSet } from "../interp/values.js";
import { serializePropertyDescriptorsOperation, type PropertyDescriptorData } from "./property-descriptors.js";
import { dataCopyIterable, runDataCopy, type DataCopyOperation } from "../interp/data-copy.js";

export function serializeCollectionProperties<T>(value: SandboxMap | SandboxSet, encode: (value: unknown) => T, dataOnly = false): { propertyState?: PropertyDescriptorData<T>; prototype?: T } {
  // eslint-disable-next-line require-yield
  return runDataCopy(serializeCollectionPropertiesOperation(value, function* (entry): DataCopyOperation<T> { return encode(entry); }, dataOnly));
}

export function* serializeCollectionPropertiesOperation<T>(value: SandboxMap | SandboxSet, encode: (value: unknown) => DataCopyOperation<T>, dataOnly = false): DataCopyOperation<T, { propertyState?: PropertyDescriptorData<T>; prototype?: T }> {
  const properties = getCollectionProperties(value);
  const prototype = hasExplicitSandboxPrototype(value) ? { prototype: yield encode(getSandboxPrototype(value)) } : {};
  if (Reflect.ownKeys(properties).length === 0 && Object.isExtensible(properties)) return prototype;
  if (dataOnly && Reflect.ownKeys(properties).some(key => !("value" in Object.getOwnPropertyDescriptor(properties, key)!)))
    throw new TypeError("Collection accessor properties cannot be serialized as replay data.");
  return { ...prototype, propertyState: yield* dataCopyIterable(serializePropertyDescriptorsOperation(properties, encode)) };
}
