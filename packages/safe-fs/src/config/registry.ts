import type { FileSystemAdapterRegistry } from "../config.js";

export function extendAdapterRegistry(
  defaults: FileSystemAdapterRegistry,
  extensions?: FileSystemAdapterRegistry
): FileSystemAdapterRegistry {
  if (
    extensions !== undefined &&
    (extensions === null ||
      typeof extensions.get !== "function" ||
      typeof extensions[Symbol.iterator] !== "function")
  ) {
    throw new TypeError("registry must be a filesystem adapter map.");
  }
  const registry = new Map(defaults);
  for (const [name, descriptor] of extensions ?? []) {
    if (registry.has(name)) throw new TypeError(`Filesystem adapter already registered: ${name}`);
    registry.set(name, descriptor);
  }
  return registry;
}
