import type { ErrnoCode, FsError } from "@poe-code/safe-fs/contracts";
import { PythonRuntimeError, type PythonOSErrorName } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { CodePointString } from "./code-point-string.js";

export interface FileSystemErrorContext {
  /** Guest-platform errno numbering and strerror text, not host/libuv errno.
   * Must cover every safe-fs code accepted by this execution's adapters. */
  errno(code: ErrnoCode): { readonly number: number; readonly message: string };
}

const subclasses: Partial<Record<ErrnoCode, PythonOSErrorName>> = {
  ENOENT: "FileNotFoundError", EEXIST: "FileExistsError", EACCES: "PermissionError", EPERM: "PermissionError",
  ENOTDIR: "NotADirectoryError", EISDIR: "IsADirectoryError", EAGAIN: "BlockingIOError", EINTR: "InterruptedError",
  EPIPE: "BrokenPipeError", ETIMEDOUT: "TimeoutError"
};

/** Internal OSError payload, not a guest exception instance. The exception
 * assembly layer retains these fields when constructing the corresponding type. */
export class PythonFileSystemError extends PythonRuntimeError {
  constructor(name: PythonOSErrorName, message: string, readonly errno: number, readonly strerror: string, readonly filename?: string, readonly filename2?: string) {
    super(name, message);
  }
}

export function translateFileSystemError(error: FsError, context: FileSystemErrorContext, meter: ExecutionMeter): PythonFileSystemError {
  meter.checkpoint();
  const info = context.errno(error.code); meter.checkpoint();
  if (!Number.isSafeInteger(info.number) || info.number < 0) throw new RangeError("guest errno must be a nonnegative safe integer");
  meter.checkpoint(0, 128 + info.message.length * 2);
  let message = `[Errno ${info.number}] ${info.message}`;
  for (const [index, path] of [error.path, error.dest].entries()) {
    if (path === undefined || error.path === undefined) continue;
    meter.checkpoint(path.length + 1, path.length * 4);
    const storage = new CodePointString(Uint32Array.from(path, character => character.codePointAt(0)!));
    const quoted = storage.repr(false, meter);
    meter.checkpoint(0, 8 + quoted.length * 4);
    message += index === 0 ? ": " : " -> ";
    for (const point of quoted) { meter.checkpoint(); message += String.fromCodePoint(point); }
  }
  return new PythonFileSystemError(subclasses[error.code] ?? "OSError", message, info.number, info.message, error.path, error.path === undefined ? undefined : error.dest);
}
