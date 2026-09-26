import { FsError, isFsError, toFsError } from "../../contracts/errors.js";
import type { ErrnoCode } from "../../contracts/errors.js";
import type {
  AppendFileOptions, CapabilityQueryOptions, CopyFileOptions, DirectoryEntry, FileReadHandle, FileResizeHandle, FileResizeOperation, FileResizeOptions, FileStat, FileSystem, OpenReadFileOptions, OpenResizeFileOptions,
  FileSystemCapabilities, FsOptions, ChmodOptions, RenameOptions, MkdirOptions, ReadDirectoryOptions, ReadFileOptions,
  ReadStreamOptions, RemoveOptions, WriteFileOptions,
  ConditionalFilePublicationOptions, ConditionalWriteFileOptions, ConditionalRemoveFileOptions, ConditionalRemoveEntryOptions, ConditionalRemoveEntryReceiptOptions, CreateStagedFileOptions, FileStaging, FileStagingEntry, FileResolutionStep, FileStagingResolution, PublishStagedFileOptions, PrepareDirectoryOptions, StagedFileContent,
} from "../../contracts/filesystem.js";
import type { ByteSource } from "../../contracts/io.js";
import { readBytes } from "../../contracts/io.js";
import { finishCleanup } from "../../contracts/cleanup.js";
import { requireOwnedMutation, ownedMutationCapabilities, openRetainedReadFile, openRetainedResizeFile, readOnlyCapabilities, retainedReadCapabilities, retainedResizeCapabilities } from "../capabilities.js";
import { admitDirectoryEntries, directoryEntryLimit } from "../directory-admission.js";
import { normalizePath, validatePath } from "../../contracts/virtual-path.js";
import { forwardFileDescriptor, openFileDescriptor } from "../descriptor.js";
import type { FileDescriptor, OpenFileOptions } from "../../contracts/descriptor.js";
import { pathNamespace } from "../path-namespace.js";
import { createStagingCleanup, snapshotStagingCreation } from "../staging-cleanup.js";
import { directoryAncestryPaths, inspectStagingBindings, runStagingGuard, snapshotDirectoryAncestry, snapshotStagingResolution } from "../staging-ancestry.js";
import { compareIdentity } from "./identity.js";
import { snapshotConditionalChmod } from "../conditional-chmod.js";
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
  readonly resolutionSteps?: FileResolutionStep[];
  readonly resizeCreate?: boolean;
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
  const { type, filesystemType, size, allocatedBytes, ioBlockSize, preferredIoBlockSize, mode, mtimeMs, atimeMs, ctimeMs, birthtimeMs, revision, identityScope, opaqueIdentity, opaqueVersion, ino, dev, rdevMajor, rdevMinor, nlink, uid, gid } = stat;
  return {
    type, size, mode, mtimeMs, atimeMs, ctimeMs,
    ...(filesystemType === undefined ? {} : { filesystemType }),
    ...(revision === undefined ? {} : { revision }),
    ...(allocatedBytes === undefined ? {} : { allocatedBytes }),
    ...(ioBlockSize === undefined ? {} : { ioBlockSize }),
    ...(preferredIoBlockSize === undefined ? {} : { preferredIoBlockSize }),
    ...(birthtimeMs === undefined ? {} : { birthtimeMs }),
    ...(identityScope === undefined ? {} : { identityScope }),
    ...(opaqueIdentity === undefined ? {} : { opaqueIdentity }),
    ...(opaqueVersion === undefined ? {} : { opaqueVersion }),
    ...(ino === undefined ? {} : { ino }),
    ...(dev === undefined ? {} : { dev }),
    ...(rdevMajor === undefined ? {} : { rdevMajor }),
    ...(rdevMinor === undefined ? {} : { rdevMinor }),
    ...(nlink === undefined ? {} : { nlink }),
    ...(uid === undefined ? {} : { uid }),
    ...(gid === undefined ? {} : { gid }),
  };
}

