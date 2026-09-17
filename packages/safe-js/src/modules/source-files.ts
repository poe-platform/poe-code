import {open,realpath,stat} from "node:fs/promises";
import {constants} from "node:fs";
import path from "node:path";
import type {SourceResolver} from "./source-graph.js";

/** Explicit Node host grant. No package lookup, extension search, or URL loading. */
export async function createRootedSourceResolver(root: string): Promise<SourceResolver & {
  entryId(filename?: string): Promise<string>;
}> {
  const directory = await realpath(root);
  const granted = path.resolve(root);
  if (!(await stat(directory)).isDirectory()) throw new TypeError("Source module root must be a directory.");
  const contains = (filename: string) => {
    const relative = path.relative(directory,filename);
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  const resolver: SourceResolver = async (specifier,referrer,{signal}) => {
    signal?.throwIfAborted();
    if ((!specifier.startsWith("./") && !specifier.startsWith("../")) || !path.isAbsolute(referrer)) return undefined;
    const relative = path.relative(granted,referrer);
    const canonicalReferrer = relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
      ? path.resolve(directory,relative) : referrer;
    if (!contains(canonicalReferrer)) return undefined;
    const candidate = path.resolve(path.dirname(canonicalReferrer),specifier);
    if (!contains(candidate)) return undefined;
    try {
      const id = await realpath(candidate);
      signal?.throwIfAborted();
      if (!contains(id)) return undefined;
      const expected = await stat(id);
      signal?.throwIfAborted();
      if (!expected.isFile()) return undefined;
      const handle = await open(id,constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        signal?.throwIfAborted();
        const actual = await handle.stat();
        signal?.throwIfAborted();
        // Read the checked inode, never reopen its pathname. These checks deny
        // observed replacements; Node's path APIs do not provide atomic ancestor
        // confinement against an adversary repeatedly swapping directories.
        if (!actual.isFile() || actual.dev !== expected.dev || actual.ino !== expected.ino) return undefined;
        const currentId = await realpath(id);
        signal?.throwIfAborted();
        if (currentId !== id) return undefined;
        const source = await handle.readFile({encoding:"utf8",signal});
        signal?.throwIfAborted();
        return {id,source};
      } finally {await handle.close();}
    } catch (error) {
      signal?.throwIfAborted();
      if (error !== null && typeof error === "object" && "code" in error &&
          ["ENOENT","ENOTDIR","ELOOP"].includes(String(error.code))) return undefined;
      throw error;
    }
  };
  return Object.assign(resolver, {async entryId(filename?: string): Promise<string> {
    if (filename === undefined) return path.join(directory,"<entry>");
    const supplied = path.resolve(granted,filename);
    const relative = path.relative(granted,supplied);
    const candidate = relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
      ? path.resolve(directory,relative) : supplied;
    if (!contains(candidate)) throw new TypeError("Source entry must be inside its granted root.");
    try {
      const id = await realpath(candidate);
      if (!contains(id)) throw new TypeError("Source entry must be inside its granted root.");
      return id;
    } catch (error) {
      if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") return candidate;
      throw error;
    }
  }});
}
