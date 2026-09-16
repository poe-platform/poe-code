import { FsError, openFileDescriptor, readBytes } from "poe-code/safe-fs";
import type {
  ByteSource, FileDescriptor, FileStat, FileSystem, FileSystemCapabilities, FsOptions,
  OpenFileOptions, ReadStreamOptions, WriteFileOptions,
} from "poe-code/safe-fs";
import { yieldTurn } from "../../contracts/yield.js";

const deviceNames = ["null", "random", "urandom", "zero"] as const;
type DeviceName = typeof deviceNames[number];
type Entry = DeviceName | "/";
const maxChunkBytes = 65536;

export interface DeviceFileSystem extends FileSystem {
  open(path: string, options: OpenFileOptions): Promise<FileDescriptor>;
  readStream(path: string, options?: ReadStreamOptions): ByteSource;
  writeStream(path: string, source: ByteSource, options?: WriteFileOptions): Promise<void>;
  rmdir(path: string, options?: FsOptions): Promise<void>;
}

export function createDeviceFileSystem(): DeviceFileSystem {
  const created = Date.now();
  const identityScope = Symbol("virtual device namespace");
  const capabilities: FileSystemCapabilities = Object.freeze({
    readOnly: false, read: true, stat: true, readdir: true, realpath: true, access: true,
    write: true, append: true, open: true, streamingRead: true, streamingWrite: true, streamingAppend: true,
    independentWriteStreams: true,
    explicitDirectories: true, implicitDirectories: false, exclusiveCreate: false,
    mkdir: false, recursiveMkdir: false, remove: false, removeDirectory: false, recursiveRemove: false,
    rename: false, copy: true, exclusiveCopy: false, readlink: false,
    truncate: false, randomAccessWrite: false, symlinks: false, hardlinks: false,
    permissions: false, timestamps: false, atomicRename: false, snapshotRmdir: false,
  });

  function resolve(path: string, syscall: string, options: FsOptions, allowMissing?: false): Entry;
  function resolve(path: string, syscall: string, options: FsOptions, allowMissing: true): Entry | undefined;
  function resolve(path: string, syscall: string, options: FsOptions, allowMissing = false): Entry | undefined {
    options.signal?.throwIfAborted();
    if (typeof path !== "string" || path.includes("\0")) throw new FsError("EINVAL", { syscall, path });
    if (path === "") throw new FsError("ENOENT", { syscall, path });
    let entry: Entry = "/";
    const components = path.split("/");
    for (let index = 0; index < components.length; index++) {
      const component = components[index]!;
      if (component === "") continue;
      if (entry !== "/") throw new FsError("ENOTDIR", { syscall, path });
      if (component === "." || component === "..") continue;
      const device = deviceNames.find(name => name === component);
      if (device === undefined) {
        if (allowMissing && components.slice(index + 1).every(part => part === "")) return undefined;
        throw new FsError("ENOENT", { syscall, path });
      }
      entry = device;
    }
    if (entry !== "/" && path.endsWith("/")) throw new FsError("ENOTDIR", { syscall, path });
    return entry;
  }

  function integer(value: number, syscall: string, path: string): void {
    if (!Number.isSafeInteger(value) || value < 0) throw new FsError("EINVAL", { syscall, path });
  }

  function openWrite(path: string, options: WriteFileOptions, syscall: string): DeviceName {
    options.signal?.throwIfAborted();
    const flag = options.flag ?? "w";
    if (!["w", "a", "wx", "ax"].includes(flag)) throw new FsError("EINVAL", { syscall, path });
    if (options.mode !== undefined) {
      integer(options.mode, syscall, path);
      if (options.mode > 0o7777) throw new FsError("EINVAL", { syscall, path });
    }
    const entry = resolve(path, syscall, options);
    if (flag === "wx" || flag === "ax") throw new FsError("EEXIST", { syscall, path });
    if (entry === "/") throw new FsError("EISDIR", { syscall, path });
    return entry;
  }

  function fill(entry: DeviceName, bytes: Uint8Array<ArrayBuffer>, path: string, syscall: string, options: FsOptions): void {
    options.signal?.throwIfAborted();
    if (entry === "random" || entry === "urandom") {
      const crypto = globalThis.crypto;
      if (typeof crypto?.getRandomValues !== "function") throw new FsError("ENOTSUP", {
        syscall, path, message: "Web Crypto getRandomValues is required",
      });
      try { crypto.getRandomValues(bytes); }
      catch (cause) {
        options.signal?.throwIfAborted();
        throw new FsError("EIO", { syscall, path, cause });
      }
    } else bytes.fill(0);
    options.signal?.throwIfAborted();
  }

  function admitWrite(entry: DeviceName, bytes: Uint8Array, path: string, syscall: string): void {
    if (!(bytes instanceof Uint8Array)) throw new TypeError("Device writes require Uint8Array data");
    if (entry === "urandom") throw new FsError("EPERM", { syscall, path });
  }

  function metadata(entry: Entry): FileStat {
    return {
      type: entry === "/" ? "directory" : "character",
      size: 0,
      mode: entry === "/" ? 0o040555 : 0o020666,
      atimeMs: created, mtimeMs: created, ctimeMs: created, birthtimeMs: created,
      identityScope, dev: 0, ino: entry === "/" ? 1 : deviceNames.indexOf(entry) + 2,
    };
  }

  const filesystem: DeviceFileSystem = {
    capabilities,
    async open(path, options) {
      return openFileDescriptor<{ entry: DeviceName; cursor: number }>(path, options, {
        position: true, readObservation: true, openTruncate: true,
        positionedRead: true, positionedWrite: true, positionedAppendWrite: true,
        delegateZeroLengthWrite: true, truncate: true, synchronization: "volatile",
      }, async admitted => {
        const entry = resolve(path, "open", admitted);
        if (admitted.creation === "exclusive") throw new FsError("EEXIST", { syscall: "open", path });
        if (entry === "/") throw new FsError("EISDIR", { syscall: "open", path });
        return {
          resource: { entry, cursor: 0 },
          async stat(retained) { return metadata(retained.entry); },
          async getPosition(retained) { return retained.cursor; },
          async probeRead() { return "ready"; },
          async read(retained, bytes, position, supplied) {
            if (retained.entry === "null") return 0;
            const count = bytes.byteLength;
            if (position === null && !Number.isSafeInteger(retained.cursor + count)) throw new FsError("EFBIG", { syscall: "read", path });
            const staging = retained.entry === "zero" ? undefined : new Uint8Array(Math.min(count, maxChunkBytes));
            let offset = 0;
            while (offset < count) {
              supplied.signal?.throwIfAborted();
              const length = Math.min(count - offset, maxChunkBytes);
              if (staging === undefined) bytes.fill(0, offset, offset + length);
              else {
                const chunk = staging.subarray(0, length);
                fill(retained.entry, chunk, path, "read", supplied);
                bytes.set(chunk, offset);
              }
              offset += length;
              if (position === null) retained.cursor += length;
              if (offset < count) await yieldTurn(supplied.signal);
            }
            return count;
          },
          async write(retained, bytes, position) {
            admitWrite(retained.entry, bytes, path, "write");
            if (position === null) {
              if (!Number.isSafeInteger(retained.cursor + bytes.byteLength)) throw new FsError("EFBIG", { syscall: "write", path });
              retained.cursor += bytes.byteLength;
            }
            return bytes.byteLength;
          },
          async truncate() {},
          async sync() {},
          async close() {},
        };
      });
    },
    async stat(path, options = {}) {
      return metadata(resolve(path, "stat", options));
    },
    async lstat(path, options = {}) {
      return metadata(resolve(path, "lstat", options));
    },
    async readFile(path, options = {}) {
      const entry = resolve(path, "readFile", options);
      if (options.maxBytes !== undefined) integer(options.maxBytes, "readFile", path);
      if (entry === "/") throw new FsError("EISDIR", { syscall: "readFile", path });
      if (entry !== "null") throw new FsError("EFBIG", {
        syscall: "readFile", path, message: "device has no EOF; use readStream with a bounded consumer",
      });
      return new Uint8Array();
    },
    async *readStream(path, options = {}) {
      const entry = resolve(path, "readStream", options);
      const start = options.start ?? 0;
      const requested = options.chunkSize ?? maxChunkBytes;
      integer(start, "readStream", path);
      integer(requested, "readStream", path);
      if (requested === 0) throw new FsError("EINVAL", { syscall: "readStream", path });
      if (options.endExclusive !== undefined) {
        integer(options.endExclusive, "readStream", path);
        if (options.endExclusive < start) throw new FsError("EINVAL", { syscall: "readStream", path });
      }
      if (entry === "/") throw new FsError("EISDIR", { syscall: "readStream", path });
      if (entry === "null") return;
      const chunkSize = Math.min(requested, maxChunkBytes);
      let remaining = options.endExclusive === undefined ? Infinity : options.endExclusive - start;
      while (remaining > 0) {
        options.signal?.throwIfAborted();
        const bytes = new Uint8Array(Math.min(chunkSize, remaining));
        fill(entry, bytes, path, "readStream", options);
        remaining -= bytes.byteLength;
        yield bytes;
        options.signal?.throwIfAborted();
        if (remaining > 0) await yieldTurn(options.signal);
      }
    },
    async writeFile(path, data, options = {}) {
      const entry = openWrite(path, options, "writeFile");
      admitWrite(entry, data, path, "writeFile");
    },
    async appendFile(path, data, options = {}) {
      const entry = openWrite(path, { ...options, flag: "a" }, "appendFile");
      admitWrite(entry, data, path, "appendFile");
    },
    async writeStream(path, source, options = {}) {
      const entry = openWrite(path, options, "writeStream");
      for await (const chunk of readBytes(source, options.signal)) {
        if (!(chunk instanceof Uint8Array)) throw new TypeError("Device writes require Uint8Array data");
        if (chunk.byteLength !== 0) admitWrite(entry, chunk, path, "writeStream");
        await yieldTurn(options.signal);
      }
      options.signal?.throwIfAborted();
    },
    async readdir(path, options = {}) {
      const entry = resolve(path, "readdir", options);
      if (entry !== "/") throw new FsError("ENOTDIR", { syscall: "readdir", path });
      if (options.maxEntries !== undefined) {
        integer(options.maxEntries, "readdir", path);
        if (options.maxEntries < deviceNames.length) throw new FsError("EFBIG", { syscall: "readdir", path });
      }
      return deviceNames.map(name => ({ name, type: "character" }));
    },
    async realpath(path, options = {}) {
      const entry = resolve(path, "realpath", options);
      return entry === "/" ? "/" : `/${entry}`;
    },
    async access(path, mode = 0, options = {}) {
      const entry = resolve(path, "access", options);
      integer(mode, "access", path);
      if (mode > 7) throw new FsError("EINVAL", { syscall: "access", path });
      if (entry === "/" ? (mode & 2) !== 0 : (mode & 1) !== 0) {
        throw new FsError("EACCES", { syscall: "access", path });
      }
    },
    async mkdir(path, options = {}) {
      const entry = resolve(path, "mkdir", options, true);
      if (entry === "/" && options.recursive) return;
      throw new FsError(entry === undefined ? "ENOTSUP" : "EEXIST", { syscall: "mkdir", path });
    },
    async rm(path, options = {}) {
      try { resolve(path, "rm", options); }
      catch (error) {
        options.signal?.throwIfAborted();
        if (options.force && error instanceof FsError && error.code === "ENOENT") return;
        throw error;
      }
      throw new FsError("ENOTSUP", { syscall: "rm", path });
    },
    async rmdir(path, options = {}) {
      const entry = resolve(path, "rmdir", options);
      throw new FsError(entry === "/" ? "ENOTEMPTY" : "ENOTDIR", { syscall: "rmdir", path });
    },
    async rename(source, destination, options = {}) {
      resolve(source, "rename", options);
      resolve(destination, "rename", options, true);
      throw new FsError("ENOTSUP", { syscall: "rename", path: source, dest: destination });
    },
    async copyFile(source, destination, options = {}) {
      const origin = resolve(source, "copyFile", options);
      const target = resolve(destination, "copyFile", options);
      if (origin === "/" || target === "/") throw new FsError("EISDIR", { syscall: "copyFile", path: source, dest: destination });
      if (options.exclusive) throw new FsError("EEXIST", { syscall: "copyFile", path: source, dest: destination });
      if (origin === target) throw new FsError("EINVAL", { syscall: "copyFile", path: source, dest: destination });
      await filesystem.writeStream(destination, filesystem.readStream(source, options), options);
    },
  };
  return filesystem;
}
