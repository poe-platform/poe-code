import { FsError, readBytes } from "poe-code/safe-fs";
import type {
  ByteSource, FileStat, FileSystem, FileSystemCapabilities, FsOptions,
  ReadStreamOptions, WriteFileOptions,
} from "poe-code/safe-fs";
import { yieldTurn } from "../../contracts/yield.js";

const deviceNames = ["null", "random", "urandom", "zero"] as const;
type DeviceName = typeof deviceNames[number];
type Entry = DeviceName | "/";
const maxChunkBytes = 65536;

export interface DeviceFileSystem extends FileSystem {
  readStream(path: string, options?: ReadStreamOptions): ByteSource;
  writeStream(path: string, source: ByteSource, options?: WriteFileOptions): Promise<void>;
  rmdir(path: string, options?: FsOptions): Promise<void>;
}

export function createDeviceFileSystem(): DeviceFileSystem {
  const created = Date.now();
  const identityScope = Symbol("virtual device namespace");
  const capabilities: FileSystemCapabilities = Object.freeze({
    readOnly: false, read: true, stat: true, readdir: true, realpath: true, access: true,
    write: true, append: true, streamingRead: true, streamingWrite: true, streamingAppend: true,
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

  function openWrite(path: string, options: WriteFileOptions, syscall: string): void {
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
        if (entry === "random" || entry === "urandom") {
          const crypto = globalThis.crypto;
          if (typeof crypto?.getRandomValues !== "function") throw new FsError("ENOTSUP", {
            syscall: "readStream", path, message: "Web Crypto getRandomValues is required",
          });
          try { crypto.getRandomValues(bytes); }
          catch (cause) {
            options.signal?.throwIfAborted();
            throw new FsError("EIO", { syscall: "readStream", path, cause });
          }
        }
        options.signal?.throwIfAborted();
        remaining -= bytes.byteLength;
        yield bytes;
        options.signal?.throwIfAborted();
        if (remaining > 0) await yieldTurn(options.signal);
      }
    },
    async writeFile(path, data, options = {}) {
      openWrite(path, options, "writeFile");
      if (!(data instanceof Uint8Array)) throw new TypeError("Device writes require Uint8Array data");
    },
    async appendFile(path, data, options = {}) {
      openWrite(path, { ...options, flag: "a" }, "appendFile");
      if (!(data instanceof Uint8Array)) throw new TypeError("Device writes require Uint8Array data");
    },
    async writeStream(path, source, options = {}) {
      openWrite(path, options, "writeStream");
      for await (const chunk of readBytes(source, options.signal)) {
        if (!(chunk instanceof Uint8Array)) throw new TypeError("Device writes require Uint8Array data");
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
