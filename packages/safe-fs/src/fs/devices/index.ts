import { FsError, isFsError } from "../../contracts/errors.js";
import type {
  AppendFileOptions, CapabilityQueryOptions, CopyFileOptions, DirectoryEntry, FileReadHandle, FileResizeHandle, FileResizeOperation, FileResizeOptions, FileStat, FileSystem, OpenReadFileOptions, OpenResizeFileOptions,
  FileSystemCapabilities, FsOptions, RenameOptions, MkdirOptions, ReadDirectoryOptions, ReadFileOptions,
  ReadStreamOptions, RemoveOptions, WriteFileOptions,
  ConditionalWriteFileOptions, ConditionalRemoveFileOptions, CreateStagedFileOptions, FileStaging, PublishStagedFileOptions, PrepareDirectoryOptions, StagedFileContent,
} from "../../contracts/filesystem.js";
import type { ByteSource } from "../../contracts/io.js";
import { admitDirectoryEntries, directoryEntryLimit } from "../directory-admission.js";
import { compareEntries, registerEntryAuthority, registerEntryView } from "../mount/comparison.js";
import { deviceDirectory, lexicalDevicePath, nullPath, resolveDevicePath } from "./path.js";
import { deviceReadStream, drainDeviceFile, drainDeviceInput } from "./stream.js";
import { openRetainedReadFile, openRetainedResizeFile, retainedResizeCapabilities, ownedMutationCapabilities, requireOwnedMutation } from "../capabilities.js";
import { pathNamespace } from "../path-namespace.js";

const views = new WeakMap<FileSystem, DeviceFileSystem>();
const deviceCapabilities: FileSystemCapabilities = Object.freeze({
  readOnly: false, read: true, stat: true, realpath: true, access: true, readdir: false,
  write: true, append: true, exclusiveCreate: true, streamingRead: true, retainedRead: true,
  streamingWrite: true, streamingAppend: true, copy: true, exclusiveCopy: true,
  remove: false, removeDirectory: false, recursiveRemove: false, rename: false,
  mkdir: false, recursiveMkdir: false, symlinks: false, hardlinks: false, readlink: false,
  permissions: false, timestamps: false, truncate: false, randomAccessWrite: false,
  atomicFileMutation: false, atomicFileStaging: false, atomicDirectoryMetadata: false,
  atomicRename: false, atomicRenameNoReplace: false, descriptorWriteStream: true, retainedResize: true, atomicResize: false,
});

function globalCapabilities(filesystem: FileSystem): FileSystemCapabilities {
  const capabilities: Record<string, boolean | undefined> = { readOnly: false };
  const optional: Record<string, readonly (keyof FileSystem)[]> = {
    atomicFileMutation: ["writeFileConditional", "removeFileConditional"], atomicFileStaging: ["createStagedFile", "publishStagedFile", "removeStagedFile"], atomicDirectoryMetadata: ["prepareDirectory"],
    streamingRead: ["readStream"], streamingWrite: ["writeStream"], retainedRead: ["openReadFile"],
    streamingAppend: ["writeStream"], descriptorWriteStream: ["writeStream"], retainedResize: ["openResizeFile"], atomicResize: ["resizeFile"],
    symlinks: ["symlink", "readlink"], hardlinks: ["link"], permissions: ["chmod"],
    timestamps: ["utimes"], readlink: ["readlink"], truncate: ["truncate"], removeDirectory: ["rmdir"],
  };
  for (const key of new Set([...Object.keys(filesystem.capabilities), ...Object.keys(deviceCapabilities)])) {
    if (key === "readOnly") continue;
    Object.defineProperty(capabilities, key, { enumerable: true, get() {
      if (key === "copy" || key === "exclusiveCopy") return undefined;
      let declared = filesystem.capabilities[key];
      if (declared === true && optional[key]?.some(method => typeof filesystem[method] !== "function")) declared = false;
      if (key === "retainedResize" && filesystem.capabilities.readOnly === true) declared = false;
      if (key === "descriptorWriteStream" && filesystem.capabilities.streamingWrite === false) declared = false;
      return declared === deviceCapabilities[key] ? declared : undefined;
    } });
  }
  return Object.freeze(capabilities);
}

function reserved(path: string): boolean { return path === "/" || path === deviceDirectory || path === nullPath; }
function nonnegative(value: number | undefined, path: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new FsError("EINVAL", { path });
}

