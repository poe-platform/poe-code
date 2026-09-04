import { FsError } from "../contracts/errors.js";
import type { ReadDirectoryOptions } from "../contracts/filesystem.js";

export function directoryEntryLimit(options: ReadDirectoryOptions, path: string): number | undefined {
  options.signal?.throwIfAborted();
  const limit = options.maxEntries;
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) {
    throw new FsError("EINVAL", { syscall: "readdir", path, message: "directory entry limit must be a nonnegative safe integer" });
  }
  return limit;
}

export function admitDirectoryEntries(count: number, limit: number | undefined, path: string): void {
  if (limit !== undefined && count > limit) {
    throw new FsError("EFBIG", { syscall: "readdir", path, message: "directory entry limit exceeded" });
  }
}
