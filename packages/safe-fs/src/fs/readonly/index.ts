import { ACCESS_MODES } from "../../contracts/filesystem.js";
import { FsError } from "../../contracts/errors.js";
import { readBytes } from "../../contracts/io.js";
import type { ByteSource } from "../../contracts/io.js";
import type {
  AppendFileOptions, CopyFileOptions, DirectoryEntry, FileStat,
  FileSystem, FileSystemCapabilities, FsOptions, MkdirOptions, ReadDirectoryOptions, ReadFileOptions,
  ReadStreamOptions, RemoveOptions, WriteFileOptions,
} from "../../contracts/filesystem.js";
import { compareEntries, registerEntryView } from "../mount/comparison.js";
import { openRetainedReadFile, readOnlyCapabilities, retainedReadCapabilities } from "../capabilities.js";
import { admitDirectoryEntries, directoryEntryLimit } from "../directory-admission.js";

function readOnly(syscall: string, path: string, dest?: string): never {
  throw new FsError("EROFS", { syscall, path, ...(dest === undefined ? {} : { dest }) });
}

function snapshotStat(stat: FileStat): FileStat {
  const { type, size, allocatedBytes, mode, mtimeMs, atimeMs, ctimeMs, birthtimeMs, identityScope, ino, dev, nlink, uid, gid } = stat;
  return {
    type, size, mode, mtimeMs, atimeMs, ctimeMs,
    ...(allocatedBytes === undefined ? {} : { allocatedBytes }),
    ...(birthtimeMs === undefined ? {} : { birthtimeMs }),
    ...(identityScope === undefined ? {} : { identityScope }),
    ...(ino === undefined ? {} : { ino }),
    ...(dev === undefined ? {} : { dev }),
    ...(nlink === undefined ? {} : { nlink }),
    ...(uid === undefined ? {} : { uid }),
    ...(gid === undefined ? {} : { gid }),
  };
}

export class ReadOnlyFileSystem implements FileSystem {
  readonly #filesystem: FileSystem;
  readonly #capabilities: FileSystemCapabilities;

  constructor(filesystem: FileSystem) {
    this.#filesystem = filesystem;
    registerEntryView(this, async (path) => ({ filesystem: this.#filesystem, path, readOnly: true }));
    const streamingRead = typeof filesystem.readStream === "function" ? filesystem.capabilities.streamingRead : false;
    this.#capabilities = readOnlyCapabilities({
      ...retainedReadCapabilities(filesystem),
      readOnly: true,
      append: false,
      symlinks: filesystem.capabilities.symlinks === true && typeof filesystem.readlink === "function",
      hardlinks: false,
      permissions: false,
      timestamps: false,
      atomicRename: false,
      ...(streamingRead === undefined ? {} : { streamingRead }),
      streamingWrite: false,
    });
  }

  get capabilities(): FileSystemCapabilities {
    return this.#capabilities;
  }

  async capabilitiesFor(path: string, options?: FsOptions): Promise<FileSystemCapabilities> {
    const capabilities = await this.#filesystem.capabilitiesFor?.(path, options) ?? this.#filesystem.capabilities;
    return readOnlyCapabilities(retainedReadCapabilities(this.#filesystem, capabilities));
  }

  openReadFile(path: string, options: FsOptions = {}) {
    return openRetainedReadFile(this.#filesystem, path, options);
  }

  async readFile(path: string, options?: ReadFileOptions): Promise<Uint8Array> {
    return new Uint8Array(await this.#filesystem.readFile(path, options));
  }

  async stat(path: string, options?: FsOptions): Promise<FileStat> {
    return snapshotStat(await this.#filesystem.stat(path, options));
  }

  async lstat(path: string, options?: FsOptions): Promise<FileStat> {
    return snapshotStat(await this.#filesystem.lstat(path, options));
  }

  compareEntry(path: string, peer: FileSystem, peerPath: string, options: FsOptions = {}) {
    return compareEntries(this, path, peer, peerPath, options);
  }

  async readdir(path: string, options?: ReadDirectoryOptions): Promise<DirectoryEntry[]> {
    const limit = options?.maxEntries === undefined ? undefined : directoryEntryLimit(options, path);
    const entries = await this.#filesystem.readdir(path, options);
    if (limit !== undefined) options?.signal?.throwIfAborted();
    admitDirectoryEntries(entries.length, limit, path);
    return entries.map((entry) => ({ name: entry.name, type: entry.type }));
  }

  async realpath(path: string, options?: FsOptions): Promise<string> {
    return this.#filesystem.realpath(path, options);
  }

  async access(path: string, mode: number = ACCESS_MODES.F_OK, options?: FsOptions): Promise<void> {
    if (!Number.isInteger(mode) || mode < 0 || mode > 7) {
      throw new FsError("EINVAL", { syscall: "access", path });
    }
    if ((mode & ACCESS_MODES.W_OK) !== 0) readOnly("access", path);
    return this.#filesystem.access(path, mode, options);
  }

  async readlink(path: string, options?: FsOptions): Promise<string> {
    if (typeof this.#filesystem.readlink !== "function") {
      throw new FsError("ENOTSUP", { syscall: "readlink", path });
    }
    return this.#filesystem.readlink(path, options);
  }

  async *readStream(path: string, options?: ReadStreamOptions): ByteSource {
    if (typeof this.#filesystem.readStream !== "function") {
      throw new FsError("ENOTSUP", { syscall: "readStream", path });
    }
    for await (const chunk of readBytes(this.#filesystem.readStream(path, options), options?.signal)) {
      yield new Uint8Array(chunk);
    }
  }

  async writeFile(path: string, _data: Uint8Array, _options?: WriteFileOptions): Promise<void> {
    readOnly("writeFile", path);
  }

  async appendFile(path: string, _data: Uint8Array, _options?: AppendFileOptions): Promise<void> {
    readOnly("appendFile", path);
  }

  async writeStream(path: string, _source: ByteSource, _options?: WriteFileOptions): Promise<void> {
    readOnly("writeStream", path);
  }

  async mkdir(path: string, _options?: MkdirOptions): Promise<void> {
    readOnly("mkdir", path);
  }

  async rm(path: string, _options?: RemoveOptions): Promise<void> {
    readOnly("rm", path);
  }

  async unlink(path: string, _options?: FsOptions): Promise<void> {
    readOnly("unlink", path);
  }

  async rmdir(path: string, _options?: FsOptions): Promise<void> {
    readOnly("rmdir", path);
  }

  async rename(source: string, destination: string, _options?: FsOptions): Promise<void> {
    readOnly("rename", source, destination);
  }

  async copyFile(source: string, destination: string, _options?: CopyFileOptions): Promise<void> {
    readOnly("copyFile", source, destination);
  }

  async symlink(target: string, path: string, _options?: FsOptions): Promise<void> {
    readOnly("symlink", target, path);
  }

  async link(existingPath: string, newPath: string, _options?: FsOptions): Promise<void> {
    readOnly("link", existingPath, newPath);
  }

  async chmod(path: string, _mode: number, _options?: FsOptions): Promise<void> {
    readOnly("chmod", path);
  }

  async utimes(path: string, _atimeMs: number, _mtimeMs: number, _options?: FsOptions): Promise<void> {
    readOnly("utimes", path);
  }

  async truncate(path: string, _length?: number, _options?: FsOptions): Promise<void> {
    readOnly("truncate", path);
  }
}

export function createReadOnlyFileSystem(filesystem: FileSystem): ReadOnlyFileSystem {
  return new ReadOnlyFileSystem(filesystem);
}
