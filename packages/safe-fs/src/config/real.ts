import type { FileSystemFactory } from "../contracts/filesystem.js";
import { readConfigRecord, type FileSystemAdapterDescriptor } from "../config.js";

export function createRealFileSystemAdapter(
  create: (options: { readonly root: string }) => ReturnType<FileSystemFactory>
): FileSystemAdapterDescriptor {
  return {
    validateOptions(options) {
      const record = readConfigRecord(options, "real option", ["root"]);
      if (
        typeof record.root !== "string" ||
        !record.root.startsWith("/") ||
        record.root.includes("\0")
      ) {
        throw new TypeError("adapter.options.root must be an absolute host directory");
      }
    },
    create(options) {
      return create({ root: options.root as string });
    }
  };
}
