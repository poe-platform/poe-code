import { snapshotStagingCreation } from "../staging-cleanup.js";
import { snapshotConditionalChmod } from "../conditional-chmod.js";
import { runStagingGuard, snapshotDirectoryAncestry } from "../staging-ancestry.js";
import { constants, type Stats, type BigIntStats } from "node:fs";
import * as immediate from "node:fs";
import * as native from "node:fs/promises";
import { dirname, basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { nativeAllocatedBytes } from "./allocation.js";
import { openFileDescriptor } from "../descriptor.js";
import type { FileDescriptor, OpenFileOptions } from "../../contracts/descriptor.js";
import { finishCleanup } from "../../contracts/cleanup.js";
import { callNativeSeekEnd, loadNativeSeekBinding } from "../../node/native-seek.js";
import { admitDirectoryEntries, directoryEntryLimit } from "../directory-admission.js";
import {
  FsError, collectBytes, isErrnoCode, toByteSource, toFsError, validatePath,
} from "../../contracts/index.js";
import type {
  AppendFileOptions, ByteSource, CopyFileOptions, DirectoryEntry, FileReadHandle, FileResizeHandle, FileStat,
  FileSystem, FileSystemCapabilities, FileType, FsOptions, RenameOptions, MkdirOptions, ChmodOptions, FileStagingEntry,
  ConditionalWriteFileOptions, ConditionalRemoveFileOptions, CreateStagedFileOptions, FileStaging, PublishStagedFileOptions, PrepareDirectoryOptions, StagedFileContent,
  OpenReadFileOptions, OpenResizeFileOptions, ReadDirectoryOptions, ReadFileOptions, ReadStreamOptions, RemoveOptions, WriteFileOptions,
} from "../../contracts/index.js";

export interface RealFileSystemOptions {
  /** An existing, absolute host directory. It is never created implicitly. */
  readonly root: string;
  /**
   * Trusted host primitive for an atomic no-replace move (e.g. renameat2 with
   * RENAME_NOREPLACE). Receives resolved absolute host paths. Must reject EEXIST
   * for any existing entry, including dangling symlinks, without mutation.
   * Never implement with an existence check, ordinary rename, or copy/delete.
   * Unsupported filesystems must reject ENOTSUP; cross-device moves reject EXDEV.
   */
  readonly renameNoReplace?: (source: string, destination: string, options: FsOptions) => Promise<void>;
}

interface ResolutionOptions extends FsOptions {
  readonly followFinal?: boolean;
  readonly missing?: "final";
  readonly deferTrailingSeparator?: boolean;
  readonly createFile?: boolean;
  readonly createDirectories?: { readonly mode: number };
  readonly checkTarget?: boolean;
}

interface PathComponent {
  readonly name: string;
  readonly fromLink: boolean;
}

function fileType(stats: Pick<Stats, "isFile" | "isDirectory" | "isSymbolicLink">): FileType {
  if (stats.isFile()) return "file";
  if (stats.isDirectory()) return "directory";
  if (stats.isSymbolicLink()) return "symlink";
  throw new FsError("ENOTSUP", { message: "special filesystem nodes are not supported" });
}

function fileStat(stats: Stats | BigIntStats): FileStat {
  const allocatedBytes = nativeAllocatedBytes(typeof stats.size === "bigint" && typeof stats.blocks === "bigint" ? Number(stats.blocks) : stats.blocks, process.platform);
  const blockSize = typeof stats.size === "bigint" && typeof stats.blksize === "bigint" ? Number(stats.blksize) : stats.blksize;
  const dev = Number(stats.dev), ino = Number(stats.ino);
  const snapshot: FileStat = {
    type: fileType(stats), size: Number(stats.size), mode: Number(stats.mode),
    ...(allocatedBytes === undefined ? {} : { allocatedBytes }),
    ...(typeof blockSize === "number" && Number.isSafeInteger(blockSize) && blockSize > 0 ? { ioBlockSize: blockSize, preferredIoBlockSize: blockSize } : {}),
    atimeMs: "atimeNs" in stats ? Number(stats.atimeNs / 1_000_000n) + Number(stats.atimeNs % 1_000_000n) / 1e6 : stats.atimeMs,
    mtimeMs: "mtimeNs" in stats ? Number(stats.mtimeNs / 1_000_000n) + Number(stats.mtimeNs % 1_000_000n) / 1e6 : stats.mtimeMs,
    ctimeMs: "ctimeNs" in stats ? Number(stats.ctimeNs / 1_000_000n) + Number(stats.ctimeNs % 1_000_000n) / 1e6 : stats.ctimeMs,
    birthtimeMs: "birthtimeNs" in stats ? Number(stats.birthtimeNs / 1_000_000n) + Number(stats.birthtimeNs % 1_000_000n) / 1e6 : stats.birthtimeMs, ino, dev,
    ...(Number.isSafeInteger(dev) && dev >= 0 && Number.isSafeInteger(ino) && ino >= 0
      ? { identityScope: Symbol.for("virtual-bash.fs.native") } : {}),
    nlink: Number(stats.nlink), uid: Number(stats.uid), gid: Number(stats.gid),
  };
  if ("ctimeNs" in stats && !stats.isDirectory()) Object.defineProperty(snapshot, "opaqueVersion", { value: `${stats.ctimeNs}:${stats.mtimeNs}`, enumerable: true });
  return snapshot;
}

function integer(value: number, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new FsError("EINVAL", { message: "expected a nonnegative safe integer" });
  }
}

function nativeError(error: unknown): FsError {
  if (typeof error === "object" && error !== null && "code" in error
    && (error.code === "ERR_INVALID_ARG_TYPE" || error.code === "ERR_INVALID_ARG_VALUE" || error.code === "ERR_OUT_OF_RANGE")) {
    return new FsError("EINVAL", { cause: error });
  }
  if (typeof error === "object" && error !== null && "info" in error) {
    const info = error.info;
    if (typeof info === "object" && info !== null && "code" in info && isErrnoCode(info.code)) {
      return new FsError(info.code, { cause: error });
    }
  }
  return toFsError(error);
}

