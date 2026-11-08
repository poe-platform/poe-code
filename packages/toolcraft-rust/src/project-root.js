import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { callNative, protect } from "./host-errors.js";

const native = createRequire(import.meta.url)("./toolcraft-rust.node");
const operations = {
  cwd: () => process.cwd(),
  resolve: value => path.resolve(value),
  parent: value => path.dirname(value),
  packagePath: value => path.join(value, "package.json"),
  exists: value => !!existsSync(value),
  undefined: () => undefined
};
const host = { operate: protect((name, args) => operations[name](...args)), get: protect((value, key) => value[key]) };

export function findProjectRoot(from = process.cwd()) {
  return callNative(native.errorReportPolicy, "findProjectRoot", [from], host);
}
