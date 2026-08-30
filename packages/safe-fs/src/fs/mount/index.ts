import { FsError, isFsError, toFsError } from "../../contracts/errors.js";
import type { ErrnoCode } from "../../contracts/errors.js";
import type {
  AppendFileOptions, CopyFileOptions, DirectoryEntry, FileStat, FileSystem,
  FileSystemCapabilities, FsOptions, MkdirOptions, ReadFileOptions,
  ReadStreamOptions, RemoveOptions, WriteFileOptions,
} from "../../contracts/filesystem.js";
import type { ByteSource } from "../../contracts/io.js";
import { readBytes } from "../../contracts/io.js";
import { finishCleanup } from "../../contracts/cleanup.js";
import { normalizePath, validatePath } from "../../contracts/path.js";
import { compareIdentity } from "./identity.js";
import { compareEntries, registerEntryAuthority, registerEntryView } from "./comparison.js";

export interface MountFileSystemOptions {
  readonly root: FileSystem;
  readonly mounts?: Readonly<Record<string, FileSystem>>;
}

interface Mount {
  readonly path: string;
  readonly backend: FileSystem;
}

interface Location {
  readonly path: string;
  readonly local: string;
  readonly mount: Mount;
  readonly stat: FileStat | undefined;
  readonly synthetic: boolean;
}

interface Component {
  readonly name: string;
  readonly trailing?: boolean;
}

interface ResolveOptions {
  readonly followFinal?: boolean;
  readonly entry?: boolean;
  readonly allowMissing?: boolean;
  readonly missingDirectory?: boolean;
  readonly createDirectories?: Map<string, Location>;
}

const syntheticStat: FileStat = Object.freeze({
  type: "directory", size: 0, mode: 0o40555,
  mtimeMs: 0, atimeMs: 0, ctimeMs: 0,
});

function within(parent: string, path: string): boolean {
  return parent === "/" || path === parent || path.startsWith(`${parent}/`);
}

function globalPath(path: string): string {
  return typeof path === "string" && path.startsWith("/") ? path : `/${String(path)}`;
}

