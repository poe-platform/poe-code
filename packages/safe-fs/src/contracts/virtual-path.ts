import { FsError } from "./errors.js";

export const MAX_PATH_BYTES = Infinity;
export const MAX_PATH_COMPONENTS = Infinity;

export interface PathLimits {
  readonly maxPathBytes?: number | undefined;
  readonly maxPathComponents?: number | undefined;
}

export function pathByteLength(path: string): number {
  let bytes = 0;
  for (const point of path) {
    const code = point.codePointAt(0)!;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}

export function validatePath(path: string, limits: PathLimits | number = {}): void {
  const maxBytes = typeof limits === "number" ? Infinity : limits.maxPathBytes ?? Infinity;
  const maxComponents = typeof limits === "number" ? limits : limits.maxPathComponents ?? Infinity;
  for (const value of [maxBytes, maxComponents]) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 0)) {
      throw new RangeError("Path limits must be nonnegative safe integers or Infinity");
    }
  }
  if (typeof path !== "string" || path.includes("\0")) {
    throw new FsError("EINVAL", { syscall: "resolve", message: "paths must be strings without NUL bytes" });
  }
  if (maxBytes !== Infinity && pathByteLength(path) > maxBytes) {
    throw new FsError("ENAMETOOLONG", { syscall: "resolve", path });
  }
  if (maxComponents === Infinity) return;
  const limit = maxComponents;
  let components = 0;
  let inComponent = false;
  for (let i = 0; i < path.length; i++) {
    if (path.charCodeAt(i) === 47) {
      inComponent = false;
    } else if (!inComponent) {
      inComponent = true;
      if (++components > limit) {
        throw new FsError("ENAMETOOLONG", { syscall: "resolve", path });
      }
    }
  }
}

function isFastCleanAbsPath(path: string): boolean {
  const len = path.length;
  if (len === 0 || path.charCodeAt(0) !== 47) return false;
  if (len === 1) return true;
  if (path.charCodeAt(len - 1) === 47) return false;
  let segStart = 1;
  for (let i = 1; i < len; i++) {
    const c = path.charCodeAt(i);
    if (c === 0) return false;
    if (c === 47) {
      const segLen = i - segStart;
      if (segLen === 0) return false;
      if (segLen === 1 && path.charCodeAt(segStart) === 46) return false;
      if (segLen === 2 && path.charCodeAt(segStart) === 46 && path.charCodeAt(segStart + 1) === 46) return false;
      segStart = i + 1;
    }
  }
  const lastLen = len - segStart;
  if (lastLen === 1 && path.charCodeAt(segStart) === 46) return false;
  if (lastLen === 2 && path.charCodeAt(segStart) === 46 && path.charCodeAt(segStart + 1) === 46) return false;
  return true;
}

function resolvePathSlow(cwd: string, paths: readonly string[]): string {
  const argLen = paths.length + 1;
  const components: string[] = [];
  for (let a = 0; a < argLen; a++) {
    const path = a === 0 ? cwd : paths[a - 1]!;
    if (a > 0) validatePath(path);
    if (path.startsWith("/")) components.length = 0;
    for (const component of path.split("/")) {
      if (component === "" || component === ".") continue;
      if (component === "..") components.pop();
      else components.push(component);
    }
  }
  return `/${components.join("/")}`;
}

export function resolvePath2(cwd: string, path0: string): string {
  validatePath(cwd);
  if (cwd.charCodeAt(0) !== 47) throw new FsError("EINVAL", { syscall: "resolve", path: cwd, message: "cwd must be absolute" });
  validatePath(path0);
  if (isFastCleanAbsPath(path0)) return path0;
  if (isFastCleanAbsPath(cwd) && path0.length > 0 && path0.charCodeAt(0) !== 47 && !path0.includes("/")) {
    if (path0 === ".") return cwd;
    if (path0 !== "..") return cwd === "/" ? `/${path0}` : `${cwd}/${path0}`;
  }
  return resolvePathSlow(cwd, [path0]);
}

export function resolvePath(cwd: string, ...paths: string[]): string {
  validatePath(cwd);
  if (!cwd.startsWith("/")) throw new FsError("EINVAL", { syscall: "resolve", path: cwd, message: "cwd must be absolute" });
  const argLen = paths.length + 1;
  if (argLen === 1) {
    if (isFastCleanAbsPath(cwd)) return cwd;
    return resolvePathSlow(cwd, paths);
  }
  if (argLen === 2) {
    return resolvePath2(cwd, paths[0]!);
  }
  return resolvePathSlow(cwd, paths);
}

export function normalizePath(path: string, cwd = "/"): string {
  return resolvePath2(cwd, path);
}

export function dirname(path: string): string {
  if (typeof path !== "string") throw new TypeError("path must be a string");
  let end = path.length;
  while (end > 0 && path[end - 1] === "/") end--;
  if (end === 0) return path.startsWith("/") ? "/" : ".";
  const boundary = path.lastIndexOf("/", end - 1);
  if (boundary < 0) return ".";
  if (boundary === 0) return "/";
  if (boundary === 1 && path.startsWith("/")) return "//";
  return path.slice(0, boundary);
}

export function relativePath(from: string, to: string): string {
  const source = normalizePath(from).split("/").filter(Boolean);
  const target = normalizePath(to).split("/").filter(Boolean);
  let common = 0;
  while (common < source.length && common < target.length && source[common] === target[common]) common++;
  return [...Array<string>(source.length - common).fill(".."), ...target.slice(common)].join("/");
}

export function isPathWithin(root: string, path: string): boolean {
  const normalizedRoot = normalizePath(root);
  const normalizedPath = normalizePath(path);
  return normalizedRoot === "/" || normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

export function assertPathWithin(root: string, path: string): string {
  const normalizedPath = normalizePath(path);
  if (!isPathWithin(root, normalizedPath)) throw new FsError("EACCES", { syscall: "resolve", path, message: "path escapes the allowed root" });
  return normalizedPath;
}