/**
 * Async byte filesystem for trusted POSIX hosts (Windows is unsupported).
 * Both relative and absolute input paths are virtual POSIX paths rooted at `/`;
 * components resolve in order, following symlinks before subsequent `..` and
 * preserving trailing directory requirements. Empty paths are ENOENT. Excess
 * input `..` clamps at the virtual root; symlink targets may never cross it.
 * There is no process cwd dependency. The configured host root must already
 * exist; its canonical location is pinned on first use or by the async factory.
 *
 * Absolute symlink targets created here are virtual paths, stored as rooted
 * host targets without lexical normalization. Relative targets retain their
 * text; safe dangling, non-directory, and looping targets may be created.
 * Existing host symlinks are
 * followed only when every traversed component remains beneath the root, with
 * a 40-link traversal limit. Existing absolute host targets must start with the
 * canonical root, not a different host alias of that root. lstat, removal, and
 * rename inspect or modify a final symlink itself rather than its target. Absolute readlink results are
 * translated back into virtual paths; external absolute targets are refused.
 *
 * SECURITY LIMIT: containment checks and subsequent Node path operations are
 * not atomic. O_NOFOLLOW narrows final-file open races, but ancestor swaps,
 * concurrent renames, mount changes, and preexisting hardlinks cannot be made
 * safe by these APIs. This is NOT a race-proof sandbox or an isolation boundary
 * against another process modifying the tree. Use an OS sandbox for that.
 * Conditional chmod and synchronous ancestry validation use the same trusted,
 * externally isolated tree boundary as owned staging. Their final checks and
 * metadata commit do not yield to JavaScript; they do not prevent OS races.
 *
 * Only regular files, directories, and symlinks are represented. Permissions,
 * ownership, timestamp precision, case sensitivity, umask, and rename behavior
 * are those of the host filesystem. Copy is not atomic; rename can fail EXDEV.
 * Cancellation is cooperative between operations/chunks, not rollback: failed
 * or canceled writes/copies may leave partial data. No native commands execute.
 * Destructive rm/rename operands ending in `.` or `..` are refused with EINVAL,
 * including native recursive-rm edge cases that could otherwise delete content.
 * Public filesystem errors carry only virtual operands; native causes are
 * intentionally omitted so host paths cannot escape through nested errors.
 */
export class RealFileSystem implements FileSystem {
  readonly capabilities: FileSystemCapabilities = Object.freeze({
    read: true, stat: true, readdir: true, realpath: true, access: true, open: true,
    write: true, append: true, exclusiveCreate: true, explicitDirectories: true, implicitDirectories: false,
    mkdir: true, recursiveMkdir: true, remove: true, removeDirectory: true, recursiveRemove: true,
    rename: true, atomicRenameNoReplace: false, copy: true, exclusiveCopy: true, readlink: true, truncate: true,
    streamingAppend: true, randomAccessWrite: true,
    readOnly: false, symlinks: true, hardlinks: true, permissions: true,
    conditionalChmod: true,
    timestamps: true, atomicRename: true, streamingRead: true, streamingWrite: true, retainedRead: true, retainedResize: true, trustedOwnedStaging: true,
  });

  private readonly configuredRoot: string;
  private readonly renameNoReplace: RealFileSystemOptions["renameNoReplace"];
  private rootPromise: Promise<string> | undefined;

  constructor(options: RealFileSystemOptions | string) {
    const root = typeof options === "string" ? options : options.root;
    validatePath(root);
    if (!isAbsolute(root)) {
      throw new FsError("EINVAL", { syscall: "root", path: root, message: "root must be an absolute host path" });
    }
    if (sep !== "/") {
      throw new FsError("ENOTSUP", { syscall: "root", message: "this backend requires a POSIX host" });
    }
    this.configuredRoot = root;
    this.renameNoReplace = typeof options === "string" ? undefined : options.renameNoReplace;
    if (this.renameNoReplace !== undefined) {
      if (typeof this.renameNoReplace !== "function") throw new FsError("EINVAL", { syscall: "root", message: "renameNoReplace must be a function" });
      this.capabilities = Object.freeze({ ...this.capabilities, atomicRenameNoReplace: true });
    }
  }

  private async root(options: FsOptions = {}): Promise<string> {
    options.signal?.throwIfAborted();
    this.rootPromise ??= (async () => {
      const root = await native.realpath(this.configuredRoot);
      if (!(await native.stat(root)).isDirectory()) throw new FsError("ENOTDIR");
      return root;
    })();
    const root = await this.rootPromise;
    options.signal?.throwIfAborted();
    if (await native.realpath(root) !== root) throw new FsError("EACCES");
    options.signal?.throwIfAborted();
    if (!(await native.stat(root)).isDirectory()) throw new FsError("ENOTDIR");
    options.signal?.throwIfAborted();
    return root;
  }

  private absoluteTarget(root: string, target: string): string[] {
    if (target === root) return [];
    const prefix = root === "/" ? "/" : `${root}/`;
    if (!target.startsWith(prefix)) {
      throw new FsError("EACCES", { message: "symlink target escapes the configured root" });
    }
    return target.slice(prefix.length).split("/");
  }

  private async walk(root: string, components: PathComponent[], options: ResolutionOptions): Promise<string> {
    let current = root;
    let links = 0;
    const pending = [...components];
    while (pending.length > 0) {
      options.signal?.throwIfAborted();
      const { name: component, fromLink } = pending.shift()!;
      if (component === "") continue;
      if ((component === "." || component === "..") && !options.checkTarget) {
        await native.lstat(`${current}/.`);
        options.signal?.throwIfAborted();
      }
      if (component === ".") continue;
      if (component === "..") {
        if (current === root) {
          if (fromLink) throw new FsError("EACCES", { message: "symlink target escapes the configured root" });
        } else {
          current = resolve(current, "..");
        }
        continue;
      }
      if (options.createFile && pending.length > 0 && pending.every((part) => part.name === "")) {
        await native.lstat(`${current}/.`);
        options.signal?.throwIfAborted();
        throw new FsError("EISDIR");
      }
      const candidate = join(current, component);
      let stats: Stats;
      try {
        stats = await native.lstat(candidate);
      } catch (error) {
        options.signal?.throwIfAborted();
        const code = (error as NodeJS.ErrnoException).code;
        if (options.checkTarget && (code === "ENOENT" || code === "ENOTDIR")) {
          current = candidate;
          continue;
        }
        if (code !== "ENOENT") throw error;
        if (options.createDirectories && !fromLink) {
          try {
            options.signal?.throwIfAborted();
            await native.mkdir(candidate, { mode: options.createDirectories.mode });
          } catch (creationError) {
            if (nativeError(creationError).code !== "EEXIST") throw creationError;
          }
          options.signal?.throwIfAborted();
          stats = await native.lstat(candidate);
        } else if (!options.createDirectories && options.missing === "final" && pending.every((part) => part.name === "")) {
          return pending.length > 0 ? `${candidate}/` : candidate;
        } else {
          throw error;
        }
      }
      options.signal?.throwIfAborted();
      if (stats.isSymbolicLink() && (pending.length > 0 || options.followFinal !== false)) {
        if (++links > 40) throw new FsError("ELOOP");
        const target = await native.readlink(candidate);
        if (isAbsolute(target)) {
          pending.unshift(...this.absoluteTarget(root, target).map((name) => ({ name, fromLink: true })));
          current = root;
        } else {
          pending.unshift(...target.split("/").map((name) => ({ name, fromLink: true })));
        }
        continue;
      }
      if (pending.length > 0 && !stats.isDirectory() && !options.checkTarget) {
        if (options.deferTrailingSeparator && stats.isFile() && pending.every((part) => part.name === "")) {
          return `${candidate}/`;
        }
        throw new FsError("ENOTDIR");
      }
      if (!options.checkTarget) fileType(stats);
      current = candidate;
    }
    options.signal?.throwIfAborted();
    return components.at(-1)?.name === "" && current !== root ? `${current}/` : current;
  }

