export function basename(path: string, suffix = ""): string {
  let end = path.length;
  while (end > 0 && path[end - 1] === "/") end--;
  const base = path.slice(path.lastIndexOf("/", end - 1) + 1, end);
  return suffix && base.endsWith(suffix) ? base.slice(0, -suffix.length) : base;
}

export function dirname(path: string): string {
  if (!path) return ".";
  let end = path.length - 1;
  while (end > 0 && path[end] === "/") end--;
  while (end >= 0 && path[end] !== "/") end--;
  if (end < 0) return ".";
  if (end === 0) return "/";
  if (end === 1 && path[0] === "/") return "//";
  return path.slice(0, end);
}

export function extname(path: string): string {
  const base = basename(path);
  const dot = base.lastIndexOf(".");
  return dot <= 0 || base === ".." ? "" : base.slice(dot);
}

export function isAbsolutePath(path: string): boolean {
  return path.startsWith("/");
}

export function joinPath(...paths: string[]): string {
  const joined = paths.filter(Boolean).join("/");
  if (!joined) return ".";
  const absolute = isAbsolutePath(joined);
  const parts: string[] = [];
  for (const part of joined.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length && parts.at(-1) !== "..") parts.pop();
      else if (!absolute) parts.push(part);
    } else parts.push(part);
  }
  const result = `${absolute ? "/" : ""}${parts.join("/")}` || ".";
  return joined.endsWith("/") && result !== "/" ? `${result}/` : result;
}

export const posixPath = Object.freeze({
  basename,
  dirname,
  extname,
  join: joinPath,
  isAbsolute: isAbsolutePath
});
