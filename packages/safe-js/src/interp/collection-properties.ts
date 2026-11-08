import type { SandboxMap, SandboxObject, SandboxSet } from "./values.js";
import { runDataCopy, type DataCopyOperation } from "./data-copy.js";

export const collectionGuestProperties = new WeakMap<object, SandboxObject>();

export function getCollectionProperties(value: SandboxMap | SandboxSet): SandboxObject {
  const properties = collectionGuestProperties.get(value);
  if (properties === undefined) throw new TypeError("Invalid sandbox collection storage.");
  return properties;
}

export function copyCollectionProperties(source: SandboxMap | SandboxSet | Map<unknown, unknown> | Set<unknown>, target: object, encode: (value: unknown, key: string | symbol) => unknown): void {
  // The synchronous callback is a leaf operation with no child to schedule.
  // eslint-disable-next-line require-yield
  runDataCopy(copyCollectionPropertiesOperation(source, target, function* (value, key) {
    return encode(value, key);
  }));
}

export function* copyCollectionPropertiesOperation<T>(source: SandboxMap | SandboxSet | Map<unknown, unknown> | Set<unknown>, target: object, encode: (value: unknown, key: string | symbol) => DataCopyOperation<T>): DataCopyOperation<T> {
  const properties = collectionGuestProperties.get(source) ?? source;
  for (const key of Reflect.ownKeys(properties)) {
    const descriptor = Object.getOwnPropertyDescriptor(properties, key)!;
    if (!("value" in descriptor)) throw new TypeError("Collection accessor properties cannot be copied as data.");
    Object.defineProperty(target, key, { ...descriptor, value: yield encode(descriptor.value, key) });
  }
  if (!Object.isExtensible(properties)) Object.preventExtensions(target);
  return undefined as T;
}