function fail(code: ErrnoCode): never {
  throw new FsError(code);
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

export class MountFileSystem implements FileSystem {
  readonly capabilities: FileSystemCapabilities;
  private readonly mounts: readonly Mount[];

  constructor(options: MountFileSystemOptions) {
    const mounts: Mount[] = [];
    const paths = new Set<string>();
    const add = (path: string, backend: FileSystem): void => {
      if (backend instanceof MountFileSystem) {
        for (const child of backend.mounts) {
          add(path === "/" ? child.path : child.path === "/" ? path : `${path}${child.path}`, child.backend);
        }
        return;
      }
      if (paths.has(path)) {
        throw new FsError("EINVAL", { syscall: "mount", path });
      }
      paths.add(path);
      mounts.push({ path, backend });
    };
    add("/", options.root);
    for (const [input, backend] of Object.entries(options.mounts ?? {})) {
      try { validatePath(input); } catch (error) {
        throw new FsError("EINVAL", { syscall: "mount", path: globalPath(input), cause: error });
      }
      const path = normalizePath(input);
      if (!input.startsWith("/") || path === "/") {
        throw new FsError("EINVAL", { syscall: "mount", path: globalPath(input) });
      }
      add(path, backend);
    }
    this.mounts = mounts.sort((left, right) => right.path.length - left.path.length);
    registerEntryView(this, (path, options) => this.operation("compareEntry", path, options, async () => {
      const location = await this.resolve(path, options);
      if (location.synthetic) return { filesystem: this, path, stat: syntheticStat, readOnly: true };
      return { filesystem: location.mount.backend, path: location.local };
    }));
    registerEntryAuthority(this, async () => "unknown");
    const all = (capability: string, methods: readonly (keyof FileSystem)[] = []): boolean =>
      mounts.every(({ backend }) => backend.capabilities[capability] === true
        && methods.every((method) => typeof backend[method] === "function"));
    const streaming = (capability: "streamingRead" | "streamingWrite", method: "readStream" | "writeStream"): boolean | undefined =>
      all(capability, [method]) ? true : mounts.some(({ backend }) =>
        backend.capabilities[capability] !== false && typeof backend[method] === "function") ? undefined : false;
    const streamingRead = streaming("streamingRead", "readStream");
    const streamingWrite = streaming("streamingWrite", "writeStream");
    this.capabilities = Object.freeze({
      get snapshotRmdir() { return mounts.some(({ backend }) => backend.capabilities.snapshotRmdir === true); },
      readOnly: all("readOnly"),
      symlinks: all("symlinks", ["readlink", "symlink"]),
      hardlinks: all("hardlinks", ["link"]),
      permissions: all("permissions", ["chmod"]),
      timestamps: all("timestamps", ["utimes"]),
      atomicRename: mounts.length === 1 && all("atomicRename"),
      ...(streamingRead === undefined ? {} : { streamingRead }),
      ...(streamingWrite === undefined ? {} : { streamingWrite }),
    });
  }

  private select(path: string): Mount {
    return this.mounts.find((mount) => within(mount.path, path))!;
  }

  private protected(path: string): boolean {
    return path === "/" || this.mounts.some((mount) => within(path, mount.path));
  }

  private error(error: unknown, syscall: string, path: string, options: FsOptions, dest?: string): unknown {
    if (options.signal?.aborted && error === options.signal.reason) return error;
    return new FsError(toFsError(error).code, {
      cause: error, syscall, path: globalPath(path), ...(dest === undefined ? {} : { dest: globalPath(dest) }),
    });
  }

  private async operation<Result>(
    syscall: string, path: string, options: FsOptions,
    action: () => Promise<Result>, dest?: string,
  ): Promise<Result> {
    try {
      options.signal?.throwIfAborted();
      const result = await action();
      options.signal?.throwIfAborted();
      return result;
    } catch (error) {
      throw this.error(error, syscall, path, options, dest);
    }
  }

  private components(path: string): Component[] {
    validatePath(path);
    if (!path) fail("ENOENT");
    const parts: Component[] = path.split("/").filter(Boolean).map((name) => ({ name }));
    if (path.endsWith("/")) parts.push({ name: ".", trailing: true });
    return parts;
  }

  private async lookup(path: string, options: FsOptions, parent?: Location, plannedParent = false): Promise<Location> {
    options.signal?.throwIfAborted();
    const mount = this.select(path);
    const local = mount.path === "/" ? path : path.slice(mount.path.length) || "/";
    let stat: FileStat | undefined;
    if (!parent?.synthetic && !plannedParent || parent?.mount !== mount) {
      try {
        stat = await mount.backend.lstat(local, options);
      } catch (error) {
        if (toFsError(error).code !== "ENOENT") throw error;
      }
    }
    options.signal?.throwIfAborted();
    if (path === mount.path && stat?.type !== "directory") fail(stat ? "ENOTDIR" : "ENOENT");
    const synthetic = this.protected(path) && stat?.type !== "directory";
    return { path, mount, local, stat: synthetic ? syntheticStat : stat, synthetic };
  }

  private async resolve(path: string, options: FsOptions, settings: ResolveOptions = {}): Promise<Location> {
    let pending = this.components(path);
    const stack = [await this.lookup("/", options)];
    let boundary: Mount | undefined;
    let verification: { mount: Mount; path: string; finalName: string | undefined } | undefined;
    const verified = async (location: Location): Promise<Location> => {
      if (verification) {
        const canonical = await verification.mount.backend.realpath(verification.path, options);
        validatePath(canonical);
        if (!canonical.startsWith("/") || normalizePath(canonical) !== canonical) fail("EIO");
        if (verification.finalName !== undefined) {
          try {
            await verification.mount.backend.lstat(`${verification.path}/${verification.finalName}`, options);
          } catch (error) {
            if (location.stat || toFsError(error).code !== "ENOENT") throw error;
          }
        }
        const expected = verification.finalName === undefined ? canonical
          : `${canonical === "/" ? "" : canonical}/${verification.finalName}`;
        if (location.mount !== verification.mount || location.local !== expected) fail("ENOTSUP");
      }
      return location;
    };
    let links = 0;
    while (pending.length > 0) {
      options.signal?.throwIfAborted();
      const component = pending.shift()!;
      const current = stack[stack.length - 1]!;
      if (current.stat?.type !== "directory") fail("ENOTDIR");
      if (!current.synthetic && !settings.createDirectories?.has(current.path)) {
        const mode = current.mount.backend.capabilities.permissions === false ? 0 : 1;
        await current.mount.backend.access(current.local, mode, options);
      }
      if (component.name === ".") continue;
      if (component.name === "..") {
        if (boundary && current.path === boundary.path) fail("EACCES");
        if (stack.length > 1) stack.pop();
        if (boundary && stack[stack.length - 1]!.mount !== boundary) fail("EACCES");
        continue;
      }
      const nextPath = `${current.path === "/" ? "" : current.path}/${component.name}`;
      if (boundary && this.select(nextPath) !== boundary) fail("EACCES");
      let next = settings.createDirectories?.get(nextPath)
        ?? await this.lookup(nextPath, options, current, settings.createDirectories?.has(current.path));
      if (!next.stat) {
        if (settings.createDirectories) {
          if (current.synthetic) fail("ENOTSUP");
          this.mutable(next);
          next = { ...next, stat: syntheticStat };
          settings.createDirectories.set(nextPath, next);
        } else if (settings.allowMissing && (pending.length === 0
          || settings.missingDirectory && pending.length === 1 && pending[0]!.trailing)) {
          if (current.synthetic) fail("ENOTSUP");
          return verified(next);
        } else {
          fail("ENOENT");
        }
      }
      const final = pending.length === 0
        || settings.entry && pending.length === 1 && pending[0]!.trailing;
      if (next.stat?.type === "symlink" && (settings.followFinal !== false || !final)) {
        if (++links > 40) fail("ELOOP");
        boundary ??= next.mount;
        if (boundary !== next.mount) fail("EACCES");
        if (!verification) {
          const suffix = pending.map((part) => part.name);
          const last = suffix.at(-1);
          const finalName = settings.followFinal === false && last !== undefined && last !== "." && last !== ".."
            ? suffix.pop() : undefined;
          verification = {
            mount: next.mount,
            path: `${next.local}${suffix.length === 0 ? "" : `/${suffix.join("/")}`}`,
            finalName,
          };
        }
        const readlink = this.optional(next, "readlink", "symlinks");
        const target = await readlink.call(next.mount.backend, next.local, options);
        const targetParts = this.components(target);
        if (target.startsWith("/")) {
          const rootIndex = stack.findIndex((entry) => entry.path === next.mount.path);
          if (rootIndex < 0) fail("EACCES");
          stack.splice(rootIndex + 1);
        }
        pending = [...targetParts, ...pending];
      } else {
        stack.push(next);
      }
    }
    return verified(stack[stack.length - 1]!);
  }

  private mutable(location: Location): void {
    if (this.protected(location.path)) fail("EBUSY");
    if (location.mount.backend.capabilities.readOnly) fail("EROFS");
  }

  private entryPath(path: string): void {
    const terminal = path.split("/").filter(Boolean).at(-1);
    if (terminal === "." || terminal === "..") fail("EINVAL");
  }

  private optional<Method extends "readlink" | "symlink" | "link" | "chmod" | "utimes" | "truncate" | "readStream" | "writeStream">(
    location: Location, method: Method, capability?: string,
  ): NonNullable<FileSystem[Method]> {
    const backend = location.mount.backend;
    const implementation = backend[method];
    if (!implementation || capability && backend.capabilities[capability] === false) fail("ENOTSUP");
    return implementation as NonNullable<FileSystem[Method]>;
  }

  readFile(path: string, options: ReadFileOptions = {}): Promise<Uint8Array> {
    return this.operation("readFile", path, options, async () => {
      const location = await this.resolve(path, options);
      if (location.synthetic) fail("EISDIR");
      return location.mount.backend.readFile(location.local, options);
    });
  }

  writeFile(path: string, data: Uint8Array, options: WriteFileOptions = {}): Promise<void> {
    return this.operation("writeFile", path, options, async () => {
      const location = await this.resolve(path, options, { allowMissing: true, followFinal: !options.flag?.endsWith("x") });
      this.mutable(location);
      await location.mount.backend.writeFile(location.local, data, options);
    });
  }

  appendFile(path: string, data: Uint8Array, options: AppendFileOptions = {}): Promise<void> {
    return this.operation("appendFile", path, options, async () => {
      const location = await this.resolve(path, options, { allowMissing: true });
      this.mutable(location);
      await location.mount.backend.appendFile(location.local, data, options);
    });
  }

  stat(path: string, options: FsOptions = {}): Promise<FileStat> {
    return this.operation("stat", path, options, async () => snapshotStat((await this.resolve(path, options)).stat!));
  }

  lstat(path: string, options: FsOptions = {}): Promise<FileStat> {
    return this.operation("lstat", path, options, async () => snapshotStat((await this.resolve(path, options, { followFinal: false })).stat!));
  }

  readdir(path: string, options: FsOptions = {}): Promise<DirectoryEntry[]> {
    return this.operation("readdir", path, options, async () => {
      const location = await this.resolve(path, options);
      if (location.stat?.type !== "directory") fail("ENOTDIR");
      const entries = new Map<string, DirectoryEntry>();
      if (!location.synthetic) {
        for (const entry of await location.mount.backend.readdir(location.local, options)) {
          const { name, type } = entry;
          if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\0")) fail("EIO");
          entries.set(name, { name, type });
        }
      }
      for (const mount of this.mounts) {
        if (mount.path !== location.path && within(location.path, mount.path)) {
          const suffix = mount.path.slice(location.path === "/" ? 1 : location.path.length + 1);
          const name = suffix.split("/")[0]!;
          entries.set(name, { name, type: "directory" });
        }
      }
      return [...entries.values()].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    });
  }

  mkdir(path: string, options: MkdirOptions = {}): Promise<void> {
    return this.operation("mkdir", path, options, async () => {
      const directories = new Map<string, Location>();
      const location = await this.resolve(path, options, options.recursive
        ? { createDirectories: directories }
        : { followFinal: false, allowMissing: true, missingDirectory: true, entry: true });
      if (options.recursive) {
        if (location.stat?.type !== "directory") fail("EEXIST");
        for (const directory of directories.values()) {
          options.signal?.throwIfAborted();
          await directory.mount.backend.mkdir(directory.local, { ...options, recursive: false });
        }
        return;
      }
      this.mutable(location);
      await location.mount.backend.mkdir(location.local, options);
    });
  }

  rmdir(path: string, options: FsOptions = {}): Promise<void> {
    return this.operation("rmdir", path, options, async () => {
      const location = await this.resolve(path, options, { followFinal: false, entry: true });
      this.mutable(location);
      this.entryPath(path);
      if (location.stat?.type !== "directory") fail("ENOTDIR");
      const backend = location.mount.backend;
      if (!backend.rmdir) fail("ENOTSUP");
      options.signal?.throwIfAborted();
      await backend.rmdir(location.local, options);
    });
  }

  rm(path: string, options: RemoveOptions = {}): Promise<void> {
    return this.operation("rm", path, options, async () => {
      let location: Location;
      try {
        location = await this.resolve(path, options, { followFinal: false, entry: true });
      } catch (error) {
        if (options.force && isFsError(error, "ENOENT")) return;
        throw error;
      }
      this.mutable(location);
      this.entryPath(path);
      await location.mount.backend.rm(location.local, options);
    });
  }

  rename(source: string, destination: string, options: FsOptions = {}): Promise<void> {
    return this.operation("rename", source, options, async () => {
      const origin = await this.resolve(source, options, { followFinal: false, entry: true });
      const target = await this.resolve(destination, options, {
        followFinal: false, allowMissing: true, entry: true, missingDirectory: origin.stat?.type === "directory",
      });
      if (this.protected(origin.path) || this.protected(target.path)) fail("EBUSY");
      if (origin.mount !== target.mount) fail("EXDEV");
      this.mutable(origin);
      this.mutable(target);
      this.entryPath(source);
      this.entryPath(destination);
      await origin.mount.backend.rename(origin.local, target.local, options);
    }, destination);
  }

  copyFile(source: string, destination: string, options: CopyFileOptions = {}): Promise<void> {
    return this.operation("copyFile", source, options, async () => {
      const origin = await this.resolve(source, options);
      if (origin.stat?.type === "directory") fail("EISDIR");
      const target = await this.resolve(destination, options, { allowMissing: true, followFinal: !options.exclusive });
      if (this.protected(target.path)) fail("EBUSY");
      this.mutable(target);
      if (options.exclusive && target.stat) fail("EEXIST");
      if (origin.mount.backend === target.mount.backend && origin.local === target.local) fail("EINVAL");
      let identity = compareIdentity(origin.stat, target.stat);
      if (identity === "same") fail("EINVAL");
      if (target.stat?.type === "directory") fail("EISDIR");
      if (target.stat && identity === "unknown") {
        identity = await compareEntries(origin.mount.backend, origin.local, target.mount.backend, target.local, options);
        if (identity === "same") fail("EINVAL");
      }
      if (target.stat && identity === "unknown") fail("ENOTSUP");
      if (origin.mount.backend === target.mount.backend) {
        await origin.mount.backend.copyFile(origin.local, target.local, { ...options, exclusive: options.exclusive || !target.stat });
        return;
      }
      const reader = origin.mount.backend;
      const writer = target.mount.backend;
      const writeOptions: WriteFileOptions = {
        ...options, flag: options.exclusive || !target.stat ? "wx" : "w",
        ...(writer.capabilities.permissions === true ? { mode: origin.stat!.mode & 0o7777 } : {}),
      };
      if (reader.readStream && reader.capabilities.streamingRead !== false
        && writer.writeStream && writer.capabilities.streamingWrite !== false) {
        const source = readBytes(reader.readStream(origin.local, options), options.signal);
        let failed = false;
        try { await writer.writeStream(target.local, source, writeOptions); }
        catch (error) { failed = true; throw error; }
        finally { await finishCleanup(() => source.return(undefined), failed); }
      } else {
        const maxBytes = 64 * 1024 * 1024;
        const data = await reader.readFile(origin.local, { ...options, maxBytes });
        if (data.byteLength > maxBytes) fail("EFBIG");
        options.signal?.throwIfAborted();
        await writer.writeFile(target.local, data, writeOptions);
      }
    }, destination);
  }

  realpath(path: string, options: FsOptions = {}): Promise<string> {
    return this.operation("realpath", path, options, async () => (await this.resolve(path, options)).path);
  }

  compareEntry(path: string, peer: FileSystem, peerPath: string, options: FsOptions = {}) {
    return this.operation("compareEntry", path, options, () => compareEntries(this, path, peer, peerPath, options), peerPath);
  }

  access(path: string, mode = 0, options: FsOptions = {}): Promise<void> {
    return this.operation("access", path, options, async () => {
      if (!Number.isInteger(mode) || mode < 0 || mode > 7) fail("EINVAL");
      const location = await this.resolve(path, options);
      if (location.synthetic) {
        if (mode & 2) fail("EACCES");
      } else {
        await location.mount.backend.access(location.local, mode, options);
      }
    });
  }

  readlink(path: string, options: FsOptions = {}): Promise<string> {
    return this.operation("readlink", path, options, async () => {
      const location = await this.resolve(path, options, { followFinal: false });
      if (location.stat?.type !== "symlink") fail("EINVAL");
      return this.optional(location, "readlink", "symlinks").call(location.mount.backend, location.local, options);
    });
  }

  symlink(target: string, path: string, options: FsOptions = {}): Promise<void> {
    return this.operation("symlink", path, options, async () => {
      this.components(target);
      const location = await this.resolve(path, options, { followFinal: false, allowMissing: true });
      this.mutable(location);
      await this.optional(location, "symlink", "symlinks").call(location.mount.backend, target, location.local, options);
    });
  }

  link(existingPath: string, newPath: string, options: FsOptions = {}): Promise<void> {
    return this.operation("link", existingPath, options, async () => {
      const origin = await this.resolve(existingPath, options, { followFinal: false, entry: true });
      const target = await this.resolve(newPath, options, { followFinal: false, allowMissing: true, entry: true });
      if (this.protected(origin.path) || this.protected(target.path)) fail("EBUSY");
      if (origin.mount !== target.mount) fail("EXDEV");
      this.mutable(origin);
      this.mutable(target);
      await this.optional(origin, "link", "hardlinks").call(origin.mount.backend, origin.local, target.local, options);
    }, newPath);
  }

  chmod(path: string, mode: number, options: FsOptions = {}): Promise<void> {
    return this.operation("chmod", path, options, async () => {
      const location = await this.resolve(path, options);
      this.mutable(location);
      await this.optional(location, "chmod", "permissions").call(location.mount.backend, location.local, mode, options);
    });
  }

  utimes(path: string, atimeMs: number, mtimeMs: number, options: FsOptions = {}): Promise<void> {
    return this.operation("utimes", path, options, async () => {
      const location = await this.resolve(path, options);
      this.mutable(location);
      await this.optional(location, "utimes", "timestamps").call(location.mount.backend, location.local, atimeMs, mtimeMs, options);
    });
  }

  truncate(path: string, length = 0, options: FsOptions = {}): Promise<void> {
    return this.operation("truncate", path, options, async () => {
      const location = await this.resolve(path, options);
      this.mutable(location);
      await this.optional(location, "truncate").call(location.mount.backend, location.local, length, options);
    });
  }

  async *readStream(path: string, options: ReadStreamOptions = {}): ByteSource {
    try {
      options.signal?.throwIfAborted();
      const location = await this.resolve(path, options);
      if (location.synthetic) fail("EISDIR");
      const source = this.optional(location, "readStream", "streamingRead").call(location.mount.backend, location.local, options);
      for await (const chunk of readBytes(source, options.signal)) {
        options.signal?.throwIfAborted();
        yield chunk;
      }
      options.signal?.throwIfAborted();
    } catch (error) {
      throw this.error(error, "readStream", path, options);
    }
  }

  writeStream(path: string, source: ByteSource, options: WriteFileOptions = {}): Promise<void> {
    return this.operation("writeStream", path, options, async () => {
      const location = await this.resolve(path, options, { allowMissing: true, followFinal: !options.flag?.endsWith("x") });
      this.mutable(location);
      await this.optional(location, "writeStream", "streamingWrite").call(location.mount.backend, location.local, source, options);
    });
  }
}

export function createMountFileSystem(options: MountFileSystemOptions): MountFileSystem {
  return new MountFileSystem(options);
}
