import type { FileSystemAdapterRegistry } from "./config.js";
import { createMemoryFileSystemAdapter } from "./config/memory.js";
import { createRealFileSystemAdapter } from "./config/real.js";
import { createMemoryFileSystem } from "./fs/memory/index.js";
import { createRealFileSystem } from "./fs/real/index.js";

export function createNodeFileSystemAdapterRegistry(
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
  const registry = new Map([
    ["memory", createMemoryFileSystemAdapter(createMemoryFileSystem)],
    ["real", createRealFileSystemAdapter(createRealFileSystem)]
  ]);
  for (const [name, descriptor] of extensions ?? []) {
    if (registry.has(name)) throw new TypeError(`Filesystem adapter already registered: ${name}`);
    registry.set(name, descriptor);
  }
  return registry;
}
