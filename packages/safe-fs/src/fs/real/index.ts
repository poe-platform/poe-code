import { constants, type Stats } from "node:fs";
import * as native from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { nativeAllocatedBytes } from "./allocation.js";
import { finishCleanup } from "../../contracts/cleanup.js";
import {
  FsError, collectBytes, isErrnoCode, toByteSource, toFsError, validatePath,
} from "../../contracts/index.js";
import type {
  AppendFileOptions, ByteSource, CopyFileOptions, DirectoryEntry, FileStat,
  FileSystem, FileSystemCapabilities, FileType, FsOptions, MkdirOptions,
  ReadFileOptions, ReadStreamOptions, RemoveOptions, WriteFileOptions,
} from "../../contracts/index.js";

export interface RealFileSystemOptions {
  /** An existing, absolute host directory. It is never created implicitly. */
  readonly root: string;
}

interface ResolutionOptions extends FsOptions {
  readonly followFinal?: boolean;
  readonly missing?: "final";
  readonly deferTrailingSeparator?: boolean;
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

function fileStat(stats: Stats): FileStat {
  const allocatedBytes = nativeAllocatedBytes(stats.blocks, process.platform);
  return {
    type: fileType(stats), size: stats.size, mode: stats.mode,
    ...(allocatedBytes === undefined ? {} : { allocatedBytes }),
    atimeMs: stats.atimeMs, mtimeMs: stats.mtimeMs, ctimeMs: stats.ctimeMs,
    birthtimeMs: stats.birthtimeMs, ino: stats.ino, dev: stats.dev,
    ...(Number.isSafeInteger(stats.dev) && stats.dev >= 0 && Number.isSafeInteger(stats.ino) && stats.ino >= 0
      ? { identityScope: Symbol.for("virtual-bash.fs.native") } : {}),
    nlink: stats.nlink, uid: stats.uid, gid: stats.gid,
  };
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
    readOnly: false, symlinks: true, hardlinks: true, permissions: true,
    timestamps: true, atomicRename: true, streamingRead: true, streamingWrite: true,
  });

  private readonly configuredRoot: string;
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
      if (component === "" || component === ".") continue;
      if (component === "..") {
        if (current === root) {
          if (fromLink) throw new FsError("EACCES", { message: "symlink target escapes the configured root" });
        } else {
          current = resolve(current, "..");
        }
        continue;
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
    action: () => Promise<Result>, dest?: string,
  ): Promise<Result> {
    options.signal?.throwIfAborted();
    try {
      validatePath(path);
      if (dest !== undefined) validatePath(dest);
      const result = await action();
      options.signal?.throwIfAborted();
      return result;
    } catch (error) {
      options.signal?.throwIfAborted();
      const converted = nativeError(error);
      throw new FsError(converted.code, {
        syscall, path, ...(dest === undefined ? {} : { dest }),
      });
    }
  }

  private protectRoot(path: string, root: string): void {
    if (resolve(path) === root) throw new FsError("EBUSY", { message: "the filesystem root cannot be removed or replaced" });
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
      return fileStat(await native.stat(target));
    });
  }

  async lstat(path: string, options: FsOptions = {}): Promise<FileStat> {
    return this.operation("lstat", path, options, async () => {
      const target = await this.path(path, { ...options, followFinal: false });
      options.signal?.throwIfAborted();
      return fileStat(await native.lstat(target));
    });
  }

  async readdir(path: string, options: FsOptions = {}): Promise<DirectoryEntry[]> {
    return this.operation("readdir", path, options, async () => {
      const target = await this.path(path, options);
      options.signal?.throwIfAborted();
      const entries = await native.readdir(target, { withFileTypes: true });
      return entries.map((entry) => ({ name: entry.name, type: fileType(entry) }));
    });
  }

  async mkdir(path: string, options: MkdirOptions = {}): Promise<void> {
    return this.operation("mkdir", path, options, async () => {
      if (options.mode !== undefined) integer(options.mode);
      const target = await this.path(path, {
        ...options,
        missing: "final", followFinal: !!options.recursive, deferTrailingSeparator: true,
        ...(options.recursive ? { createDirectories: { mode: options.mode ?? 0o777 } } : {}),
      });
      options.signal?.throwIfAborted();
      await native.mkdir(target, { recursive: options.recursive ?? false, ...(options.mode === undefined ? {} : { mode: options.mode }) });
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

  async rename(source: string, destination: string, options: FsOptions = {}): Promise<void> {
    return this.operation("rename", source, options, async () => {
      const from = await this.path(source, { ...options, followFinal: false });
      const to = await this.path(destination, { ...options, followFinal: false, missing: "final" });
      this.protectTerminal(source);
      this.protectTerminal(destination);
      const root = await this.root(options);
      this.protectRoot(from, root);
      this.protectRoot(to, root);
      options.signal?.throwIfAborted();
      await native.rename(from, to);
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

  async chmod(path: string, mode: number, options: FsOptions = {}): Promise<void> {
    return this.operation("chmod", path, options, async () => {
      integer(mode);
      const target = await this.path(path, options);
      options.signal?.throwIfAborted();
      await native.chmod(target, mode);
    });
  }

  async utimes(path: string, atimeMs: number, mtimeMs: number, options: FsOptions = {}): Promise<void> {
    return this.operation("utimes", path, options, async () => {
      if (!Number.isFinite(atimeMs) || !Number.isFinite(mtimeMs)) throw new FsError("EINVAL");
      const target = await this.path(path, options);
      options.signal?.throwIfAborted();
      await native.utimes(target, new Date(atimeMs), new Date(mtimeMs));
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

/** Construct and validate an existing root before returning the backend. */
export async function createRealFileSystem(options: RealFileSystemOptions | string): Promise<RealFileSystem> {
  const filesystem = new RealFileSystem(options);
  await filesystem.stat("/");
  return filesystem;
}
