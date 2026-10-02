import type { FileSystemAdapterRegistry } from "./config.js";
import { createMemoryFileSystemAdapter } from "./config/memory.js";
import { extendAdapterRegistry } from "./config/registry.js";
import { createMemoryFileSystem } from "./fs/memory/index.js";

/** Portable defaults never grant access to the host filesystem. */
export function createPortableFileSystemAdapterRegistry(
  extensions?: FileSystemAdapterRegistry
): FileSystemAdapterRegistry {
  return extendAdapterRegistry(new Map([
    ["memory", createMemoryFileSystemAdapter(createMemoryFileSystem)]
  ]), extensions);
}
