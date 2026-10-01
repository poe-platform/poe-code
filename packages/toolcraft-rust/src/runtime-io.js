import { access, lstat, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { callNative, protect } from "./host-errors.js";

const native = createRequire(import.meta.url)("./toolcraft-rust.node");
export const RESERVED_SERVICE_NAMES = new Set(native.reservedServiceNames());
const reservedMessage = `Available reserved names: ${[...RESERVED_SERVICE_NAMES].join(", ")}.`;
let depth = 0;
function invoke(operation, args) {
  if (depth >= 128) throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try { return callNative(native.runtimePolicy, operation, args, host); }
  finally { depth--; }
}
const operations = {
  keys: Object.keys,
  has: (reserved, name) => !!reserved.has(name),
  undefined: () => undefined,
  reserved(name, message) { throw new Error(`Service name "${name}" is reserved. Choose a different name. ${message}`); },
  invalidOperation() { throw new TypeError("Invalid runtime policy operation"); },
  eachService(names, reserved, message) {
    for (const name of names) invoke("service", [name, reserved, message]);
  }
};
const host = { operate: protect((name, args) => operations[name](...args)), get: protect((value, key) => value[key]) };

export function validateServices(services) {
  return invoke("services", [services, RESERVED_SERVICE_NAMES, reservedMessage]);
}

// Filesystem promises and environment property access stay in the caller's
// Node realm. Injected capabilities pass through with their identity intact.
export function createFs(fs) {
  if (fs !== undefined) return fs;
  return {
    readFile: async (path, encoding = "utf8") => readFile(path, { encoding }),
    writeFile: async (path, contents, options) => { await writeFile(path, contents, options); },
    exists: async path => {
      try { await access(path); return true; }
      catch { return false; }
    },
    lstat: async path => lstat(path),
    rename: async (fromPath, toPath) => rename(fromPath, toPath),
    unlink: async path => unlink(path)
  };
}

export function createEnv(values = process.env) {
  return { get(key) { return values[key]; } };
}
