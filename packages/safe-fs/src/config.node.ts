import { extendAdapterRegistry } from "./config/registry.js";
import type { FileSystemAdapterRegistry } from "./config.js";
import { createMemoryFileSystemAdapter } from "./config/memory.js";
import { createRealFileSystemAdapter } from "./config/real.js";
import { createMemoryFileSystem } from "./fs/memory/index.js";
import { createRealFileSystem } from "./fs/real/index.js";

export function createNodeFileSystemAdapterRegistry(
  extensions?: FileSystemAdapterRegistry
): FileSystemAdapterRegistry {
  return extendAdapterRegistry(new Map([
    ["memory", createMemoryFileSystemAdapter(createMemoryFileSystem)],
    ["real", createRealFileSystemAdapter(createRealFileSystem)]
  ]), extensions);
}
