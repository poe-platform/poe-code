import type { FileSystemFactory } from "../contracts/filesystem.js";
import type { FileSystemAdapterDescriptor } from "../config.js";
import { normalizeMemoryFileSystemLimits } from "../fs/memory/limits.js";

export function createMemoryFileSystemAdapter(
  create: FileSystemFactory
): FileSystemAdapterDescriptor {
  return {
    validateOptions: normalizeMemoryFileSystemLimits,
    create
  };
}
