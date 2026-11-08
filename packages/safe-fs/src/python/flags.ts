import { FsError } from "../contracts/errors.js";
import type { OpenFileOptions } from "../contracts/filesystem.js";

/** Emscripten's pinned musl flag ABI, not the host operating system's flags. */
export function translatePythonOpenFlags(flags: number, mode = 0o666): OpenFileOptions {
  if (!Number.isSafeInteger(flags) || flags < 0 || flags > 0x7fffffff || (flags & 3) === 3) throw new FsError("EINVAL", { syscall: "open" });
  const exclusive = (flags & (64 | 128)) === (64 | 128);
  // CLOEXEC and LARGEFILE do not alter the lifetime or numeric range of a virtual descriptor.
  const supported = 3 | 64 | 128 | 512 | 1024 | 32768 | 524288 | (exclusive ? 131072 : 0);
  if ((flags & ~supported) !== 0) throw new FsError("ENOTSUP", { syscall: "open" });
  return { access: (flags & 3) === 0 ? "read" : (flags & 3) === 1 ? "write" : "readwrite",
    creation: (flags & 64) !== 0 ? exclusive ? "exclusive" : "ifMissing" : "never",
    truncate: (flags & 512) !== 0, append: (flags & 1024) !== 0, mode };
}
