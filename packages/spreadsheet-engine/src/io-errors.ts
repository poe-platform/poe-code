import { SsconvertError } from "./contracts.js";

// Only known filesystem errors are translated. Opaque host failures keep identity.
const descriptions: Readonly<Record<string, string>> = {
  ENOENT: "No such file or directory", EACCES: "Permission denied", EPERM: "Operation not permitted",
  EISDIR: "Is a directory", ENOTDIR: "Not a directory", ENOSPC: "No space left on device",
  EROFS: "Read-only file system", ENOTSUP: "Operation not supported", EIO: "Input/output error"
};
/** Preserve the underlying detail for native object-export diagnostics. */
export class FileWriteError extends SsconvertError {
  constructor(uri: string, readonly detail: string) {
    super("io", `E Can't open '${uri}' for writing: ${detail}`);
  }
}
export function ioFailure(error: unknown, uri: string, direction: "read" | "write", detailPath?: string): never {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    const message = descriptions[error.code];
    if (message) throw direction === "read" ? new SsconvertError("io", `E ${uri}: ${message}`) :
      new FileWriteError(uri, `${detailPath === undefined ? "" : `${detailPath}: `}${message}`);
  }
  throw error;
}
