import { posix } from "node:path";
import { FsError } from "./errors.js";

export const posixPath = posix;
export const basename = posix.basename;
export const dirname = posix.dirname;
export const extname = posix.extname;
export const joinPath = posix.join;
export const isAbsolutePath = posix.isAbsolute;

export function validatePath(path: string): void {
  if (typeof path !== "string" || path.includes("\0")) {
    throw new FsError("EINVAL", { syscall: "resolve", message: "paths must be strings without NUL bytes" });
  }
}

export function resolvePath(cwd: string, ...paths: string[]): string {
  validatePath(cwd);
  if (!posix.isAbsolute(cwd)) {
    throw new FsError("EINVAL", { syscall: "resolve", path: cwd, message: "cwd must be absolute" });
  }
  for (const path of paths) validatePath(path);
  return posix.resolve(cwd, ...paths);
}

export function normalizePath(path: string, cwd = "/"): string {
  return resolvePath(cwd, path);
}

export function relativePath(from: string, to: string): string {
  return posix.relative(normalizePath(from), normalizePath(to));
}

export function isPathWithin(root: string, path: string): boolean {
  const normalizedRoot = normalizePath(root);
  const normalizedPath = normalizePath(path);
  return normalizedRoot === "/"
    || normalizedPath === normalizedRoot
    || normalizedPath.startsWith(`${normalizedRoot}/`);
}

export function assertPathWithin(root: string, path: string): string {
  const normalizedPath = normalizePath(path);
  if (!isPathWithin(root, normalizedPath)) {
    throw new FsError("EACCES", { syscall: "resolve", path, message: "path escapes the allowed root" });
  }
  return normalizedPath;
}
