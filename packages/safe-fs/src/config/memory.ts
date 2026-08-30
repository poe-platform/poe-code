import type { FileSystemFactory } from "../contracts/filesystem.js";
import { readConfigRecord, type FileSystemAdapterDescriptor } from "../config.js";

export function createMemoryFileSystemAdapter(
  create: FileSystemFactory
): FileSystemAdapterDescriptor {
  return {
    validateOptions(options) {
      readConfigRecord(options, "memory option", []);
    },
    create
  };
}