export class DeviceFileSystem implements FileSystem {
  readonly #filesystem: FileSystem;
  readonly capabilities: FileSystemCapabilities;
  readonly #nullStat: FileStat;
  readonly #directoryStat: FileStat;

  constructor(filesystem: FileSystem) {
    this.#filesystem = filesystem;
    Object.defineProperty(this, pathNamespace, { get: () => Reflect.get(filesystem, pathNamespace) });
    this.capabilities = globalCapabilities(filesystem);
    const identityScope = Object.freeze({});
    const stat = { mode: 0o020666, size: 0, allocatedBytes: 0,
      mtimeMs: 0, atimeMs: 0, ctimeMs: 0, birthtimeMs: 0, identityScope, ino: 1, dev: 0, nlink: 1 };
    this.#nullStat = Object.freeze({ ...stat, type: "character", preferredIoBlockSize: 4096 });
    this.#directoryStat = Object.freeze({ ...stat, type: "directory", mode: 0o040755, ino: 2 });
    const methods = new Map<PropertyKey, { backing: unknown; bound: unknown }>();
    const view = new Proxy(this, {
      set: (_target, property, value) => Reflect.set(filesystem, property, value, filesystem),
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (typeof value !== "function" || property === "constructor") return value;
        const backing = Reflect.get(filesystem, property, filesystem);
        const cached = methods.get(property);
        if (cached && cached.backing === backing) return cached.bound;
        const bound = value.bind(target);
        methods.set(property, { backing, bound });
        return bound;
      },
    });
    for (const identity of [this, view]) registerEntryView(identity, async (path, options) => {
      const resolved = await this.#resolve(path, options);
      if (resolved === nullPath || resolved === deviceDirectory) return { filesystem: this, path: resolved,
        stat: resolved === nullPath ? this.#nullStat : this.#directoryStat, readOnly: false };
      return { filesystem, path };
    });
    // This internal view has no identity proof beyond its synthetic stats.
    registerEntryAuthority(this, async () => "unknown");
    return view;
  }

  #resolve(path: string, options: FsOptions, followFinal = true, resizeCreate?: boolean) {
    return resolveDevicePath(this.#filesystem, path, options, followFinal, resizeCreate);
  }

  async #mutable(path: string, options: FsOptions, followFinal = true): Promise<void> {
    if (reserved(await this.#resolve(path, options, followFinal))) throw new FsError("EBUSY", { path });
  }

  async #writeTarget(path: string, options: WriteFileOptions): Promise<boolean> {
    const resolved = await this.#resolve(path, options);
    if (resolved === nullPath) {
      if (options.flag === "wx" || options.flag === "ax") throw new FsError("EEXIST", { path });
      if (options.flag !== undefined && options.flag !== "w" && options.flag !== "a") throw new FsError("EINVAL", { path });
      return true;
    }
    if (resolved === "/" || resolved === deviceDirectory) throw new FsError("EISDIR", { path });
    return false;
  }

  canonicalizeMissingTarget(path: string, options: FsOptions = {}): string | undefined {
    options.signal?.throwIfAborted();
    const resolved = lexicalDevicePath(path);
    return reserved(resolved) ? resolved : this.#filesystem.canonicalizeMissingTarget?.(path, options);
  }

