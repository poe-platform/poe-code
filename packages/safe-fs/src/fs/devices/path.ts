import { FsError, isFsError } from "../../contracts/errors.js";
import type { FileStat, FileSystem, FsOptions } from "../../contracts/filesystem.js";
import { MAX_PATH_COMPONENTS, validatePath } from "../../contracts/virtual-path.js";
import { capturePathNamespace, pathNamespace } from "../path-namespace.js";
import { isCleanAbsolutePath, tryResolveMemoryDevicePath } from "../memory/index.js";

export const nullPath = "/dev/null";
export const deviceDirectory = "/dev";

function isNullParts(parts: readonly string[]): boolean {
  return parts.length === 2 && parts[0] === "dev" && parts[1] === "null";
}

export function lexicalDevicePath(path: string): string {
  validatePath(path);
  if (isCleanAbsolutePath(path) && !path.startsWith("/dev/null/")) return path;
  const parts: string[] = [];
  for (const component of path.split("/")) {
    if (isNullParts(parts)) throw new FsError("ENOTDIR", { path });
    if (component === "..") parts.pop();
    else if (component && component !== ".") parts.push(component);
  }
  return `/${parts.join("/")}`;
}

async function resolveResizeDevicePath(filesystem: FileSystem, path: string, options: FsOptions, create: boolean, namespace: ((path: string) => string) | undefined): Promise<string> {
  validatePath(path);
  const components = (value: string) => {
    const result = value.split("/").filter(Boolean);
    if (value.endsWith("/")) result.push("");
    return result;
  };
  const pending = components(path);
  let remainingComponents = MAX_PATH_COMPONENTS - pending.length;
  if (remainingComponents < 0) throw new FsError("ENAMETOOLONG", { path });
  const parts: string[] = [];
  let links = 0;
  let expanded = path.length;
  let boundary: string | undefined;
  while (pending.length) {
    options.signal?.throwIfAborted();
    const component = pending.shift()!;
    const current = `/${parts.join("/")}`;
    if (current === nullPath) throw new FsError("ENOTDIR", { path });
    if (current !== deviceDirectory) {
      const observe = filesystem.stat;
      options.signal?.throwIfAborted();
      const stat = await Reflect.apply(observe, filesystem, [current, options]);
      options.signal?.throwIfAborted();
      if (stat.type !== "directory") throw new FsError("ENOTDIR", { path });
      if (!(component === "" && pending.length === 0)) {
        const access = filesystem.access;
        options.signal?.throwIfAborted();
        await Reflect.apply(access, filesystem, [current, 1, options]);
        options.signal?.throwIfAborted();
      }
    }
    if (component === "." || component === "") continue;
    if (component === "..") {
      if (boundary !== undefined && current === boundary) throw new FsError("EACCES", { path });
      parts.pop();
      continue;
    }
    if (exceedsComponentByteLimit(component)) throw new FsError("ENAMETOOLONG", { path });
    const candidate = `/${[...parts, component].join("/")}`;
    const selected = namespace === undefined ? undefined : candidate === deviceDirectory || candidate === nullPath ? "/" : namespace(candidate);
    if (boundary !== undefined && selected !== boundary) throw new FsError("EACCES", { path });
    if (create && pending.length === 1 && pending[0] === "") throw new FsError("EISDIR", { path });
    if (candidate !== deviceDirectory && candidate !== nullPath) {
      let stat: FileStat | undefined;
      const lstat = filesystem.lstat;
      options.signal?.throwIfAborted();
      try { stat = await Reflect.apply(lstat, filesystem, [candidate, options]); }
      catch (error) {
        options.signal?.throwIfAborted();
        if (!(isFsError(error, "ENOENT") && create && pending.length === 0)) throw error;
      }
      options.signal?.throwIfAborted();
      if (stat?.type === "symlink") {
        boundary ??= selected;
        const readlink = filesystem.readlink;
        options.signal?.throwIfAborted();
        if (typeof readlink !== "function") throw new FsError("ENOTSUP", { path });
        if (++links > 40) throw new FsError("ELOOP", { path });
        const target = await Reflect.apply(readlink, filesystem, [candidate, options]);
        options.signal?.throwIfAborted();
        validatePath(target);
        expanded += target.length;
        if (expanded > 65536) throw new FsError("ENAMETOOLONG", { path });
        if (target.startsWith("/")) parts.splice(0, parts.length, ...(boundary ?? "/").split("/").filter(Boolean));
        const targetParts = components(target);
        if (targetParts.at(-1) === "" && pending[0] === "") targetParts.pop();
        if (targetParts.length > remainingComponents) throw new FsError("ENAMETOOLONG", { path });
        remainingComponents -= targetParts.length;
        pending.unshift(...targetParts);
        continue;
      }
    }
    parts.push(component);
  }
  return `/${parts.join("/")}`;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

function exceedsComponentByteLimit(value: string): boolean {
  return value.length > 85 && (value.length > 255 || utf8ByteLength(value) > 255);
}

export async function resolveDevicePath(filesystem: FileSystem, path: string, options: FsOptions, followFinal = true, resizeCreate?: boolean): Promise<string> {
  options.signal?.throwIfAborted();
  if (resizeCreate === undefined && Reflect.get(filesystem, pathNamespace) === undefined) {
    const fast = tryResolveMemoryDevicePath(filesystem, path);
    if (fast !== undefined) return fast;
  }
  const namespace = capturePathNamespace(filesystem, options);
  if (resizeCreate !== undefined) return resolveResizeDevicePath(filesystem, path, options, resizeCreate, namespace);
  const lexical = lexicalDevicePath(path);
  const lstat = filesystem.lstat;
  options.signal?.throwIfAborted();
  const aliases = typeof lstat === "function";
  if (!aliases && lexical !== nullPath && lexical !== deviceDirectory && lexical !== "/") return lexical;
  const pending = path.split("/");
  let remainingComponents = MAX_PATH_COMPONENTS - pending.filter(Boolean).length;
  if (remainingComponents < 0) throw new FsError("ENAMETOOLONG", { path });
  const parts: string[] = [];
  let links = 0;
  let expanded = path.length;
  let absolute = path.startsWith("/");
  let traversalFailure: FsError | undefined;
  let failedDepth = Infinity;
  let boundary: string | undefined;
  while (pending.length) {
    options.signal?.throwIfAborted();
    if (isNullParts(parts)) throw new FsError("ENOTDIR", { path });
    const component = pending.shift()!;
    if (!component || component === ".") continue;
    if (component === "..") {
      if (boundary !== undefined && `/${parts.join("/")}` === boundary) throw new FsError("EACCES", { path });
      parts.pop();
      if (parts.length < failedDepth) {
        traversalFailure = undefined;
        failedDepth = Infinity;
      }
      continue;
    }
    const candidate = `/${[...parts, component].join("/")}`;
    const selected = namespace === undefined ? undefined : candidate === deviceDirectory || candidate === nullPath ? "/" : namespace(candidate);
    if (boundary !== undefined && selected !== boundary) throw new FsError("EACCES", { path });
    if (parts.length < failedDepth && candidate !== deviceDirectory && candidate !== nullPath && ((followFinal && aliases) || pending.length)) {
      const lookup = absolute ? candidate : candidate.slice(1);
      let stat: FileStat | undefined;
      try {
        if (typeof lstat !== "function") throw new FsError("ENOTSUP", { path });
        stat = await Reflect.apply(lstat, filesystem, [lookup, options]);
      } catch (error) {
        options.signal?.throwIfAborted();
        if (isFsError(error, "ENOTSUP") && links === 0 && lexical !== nullPath && lexical !== deviceDirectory && lexical !== "/") return lexical;
        if (!isFsError(error, "ENOENT")) throw error;
        if (pending.length) {
          traversalFailure ??= error;
          failedDepth = Math.min(failedDepth, parts.length + 1);
        }
      }
      options.signal?.throwIfAborted();
      if (stat?.type === "symlink") {
        boundary ??= selected;
        const readlink = filesystem.readlink;
        options.signal?.throwIfAborted();
        if (typeof readlink !== "function") throw new FsError("ENOTSUP", { path });
        if (++links > 40) throw new FsError("ELOOP", { path });
        const target = await Reflect.apply(readlink, filesystem, [lookup, options]);
        options.signal?.throwIfAborted();
        validatePath(target);
        expanded += target.length;
        if (expanded > 65536) throw new FsError("ENAMETOOLONG", { path });
        const targetSplit = target.split("/");
        const nonEmptyCount = targetSplit.filter(Boolean).length;
        if (nonEmptyCount > remainingComponents) throw new FsError("ENAMETOOLONG", { path });
        remainingComponents -= nonEmptyCount;
        if (target.startsWith("/")) {
          parts.splice(0, parts.length, ...(boundary ?? "/").split("/").filter(Boolean));
          absolute = true;
          traversalFailure = undefined;
          failedDepth = Infinity;
        }
        pending.unshift(...targetSplit);
        continue;
      }
      if (stat && pending.length && stat.type !== "directory") {
        traversalFailure ??= new FsError("ENOTDIR", { path });
        failedDepth = Math.min(failedDepth, parts.length + 1);
      }
    }
    parts.push(component);
  }
  const resolved = `/${parts.join("/")}`;
  if (traversalFailure && (resolved === nullPath || resolved === deviceDirectory || resolved === "/")) throw traversalFailure;
  return resolved;
}
