import { createHash } from "node:crypto";
import { appendFileSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { relative, resolve as pathResolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const config = JSON.parse(readFileSync(process.env.VALIDATION_GUARD_CONFIG, "utf8"));
const packageRoot = realpathSync(pathResolve(config.packageRoot));
const packagePrefix = `${packageRoot}${sep}`;
const allowedHarness = new Set(config.allowedHarness.map(value => realpathSync(pathResolve(value))));

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function record(value) {
  appendFileSync(config.logPath, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "a" });
}

function reject(message, detail) {
  record({ event: "reject", message, ...detail });
  throw new Error(message);
}

function packageRelative(path) {
  if (path === packageRoot) return "";
  if (!path.startsWith(packagePrefix)) return null;
  return relative(packageRoot, path).split(sep).join("/");
}

function inspectPackageFile(url) {
  const path = fileURLToPath(url);
  const lexicalRelative = packageRelative(path);
  if (lexicalRelative === null) return null;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    reject(`VALIDATION_GUARD_NON_REGULAR: ${lexicalRelative}`, { url });
  }
  const realPath = realpathSync(path);
  if (packageRelative(realPath) === null) {
    reject(`VALIDATION_GUARD_REALPATH_ESCAPE: ${lexicalRelative}`, { url, realPath });
  }
  const expected = config.packageFiles[lexicalRelative];
  if (typeof expected !== "string") {
    reject(`VALIDATION_GUARD_UNAUTHENTICATED_FILE: ${lexicalRelative}`, { url, realPath });
  }
  const actual = sha256(readFileSync(realPath));
  if (actual !== expected) {
    reject(`VALIDATION_GUARD_HASH_MISMATCH: ${lexicalRelative} expected=${expected} actual=${actual}`, {
      url,
      realPath,
    });
  }
  return { path, realPath, relative: lexicalRelative, sha256: actual };
}

export async function resolveHook(specifier, context, nextResolve) {
  if (specifier.startsWith("node:")) return nextResolve(specifier, context);
  const result = await nextResolve(specifier, context);
  if (!result.url.startsWith("file:")) {
    reject(`VALIDATION_GUARD_NON_FILE_MODULE: ${result.url}`, { specifier, parentURL: context.parentURL ?? null });
  }
  const path = fileURLToPath(result.url);
  const realPath = realpathSync(pathResolve(path));
  if (allowedHarness.has(realPath)) return result;
  if (packageRelative(realPath) !== null) return result;
  reject(`VALIDATION_GUARD_OUTSIDE_PACKAGE: specifier=${specifier} url=${result.url}`, {
    specifier,
    parentURL: context.parentURL ?? null,
    resolvedURL: result.url,
  });
}

export async function loadHook(url, context, nextLoad) {
  if (url.startsWith("node:")) return nextLoad(url, context);
  const path = fileURLToPath(url);
  if (allowedHarness.has(realpathSync(pathResolve(path)))) return nextLoad(url, context);
  const authenticated = inspectPackageFile(url);
  if (authenticated === null) reject(`VALIDATION_GUARD_OUTSIDE_LOAD: ${url}`, { url });
  record({ event: "load", url, ...authenticated });
  return nextLoad(url, context);
}

export function initialize() {
  record({
    event: "initialize",
    packageRoot,
    packageRootRealpath: realpathSync(packageRoot),
    expectedFileCount: Object.keys(config.packageFiles).length,
    allowedHarness: [...allowedHarness].sort(),
  });
}

export function globalPreload() {
  return "";
}

export const resolve = resolveHook;
export const load = loadHook;
