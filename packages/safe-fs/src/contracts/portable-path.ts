import { dirname as virtualDirname } from "./virtual-path.js";

function assertString(value: unknown): asserts value is string {
  if (typeof value !== "string") throw new TypeError("path must be a string");
}

export function basename(path: string, suffix = ""): string {
  assertString(path);
  assertString(suffix);
  if (suffix && path === suffix) return "";
  let end = path.length;
  while (end > 0 && path[end - 1] === "/") end--;
  if (end === 0 && suffix && suffix.length <= path.length) return path;
  const start = path.lastIndexOf("/", end - 1) + 1;
  const base = path.slice(start, end);
  if (suffix.length > base.length && suffix.length <= path.length && suffix.endsWith(base)) return path.slice(start);
  return suffix && suffix.length < base.length && base.endsWith(suffix)
    ? base.slice(0, -suffix.length)
    : base;
}

export const dirname = virtualDirname;

export function extname(path: string): string {
  const base = basename(path);
  const position = base.lastIndexOf(".");
  return position <= 0 || base === ".." ? "" : base.slice(position);
}

export function isAbsolutePath(path: string): boolean {
  assertString(path);
  return path.startsWith("/");
}

export function joinPath(...paths: string[]): string {
  for (const path of paths) assertString(path);
  const joined = paths.filter(Boolean).join("/");
  if (!joined) return ".";
  const absolute = joined.startsWith("/");
  const components: string[] = [];
  for (const component of joined.split("/")) {
    if (!component || component === ".") continue;
    if (component === "..") {
      if (components.length && components.at(-1) !== "..") components.pop();
      else if (!absolute) components.push(component);
    } else components.push(component);
  }
  const result = `${absolute ? "/" : ""}${components.join("/")}` || ".";
  return joined.endsWith("/") && result !== "/" ? `${result}/` : result;
}

export const posixPath = Object.freeze({ basename, dirname, extname, join: joinPath, isAbsolute: isAbsolutePath });
