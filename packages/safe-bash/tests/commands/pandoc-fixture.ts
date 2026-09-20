import {Volume} from "memfs";
import {Shell} from "../../src/shell/index.js";
import {MemoryFileSystem} from "../../src/fs/memory/index.js";
import {FsError, type FileSystem} from "../../src/contracts/index.js";
import {agentCommands} from "../../src/plugins/index.js";

import {pandocCommands} from "../../src/commands/pandoc/index.js";
export function fixture() {
  const volume = Volume.fromJSON({"/work/a b.md": "Alpha", "/work/b.md": "Beta", "/work/-name.md": "Dash", "/work/out": "Keep"});
  const base = new MemoryFileSystem();
  const identityScope = {};
  const observe = (follow: boolean): FileSystem["stat"] => async (path, options) => {
    options?.signal?.throwIfAborted();
    try {
      const value = follow ? volume.statSync(path) : volume.lstatSync(path);
      return {type: value.isSymbolicLink() ? "symlink" : value.isDirectory() ? "directory" : "file", size: value.size, mode: value.mode, mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs, atimeMs: value.atimeMs, dev: value.dev, ino: value.ino, identityScope};
    } catch {throw new FsError("ENOENT", {path});}
  };
  const stat = observe(true), lstat = observe(false);
  const fs: FileSystem = new Proxy(base, {get(target, key) {
    if (key === "stat") return stat;
    if (key === "lstat") return lstat;
    if (key === "mkdir") return async (path: string, options?: {recursive?: boolean; signal?: AbortSignal}) => {options?.signal?.throwIfAborted(); volume.mkdirSync(path, {recursive: options?.recursive ?? false});};
    if (key === "realpath") return async (path: string) => String(volume.realpathSync(path));
    if (key === "capabilities") return {...target.capabilities, atomicFileMutation: true};
    if (["openReadFile", "openResizeFile", "readStream", "writeStream", "capabilitiesFor", "compareEntry"].includes(String(key))) return undefined;
    if (key === "access") return async (path: string) => {await stat(path);};
    if (key === "open") return async (path: string, options: {access: string; creation?: string; truncate?: boolean; append?: boolean; signal?: AbortSignal}) => {
      options.signal?.throwIfAborted();
      const fd = volume.openSync(path, options.access === "read" ? "r" : options.creation === "exclusive" ? "wx" : options.truncate ? "w" : "a");
      return {capabilities: {positionedRead: true, positionedWrite: true, truncate: true, synchronization: "volatile"},
        stat: async () => stat(path),
        read: async (buffer: Uint8Array, position: number | null) => volume.readSync(fd, buffer, 0, buffer.length, position),
        write: async (buffer: Uint8Array, position: number | null) => volume.writeSync(fd, buffer, 0, buffer.length, position),
        truncate: async (length: number) => {volume.ftruncateSync(fd, length);}, sync: async () => {}, close: async () => {volume.closeSync(fd);}};
    };
    if (key === "readFile") return async (path: string, options?: {signal?: AbortSignal}) => {options?.signal?.throwIfAborted(); if (!volume.existsSync(path)) throw new FsError("ENOENT"); return new Uint8Array(volume.readFileSync(path) as Buffer);};
    if (key === "writeFile" || key === "writeFileConditional") return async (path: string, bytes: Uint8Array, options?: {signal?: AbortSignal; flag?: string}) => {options?.signal?.throwIfAborted(); volume.writeFileSync(path, bytes, {flag: options?.flag ?? "w"}); return stat(path);};
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  }});
  const shell = new Shell({fs, cwd: "/work"}).use(agentCommands()).use(pandocCommands());
  return {volume, fs, shell};
}