export class MountFileSystem implements FileSystem {
  readonly capabilities: FileSystemCapabilities;
  private readonly mounts: readonly Mount[];
  private activeNamespaceOperations = 0;
  private namespaceMutation = false;
  private readonly namespaceWaiters = new Set<() => void>();

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
    const selectNamespace = this.select.bind(this);
    Object.defineProperty(this, pathNamespace, {
      value: Object.freeze({ select: (path: string) => selectNamespace(path).path }),
    });
    registerEntryView(this, (path, options) => this.operation("compareEntry", path, options, async () => {
      const location = await this.resolve(path, options);
      if (location.synthetic) return { filesystem: this, path, stat: syntheticStat, readOnly: true };
      return { filesystem: location.mount.backend, path: location.local };
    }));
    registerEntryAuthority(this, async () => "unknown");
    const all = (capability: string, methods: readonly (keyof FileSystem)[] = []): boolean =>
      mounts.every(({ backend }) => backend.capabilities[capability] === true
        && methods.every((method) => typeof backend[method] === "function"));
    const streaming = (capability: "streamingRead" | "streamingWrite" | "retainedRead", method: "readStream" | "writeStream" | "openReadFile"): boolean | undefined =>
      all(capability, [method]) ? true : mounts.some(({ backend }) =>
        backend.capabilities[capability] !== false && typeof backend[method] === "function") ? undefined : false;
    const streamingRead = streaming("streamingRead", "readStream");
    const streamingWrite = streaming("streamingWrite", "writeStream");
    const retainedRead = streaming("retainedRead", "openReadFile");
    const append = all("append") ? true
      : mounts.every(({ backend }) => backend.capabilities.append === false) ? false : undefined;
    const common = (capability: string): boolean | undefined => {
      const optional: Record<string, readonly (keyof FileSystem)[]> = {
        open: ["open"],
        retainedStagingCleanup: ["createStagedFile", "publishStagedFile", "removeStagedFile"],
        synchronousDirectoryValidation: ["prepareDirectoryAncestry"], guardedStagingPublication: ["createStagedFile", "publishStagedFile", "removeStagedFile"],
        trustedOwnedStaging: ["createStagedFile", "publishStagedFile", "removeStagedFile", "writeFileConditional", "removeFileConditional", "prepareDirectory"],
        atomicFilePublication: ["publishFileConditional"], atomicEntryRemoval: ["removeEntryConditional"], atomicEntryRemovalReceipt: ["removeEntryConditional"], atomicTreeRemoval: ["removeTreeConditional"], atomicFileMutation: ["writeFileConditional", "removeFileConditional"], atomicFileStaging: ["createStagedFile", "publishStagedFile", "removeStagedFile"], atomicDirectoryMetadata: ["prepareDirectory"],
        symlinks: ["symlink", "readlink"], hardlinks: ["link"], permissions: ["chmod"], timestamps: ["utimes"], readlink: ["readlink"],
        descriptorWriteStream: ["writeStream"], retainedResize: ["openResizeFile"], atomicResize: ["resizeFile"],
      };
      const values = mounts.map(({ backend }) => {
        if (backend.capabilities.readOnly === true
          && !["open", "versionedDescriptors", "read", "stat", "readdir", "realpath", "access", "readlink", "explicitDirectories", "implicitDirectories"].includes(capability)) return false;
        const declared = capability === "retainedStagingCleanup" || capability === "atomicEntryRemovalReceipt"
          ? ownedMutationCapabilities(backend)[capability] : backend.capabilities[capability];
        if (capability === "descriptorWriteStream" && backend.capabilities.streamingWrite === false) return false;
        return declared === true && optional[capability]?.some(method => typeof backend[method] !== "function") ? false : declared;
      });
      if (["rename", "atomicRenameNoReplace", "copy", "exclusiveCopy"].includes(capability) && mounts.length > 1) return undefined;
      return values.every(value => value === true) ? true : values.every(value => value === false) ? false : undefined;
    };
    const semantics = Object.fromEntries([
      "guardedStagingPublication", "retainedStagingCleanup", "atomicEntryRemovalReceipt",
      "trustedOwnedStaging", "atomicFilePublication", "atomicEntryRemoval", "atomicTreeRemoval", "atomicFileMutation", "atomicFileStaging", "atomicDirectoryMetadata", "read", "stat", "readdir", "realpath", "access", "open", "versionedDescriptors",
      "write", "append", "exclusiveCreate", "explicitDirectories", "implicitDirectories", "mkdir", "recursiveMkdir",
      "remove", "removeDirectory", "recursiveRemove", "rename", "atomicRenameNoReplace", "copy", "exclusiveCopy", "readlink", "truncate",
      "streamingAppend", "randomAccessWrite", "descriptorWriteStream", "retainedResize", "atomicResize", "symlinks", "hardlinks", "permissions", "timestamps",
    ].map(capability => [capability, common(capability)]).filter(([, value]) => value !== undefined));
    this.capabilities = Object.freeze({
      get snapshotRmdir() { return mounts.some(({ backend }) => backend.capabilities.snapshotRmdir === true); },
      readOnly: all("readOnly"),
      ...(append === undefined ? {} : { append }),
      ...semantics,
      // Real ancestry (including synthetic mount parents) is path-dependent.
      synchronousStagingResolution: mounts.some(({ backend }) => typeof backend.prepareStagingResolution === "function") ? undefined : false,
      atomicStagingAncestry: mounts.some(({ backend }) => typeof backend.prepareDirectoryAncestry === "function"
        && typeof backend.publishStagedFile === "function" && (typeof backend.capabilitiesFor === "function"
          || backend.capabilities.guardedStagingPublication !== false && backend.capabilities.synchronousDirectoryValidation !== false)) ? undefined : false,
      atomicRename: mounts.length === 1 && all("atomicRename"),
      conditionalChmod: all("conditionalChmod", ["chmod", "prepareDirectoryAncestry"]),
      ...(streamingRead === undefined ? {} : { streamingRead }),
      ...(streamingWrite === undefined ? {} : { streamingWrite }),
      ...(retainedRead === undefined ? {} : { retainedRead }),
    });
  }

  private select(path: string): Mount {
    return this.mounts.find((mount) => within(mount.path, path))!;
  }

  async capabilitiesFor(path: string, options: CapabilityQueryOptions = {}): Promise<FileSystemCapabilities> {
    return this.operation("capabilitiesFor", path, options, async () => {
      if (options.stagingResolution === true && normalizePath(globalPath(path)) !== path) fail("EINVAL");
      const location = await this.resolve(path, options, {
        allowMissing: options.create ?? true,
        followFinal: options.stagingResolution !== true && (options.create !== undefined || options.creation !== "exclusive"),
        ...(options.create === undefined ? {} : { resizeCreate: options.create }),
      });
      const observed = ownedMutationCapabilities(location.mount.backend, await location.mount.backend.capabilitiesFor?.(location.local, options)
        ?? location.mount.backend.capabilities);
      const declared = observed.descriptorWriteStream === true
        && (typeof location.mount.backend.writeStream !== "function" || observed.readOnly === true || observed.streamingWrite === false)
        ? { ...observed, descriptorWriteStream: false } : observed;
      const resize = declared.atomicResize === true && (typeof location.mount.backend.resizeFile !== "function" || declared.readOnly === true)
        ? { ...declared, atomicResize: false } : declared;
      const ancestry = options.stagingAncestry === true && location.path === normalizePath(globalPath(path))
        && await this.supportsStagingAncestry(location, resize, options);
      const validation = options.stagingAncestry === true ? location.stat?.type === "directory"
        && location.path === normalizePath(globalPath(path)) && await this.supportsDirectoryValidation(location.path, options) : undefined;
      let resolution: boolean | undefined;
      if (options.stagingResolution === true) {
        resolution = false;
        if (within(location.mount.path, path) && typeof location.mount.backend.prepareStagingResolution === "function") {
          const input = location.mount.path === "/" ? path : path.slice(location.mount.path.length) || "/";
          const declared = input === location.local ? resize : ownedMutationCapabilities(location.mount.backend,
            await location.mount.backend.capabilitiesFor?.(input, options) ?? location.mount.backend.capabilities);
          options.signal?.throwIfAborted();
          resolution = declared.synchronousStagingResolution === true && await this.supportsStagingAncestry(location, resize, options);
        }
      }
      const conditionalChmod = options.conditionalChmod === true
        ? resize.conditionalChmod === true && typeof location.mount.backend.chmod === "function"
          && await this.supportsDirectoryValidation(location.path.slice(0, location.path.lastIndexOf("/")) || "/", options, true)
        : this.capabilities.conditionalChmod;
      const { synchronousDirectoryValidation: ignoredValidation, synchronousStagingResolution: ignoredResolution, ...ordinary } = resize;
      const withOpen = { ...ordinary, retainedStagingWrite: false, ...(conditionalChmod === undefined ? {} : { conditionalChmod }), ...(resolution === undefined ? {} : { synchronousStagingResolution: resolution }), ...(validation === undefined ? {} : { synchronousDirectoryValidation: validation }), atomicStagingAncestry: ancestry, ...(typeof location.mount.backend.open === "function" ? {} : { open: false }) };
      const capabilities = location.synthetic ? { ...withOpen, open: false, retainedRead: false }
        : retainedResizeCapabilities(location.mount.backend, retainedReadCapabilities(location.mount.backend, withOpen));
      if (location.synthetic) return readOnlyCapabilities(capabilities);
      if (this.mounts.length === 1 || capabilities.readOnly === true) return Object.freeze({ ...capabilities });
      const { rename: ignoredRename, copy: ignoredCopy, exclusiveCopy: ignoredExclusiveCopy, ...selected } = capabilities;
      const cannotPublish = capabilities.write === false && capabilities.streamingWrite === false && capabilities.exclusiveCreate === false;
      return Object.freeze({
        ...selected,
        ...(capabilities.copy === false && capabilities.exclusiveCopy === false && cannotPublish ? { copy: false } : {}),
        ...(capabilities.exclusiveCopy === false && capabilities.exclusiveCreate === false && capabilities.streamingWrite === false ? { exclusiveCopy: false } : {}),
      });
    });
  }

  private async supportsStagingAncestry(target: Location, capabilities: FileSystemCapabilities, options: FsOptions): Promise<boolean> {
    options.signal?.throwIfAborted();
    if (target.synthetic || target.stat !== undefined && (target.stat.type !== "file" || compareIdentity(target.stat, target.stat) !== "same")
      || capabilities.atomicFileStaging !== true || capabilities.atomicStagingAncestry !== true
      || capabilities.guardedStagingPublication !== true || capabilities.readOnly === true) return false;
    const parent = target.path.slice(0, target.path.lastIndexOf("/")) || "/";
    return this.supportsDirectoryValidation(parent, options);
  }

  private async supportsDirectoryValidation(directory: string, options: FsOptions, conditionalChmod = false): Promise<boolean> {
    const controls: FsOptions = options.signal === undefined ? {} : { signal: options.signal };
    for (const path of directoryAncestryPaths(directory)) {
      const entry = await this.lookup(path, controls);
      if (entry.synthetic || entry.stat?.type !== "directory" || compareIdentity(entry.stat, entry.stat) !== "same") return false;
      const backend = entry.mount.backend;
      const declared = await backend.capabilitiesFor?.(entry.local, { ...controls, stagingAncestry: true }) ?? backend.capabilities;
      options.signal?.throwIfAborted();
      if (declared.synchronousDirectoryValidation !== true && !(conditionalChmod && declared.conditionalChmod === true)
        || typeof backend.prepareDirectoryAncestry !== "function") return false;
    }
    return true;
  }

  prepareDirectoryAncestry(ancestors: readonly FileStagingEntry[], options: FsOptions = {}): Promise<() => true> {
    return this.operation("prepareDirectoryAncestry", ancestors.at(-1)?.path ?? "/", options,
      () => this.prepareAncestry(ancestors, options));
  }

  prepareStagingResolution(path: string, options: FsOptions = {}): Promise<FileStagingResolution> {
    const controls: FsOptions = options.signal === undefined ? {} : { signal: options.signal };
    return this.operation("prepareStagingResolution", path, controls, async () => {
      if (normalizePath(globalPath(path)) !== path) fail("EINVAL");
      const observed: FileResolutionStep[] = [];
      const location = await this.resolve(path, controls, { followFinal: false, allowMissing: true, resolutionSteps: observed });
      if (location.synthetic || !within(location.mount.path, path)) fail("ENOTSUP");
      const backend = location.mount.backend;
      const input = location.mount.path === "/" ? path : path.slice(location.mount.path.length) || "/";
      const declared = ownedMutationCapabilities(backend,
        await backend.capabilitiesFor?.(input, { ...controls, stagingResolution: true }) ?? backend.capabilities);
      controls.signal?.throwIfAborted();
      if (declared.synchronousStagingResolution !== true || !backend.prepareStagingResolution) fail("ENOTSUP");
      const prefix = directoryAncestryPaths(location.mount.path).map(ancestor => {
        const entry = observed.find(step => step.path === ancestor);
        if (!entry) fail("ENOTSUP");
        return entry;
      });
      const outerGuard = await this.prepareAncestry(prefix, controls);
      const bound = snapshotStagingResolution(await backend.prepareStagingResolution(input, controls));
      controls.signal?.throwIfAborted();
      const mapPath = (local: string): string => location.mount.path === "/" ? local : `${location.mount.path}${local === "/" ? "" : local}`;
      const map = <T extends FileStagingEntry>(entry: T): T => ({ ...entry, path: mapPath(entry.path) });
      const traversed = bound.traversed.map(map);
      const localObserved = observed.filter(entry => within(location.mount.path, entry.path));
      if (mapPath(bound.path) !== location.path || localObserved.length !== traversed.length) fail("EAGAIN");
      for (const [index, before] of localObserved.entries()) {
        const after = traversed[index]!;
        if (this.select(after.path) !== location.mount) fail("EACCES");
        if (before.path !== after.path || before.linkTarget !== after.linkTarget || before.stat.type !== after.stat.type
          || compareIdentity(before.stat, after.stat) !== "same"
          || before.stat.type !== "directory" && (["revision", "size", "mode", "nlink", "mtimeMs", "ctimeMs"] as const).some(field => before.stat[field] !== after.stat[field])) fail("EAGAIN");
      }
      const validate = (): true => {
        controls.signal?.throwIfAborted();
        runStagingGuard(outerGuard);
        runStagingGuard(bound.validate);
        return true;
      };
      const result = snapshotStagingResolution({ ...bound, path: mapPath(bound.path),
        ancestors: [...prefix.slice(0, -1), ...bound.ancestors.map(map)], traversed: [...prefix.slice(0, -1), ...traversed], validate });
      runStagingGuard(validate);
      return result;
    });
  }

  private async prepareAncestry(ancestors: readonly FileStagingEntry[], options: FsOptions, conditionalChmod = false): Promise<() => true> {
    options.signal?.throwIfAborted();
    try {
      const entries = snapshotDirectoryAncestry(ancestors);
      const controls: FsOptions = options.signal === undefined ? {} : { signal: options.signal };
      const groups: { mount: Mount; entries: FileStagingEntry[] }[] = [];
      for (const entry of entries) {
        const mount = this.select(entry.path);
        let group = groups.at(-1);
        if (group?.mount !== mount) { group = { mount, entries: [] }; groups.push(group); }
        group.entries.push({ path: mount.path === "/" ? entry.path : entry.path.slice(mount.path.length) || "/", stat: entry.stat });
      }
      const guards: (() => true)[] = [];
      for (const group of groups) {
        controls.signal?.throwIfAborted();
        const backend = group.mount.backend;
        for (const entry of group.entries) {
          let current: FileStat;
          try { current = await backend.lstat(entry.path, controls); }
          catch (error) {
            controls.signal?.throwIfAborted();
            if (["ENOENT", "ENOTDIR", "ELOOP"].includes(toFsError(error).code)) fail("EAGAIN");
            throw error;
          }
          controls.signal?.throwIfAborted();
          if (current.type !== "directory") fail("EAGAIN");
          const identity = compareIdentity(current, entry.stat);
          if (identity === "unknown") fail("ENOTSUP");
          if (identity !== "same") fail("EAGAIN");
          const declared = await backend.capabilitiesFor?.(entry.path, { ...controls, stagingAncestry: true }) ?? backend.capabilities;
          controls.signal?.throwIfAborted();
          if (declared.synchronousDirectoryValidation !== true && !(conditionalChmod && declared.conditionalChmod === true)) fail("ENOTSUP");
        }
        if (typeof backend.prepareDirectoryAncestry !== "function") fail("ENOTSUP");
        const guard = await backend.prepareDirectoryAncestry(group.entries, controls);
        controls.signal?.throwIfAborted();
        if (typeof guard !== "function") fail("ENOTSUP");
        guards.push(guard);
      }
      return () => {
        controls.signal?.throwIfAborted();
        for (const guard of guards) runStagingGuard(guard);
        return true;
      };
    } catch (error) { options.signal?.throwIfAborted(); throw error; }
  }

  private protected(path: string): boolean {
    return path === "/" || this.mounts.some((mount) => within(path, mount.path));
  }

  async openReadFile(path: string, options: OpenReadFileOptions = {}): Promise<FileReadHandle> {
    let release: (() => void) | undefined;
    try {
      release = await this.acquireNamespace(options);
      options.signal?.throwIfAborted();
      const location = await this.resolve(path, options);
      if (location.synthetic) fail("EISDIR");
      return await openRetainedReadFile(location.mount.backend, location.local, options);
    } catch (error) {
      throw error ? this.error(error, "openReadFile", path, options) : error;
    } finally {
      release?.();
    }
  }

  async resizeFile(path: string, operation: FileResizeOperation, options: FileResizeOptions = {}): Promise<void> {
    return this.operation("resizeFile", path, options, async () => {
      const location = await this.resolve(path, options, { allowMissing: options.create === true, resizeCreate: options.create ?? false });
      if (location.synthetic) fail("EROFS");
      const backend = location.mount.backend;
      const capabilities = await backend.capabilitiesFor?.(location.local, options) ?? backend.capabilities;
      options.signal?.throwIfAborted();
      if (capabilities.readOnly === true) fail("EROFS");
      const resize = backend.resizeFile;
      options.signal?.throwIfAborted();
      if (capabilities.atomicResize !== true || typeof resize !== "function") fail("ENOTSUP");
      await Reflect.apply(resize!, backend, [location.local, operation, options]);
    });
  }

  async openResizeFile(path: string, options: OpenResizeFileOptions = {}): Promise<FileResizeHandle> {
    let release: (() => void) | undefined;
    try {
      release = await this.acquireNamespace(options);
      options.signal?.throwIfAborted();
      const resolution = this.resolve(path, options, { allowMissing: options.create === true, resizeCreate: options.create ?? false });
      const signal = options.signal;
      const location = await (signal ? new Promise<Location>((resolve, reject) => {
        const abort = (): void => { signal.removeEventListener("abort", abort); reject(signal.reason); };
        signal.addEventListener("abort", abort, { once: true });
        resolution.then(
          value => { signal.removeEventListener("abort", abort); resolve(value); },
          error => { signal.removeEventListener("abort", abort); reject(error); },
        );
        if (signal.aborted) abort();
      }) : resolution);
      options.signal?.throwIfAborted();
      if (location.synthetic) fail("EROFS");
      return await openRetainedResizeFile(location.mount.backend, location.local, options);
    } catch (error) {
      throw error ? this.error(error, "openResizeFile", path, options) : error;
    } finally {
      release?.();
    }
  }

  private error(error: unknown, syscall: string, path: string, options: FsOptions, dest?: string): unknown {
    if (options.signal?.aborted && Object.is(error, options.signal.reason)) return error;
    return new FsError(toFsError(error).code, {
      cause: error, syscall, path: globalPath(path), ...(dest === undefined ? {} : { dest: globalPath(dest) }),
    });
  }

  // Keep guest namespace changes outside every path admission/action interval.
  // Backend references held outside this view still require backend confinement.
  private async acquireNamespace(options: FsOptions, mutation = false): Promise<() => void> {
    const signal = options.signal;
    signal?.throwIfAborted();
    while (this.namespaceMutation || mutation && this.activeNamespaceOperations > 0) {
      await new Promise<void>((resolve, reject) => {
        const wake = (): void => { cleanup(); resolve(); };
        const abort = (): void => { cleanup(); reject(signal!.reason); };
        const cleanup = (): void => {
          this.namespaceWaiters.delete(wake);
          signal?.removeEventListener("abort", abort);
        };
        this.namespaceWaiters.add(wake);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      });
      signal?.throwIfAborted();
    }
    this.activeNamespaceOperations++;
    if (mutation) this.namespaceMutation = true;
    return () => {
      this.activeNamespaceOperations--;
      if (mutation) this.namespaceMutation = false;
      for (const wake of this.namespaceWaiters) wake();
    };
  }

  private async operation<Result>(
    syscall: string, path: string, options: FsOptions,
    action: () => Promise<Result>, dest?: string, preserveReceipt = false,
  ): Promise<Result> {
    let release: (() => void) | undefined;
    try {
      release = await this.acquireNamespace(options, [
        "rename", "symlink", "link", "unlink", "rm", "rmdir",
        "removeEntryConditional", "removeFileConditional", "removeTreeConditional",
        "publishStagedFile", "removeStagedFile",
      ].includes(syscall));
      const result = await action();
      if (!preserveReceipt) options.signal?.throwIfAborted();
      return result;
    } catch (error) {
      throw this.error(error, syscall, path, options, dest);
    } finally {
      release?.();
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
    let recordedUnits = 0;
    const observe = (entry: Location, linkTarget?: string): void => {
      if (!settings.resolutionSteps || !entry.stat) return;
      recordedUnits += entry.path.length + (linkTarget?.length ?? 0);
      if (settings.resolutionSteps.length >= 4096 || recordedUnits > 1_048_576) fail("EFBIG");
      settings.resolutionSteps.push({ path: entry.path, stat: snapshotStat(entry.stat), ...(linkTarget === undefined ? {} : { linkTarget }) });
    };
    observe(stack[0]!);
    let boundary: Mount | undefined;
    let verification: { mount: Mount; path: string; finalName: string | undefined } | undefined;
    let creationVerification: typeof verification;
    let followedFinalLink = false;
    const verified = async (location: Location): Promise<Location> => {
      let inspection = !location.stat && settings.resizeCreate === true ? creationVerification : verification;
      // A missing entry has no realpath. Verify its existing parent while
      // leaving dangling final symlinks on the ordinary following path.
      if (inspection && !location.stat && settings.allowMissing && !followedFinalLink && inspection.finalName === undefined) {
        const separator = inspection.path.lastIndexOf("/");
        const finalName = inspection.path.slice(separator + 1);
        if (finalName && finalName !== "." && finalName !== "..") {
          inspection = { ...inspection, path: inspection.path.slice(0, separator) || "/", finalName };
        }
      }
      if (inspection) {
        const canonical = await inspection.mount.backend.realpath(inspection.path, options);
        options.signal?.throwIfAborted();
        if (!location.stat && inspection.finalName === undefined) fail("ENOTSUP");
        validatePath(canonical);
        if (!canonical.startsWith("/") || normalizePath(canonical) !== canonical) fail("EIO");
        if (inspection.finalName !== undefined) {
          try {
            await inspection.mount.backend.lstat(`${inspection.path}/${inspection.finalName}`, options);
            options.signal?.throwIfAborted();
            if (!location.stat && settings.allowMissing && settings.followFinal !== false) fail("ENOTSUP");
          } catch (error) {
            options.signal?.throwIfAborted();
            if (location.stat || toFsError(error).code !== "ENOENT") throw error;
          }
        }
        const expected = inspection.finalName === undefined ? canonical
          : `${canonical === "/" ? "" : canonical}/${inspection.finalName}`;
        if (location.mount !== inspection.mount || location.local !== expected) fail("ENOTSUP");
      }
      return location;
    };
    let links = 0;
    while (pending.length > 0) {
      options.signal?.throwIfAborted();
      const component = pending.shift()!;
      const current = stack[stack.length - 1]!;
      if (current.stat?.type !== "directory") fail("ENOTDIR");
      if (component.trailing && pending.length === 0 && settings.resizeCreate !== undefined) fail("EISDIR");
      if (!current.synthetic && !settings.createDirectories?.has(current.path)) {
        const mode = settings.resizeCreate === undefined && current.mount.backend.capabilities.permissions === false ? 0 : 1;
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
      if (settings.resizeCreate === true && pending.length === 1 && pending[0]!.trailing) fail("EISDIR");
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
        if (final) followedFinalLink = true;
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
        observe(next, target);
        const targetParts = this.components(target);
        if (settings.resizeCreate !== undefined && targetParts.at(-1)?.trailing && pending[0]?.trailing) targetParts.pop();
        if (settings.resizeCreate === true) {
          const remainder = [...targetParts, ...pending];
          const finalName = remainder.at(-1)?.name;
          if (finalName !== undefined && finalName !== "." && finalName !== "..") {
            const parent = target.startsWith("/") ? "" : next.local.slice(0, next.local.lastIndexOf("/"));
            creationVerification = {
              mount: next.mount,
              path: `${parent}/${remainder.slice(0, -1).map(part => part.name).join("/")}`,
              finalName,
            };
          }
        }
        if (target.startsWith("/")) {
          const rootIndex = stack.findIndex((entry) => entry.path === next.mount.path);
          if (rootIndex < 0) fail("EACCES");
          stack.splice(rootIndex + 1);
        }
        pending = [...targetParts, ...pending];
      } else {
        observe(next);
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

  open(path: string, options: OpenFileOptions): Promise<FileDescriptor> {
    return openFileDescriptor(globalPath(path), options, {
      noFollow: true, positionedRead: true, positionedWrite: true, truncate: true, synchronization: "storage",
    }, async admitted => {
      let release: (() => void) | undefined;
      try {
        release = await this.acquireNamespace(admitted);
        const location = await this.resolve(path, admitted, {
          allowMissing: admitted.creation !== "never", followFinal: !admitted.noFollow && admitted.creation !== "exclusive",
        });
        if (location.synthetic) fail("EISDIR");
        if (admitted.access !== "read" || admitted.creation !== "never" || admitted.truncate || admitted.append) this.mutable(location);
        const backend = location.mount.backend;
        const capabilities = admitted.noFollow ? backend.capabilities
          : await backend.capabilitiesFor?.(location.local, admitted) ?? backend.capabilities;
        if (!backend.open || capabilities.open === false) fail("ENOTSUP");
        admitted.signal?.throwIfAborted();
        const descriptor = await backend.open(location.local, admitted);
        try {
          return forwardFileDescriptor(descriptor, (syscall, forwarded, action) => this.operation(syscall, path, forwarded, action), descriptor.capabilities, snapshotStat);
        } catch (error) {
          await finishCleanup(() => descriptor.close(), true);
          throw error;
        }
      } catch (error) {
        admitted.signal?.throwIfAborted();
        throw this.error(error, "open", path, admitted);
      } finally {
        release?.();
      }
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

  readdir(path: string, options: ReadDirectoryOptions = {}): Promise<DirectoryEntry[]> {
    return this.operation("readdir", path, options, async () => {
      const limit = directoryEntryLimit(options, path);
      const location = await this.resolve(path, options);
      if (location.stat?.type !== "directory") fail("ENOTDIR");
      const entries = new Map<string, DirectoryEntry>();
      if (!location.synthetic) {
        const children = await location.mount.backend.readdir(location.local, options);
        options.signal?.throwIfAborted();
        admitDirectoryEntries(children.length, limit, path);
        for (const entry of children) {
          options.signal?.throwIfAborted();
          const { name, type } = entry;
          if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\0")) fail("EIO");
          if (!entries.has(name)) admitDirectoryEntries(entries.size + 1, limit, path);
          entries.set(name, { name, type });
        }
      }
      for (const mount of this.mounts) {
        if (mount.path !== location.path && within(location.path, mount.path)) {
          const suffix = mount.path.slice(location.path === "/" ? 1 : location.path.length + 1);
          const name = suffix.split("/")[0]!;
          if (!entries.has(name)) admitDirectoryEntries(entries.size + 1, limit, path);
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

  unlink(path: string, options: FsOptions = {}): Promise<void> {
    return this.operation("unlink", path, options, async () => {
      const location = await this.resolve(path, options, { followFinal: false, entry: true });
      this.mutable(location);
      this.entryPath(path);
      const backend = location.mount.backend;
      if (!backend.unlink) fail("ENOTSUP");
      options.signal?.throwIfAborted();
      await backend.unlink(location.local, options);
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

  private async localStaging(staging: FileStaging, options: FsOptions): Promise<{ mount: Mount; staging: FileStaging }> {
    const parent = await this.resolve(staging.parent.path, options, { followFinal: false, entry: true });
    const directory = await this.resolve(staging.directory.path, options, { followFinal: false, entry: true });
    const file = await this.resolve(staging.file.path, options, { followFinal: false, entry: true, allowMissing: true });
    if (parent.mount !== directory.mount || directory.mount !== file.mount) fail("EXDEV");
    if (this.protected(directory.path) || this.protected(file.path)) fail("EBUSY");
    for (const location of [directory, file]) this.mutable(location);
    return { mount: directory.mount, staging: {
      parent: { path: parent.local, stat: staging.parent.stat },
      directory: { path: directory.local, stat: staging.directory.stat },
      file: { path: file.local, stat: staging.file.stat },
    } };
  }

  publishFileConditional(path: string, source: ByteSource, options: ConditionalFilePublicationOptions): Promise<FileStat> {
    return this.operation("publishFileConditional", path, options, async () => {
      const location = await this.resolve(path, options, { followFinal: false, entry: true, allowMissing: true });
      if (this.protected(location.path)) fail("EBUSY");
      this.mutable(location);
      const backend = location.mount.backend;
      await requireOwnedMutation(backend, location.local, "atomicFilePublication", options, options.expected === null);
      if (!backend.publishFileConditional) fail("ENOTSUP");
      return snapshotStat(await backend.publishFileConditional(location.local, source, options));
    }, undefined, true);
  }

  writeFileConditional(path: string, data: Uint8Array, options: ConditionalWriteFileOptions): Promise<FileStat> {
    return this.operation("writeFileConditional", path, options, async () => {
      const location = await this.resolve(path, options, { followFinal: false, entry: true, allowMissing: true });
      if (this.protected(location.path)) fail("EBUSY");
      this.mutable(location);
      const backend = location.mount.backend;
      await requireOwnedMutation(backend, location.local, "atomicFileMutation", options, options.expected === null);
      if (!backend.writeFileConditional) fail("ENOTSUP");
      return snapshotStat(await backend.writeFileConditional(location.local, data, options));
    }, undefined, true);
  }

  removeEntryConditional(path: string, options: ConditionalRemoveEntryOptions & { readonly returnRemainingStat?: false | undefined }): Promise<void>;
  removeEntryConditional(path: string, options: ConditionalRemoveEntryReceiptOptions): Promise<void | FileStat>;
  removeEntryConditional(path: string, options: ConditionalRemoveEntryReceiptOptions): Promise<void | FileStat> {
    options = { ...options };
    const requested = options.returnRemainingStat === true;
    return this.operation("removeEntryConditional", path, options, async () => {
      const location = await this.resolve(path, options, { followFinal: false, entry: true, allowMissing: true });
      if (this.protected(location.path)) fail("EBUSY");
      this.mutable(location);
      const backend = location.mount.backend;
      await requireOwnedMutation(backend, location.local, "atomicEntryRemoval", options);
      if (requested) await requireOwnedMutation(backend, location.local, "atomicEntryRemovalReceipt", options);
      if (!backend.removeEntryConditional) fail("ENOTSUP");
      const receipt = await backend.removeEntryConditional(location.local, options);
      return requested && receipt !== undefined ? Object.freeze(snapshotStat(receipt)) : undefined;
    }, undefined, requested);
  }

  removeFileConditional(path: string, options: ConditionalRemoveFileOptions): Promise<void> {
    return this.operation("removeFileConditional", path, options, async () => {
      const location = await this.resolve(path, options, { followFinal: false, entry: true, allowMissing: true });
      if (this.protected(location.path)) fail("EBUSY");
      this.mutable(location);
      const backend = location.mount.backend;
      await requireOwnedMutation(backend, location.local, "atomicFileMutation", options);
      if (!backend.removeFileConditional) fail("ENOTSUP");
      await backend.removeFileConditional(location.local, options);
    });
  }

  removeTreeConditional(path: string, options: ConditionalRemoveEntryOptions): Promise<void> {
    return this.operation("removeTreeConditional", path, options, async () => {
      const location = await this.resolve(path, options, { followFinal: false, entry: true, allowMissing: true });
      if (this.protected(location.path)) fail("EBUSY");
      this.mutable(location);
      const backend = location.mount.backend;
      await requireOwnedMutation(backend, location.local, "atomicTreeRemoval", options);
      if (!backend.removeTreeConditional) fail("ENOTSUP");
      await backend.removeTreeConditional(location.local, options);
    });
  }

  async createStagedFile(path: string, name: string, content: StagedFileContent, options: CreateStagedFileOptions): Promise<FileStaging> {
    options = snapshotStagingCreation(options, path);
    return this.operation("createStagedFile", path, options, async () => {
      const location = await this.resolve(path, options, { followFinal: false, entry: true, allowMissing: true, missingDirectory: true });
      if (this.protected(location.path)) fail("EBUSY");
      this.mutable(location);
      const backend = location.mount.backend;
      await requireOwnedMutation(backend, location.local, "atomicFileStaging", options, true);
      if (options.retainCleanup === true) await requireOwnedMutation(backend, location.local, "retainedStagingCleanup", options, true);
      if (!backend.createStagedFile) fail("ENOTSUP");
      const receipt = await backend.createStagedFile(location.local, name, content, options);
      const map = (entry: FileStagingEntry): FileStagingEntry => Object.freeze({
        path: location.mount.path === "/" ? entry.path : `${location.mount.path}${entry.path === "/" ? "" : entry.path}`,
        stat: Object.freeze(snapshotStat(entry.stat)),
      });
      try {
        const staging = { parent: map(receipt.parent), directory: map(receipt.directory), file: map(receipt.file) };
        if (!receipt.cleanup) return Object.freeze(staging);
        const backendCleanup = receipt.cleanup;
        const cleanup = createStagingCleanup(staging.directory.path,
          controls => this.operation("removeStagedFile", staging.directory.path, controls,
            () => backendCleanup.remove(controls), undefined, true),
          () => backendCleanup.close());
        return Object.freeze({ ...staging, cleanup });
      } catch (error) {
        await finishCleanup(() => receipt.cleanup?.close(), true);
        throw error;
      }
    }, undefined, true);
  }

  publishStagedFile(staging: FileStaging, destination: string, options: PublishStagedFileOptions): Promise<void> {
    return this.operation("publishStagedFile", staging.file.path, options, async () => {
      const ancestors = options.ancestors === undefined ? undefined : snapshotDirectoryAncestry(options.ancestors);
      const callerGuard = options.commitGuard;
      let guard: (() => true) | undefined;
      if (ancestors) {
        const canonical = normalizePath(globalPath(destination));
        const parent = canonical.slice(0, canonical.lastIndexOf("/")) || "/";
        if (canonical !== destination || ancestors.at(-1)?.path !== parent) fail("EINVAL");
        guard = await this.prepareAncestry(ancestors, options);
        runStagingGuard(guard);
      }
      const local = await this.localStaging(staging, options);
      const target = await this.resolve(destination, options, { followFinal: false, entry: true, allowMissing: true });
      if (ancestors) {
        if (target.path !== destination) fail("EAGAIN");
        if (options.destination === null) {
          if (target.stat !== undefined) fail("EAGAIN");
        } else {
          if (target.stat === undefined || target.stat.type !== options.destination.type) fail("EAGAIN");
          const identity = compareIdentity(target.stat, options.destination);
          if (identity === "unknown") fail("ENOTSUP");
          if (identity !== "same") fail("EAGAIN");
        }
      }
      if (this.protected(target.path)) fail("EBUSY");
      if (local.mount !== target.mount) fail("EXDEV");
      this.mutable(target);
      await requireOwnedMutation(local.mount.backend, local.staging.directory.path, "atomicFileStaging", options);
      await requireOwnedMutation(local.mount.backend, target.local, "atomicFileStaging", options, options.destination === null);
      if (!local.mount.backend.publishStagedFile) fail("ENOTSUP");
      if (ancestors || callerGuard !== undefined) await requireOwnedMutation(local.mount.backend, target.local, "guardedStagingPublication", options, options.destination === null);
      if (!ancestors) {
        await local.mount.backend.publishStagedFile(local.staging, target.local, options);
        return;
      }
      const parent = target.path.slice(0, target.path.lastIndexOf("/")) || "/";
      if (target.path !== normalizePath(globalPath(destination)) || ancestors.at(-1)?.path !== parent) fail("EINVAL");
      try {
        const declared = await local.mount.backend.capabilitiesFor?.(target.local, { ...options, stagingAncestry: true, ...(options.destination === null ? { create: true } : {}) }) ?? local.mount.backend.capabilities;
        if (!await this.supportsStagingAncestry(target, declared, options)) fail("ENOTSUP");
      } catch (error) {
        options.signal?.throwIfAborted();
        if (["ENOTSUP", "ENOENT", "ENOTDIR", "ELOOP"].includes(toFsError(error).code)) {
          await inspectStagingBindings(async path => {
            const entry = await this.lookup(path, options);
            if (!entry.stat) fail("ENOENT");
            return entry.stat;
          }, destination, options);
        }
        throw error;
      }
      const first = ancestors.findIndex(entry => entry.path === target.mount.path);
      if (first < 0) fail("EINVAL");
      const localAncestors = ancestors.slice(first).map(entry => ({
        path: target.mount.path === "/" ? entry.path : entry.path.slice(target.mount.path.length) || "/", stat: entry.stat,
      }));
      await local.mount.backend.publishStagedFile(local.staging, target.local, {
        ...options, ancestors: localAncestors,
        commitGuard: () => {
          if (callerGuard !== undefined) runStagingGuard(callerGuard);
          runStagingGuard(guard!);
          return true;
        },
      });
    }, destination, true);
  }

  removeStagedFile(staging: FileStaging, options: FsOptions = {}): Promise<void> {
    return this.operation("removeStagedFile", staging.directory.path, options, async () => {
      const local = await this.localStaging(staging, options);
      await requireOwnedMutation(local.mount.backend, local.staging.directory.path, "atomicFileStaging", options);
      if (!local.mount.backend.removeStagedFile) fail("ENOTSUP");
      await local.mount.backend.removeStagedFile(local.staging, options);
    });
  }

  prepareDirectory(path: string, options: PrepareDirectoryOptions): Promise<FileStat> {
    return this.operation("prepareDirectory", path, options, async () => {
      const location = await this.resolve(path, options, { followFinal: false, entry: true, allowMissing: true, missingDirectory: true });
      if (this.protected(location.path)) fail("EBUSY");
      this.mutable(location);
      await requireOwnedMutation(location.mount.backend, location.local, "atomicDirectoryMetadata", options, options.expected === null);
      if (!location.mount.backend.prepareDirectory) fail("ENOTSUP");
      return snapshotStat(await location.mount.backend.prepareDirectory(location.local, options));
    }, undefined, true);
  }

  rename(source: string, destination: string, options: RenameOptions = {}): Promise<void> {
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
      if (options.noReplace) {
        const capabilities = await target.mount.backend.capabilitiesFor?.(target.local, options) ?? target.mount.backend.capabilities;
        options.signal?.throwIfAborted();
        if (capabilities.atomicRenameNoReplace !== true) fail("ENOTSUP");
      }
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
        ...(options.signal ? { signal: options.signal } : {}), flag: options.exclusive || !target.stat ? "wx" : "w",
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
        const data = await reader.readFile(origin.local, options);
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

  chmod(path: string, mode: number, options: ChmodOptions = {}): Promise<void> {
    return this.operation("chmod", path, options, async () => {
      const conditional = snapshotConditionalChmod(path, options);
      const controls: FsOptions = options.signal === undefined ? {} : { signal: options.signal };
      const location = await this.resolve(path, controls, conditional ? { followFinal: false } : {});
      this.mutable(location);
      const chmod = this.optional(location, "chmod", "permissions");
      if (!conditional) return chmod.call(location.mount.backend, location.local, mode, controls);
      if (location.path !== path) fail("EAGAIN");
      const backend = location.mount.backend;
      const capabilities = await backend.capabilitiesFor?.(location.local, { ...controls, conditionalChmod: true }) ?? backend.capabilities;
      if (capabilities.conditionalChmod !== true) fail("ENOTSUP");
      const guard = await this.prepareAncestry(conditional.ancestors, controls, true);
      const ancestors = conditional.ancestors.filter(entry => this.select(entry.path) === location.mount).map(entry => ({
        path: location.mount.path === "/" ? entry.path : entry.path.slice(location.mount.path.length) || "/", stat: entry.stat,
      }));
      await chmod.call(backend, location.local, mode, { ...conditional, ancestors, commitGuard: () => {
        if (conditional.commitGuard) runStagingGuard(conditional.commitGuard);
        runStagingGuard(guard);
        return true;
      } });
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
    let release: (() => void) | undefined;
    try {
      release = await this.acquireNamespace(options);
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
    } finally {
      release?.();
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
