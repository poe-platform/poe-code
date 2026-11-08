import {hostFs, fsConstants as constants} from "#safe-js-platform";
import {resolvePath, type FileSystem, type FileStat} from "@poe-code/safe-fs/core";

import path from "./paths.js";
import type {SourceResolver} from "./source-graph.js";

/** Explicit filesystem grant. No package lookup, extension search, or URL loading. */
export async function createRootedSourceResolver(root: string, adapter?: FileSystem): Promise<SourceResolver & {
  entryId(filename?: string): Promise<string>;
}> {
  const realpath = (filename: string) => adapter ? adapter.realpath(filename) : hostFs.realpath(filename);
  const stat = async (filename: string) => adapter ? sourceStat(await adapter.stat(filename)) : await hostFs.stat(filename);
  const granted = adapter ? resolvePath("/", root) : path.resolve(root);
  const directory = await realpath(granted);
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
      const handle = adapter
        ? await openSourceFile(adapter, id, signal)
        : await hostFs.open(id,constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        signal?.throwIfAborted();
        const actual = await handle.stat();
        signal?.throwIfAborted();
        // Read the checked inode, never reopen its pathname. These checks deny
        // observed replacements; Node's path APIs do not provide atomic ancestor
        // confinement against an adversary repeatedly swapping directories.
        if (!actual.isFile() || ("identity" in actual && "identity" in expected
          ? !sameSourceIdentity(actual.identity, expected.identity)
          : actual.dev !== expected.dev || actual.ino !== expected.ino)) return undefined;
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

function sourceStat(value: FileStat) {
  return {identity: value, dev: value.dev, ino: value.ino,
    isFile: () => value.type === "file", isDirectory: () => value.type === "directory"};
}

function sameSourceIdentity(actual: FileStat, expected: FileStat): boolean {
  if (expected.identityScope !== undefined && expected.opaqueIdentity !== undefined) {
    return actual.identityScope === expected.identityScope && actual.opaqueIdentity === expected.opaqueIdentity &&
      (expected.opaqueVersion === undefined || actual.opaqueVersion === expected.opaqueVersion);
  }
  return expected.dev !== undefined && expected.ino !== undefined && actual.dev === expected.dev && actual.ino === expected.ino;
}

async function openSourceFile(adapter: FileSystem, id: string, signal?: AbortSignal) {
  if (!adapter.openReadFile) throw new TypeError("Source filesystem must support retained reads.");
  const handle = await adapter.openReadFile(id, signal ? {signal} : {});
  return {
    stat: async () => sourceStat(await handle.stat(signal ? {signal} : {})),
    close: handle.close.bind(handle),
    async readFile(_options: {encoding: "utf8"; signal?: AbortSignal}) {
      const decoder = new TextDecoder("utf-8", {ignoreBOM: true});
      const chunks: string[] = [];
      let position = 0;
      for (;;) {
        signal?.throwIfAborted();
        const chunk = await handle.read(position, 64 * 1024, signal ? {signal} : {});
        if (chunk.byteLength === 0) break;
        chunks.push(decoder.decode(chunk, {stream: true}));
        position += chunk.byteLength;
      }
      chunks.push(decoder.decode());
      return chunks.join("");
    }
  };
}
