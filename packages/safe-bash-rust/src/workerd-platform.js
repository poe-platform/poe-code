import core from "./safe_bash_rust.wasm";
import adapter from "./stream-adapter.wasm";
import { FsError, isErrnoCode } from "@poe-code/safe-fs/runtime-core";
export { posixPath as posix } from "@poe-code/safe-fs/runtime-core";

export function coreModule() { return core; }
export function callbackModule() { return adapter; }
export function fsOperationError(text, syscall, path, dest, message) {
  const code = text.split(":", 1)[0];
  if (isErrnoCode(code)) return new FsError(code, { syscall, path, dest, message });
  // EOVERFLOW is a Wasm descriptor error outside safe-fs's portable errno list.
  return Object.assign(new Error(`${code}: ${message ?? text}`), { name: "FsError", code, syscall, path, dest });
}
