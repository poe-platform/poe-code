import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { callNative, protect } from "./host-errors.js";

const native = createRequire(import.meta.url)("./toolcraft-rust.node");
const host = {
  realpath: protect((value) => realpathSync(value)),
  isDirectory: protect((value) => statSync(value).isDirectory()),
  parent: protect((value) => path.dirname(value)),
  packagePath: protect((value) => path.join(value, "package.json")),
  exists: protect((value) => existsSync(value))
};

function pathFromInput(from) {
  if (from instanceof URL || from.startsWith("file:")) return fileURLToPath(from);
  return path.resolve(from);
}

export function findPackageMetadata(from) {
  const packageJsonPath = callNative(native.findPackagePath, pathFromInput(from), host);
  if (packageJsonPath == null) return undefined;
  const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const metadata = { path: packageJsonPath };
  if (typeof parsed.name === "string") metadata.name = parsed.name;
  if (typeof parsed.version === "string") metadata.version = parsed.version;
  return metadata;
}

export function packageMetadata(from = process.cwd()) {
  const metadata = findPackageMetadata(from);
  if (metadata === undefined) throw new Error(`No package.json found from ${pathFromInput(from)}.`);
  return metadata;
}

export function findEntrypointPackageMetadata(entrypoint) {
  if (entrypoint === undefined || entrypoint.length === 0) return undefined;
  if (!path.isAbsolute(entrypoint) && !entrypoint.startsWith("file:")) return undefined;
  return findPackageMetadata(entrypoint);
}