  private async path(path: string, options: ResolutionOptions = {}): Promise<string> {
    options.signal?.throwIfAborted();
    validatePath(path);
    if (path === "") throw new FsError("ENOENT");
    return this.walk(await this.root(options), path.split("/").map((name) => ({ name, fromLink: false })), options);
  }

  private async operation<Result>(
    syscall: string, path: string, options: FsOptions,
    action: () => Promise<Result>, dest?: string, preserveReceipt = false,
  ): Promise<Result> {
    options.signal?.throwIfAborted();
    try {
      validatePath(path);
      if (dest !== undefined) validatePath(dest);
      const result = await action();
      if (!preserveReceipt) options.signal?.throwIfAborted();
      return result;
    } catch (error) {
      if (!preserveReceipt) options.signal?.throwIfAborted();
      else if (options.signal?.aborted && Object.is(error, options.signal.reason)) throw error;
      const converted = nativeError(error);
      throw new FsError(converted.code, {
        syscall, path, ...(dest === undefined ? {} : { dest }),
      });
    }
  }

  private protectRoot(path: string, root: string): void {
    if (resolve(path) === root) throw new FsError("EBUSY", { message: "the filesystem root cannot be removed or replaced" });
  }

  // These critical sections contain no await. They serialize with all JavaScript
  // callers, under this adapter's existing trusted-host (externally isolated tree)
  // boundary. They deliberately do not advertise the stronger atomic capabilities.
  private stagingSnapshot(path: string): FileStat | null {
    try { return fileStat(immediate.lstatSync(path, { bigint: true })); }
    catch (error) { if (nativeError(error).code === "ENOENT") return null; throw error; }
  }

  private expectStaging(path: string, expected: FileStat | null, identityOnly = false): FileStat | null {
    if (expected && (expected.identityScope !== Symbol.for("virtual-bash.fs.native")
      || expected.dev === undefined || expected.ino === undefined || !identityOnly && expected.opaqueVersion === undefined)) throw new FsError("ENOTSUP");
    const current = this.stagingSnapshot(path);
    if (expected === null ? current !== null : !current || current.dev !== expected.dev || current.ino !== expected.ino || current.type !== expected.type
      || !identityOnly && (current.opaqueVersion !== expected.opaqueVersion || current.size !== expected.size || current.mode !== expected.mode || current.nlink !== expected.nlink)) throw new FsError("EAGAIN");
    if (immediate.realpathSync(dirname(path)) !== dirname(path)) throw new FsError("EAGAIN");
    return current;
  }

  private stagingMetadata(options: { mode?: number; atimeMs?: number; mtimeMs?: number }): void {
    if (options.mode !== undefined) integer(options.mode);
    for (const time of [options.atimeMs, options.mtimeMs]) if (time !== undefined && (!Number.isFinite(time) || Math.abs(time) > 8.64e15)) throw new FsError("EINVAL");
  }

  async prepareDirectoryAncestry(ancestors: readonly FileStagingEntry[], options: FsOptions = {}): Promise<() => true> {
    const controls: FsOptions = options.signal === undefined ? {} : { signal: options.signal };
    controls.signal?.throwIfAborted();
    const entries = snapshotDirectoryAncestry(ancestors);
    const path = entries.at(-1)!.path;
    return this.operation("prepareDirectoryAncestry", path, controls, async () => {
      const root = await this.root(controls);
      const validate = (): true => {
        controls.signal?.throwIfAborted();
        try {
          for (const entry of entries) this.expectStaging(join(root, entry.path.slice(1)), entry.stat, true);
          return true;
        } catch (error) {
          controls.signal?.throwIfAborted();
          throw new FsError(nativeError(error).code, { syscall: "prepareDirectoryAncestry", path });
        }
      };
      validate();
      return validate;
    });
  }

