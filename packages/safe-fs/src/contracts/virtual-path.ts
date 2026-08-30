import { FsError } from "./errors.js";

export function validatePath(path: string): void {
  if (typeof path !== "string" || path.includes("\0")) {
    throw new FsError("EINVAL", { syscall: "resolve", message: "paths must be strings without NUL bytes" });
  }
}

export function resolvePath(cwd: string, ...paths: string[]): string {
  validatePath(cwd);
  if (!cwd.startsWith("/")) throw new FsError("EINVAL", { syscall: "resolve", path: cwd, message: "cwd must be absolute" });
  for (const path of paths) validatePath(path);
  const components: string[] = [];
  for (const path of [cwd, ...paths]) {
    if (path.startsWith("/")) components.length = 0;
    for (const component of path.split("/")) {
      if (component === "" || component === ".") continue;
      if (component === "..") components.pop();
      else components.push(component);
    }
  }
  return `/${components.join("/")}`;
}

export function normalizePath(path: string, cwd = "/"): string {
  return resolvePath(cwd, path);
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
