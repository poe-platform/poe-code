import { FsError, isFsError } from "../../contracts/errors.js";
import type { FileStat, FileSystem, FsOptions } from "../../contracts/filesystem.js";
import { validatePath } from "../../contracts/virtual-path.js";
import { capturePathNamespace } from "../path-namespace.js";

export const nullPath = "/dev/null";
export const deviceDirectory = "/dev";

export function lexicalDevicePath(path: string): string {
  validatePath(path);
  const parts: string[] = [];
  for (const component of path.split("/")) {
    if (`/${parts.join("/")}` === nullPath) throw new FsError("ENOTDIR", { path });
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
    if (new TextEncoder().encode(component).byteLength > 255) throw new FsError("ENAMETOOLONG", { path });
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
        pending.unshift(...targetParts);
        continue;
      }
    }
    parts.push(component);
  }
  return `/${parts.join("/")}`;
}

export async function resolveDevicePath(filesystem: FileSystem, path: string, options: FsOptions, followFinal = true, resizeCreate?: boolean): Promise<string> {
  options.signal?.throwIfAborted();
  const namespace = capturePathNamespace(filesystem, options);
  if (resizeCreate !== undefined) return resolveResizeDevicePath(filesystem, path, options, resizeCreate, namespace);
  const lexical = lexicalDevicePath(path);
  const lstat = filesystem.lstat;
  options.signal?.throwIfAborted();
  const aliases = typeof lstat === "function";
  if (!aliases && lexical !== nullPath && lexical !== deviceDirectory && lexical !== "/") return lexical;
  const pending = path.split("/");
  const parts: string[] = [];
  let links = 0;
  let expanded = path.length;
  let absolute = path.startsWith("/");
  let traversalFailure: FsError | undefined;
  let boundary: string | undefined;
  while (pending.length) {
    options.signal?.throwIfAborted();
    if (`/${parts.join("/")}` === nullPath) throw new FsError("ENOTDIR", { path });
    const component = pending.shift()!;
    if (!component || component === ".") continue;
    if (component === "..") {
      if (boundary !== undefined && `/${parts.join("/")}` === boundary) throw new FsError("EACCES", { path });
      parts.pop();
      continue;
    }
    const candidate = `/${[...parts, component].join("/")}`;
    const selected = namespace === undefined ? undefined : candidate === deviceDirectory || candidate === nullPath ? "/" : namespace(candidate);
    if (boundary !== undefined && selected !== boundary) throw new FsError("EACCES", { path });
    if (candidate !== deviceDirectory && candidate !== nullPath && ((followFinal && aliases) || pending.length)) {
      const lookup = absolute ? candidate : candidate.slice(1);
      let stat: FileStat | undefined;
      try {
        if (typeof lstat !== "function") throw new FsError("ENOTSUP", { path });
        stat = await Reflect.apply(lstat, filesystem, [lookup, options]);
      } catch (error) {
        options.signal?.throwIfAborted();
        if (isFsError(error, "ENOTSUP") && links === 0 && lexical !== nullPath && lexical !== deviceDirectory && lexical !== "/") return lexical;
        if (!isFsError(error, "ENOENT")) throw error;
        if (pending.length) traversalFailure ??= error;
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
        if (target.startsWith("/")) {
          parts.splice(0, parts.length, ...(boundary ?? "/").split("/").filter(Boolean));
          absolute = true;
        }
        pending.unshift(...target.split("/"));
        continue;
      }
      if (stat && pending.length && stat.type !== "directory") traversalFailure ??= new FsError("ENOTDIR", { path });
    }
    parts.push(component);
  }
  const resolved = `/${parts.join("/")}`;
  if (traversalFailure && (resolved === nullPath || resolved === deviceDirectory || resolved === "/")) throw traversalFailure;
  return resolved;
}
