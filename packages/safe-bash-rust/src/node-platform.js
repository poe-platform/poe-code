import fs from "node:fs";
import { getSystemErrorMap } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adapterBytes } from "./stream-adapter.js";

export const posix = path.posix;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let systemErrors;
export function fsOperationError(text, syscall, path, dest, detail) {
  const code = text.split(":", 1)[0];
  systemErrors ??= new Map(Array.from(getSystemErrorMap(), ([errno, [name, description]]) => [name, [errno, description]]));
  const [errno, description] = systemErrors.get(code) ?? systemErrors.get("EIO");
  const message = `${code}: ${detail ?? (code === "ENOTSUP" ? "operation not supported" : description)}${syscall === undefined ? "" : ", " + syscall}` + (path === undefined ? "" : ` '${path}'`) + (dest === undefined ? "" : ` -> '${dest}'`);
  const error = Object.assign(new Error(message), { name: "FsError", code, errno, syscall, path, [Symbol.for("@poe-code/safe-fs.FsError")]: true });
  if (dest !== undefined) error.dest = dest;
  return error;
}
let compiledWasmModule = null;

export function coreModule() {
  if (!compiledWasmModule) {
    const bytes = fs.readFileSync(path.join(__dirname, "safe_bash_rust.wasm"));
    compiledWasmModule = new WebAssembly.Module(bytes);
  }
  return compiledWasmModule;
}
let adapter;
export function callbackModule() { return adapter ??= new WebAssembly.Module(adapterBytes); }
