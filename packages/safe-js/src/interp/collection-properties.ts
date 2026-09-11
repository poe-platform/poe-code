import type { SandboxMap, SandboxObject, SandboxSet } from "./values.js";

export const collectionGuestProperties = new WeakMap<object, SandboxObject>();

export function getCollectionProperties(value: SandboxMap | SandboxSet): SandboxObject {
  const properties = collectionGuestProperties.get(value);
  if (properties === undefined) throw new TypeError("Invalid sandbox collection storage.");
  return properties;
}

export function copyCollectionProperties(source: SandboxMap | SandboxSet | Map<unknown, unknown> | Set<unknown>, target: object, encode: (value: unknown) => unknown): void {
  const properties = collectionGuestProperties.get(source) ?? source;
  for (const key of Reflect.ownKeys(properties)) {
    const descriptor = Object.getOwnPropertyDescriptor(properties, key)!;
    if (!("value" in descriptor)) throw new TypeError("Collection accessor properties cannot be copied as data.");
    Object.defineProperty(target, key, { ...descriptor, value: encode(descriptor.value) });
  }
  if (!Object.isExtensible(properties)) Object.preventExtensions(target);
}