  async capabilitiesFor(path: string, options: CapabilityQueryOptions = {}): Promise<FileSystemCapabilities> {
    const resolved = await this.#resolve(path, options, true, options.create);
    options.signal?.throwIfAborted();
    if (options.create !== undefined && (resolved === deviceDirectory || resolved === "/")) throw new FsError("EISDIR", { syscall: "capabilitiesFor", path });
    if (resolved === nullPath) return deviceCapabilities;
    if (resolved === deviceDirectory) return { ...deviceCapabilities, readdir: true, write: false, append: false,
      exclusiveCreate: false, streamingWrite: false, streamingAppend: false, descriptorWriteStream: false,
      retainedRead: false, retainedResize: false, streamingRead: false, copy: false, exclusiveCopy: false };
    const query = this.#filesystem.capabilitiesFor;
    options.signal?.throwIfAborted();
    const selected = query === undefined || query === null ? undefined : await Reflect.apply(query, this.#filesystem, [path, options]);
    options.signal?.throwIfAborted();
    const observed = ownedMutationCapabilities(this.#filesystem, selected ?? this.#filesystem.capabilities);
    options.signal?.throwIfAborted();
    const capabilities = observed.retainedResize === true ? retainedResizeCapabilities(this.#filesystem, observed) : observed;
    const unavailable: Record<string, false> = {};
    if (typeof this.#filesystem.readStream !== "function") unavailable.streamingRead = false;
    if (typeof this.#filesystem.writeStream !== "function") {
      unavailable.streamingWrite = false;
      unavailable.streamingAppend = false;
      unavailable.descriptorWriteStream = false;
    }
    if (typeof this.#filesystem.openReadFile !== "function") unavailable.retainedRead = false;
    if (observed.atomicResize === true && (typeof this.#filesystem.resizeFile !== "function" || observed.readOnly === true)) unavailable.atomicResize = false;
    const result = Object.keys(unavailable).some(key => capabilities[key] !== false)
      ? { ...capabilities, ...unavailable } : capabilities;
    options.signal?.throwIfAborted();
    return result;
  }

  async stat(path: string, options: FsOptions = {}): Promise<FileStat> {
    const resolved = await this.#resolve(path, options);
    options.signal?.throwIfAborted();
    if (resolved === nullPath) return { ...this.#nullStat };
    if (resolved === deviceDirectory) return { ...this.#directoryStat };
    const stat = this.#filesystem.stat;
    options.signal?.throwIfAborted();
    const result = await Reflect.apply(stat, this.#filesystem, [path, options]);
    options.signal?.throwIfAborted();
    return result;
  }

  async lstat(path: string, options: FsOptions = {}): Promise<FileStat> {
    const resolved = await this.#resolve(path, options, false);
    options.signal?.throwIfAborted();
    if (resolved === nullPath) return { ...this.#nullStat };
    if (resolved === deviceDirectory) return { ...this.#directoryStat };
    const lstat = this.#filesystem.lstat;
    options.signal?.throwIfAborted();
    const result = await Reflect.apply(lstat, this.#filesystem, [path, options]);
    options.signal?.throwIfAborted();
    return result;
  }

  compareEntry(path: string, peer: FileSystem, peerPath: string, options: FsOptions = {}) {
    return compareEntries(this, path, peer, peerPath, options);
  }

  async realpath(path: string, options: FsOptions = {}): Promise<string> {
    const resolved = await this.#resolve(path, options);
    return reserved(resolved) ? resolved : this.#filesystem.realpath(path, options);
  }

  async readFile(path: string, options: ReadFileOptions = {}): Promise<Uint8Array> {
    const resolved = await this.#resolve(path, options);
    if (resolved === nullPath) { nonnegative(options.maxBytes, path); return new Uint8Array(); }
    if (resolved === deviceDirectory) throw new FsError("EISDIR", { path });
    return this.#filesystem.readFile(path, options);
  }

  readStream(path: string, options: ReadStreamOptions = {}): ByteSource {
    return deviceReadStream(async () => {
      const resolved = await this.#resolve(path, options);
      if (resolved === nullPath) {
        nonnegative(options.start, path); nonnegative(options.endExclusive, path); nonnegative(options.chunkSize, path);
        if (options.chunkSize === 0 || (options.endExclusive !== undefined && options.endExclusive < (options.start ?? 0))) throw new FsError("EINVAL", { path });
        return { [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }) };
      }
      if (resolved === deviceDirectory) throw new FsError("EISDIR", { path });
      if (!this.#filesystem.readStream) throw new FsError("ENOTSUP", { path });
      return this.#filesystem.readStream(path, options);
    }, options.signal);
  }

  async openReadFile(path: string, options: OpenReadFileOptions = {}): Promise<FileReadHandle> {
    const resolved = await this.#resolve(path, options);
    if (resolved !== nullPath) {
      if (resolved === deviceDirectory) throw new FsError("EISDIR", { path });
      return openRetainedReadFile(this.#filesystem, path, options);
    }
    const stat = this.#nullStat;
    let closed = false;
    const check = (settings: FsOptions) => { settings.signal?.throwIfAborted(); if (closed) throw new FsError("EBADF", { path }); };
    return {
      async stat(settings = {}) { check(settings); return { ...stat }; },
      async read(position, maxBytes, settings = {}) { check(settings); nonnegative(position, path); nonnegative(maxBytes, path); return new Uint8Array(); },
      async seekEnd(settings = {}) { check(settings); return 0n; },
      async close() { closed = true; },
    };
  }

  async resizeFile(path: string, operation: FileResizeOperation, options: FileResizeOptions = {}): Promise<void> {
    await this.#mutable(path, options);
    const capabilities = await this.capabilitiesFor(path, options);
    options.signal?.throwIfAborted();
    if (capabilities.readOnly === true) throw new FsError("EROFS", { syscall: "resizeFile", path });
    const resize = this.#filesystem.resizeFile;
    options.signal?.throwIfAborted();
    if (capabilities.atomicResize !== true || typeof resize !== "function") throw new FsError("ENOTSUP", { syscall: "resizeFile", path });
    await Reflect.apply(resize, this.#filesystem, [path, operation, options]);
    options.signal?.throwIfAborted();
  }

  async openResizeFile(path: string, options: OpenResizeFileOptions = {}): Promise<FileResizeHandle> {
    options.signal?.throwIfAborted();
    const resolution = this.#resolve(path, options, true, options.create ?? false);
    const signal = options.signal;
    const resolved = await (signal ? new Promise<string>((resolve, reject) => {
      const abort = (): void => { signal.removeEventListener("abort", abort); reject(signal.reason); };
      signal.addEventListener("abort", abort, { once: true });
      resolution.then(
        value => { signal.removeEventListener("abort", abort); resolve(value); },
        error => { signal.removeEventListener("abort", abort); reject(error); },
      );
      if (signal.aborted) abort();
    }) : resolution);
    options.signal?.throwIfAborted();
    if (resolved === deviceDirectory || resolved === "/") throw new FsError("EISDIR", { syscall: "openResizeFile", path });
    if (resolved !== nullPath) return openRetainedResizeFile(this.#filesystem, path, options);
    const stat = this.#nullStat;
    let closing: Promise<void> | undefined;
    const check = (settings: FsOptions, syscall: string): void => {
      settings.signal?.throwIfAborted();
      if (closing) throw new FsError("EBADF", { syscall, path });
    };
    return {
      async stat(settings = {}) { check(settings, "fstat"); return { ...stat }; },
      async seekEnd(settings = {}) { check(settings, "lseek"); return 0n; },
      async truncate(_length, settings = {}) {
        check(settings, "ftruncate");
        throw new FsError("EINVAL", { syscall: "ftruncate", path });
      },
      close: () => closing ??= Promise.resolve(),
    };
  }

  async writeFile(path: string, data: Uint8Array, options: WriteFileOptions = {}): Promise<void> {
    if (await this.#writeTarget(path, options)) {
      if (!(data instanceof Uint8Array)) throw new TypeError("File data must be Uint8Array");
      return;
    }
    await this.#filesystem.writeFile(path, data, options);
  }

  async appendFile(path: string, data: Uint8Array, options: AppendFileOptions = {}): Promise<void> {
    if (await this.#writeTarget(path, options)) {
      if (!(data instanceof Uint8Array)) throw new TypeError("File data must be Uint8Array");
      return;
    }
    await this.#filesystem.appendFile(path, data, options);
  }

  async writeStream(path: string, source: ByteSource, options: WriteFileOptions = {}): Promise<void> {
    if (await this.#writeTarget(path, options)) return drainDeviceInput(source, options.signal);
    if (!this.#filesystem.writeStream) throw new FsError("ENOTSUP", { path });
    await this.#filesystem.writeStream(path, source, options);
  }

  async readdir(path: string, options: ReadDirectoryOptions = {}): Promise<DirectoryEntry[]> {
    const resolved = await this.#resolve(path, options);
    if (resolved === nullPath) throw new FsError("ENOTDIR", { path });
    if (resolved !== "/" && resolved !== deviceDirectory) return this.#filesystem.readdir(path, options);
    const limit = directoryEntryLimit(options, path);
    let entries: DirectoryEntry[];
    try { entries = await this.#filesystem.readdir(resolved, options); }
    catch (error) {
      options.signal?.throwIfAborted();
      if (!isFsError(error, "ENOENT") && !isFsError(error, "ENOTDIR")) throw error;
      entries = [];
    }
    options.signal?.throwIfAborted();
    const merged = new Map<string, DirectoryEntry>();
    for (const entry of entries) {
      if (entry.name === "." || entry.name === "..") continue;
      if (!entry.name || entry.name.includes("/") || entry.name.includes("\0")) throw new FsError("EIO", { path, message: "invalid directory entry" });
      merged.set(entry.name, { name: entry.name, type: entry.type });
      admitDirectoryEntries(merged.size, limit, path);
    }
    const name = resolved === "/" ? "dev" : "null";
    merged.set(name, { name, type: resolved === "/" ? "directory" : "character" });
    admitDirectoryEntries(merged.size, limit, path);
    return [...merged.values()];
  }

  async mkdir(path: string, options: MkdirOptions = {}): Promise<void> {
    const resolved = await this.#resolve(path, options);
    if (reserved(resolved)) {
      if (resolved !== nullPath && options.recursive) return;
      throw new FsError("EEXIST", { path });
    }
    await this.#filesystem.mkdir(path, options);
  }

  async rm(path: string, options: RemoveOptions = {}): Promise<void> {
    await this.#mutable(path, options, false);
    await this.#filesystem.rm(path, options);
  }

  async rmdir(path: string, options: FsOptions = {}): Promise<void> {
    const resolved = await this.#resolve(path, options, false);
    if (resolved === nullPath) throw new FsError("ENOTDIR", { path });
    if (reserved(resolved)) throw new FsError("EBUSY", { path });
    if (!this.#filesystem.rmdir) throw new FsError("ENOTSUP", { path });
    await this.#filesystem.rmdir(path, options);
  }

  async writeFileConditional(path: string, data: Uint8Array, options: ConditionalWriteFileOptions): Promise<FileStat> {
    await this.#mutable(path, options, false);
    await requireOwnedMutation(this.#filesystem, path, "atomicFileMutation", options, options.expected === null);
    if (!this.#filesystem.writeFileConditional) throw new FsError("ENOTSUP", { path });
    return this.#filesystem.writeFileConditional(path, data, options);
  }

  async removeFileConditional(path: string, options: ConditionalRemoveFileOptions): Promise<void> {
    await this.#mutable(path, options, false);
    await requireOwnedMutation(this.#filesystem, path, "atomicFileMutation", options);
    if (!this.#filesystem.removeFileConditional) throw new FsError("ENOTSUP", { path });
    await this.#filesystem.removeFileConditional(path, options);
  }

  async createStagedFile(path: string, name: string, content: StagedFileContent, options: CreateStagedFileOptions): Promise<FileStaging> {
    await this.#mutable(path, options, false);
    await requireOwnedMutation(this.#filesystem, path, "atomicFileStaging", options, true);
    if (!this.#filesystem.createStagedFile) throw new FsError("ENOTSUP", { path });
    return this.#filesystem.createStagedFile(path, name, content, options);
  }

  async publishStagedFile(staging: FileStaging, destination: string, options: PublishStagedFileOptions): Promise<void> {
    for (const path of [staging.directory.path, staging.file.path, destination]) await this.#mutable(path, options, false);
    await requireOwnedMutation(this.#filesystem, staging.directory.path, "atomicFileStaging", options);
    if (!this.#filesystem.publishStagedFile) throw new FsError("ENOTSUP", { path: destination });
    await this.#filesystem.publishStagedFile(staging, destination, options);
  }

  async removeStagedFile(staging: FileStaging, options: FsOptions = {}): Promise<void> {
    for (const path of [staging.directory.path, staging.file.path]) await this.#mutable(path, options, false);
    await requireOwnedMutation(this.#filesystem, staging.directory.path, "atomicFileStaging", options);
    if (!this.#filesystem.removeStagedFile) throw new FsError("ENOTSUP", { path: staging.directory.path });
    await this.#filesystem.removeStagedFile(staging, options);
  }

  async prepareDirectory(path: string, options: PrepareDirectoryOptions): Promise<FileStat> {
    await this.#mutable(path, options, false);
    await requireOwnedMutation(this.#filesystem, path, "atomicDirectoryMetadata", options, options.expected === null);
    if (!this.#filesystem.prepareDirectory) throw new FsError("ENOTSUP", { path });
    return this.#filesystem.prepareDirectory(path, options);
  }

  async rename(source: string, destination: string, options: RenameOptions = {}): Promise<void> {
    await this.#mutable(source, options, false); await this.#mutable(destination, options, false);
    if (options.noReplace) {
      const capabilities = await this.#filesystem.capabilitiesFor?.(destination, options) ?? this.#filesystem.capabilities;
      options.signal?.throwIfAborted();
      if (capabilities.atomicRenameNoReplace !== true) throw new FsError("ENOTSUP", { syscall: "rename", path: source, dest: destination });
    }
    await this.#filesystem.rename(source, destination, options);
  }

  async copyFile(source: string, destination: string, options: CopyFileOptions = {}): Promise<void> {
    const target = await this.#resolve(destination, options);
    if (target === nullPath && options.exclusive) throw new FsError("EEXIST", { path: destination });
    const origin = await this.#resolve(source, options);
    if (target !== nullPath && origin !== nullPath) {
      if (target === "/" || target === deviceDirectory) throw new FsError("EISDIR", { path: destination });
      await this.#filesystem.copyFile(source, destination, options);
      return;
    }
    if (target === nullPath) {
      if (origin === nullPath) return;
      if (origin === "/" || origin === deviceDirectory) throw new FsError("EISDIR", { path: source });
      const capabilities = await this.capabilitiesFor(source, options);
      if (this.#filesystem.readStream && capabilities.streamingRead !== false) {
        await drainDeviceInput(this.#filesystem.readStream(source, options), options.signal);
      } else if (this.#filesystem.openReadFile && capabilities.retainedRead !== false) {
        await drainDeviceFile(await this.#filesystem.openReadFile(source, options), options.signal);
      } else throw new FsError("ENOTSUP", { path: source });
      return;
    }
    if (reserved(target)) throw new FsError("EISDIR", { path: destination });
    await this.#filesystem.writeFile(destination, new Uint8Array(), { ...options, flag: options.exclusive ? "wx" : "w" });
  }

  async access(path: string, mode = 0, options: FsOptions = {}): Promise<void> {
    const resolved = await this.#resolve(path, options);
    if (resolved === nullPath || resolved === deviceDirectory) {
      if (!Number.isInteger(mode) || mode < 0 || mode > 7) throw new FsError("EINVAL", { path });
      if ((resolved === nullPath && (mode & 1)) || (resolved === deviceDirectory && (mode & 2))) throw new FsError("EACCES", { path });
      return;
    }
    await this.#filesystem.access(path, mode, options);
  }

  async readlink(path: string, options: FsOptions = {}): Promise<string> {
    if (reserved(await this.#resolve(path, options, false))) throw new FsError("EINVAL", { path });
    if (!this.#filesystem.readlink) throw new FsError("ENOTSUP", { path });
    return this.#filesystem.readlink(path, options);
  }

  async symlink(target: string, path: string, options: FsOptions = {}): Promise<void> {
    await this.#mutable(path, options, false);
    if (!this.#filesystem.symlink) throw new FsError("ENOTSUP", { path });
    await this.#filesystem.symlink(target, path, options);
  }

  async link(existingPath: string, newPath: string, options: FsOptions = {}): Promise<void> {
    await this.#mutable(existingPath, options, false); await this.#mutable(newPath, options, false);
    if (!this.#filesystem.link) throw new FsError("ENOTSUP", { path: newPath });
    await this.#filesystem.link(existingPath, newPath, options);
  }

  async chmod(path: string, mode: number, options: FsOptions = {}): Promise<void> {
    await this.#mutable(path, options);
    if (!this.#filesystem.chmod) throw new FsError("ENOTSUP", { path });
    await this.#filesystem.chmod(path, mode, options);
  }

  async utimes(path: string, atimeMs: number, mtimeMs: number, options: FsOptions = {}): Promise<void> {
    await this.#mutable(path, options);
    if (!this.#filesystem.utimes) throw new FsError("ENOTSUP", { path });
    await this.#filesystem.utimes(path, atimeMs, mtimeMs, options);
  }

  async truncate(path: string, length?: number, options: FsOptions = {}): Promise<void> {
    await this.#mutable(path, options);
    if (!this.#filesystem.truncate) throw new FsError("ENOTSUP", { path });
    await this.#filesystem.truncate(path, length, options);
  }
}

export function createDeviceFileSystem(filesystem: FileSystem): DeviceFileSystem {
  if (filesystem instanceof DeviceFileSystem) return filesystem;
  let view = views.get(filesystem);
  if (!view) { view = new DeviceFileSystem(filesystem); views.set(filesystem, view); }
  return view;
}
