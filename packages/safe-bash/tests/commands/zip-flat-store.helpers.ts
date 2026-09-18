import { FsError, normalizePath, type ByteSource, type ConditionalFilePublicationOptions, type FileStat, type FileSystem, type FsOptions } from "@poe-code/safe-fs/core";

/** Bounded host model: implicit directories and immutable blobs, with no inodes. */
export function flatStore() {
  const scope = {};
  const rows = new Map<string, { bytes: Uint8Array; identity: string; version: string; time: number }>();
  let generation = 0;
  let publications = 0;
  const path = (input: string) => normalizePath(input);
  const missing = (input: string): never => { throw new FsError("ENOENT", { path: input }); };
  const unsupported = async (): Promise<never> => { throw new FsError("ENOTSUP"); };
  const check = (options?: FsOptions) => options?.signal?.throwIfAborted();
  const directory = (input: string) => input === "/" || [...rows.keys()].some(key => key.startsWith(input + "/"));
  const stat = async (input: string, options?: FsOptions): Promise<FileStat> => {
    check(options);
    const key = path(input);
    const row = rows.get(key);
    if (!row && !directory(key)) missing(input);
    const time = row?.time ?? 1700000000000;
    return { type: row ? "file" : "directory", size: row?.bytes.length ?? 0,
      mode: row ? 0o100644 : 0o40755, mtimeMs: time, atimeMs: time, ctimeMs: time,
      ...(row ? { identityScope: scope, opaqueIdentity: row.identity, opaqueVersion: row.version } : {}) };
  };
  const write = (input: string, bytes: Uint8Array, identity?: string) => {
    const key = path(input);
    if (bytes.length > 1048576 || rows.size >= 64 && !rows.has(key)) throw new FsError("ENOSPC");
    const version = String(++generation);
    rows.set(key, { bytes: Uint8Array.from(bytes), identity: identity ?? version, version, time: 1700000000000 + generation * 2000 });
  };
  let beforeCommit: (() => void | Promise<void>) | undefined;
  const publish = async (input: string, source: ByteSource, options: ConditionalFilePublicationOptions): Promise<FileStat> => {
    check(options);
    publications++;
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of source) {
      check(options);
      if (chunk.length > Math.min(options.maxBytes, 1048576) - size) throw new FsError("EFBIG");
      size += chunk.length;
      chunks.push(Uint8Array.from(chunk));
    }
    await beforeCommit?.();
    check(options);
    const key = path(input);
    const current = rows.get(key);
    if (options.expected === null ? current !== undefined : !current || options.expected.identityScope !== scope || options.expected.opaqueVersion !== current.version) throw new FsError("EAGAIN");
    if (options.parent.type !== "directory" || !directory(key.slice(0, key.lastIndexOf("/")) || "/")) throw new FsError("ENOENT");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    write(key, bytes);
    return stat(key);
  };
  const fs: FileSystem = {
    capabilities: { read: true, stat: true, readdir: true, realpath: true, access: true,
      write: true, remove: true, implicitDirectories: true, hardlinks: false, symlinks: false,
      permissions: false, atomicFilePublication: true, atomicFileStaging: false, streamingRead: true },
    stat, lstat: stat, publishFileConditional: publish,
    async readFile(input, options) {
      check(options);
      const row = rows.get(path(input)) ?? missing(input);
      if (options?.maxBytes !== undefined && row.bytes.length > options.maxBytes) throw new FsError("EFBIG");
      return Uint8Array.from(row.bytes);
    },
    async *readStream(input, options) {
      check(options);
      const row = rows.get(path(input)) ?? missing(input);
      for (let offset = 0; offset < row.bytes.length; offset += options?.chunkSize ?? 65536) {
        check(options);
        yield row.bytes.slice(offset, offset + (options?.chunkSize ?? 65536));
      }
    },
    async writeFile(input, bytes, options) {
      check(options);
      if (options?.flag === "wx" && rows.has(path(input))) throw new FsError("EEXIST");
      write(input, bytes);
    },
    async rm(input, options) { check(options); if (!rows.delete(path(input)) && !options?.force) missing(input); },
    async readdir(input, options) {
      await stat(input, options);
      const prefix = path(input) === "/" ? "/" : path(input) + "/";
      const entries = new Map<string, "file" | "directory">();
      for (const key of rows.keys()) if (key.startsWith(prefix)) {
        const relative = key.slice(prefix.length);
        const index = relative.indexOf("/");
        entries.set(index < 0 ? relative : relative.slice(0, index), index < 0 ? "file" : "directory");
      }
      if (options?.maxEntries !== undefined && entries.size > options.maxEntries) throw new FsError("EFBIG");
      return [...entries].map(([name, type]) => ({ name, type }));
    },
    async realpath(input, options) { await stat(input, options); return path(input); },
    async access(input, _mode, options) { await stat(input, options); },
    appendFile: unsupported, mkdir: unsupported, rename: unsupported, copyFile: unsupported,
  };
  return { fs, write, rows, scope, get publications() { return publications; },
    set beforeCommit(hook: (() => void | Promise<void>) | undefined) { beforeCommit = hook; },
    alias(input: string, target: string) {
      const row = rows.get(path(target)) ?? missing(target);
      write(input, row.bytes, row.identity);
    } };
}