  async createStagedFile(directoryPath: string, name: string, content: StagedFileContent, options: CreateStagedFileOptions): Promise<FileStaging> {
    options = snapshotStagingCreation(options, directoryPath);
    // Unlike operation(), this must return its receipt after commit even if the
    // signal is aborted before the promise settles.
    options.signal?.throwIfAborted();
    try {
      if (options.retainCleanup === true) throw new FsError("ENOTSUP");
      if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\0")) throw new FsError("EINVAL");
      this.stagingMetadata(options);
      if (content.type === "file" && !(content.data instanceof Uint8Array)) throw new FsError("EINVAL");
      const directory = await this.path(directoryPath, { ...options, followFinal: false, missing: "final" });
      const root = await this.root(options);
      const target = content.type === "symlink" ? (validatePath(content.target), isAbsolute(content.target) ? `${root}/${content.target.slice(1)}` : content.target) : undefined;
      if (content.type === "symlink") await this.walk(root, (isAbsolute(content.target) ? content.target.slice(1).split("/") : relative(root, directory).split("/").concat(content.target.split("/"))).map(name => ({ name, fromLink: true })), { ...options, checkTarget: true });
      options.signal?.throwIfAborted();
      this.protectTerminal(directoryPath);
      this.expectStaging(dirname(directory), options.parent, true);
      immediate.mkdirSync(directory, { mode: 0o700 });
      const file = join(directory, name);
      try {
        if (content.type === "file") {
          const fd = immediate.openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, options.mode ?? 0o666);
          try {
            immediate.writeFileSync(fd, content.data);
            if (options.mode !== undefined) immediate.fchmodSync(fd, options.mode);
            if (options.atimeMs !== undefined || options.mtimeMs !== undefined) {
              const stat = immediate.fstatSync(fd);
              immediate.futimesSync(fd, (options.atimeMs ?? stat.atimeMs) / 1000, (options.mtimeMs ?? stat.mtimeMs) / 1000);
            }
          } finally { immediate.closeSync(fd); }
        } else immediate.symlinkSync(target!, file);
        const virtualDirectory = `/${relative(root, directory)}`;
        const receipt = (path: string, host: string) => Object.freeze({ path, stat: Object.freeze(this.stagingSnapshot(host)!) });
        return Object.freeze({ parent: receipt(dirname(virtualDirectory), dirname(directory)), directory: receipt(virtualDirectory, directory), file: receipt(`${virtualDirectory}/${name}`, file) });
      } catch (error) {
        // Only entries just acquired by this synchronous section can be removed.
        if (immediate.existsSync(file)) immediate.unlinkSync(file);
        immediate.rmdirSync(directory);
        throw error;
      }
    } catch (error) { options.signal?.throwIfAborted(); throw new FsError(nativeError(error).code, { syscall: "createStagedFile", path: directoryPath }); }
  }

  private async stagingPaths(staging: FileStaging, options: FsOptions): Promise<{ directory: string; file: string; parent: string }> {
    const directory = await this.path(staging.directory.path, { ...options, followFinal: false });
    const file = await this.path(staging.file.path, { ...options, followFinal: false, missing: "final" });
    const parent = await this.path(staging.parent.path, { ...options, followFinal: false });
    if (dirname(directory) !== parent || dirname(file) !== directory) throw new FsError("EAGAIN");
    return { directory, file, parent };
  }

  private checkStaging(staging: FileStaging, paths: { directory: string; file: string; parent: string }): void {
    this.expectStaging(paths.parent, staging.parent.stat, true);
    const directory = this.expectStaging(paths.directory, staging.directory.stat, true);
    if (directory?.type !== "directory" || (directory.mode & 0o777) !== 0o700) throw new FsError("EAGAIN");
  }

  async publishStagedFile(staging: FileStaging, destination: string, options: PublishStagedFileOptions): Promise<void> {
    return this.operation("publishStagedFile", staging.file.path, options, async () => {
      options.signal?.throwIfAborted();
      if (options.ancestors !== undefined || options.commitGuard !== undefined) throw new FsError("ENOTSUP");
      const paths = await this.stagingPaths(staging, options);
      const target = await this.path(destination, { ...options, followFinal: false, missing: "final" });
      options.signal?.throwIfAborted();
      this.protectTerminal(destination);
      this.checkStaging(staging, paths);
      this.expectStaging(paths.file, staging.file.stat);
      this.expectStaging(dirname(target), options.parent, true);
      const existing = this.expectStaging(target, options.destination);
      if (existing && existing.dev === staging.file.stat.dev && existing.ino === staging.file.stat.ino
        || target === paths.file || target === paths.directory || dirname(target) === paths.directory) throw new FsError("EINVAL");
      if (existing && existing.type !== "file") throw new FsError("EAGAIN");
      immediate.renameSync(paths.file, target);
    }, destination, true);
  }

  async removeStagedFile(staging: FileStaging, options: FsOptions = {}): Promise<void> {
    return this.operation("removeStagedFile", staging.directory.path, options, async () => {
      const paths = await this.stagingPaths(staging, options);
      options.signal?.throwIfAborted();
      this.checkStaging(staging, paths);
      const file = this.stagingSnapshot(paths.file);
      if (file) this.expectStaging(paths.file, staging.file.stat);
      const children = immediate.readdirSync(paths.directory);
      if (children.length !== (file ? 1 : 0) || file && children[0] !== basename(paths.file)) throw new FsError("ENOTEMPTY");
      if (file) immediate.unlinkSync(paths.file);
      immediate.rmdirSync(paths.directory);
    });
  }

  async writeFileConditional(path: string, data: Uint8Array, options: ConditionalWriteFileOptions): Promise<FileStat> {
    options.signal?.throwIfAborted();
    try {
      if (!(data instanceof Uint8Array)) throw new FsError("EINVAL");
      this.stagingMetadata(options);
      const target = await this.path(path, { ...options, followFinal: false, missing: "final" });
      options.signal?.throwIfAborted();
      this.expectStaging(dirname(target), options.parent, true);
      const existing = this.expectStaging(target, options.expected);
      if (existing && existing.type !== "file") throw new FsError("EAGAIN");
      const fd = immediate.openSync(target, constants.O_WRONLY | constants.O_NOFOLLOW | (existing ? 0 : constants.O_CREAT | constants.O_EXCL), options.mode ?? 0o666);
      try {
        if (!options.append) immediate.ftruncateSync(fd, 0);
        let offset = options.append ? Number(immediate.fstatSync(fd).size) : 0;
        let written = 0;
        while (written < data.length) {
          const count = immediate.writeSync(fd, data, written, data.length - written, offset);
          if (count === 0) throw new FsError("EIO");
          written += count; offset += count;
        }
        if (options.mode !== undefined) immediate.fchmodSync(fd, options.mode);
        if (options.atimeMs !== undefined || options.mtimeMs !== undefined) {
          const stat = immediate.fstatSync(fd);
          immediate.futimesSync(fd, (options.atimeMs ?? stat.atimeMs) / 1000, (options.mtimeMs ?? stat.mtimeMs) / 1000);
        }
        return fileStat(immediate.fstatSync(fd, { bigint: true }));
      } finally { immediate.closeSync(fd); }
    } catch (error) { options.signal?.throwIfAborted(); throw new FsError(nativeError(error).code, { syscall: "writeFileConditional", path }); }
  }

  async removeFileConditional(path: string, options: ConditionalRemoveFileOptions): Promise<void> {
    return this.operation("removeFileConditional", path, options, async () => {
      const target = await this.path(path, { ...options, followFinal: false });
      options.signal?.throwIfAborted();
      this.expectStaging(dirname(target), options.parent, true);
      const file = this.expectStaging(target, options.expected);
      if (file?.type !== "file" || file.nlink !== 1) throw new FsError("EAGAIN");
      immediate.unlinkSync(target);
    });
  }

  async prepareDirectory(path: string, options: PrepareDirectoryOptions): Promise<FileStat> {
    options.signal?.throwIfAborted();
    try {
      this.stagingMetadata(options);
      const target = await this.path(path, { ...options, followFinal: false, missing: "final" });
      options.signal?.throwIfAborted();
      this.protectTerminal(path);
      this.expectStaging(dirname(target), options.parent, true);
      const existing = this.expectStaging(target, options.expected, true);
      if (existing && existing.type !== "directory") throw new FsError("EAGAIN");
      if (!existing) immediate.mkdirSync(target, { mode: options.mode ?? 0o777 });
      if (options.mode !== undefined) immediate.chmodSync(target, options.mode);
      if (options.atimeMs !== undefined || options.mtimeMs !== undefined) {
        const stat = immediate.statSync(target);
        immediate.utimesSync(target, (options.atimeMs ?? stat.atimeMs) / 1000, (options.mtimeMs ?? stat.mtimeMs) / 1000);
      }
      return this.stagingSnapshot(target)!;
    } catch (error) { options.signal?.throwIfAborted(); throw new FsError(nativeError(error).code, { syscall: "prepareDirectory", path }); }
  }

  open(path: string, options: OpenFileOptions): Promise<FileDescriptor> {
    return openFileDescriptor<{ handle: native.FileHandle | undefined }>(path, options, {
      noFollow: true, positionedRead: true, positionedWrite: true, truncate: true, synchronization: "storage",
    }, async admitted => {
      let handle: native.FileHandle | undefined;
      try {
        const target = await this.path(path, {
          ...admitted, followFinal: !admitted.noFollow && admitted.creation !== "exclusive",
          ...(admitted.creation === "never" ? {} : { missing: "final" as const }),
        });
        let flags = (admitted.access === "read" ? constants.O_RDONLY : admitted.access === "write" ? constants.O_WRONLY : constants.O_RDWR)
          | constants.O_NOFOLLOW | constants.O_NONBLOCK;
        if (admitted.creation !== "never") flags |= constants.O_CREAT;
        if (admitted.creation === "exclusive") flags |= constants.O_EXCL;
        if (admitted.append) flags |= constants.O_APPEND;
        let created = false;
        if (admitted.exactMode && admitted.creation !== "never") {
          try {
            handle = await native.open(target, flags | constants.O_EXCL, admitted.mode);
            created = true;
          } catch (error) {
            if (admitted.creation === "exclusive" || nativeError(error).code !== "EEXIST") throw error;
            handle = await native.open(target, flags & ~constants.O_CREAT, admitted.mode);
          }
        } else handle = await native.open(target, flags, admitted.mode);
        if (created) await handle.chmod(admitted.mode);
        admitted.signal?.throwIfAborted();
        const stat = await handle.stat();
        if (stat.isDirectory()) throw new FsError("EISDIR");
        if (!stat.isFile()) throw new FsError("ENOTSUP");
        admitted.signal?.throwIfAborted();
        if (admitted.truncate) await handle.truncate(0);
        const resource: { handle: native.FileHandle | undefined } = { handle };
        handle = undefined;
        return {
          resource,
          stat: (retained, forwarded) => this.operation("fstat", path, forwarded, async () => fileStat(await retained.handle!.stat({ bigint: true }))),
          read: (retained, buffer, position, forwarded) => this.operation("read", path, forwarded,
            async () => (await retained.handle!.read(buffer, 0, buffer.byteLength, position)).bytesRead),
          write: (retained, buffer, position, forwarded) => this.operation("write", path, forwarded,
            async () => (await retained.handle!.write(buffer, 0, buffer.byteLength, position)).bytesWritten),
          truncate: (retained, length, forwarded) => this.operation("ftruncate", path, forwarded, () => retained.handle!.truncate(length)),
          sync: (retained, dataOnly, forwarded) => this.operation(dataOnly ? "fdatasync" : "fsync", path, forwarded,
            () => dataOnly ? retained.handle!.datasync() : retained.handle!.sync()),
          close: async retained => {
            try { await this.operation("close", path, {}, () => retained.handle!.close()); }
            finally { retained.handle = undefined; }
          },
        };
      } catch (error) {
        if (handle) await finishCleanup(() => handle!.close(), true);
        handle = undefined;
        admitted.signal?.throwIfAborted();
        throw new FsError(nativeError(error).code, { syscall: "open", path });
      }
    });
  }

  private protectTerminal(path: string): void {
    const terminal = path.split("/").filter(Boolean).at(-1);
    if (terminal === "." || terminal === "..") throw new FsError("EINVAL");
  }

  async readFile(path: string, options: ReadFileOptions = {}): Promise<Uint8Array> {
    return this.operation("readFile", path, options, async () => {
      const maxBytes = options.maxBytes ?? Number.MAX_SAFE_INTEGER;
      integer(maxBytes);
      return collectBytes(this.readStream(path, options), { maxBytes, ...options });
    });
  }

  async writeFile(path: string, data: Uint8Array, options: WriteFileOptions = {}): Promise<void> {
    return this.operation("writeFile", path, options, async () => {
      if (!(data instanceof Uint8Array)) throw new FsError("EINVAL");
      await this.writeStream(path, toByteSource(data), options);
    });
  }

  async appendFile(path: string, data: Uint8Array, options: AppendFileOptions = {}): Promise<void> {
    return this.operation("appendFile", path, options, () => this.writeFile(path, data, { ...options, flag: "a" }));
  }

  async stat(path: string, options: FsOptions = {}): Promise<FileStat> {
    return this.operation("stat", path, options, async () => {
      const target = await this.path(path, options);
      options.signal?.throwIfAborted();
      return fileStat(await native.stat(target, { bigint: true }));
    });
  }

  async lstat(path: string, options: FsOptions = {}): Promise<FileStat> {
    return this.operation("lstat", path, options, async () => {
      const target = await this.path(path, { ...options, followFinal: false });
      options.signal?.throwIfAborted();
      return fileStat(await native.lstat(target, { bigint: true }));
    });
  }

  async readdir(path: string, options: ReadDirectoryOptions = {}): Promise<DirectoryEntry[]> {
    const limit = directoryEntryLimit(options, path);
    return this.operation("readdir", path, options, async () => {
      const target = await this.path(path, options);
      options.signal?.throwIfAborted();
      if (limit === undefined) {
        const entries = await native.readdir(target, { withFileTypes: true });
        return entries.map((entry) => ({ name: entry.name, type: fileType(entry) }));
      }
      const handle = await native.opendir(target, { bufferSize: 1 });
      let failed = false;
      try {
        const entries: DirectoryEntry[] = [];
        while (true) {
          options.signal?.throwIfAborted();
          const entry = await handle.read();
          options.signal?.throwIfAborted();
          if (entry === null) return entries;
          admitDirectoryEntries(entries.length + 1, limit, path);
          entries.push({ name: entry.name, type: fileType(entry) });
        }
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        await finishCleanup(() => handle.close(), failed);
      }
    });
  }

  async mkdir(path: string, options: MkdirOptions = {}): Promise<void> {
    return this.operation("mkdir", path, options, async () => {
      if (options.mode !== undefined) integer(options.mode);
      if (options.exactMode && options.recursive) throw new FsError("ENOTSUP");
      const target = await this.path(path, {
        ...options,
        missing: "final", followFinal: !!options.recursive, deferTrailingSeparator: true,
        ...(options.recursive ? { createDirectories: { mode: options.mode ?? 0o777 } } : {}),
      });
      options.signal?.throwIfAborted();
      await native.mkdir(target, { recursive: options.recursive ?? false, ...(options.mode === undefined ? {} : { mode: options.mode }) });
      if (options.exactMode) await native.chmod(target, options.mode ?? 0o777);
    });
  }

  async rmdir(path: string, options: FsOptions = {}): Promise<void> {
    return this.operation("rmdir", path, options, async () => {
      const target = await this.path(path.replace(/\/+$/, "") || (path ? "/" : ""), { ...options, followFinal: false });
      this.protectTerminal(path);
      this.protectRoot(target, await this.root(options));
      options.signal?.throwIfAborted();
      await native.rmdir(target);
    });
  }

  async rm(path: string, options: RemoveOptions = {}): Promise<void> {
    return this.operation("rm", path, options, async () => {
      let target: string;
      try {
        target = await this.path(path, { ...options, followFinal: false });
      } catch (error) {
        if (options.force && toFsError(error).code === "ENOENT") return;
        throw error;
      }
      this.protectTerminal(path);
      this.protectRoot(target, await this.root(options));
      options.signal?.throwIfAborted();
      await native.rm(target, { recursive: options.recursive ?? false, force: options.force ?? false });
    });
  }

  async unlink(path: string, options: FsOptions = {}): Promise<void> {
    return this.operation("unlink", path, options, async () => {
      const target = await this.path(path, { ...options, followFinal: false });
      this.protectTerminal(path);
      this.protectRoot(target, await this.root(options));
      options.signal?.throwIfAborted();
      await native.unlink(target);
    });
  }

  async rename(source: string, destination: string, options: RenameOptions = {}): Promise<void> {
    return this.operation("rename", source, options, async () => {
      if (options.noReplace && !this.renameNoReplace) throw new FsError("ENOTSUP", { syscall: "rename", path: source, dest: destination });
      const from = await this.path(source, { ...options, followFinal: false });
      const to = await this.path(destination, { ...options, followFinal: false, missing: "final" });
      this.protectTerminal(source);
      this.protectTerminal(destination);
      const root = await this.root(options);
      this.protectRoot(from, root);
      this.protectRoot(to, root);
      options.signal?.throwIfAborted();
      if (options.noReplace) await this.renameNoReplace!(from, to, options.signal ? { signal: options.signal } : {});
      else await native.rename(from, to);
    }, destination);
  }

  async copyFile(source: string, destination: string, options: CopyFileOptions = {}): Promise<void> {
    return this.operation("copyFile", source, options, async () => {
      const from = await this.path(source, options);
      const to = await this.path(destination, { ...options, missing: "final", followFinal: !options.exclusive, deferTrailingSeparator: true });
      let flags = options.exclusive ? constants.COPYFILE_EXCL : 0;
      if (!to.endsWith("/")) {
        const origin = await native.stat(from, { bigint: true });
        let target;
        try { target = await native.lstat(to, { bigint: true }); }
        catch (error) { if (nativeError(error).code !== "ENOENT") throw error; }
        if (target && options.exclusive) throw new FsError("EEXIST");
        if (target && origin.isFile() && origin.dev === target.dev && origin.ino === target.ino) throw new FsError("EINVAL");
        if (!target) flags |= constants.COPYFILE_EXCL;
      }
      options.signal?.throwIfAborted();
      await native.copyFile(from, to, flags);
    }, destination);
  }

  async realpath(path: string, options: FsOptions = {}): Promise<string> {
    return this.operation("realpath", path, options, async () => {
      const target = await this.path(path, options);
      return `/${relative(await this.root(options), target)}`;
    });
  }

  async access(path: string, mode = constants.F_OK, options: FsOptions = {}): Promise<void> {
    return this.operation("access", path, options, async () => {
      integer(mode);
      if (mode > 7) throw new FsError("EINVAL");
      const target = await this.path(path, options);
      options.signal?.throwIfAborted();
      await native.access(target, mode);
    });
  }

  async readlink(path: string, options: FsOptions = {}): Promise<string> {
    return this.operation("readlink", path, options, async () => {
      const resolved = await this.path(path, { ...options, followFinal: false });
      options.signal?.throwIfAborted();
      const target = await native.readlink(resolved);
      if (!isAbsolute(target)) return target;
      return `/${this.absoluteTarget(await this.root(options), target).join("/")}`;
    });
  }

  async symlink(target: string, path: string, options: FsOptions = {}): Promise<void> {
    return this.operation("symlink", path, options, async () => {
      validatePath(target);
      if (!target) throw new FsError("ENOENT");
      const destination = await this.path(path, { ...options, followFinal: false, missing: "final" });
      const root = await this.root(options);
      const stored = target.startsWith("/") ? `${root === "/" ? "" : root}${target}` : target;
      const components = target.startsWith("/")
        ? target.split("/")
        : [...relative(root, resolve(destination, "..")).split("/"), ...target.split("/")];
      try {
        await this.walk(root, components.map((name) => ({ name, fromLink: true })), { ...options, checkTarget: true });
      } catch (error) {
        if (nativeError(error).code !== "ELOOP") throw error;
      }
      options.signal?.throwIfAborted();
      await native.symlink(stored, destination);
    });
  }

  async link(existingPath: string, newPath: string, options: FsOptions = {}): Promise<void> {
    return this.operation("link", existingPath, options, async () => {
      const source = await this.path(existingPath, { ...options, followFinal: false });
      const destination = await this.path(newPath, { ...options, followFinal: false, missing: "final" });
      options.signal?.throwIfAborted();
      await native.link(source, destination);
    }, newPath);
  }

  async chmod(path: string, mode: number, options: ChmodOptions = {}): Promise<void> {
    return this.operation("chmod", path, options, async () => {
      integer(mode);
      const conditional = snapshotConditionalChmod(path, options);
      if (conditional) {
        const target = await this.path(path, { ...conditional, followFinal: false });
        const root = await this.root(conditional);
        if ((target === root ? "/" : `/${relative(root, target)}`) !== path) throw new FsError("EAGAIN");
        if (conditional.expected.type !== "file" && conditional.expected.type !== "directory") throw new FsError("ENOTSUP");
        const parent = target === root ? root : dirname(target);
        const validate = (): void => {
          conditional.signal?.throwIfAborted();
          for (const entry of conditional.ancestors) this.expectStaging(join(root, entry.path.slice(1)), entry.stat, true);
          this.expectStaging(parent, conditional.parent, true);
          const current = this.expectStaging(target, conditional.expected, conditional.expected.type === "directory");
          if (current?.mode !== conditional.expected.mode) throw new FsError("EAGAIN");
        };
        validate();
        if (conditional.commitGuard) runStagingGuard(conditional.commitGuard);
        validate();
        immediate.chmodSync(target, mode);
        return;
      }
      const target = await this.path(path, options);
      options.signal?.throwIfAborted();
      await native.chmod(target, mode);
    });
  }

  async utimes(path: string, atimeMs: number, mtimeMs: number, options: FsOptions = {}): Promise<void> {
    return this.operation("utimes", path, options, async () => {
      if (!Number.isFinite(atimeMs) || !Number.isFinite(mtimeMs)
        || Math.abs(atimeMs) > 8.64e15 || Math.abs(mtimeMs) > 8.64e15) throw new FsError("EINVAL");
      const target = await this.path(path, options);
      options.signal?.throwIfAborted();
      const atimeSeconds = atimeMs / 1000;
      const mtimeSeconds = mtimeMs / 1000;
      await native.utimes(target, atimeSeconds < 0 ? String(atimeSeconds) : atimeSeconds, mtimeSeconds < 0 ? String(mtimeSeconds) : mtimeSeconds);
    });
  }

  async truncate(path: string, length = 0, options: FsOptions = {}): Promise<void> {
    return this.operation("truncate", path, options, async () => {
      integer(length);
      const target = await this.path(path, options);
      options.signal?.throwIfAborted();
      const handle = await native.open(target, constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        options.signal?.throwIfAborted();
        if (!(await handle.stat()).isFile()) throw new FsError("ENOTSUP");
        options.signal?.throwIfAborted();
        await handle.truncate(length);
      } finally {
        await handle.close();
      }
    });
  }

  async openResizeFile(path: string, options: OpenResizeFileOptions = {}): Promise<FileResizeHandle> {
    options.signal?.throwIfAborted();
    const assertStock = (): void => {
      const unsupported = (): never => { throw new FsError("ENOTSUP", { syscall: "openResizeFile", path }); };
      if (Object.getPrototypeOf(this) !== RealFileSystem.prototype) unsupported();
      for (const name of ["openResizeFile", "truncate", "writeFile", "writeStream", "appendFile", "stat", "lstat", "realpath", "access",
        "root", "absoluteTarget", "walk", "path"]) {
        const descriptor = Object.getOwnPropertyDescriptor(this, name)
          ?? Object.getOwnPropertyDescriptor(RealFileSystem.prototype, name);
        if (!descriptor || !("value" in descriptor) || descriptor.value !== realImplementation[name]?.value) unsupported();
      }
      const capabilities = Object.getOwnPropertyDescriptor(this, "capabilities")?.value;
      if (capabilities?.readOnly === true) throw new FsError("EROFS", { syscall: "openResizeFile", path });
      if (capabilities?.retainedResize !== true) unsupported();
    };
    assertStock();
    const failure = (error: unknown, syscall: string): unknown => error
      ? new FsError(nativeError(error).code, { syscall, path }) : error;
    let resource: native.FileHandle | undefined;
    try {
      if (options.mode !== undefined) integer(options.mode);
      if (options.create !== undefined && typeof options.create !== "boolean") throw new FsError("EINVAL");
      const target = await this.path(path, {
        ...options, ...(options.create === true ? { missing: "final" as const } : {}),
        deferTrailingSeparator: true, createFile: options.create === true,
      });
      options.signal?.throwIfAborted();
      assertStock();
      const flags = constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
        | (options.create === true ? constants.O_CREAT : 0);
      resource = await native.open(target, flags, options.mode ?? 0o666);
      options.signal?.throwIfAborted();
      const stats = await resource.stat();
      options.signal?.throwIfAborted();
      assertStock();
      if (stats.isDirectory()) throw new FsError("EISDIR");
      if (!stats.isFile()) throw new FsError("ENOTSUP");
    } catch (error) {
      await finishCleanup(async () => { await resource?.close(); }, true);
      options.signal?.throwIfAborted();
      throw failure(error, "openResizeFile");
    }
    const handle = resource;
    const pending = new Set<Promise<void>>();
    let accepting = true;
    let closing: Promise<void> | undefined;
    const assertOpen = (options: FsOptions, syscall: string): void => {
      options.signal?.throwIfAborted();
      if (!accepting) throw new FsError("EBADF", { syscall, path });
    };
    const perform = async <Value>(options: FsOptions, syscall: string, action: () => Promise<Value>): Promise<Value> => {
      assertOpen(options, syscall);
      let settled!: () => void;
      const admitted = new Promise<void>(resolve => { settled = resolve; });
      pending.add(admitted);
      try {
        const value = await action();
        options.signal?.throwIfAborted();
        return value;
      } catch (error) {
        options.signal?.throwIfAborted();
        throw failure(error, syscall);
      } finally {
        pending.delete(admitted);
        settled();
      }
    };
    return {
      stat(options = {}) {
        return perform(options, "fstat", async () => fileStat(await handle.stat({ bigint: true })));
      },
      async truncate(length, options = {}) {
        assertOpen(options, "ftruncate");
        try { integer(length); }
        catch (error) { throw failure(error, "ftruncate"); }
        return perform(options, "ftruncate", async () => { await handle.truncate(length); });
      },
      async seekEnd(options = {}) {
        const signal = options.signal;
        const operationOptions = signal === undefined ? {} : { signal };
        assertOpen(operationOptions, "lseek");
        try {
          const binding = await loadNativeSeekBinding(signal);
          assertOpen(operationOptions, "lseek");
          const seek = binding.seekEnd;
          assertOpen(operationOptions, "lseek");
          if (typeof seek !== "function") throw new FsError("EIO");
          const descriptor = handle.fd;
          assertOpen(operationOptions, "lseek");
          return await perform(operationOptions, "lseek", () => callNativeSeekEnd(binding, seek, descriptor));
        } catch (error) {
          signal?.throwIfAborted();
          throw failure(error, "lseek");
        }
      },
      close() {
        accepting = false;
        closing ??= Promise.all([...pending]).then(async () => {
          try { await handle.close(); }
          catch (error) { throw failure(error, "close"); }
        });
        return closing;
      },
    };
  }

  async openReadFile(path: string, options: OpenReadFileOptions = {}): Promise<FileReadHandle> {
    const signal = options.signal;
    signal?.throwIfAborted();
    const assertStock = (): void => {
      const unsupported = (): never => { throw new FsError("ENOTSUP", { syscall: "openReadFile", path }); };
      if (Object.getPrototypeOf(this) !== RealFileSystem.prototype) unsupported();
      for (const name of ["openReadFile", "readFile", "readStream", "stat", "lstat", "realpath", "access",
        "root", "absoluteTarget", "walk", "path"]) {
        const descriptor = Object.getOwnPropertyDescriptor(this, name)
          ?? Object.getOwnPropertyDescriptor(RealFileSystem.prototype, name);
        if (!descriptor || !("value" in descriptor) || descriptor.value !== realImplementation[name]?.value) unsupported();
      }
      if (Object.getOwnPropertyDescriptor(this, "capabilities")?.value?.retainedRead !== true) unsupported();
    };
    assertStock();
    const failure = (error: unknown, syscall: string): unknown => error
      ? new FsError(nativeError(error).code, { syscall, path }) : error;
    let resource: native.FileHandle | undefined;
    let directory = false;
    try {
      const allowDirectory = options.allowDirectory === true;
      signal?.throwIfAborted();
      const target = await this.path(path, signal === undefined ? {} : { signal });
      signal?.throwIfAborted();
      assertStock();
      resource = await native.open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      signal?.throwIfAborted();
      const stats = await resource.stat();
      signal?.throwIfAborted();
      assertStock();
      directory = stats.isDirectory();
      if (directory && !allowDirectory) throw new FsError("EISDIR");
      if (!directory && !stats.isFile()) throw new FsError("ENOTSUP");
      signal?.throwIfAborted();
    } catch (error) {
      await finishCleanup(async () => { await resource?.close(); }, true);
      signal?.throwIfAborted();
      throw failure(error, "openReadFile");
    }
    const handle = resource;
    const pending = new Set<Promise<void>>();
    let accepting = true;
    let closing: Promise<void> | undefined;
    const assertOpen = (options: FsOptions, syscall: string): void => {
      options.signal?.throwIfAborted();
      if (!accepting) throw new FsError("EBADF", { syscall, path });
    };
    const perform = async <Value>(options: FsOptions, syscall: string, action: () => Promise<Value>): Promise<Value> => {
      assertOpen(options, syscall);
      let settled!: () => void;
      const admitted = new Promise<void>(resolve => { settled = resolve; });
      pending.add(admitted);
      try {
        const value = await action();
        options.signal?.throwIfAborted();
        return value;
      } catch (error) {
        options.signal?.throwIfAborted();
        throw failure(error, syscall);
      } finally {
        pending.delete(admitted);
        settled();
      }
    };
    return {
      stat(options = {}) {
        return perform(options, "fstat", async () => fileStat(await handle.stat({ bigint: true })));
      },
      async read(position, maxBytes, options = {}) {
        assertOpen(options, "read");
        try {
          integer(position);
          integer(maxBytes, 1);
        } catch (error) { throw failure(error, "read"); }
        if (maxBytes > Number.MAX_SAFE_INTEGER - position) throw new FsError("EINVAL", { syscall: "read", path });
        if (directory) throw new FsError("EISDIR", { syscall: "read", path });
        return perform(options, "read", async () => {
          let bytes: Uint8Array;
          try { bytes = new Uint8Array(maxBytes); }
          catch { throw new FsError("EFBIG"); }
          const { bytesRead } = await handle.read(bytes, 0, bytes.byteLength, position);
          if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > maxBytes) throw new FsError("EIO");
          return bytes.slice(0, bytesRead);
        });
      },
      async seekEnd(options = {}) {
        const signal = options.signal;
        const operationOptions = signal === undefined ? {} : { signal };
        assertOpen(operationOptions, "lseek");
        try {
          const binding = await loadNativeSeekBinding(signal);
          assertOpen(operationOptions, "lseek");
          const seek = binding.seekEnd;
          assertOpen(operationOptions, "lseek");
          if (typeof seek !== "function") throw new FsError("EIO");
          const descriptor = handle.fd;
          assertOpen(operationOptions, "lseek");
          return await perform(operationOptions, "lseek", () => callNativeSeekEnd(binding, seek, descriptor));
        } catch (error) {
          signal?.throwIfAborted();
          throw failure(error, "lseek");
        }
      },
      close() {
        accepting = false;
        closing ??= Promise.all([...pending]).then(async () => {
          try { await handle.close(); }
          catch (error) { throw failure(error, "close"); }
        });
        return closing;
      },
    };
  }

  async *readStream(path: string, options: ReadStreamOptions = {}): ByteSource {
    const syscall = "readStream";
    let handle: native.FileHandle | undefined;
    let failed = false;
    try {
      options.signal?.throwIfAborted();
      const start = options.start ?? 0;
      const end = options.endExclusive ?? Number.MAX_SAFE_INTEGER;
      const chunkSize = options.chunkSize ?? 64 * 1024;
      integer(start);
      integer(end);
      integer(chunkSize, 1);
      if (end < start) throw new FsError("EINVAL");
      const target = await this.path(path, options);
      options.signal?.throwIfAborted();
      handle = await native.open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      options.signal?.throwIfAborted();
      const stats = await handle.stat();
      if (stats.isDirectory()) throw new FsError("EISDIR");
      if (!stats.isFile()) throw new FsError("ENOTSUP");
      let position = start;
      while (position < end) {
        options.signal?.throwIfAborted();
        const bytes = new Uint8Array(Math.min(chunkSize, end - position));
        const { bytesRead } = await handle.read(bytes, 0, bytes.byteLength, position);
        options.signal?.throwIfAborted();
        if (bytesRead === 0) break;
        position += bytesRead;
        yield bytes.subarray(0, bytesRead);
      }
      options.signal?.throwIfAborted();
    } catch (error) {
      failed = true;
      options.signal?.throwIfAborted();
      throw new FsError(nativeError(error).code, { syscall, path });
    } finally {
      await finishCleanup(async () => {
        try {
          await handle?.close();
        } catch (error) {
          throw new FsError(nativeError(error).code, { syscall, path });
        }
      }, failed);
    }
  }

  async writeStream(path: string, source: ByteSource, options: WriteFileOptions = {}): Promise<void> {
    return this.operation("writeStream", path, options, async () => {
      const flag = options.flag ?? "w";
      if (!["w", "wx", "a", "ax"].includes(flag)) throw new FsError("EINVAL");
      if (options.mode !== undefined) integer(options.mode);
      const exclusive = flag.endsWith("x");
      const destination = await this.path(path, { ...options, missing: "final", followFinal: !exclusive, deferTrailingSeparator: true });
      const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK
        | (flag.startsWith("a") ? constants.O_APPEND : constants.O_TRUNC)
        | (exclusive ? constants.O_EXCL : 0);
      options.signal?.throwIfAborted();
      const handle = await native.open(destination, flags, options.mode ?? 0o666);
      try {
        options.signal?.throwIfAborted();
        if (!(await handle.stat()).isFile()) throw new FsError("ENOTSUP");
        options.signal?.throwIfAborted();
        for await (const chunk of source) {
          options.signal?.throwIfAborted();
          if (!(chunk instanceof Uint8Array)) throw new FsError("EINVAL");
          let offset = 0;
          while (offset < chunk.byteLength) {
            options.signal?.throwIfAborted();
            const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset, null);
            if (bytesWritten === 0) throw new FsError("EIO");
            offset += bytesWritten;
          }
        }
      } finally {
        await handle.close();
      }
    });
  }
}

const realImplementation = Object.getOwnPropertyDescriptors(RealFileSystem.prototype);

/** Construct and validate an existing root before returning the backend. */
export async function createRealFileSystem(options: RealFileSystemOptions | string): Promise<RealFileSystem> {
  const filesystem = new RealFileSystem(options);
  await filesystem.stat("/");
  return filesystem;
}
