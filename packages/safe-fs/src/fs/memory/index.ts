import { FsError } from "../../contracts/errors.js";
import type { ErrnoCode } from "../../contracts/errors.js";
import type {
  AppendFileOptions, CopyFileOptions, DirectoryEntry, EntryComparison, FileReadHandle, FileResizeHandle, FileStat, FileSystem, FileSystemCapabilities,
  FsOptions, ChmodOptions, RenameOptions, MkdirOptions, ReadDirectoryOptions, ReadFileOptions, ReadStreamOptions, RemoveOptions,
  FileDescriptor, OpenFileOptions, OpenReadFileOptions, OpenResizeFileOptions, WriteFileOptions,
  ConditionalWriteFileOptions, ConditionalRemoveFileOptions, ConditionalRemoveEntryOptions, ConditionalRemoveEntryReceiptOptions, CreateStagedFileOptions, FileStaging, FileStagingCleanup, FileStagingEntry, FileResolutionStep, FileStagingResolution, PublishStagedFileOptions, PrepareDirectoryOptions, StagedFileContent,
} from "../../contracts/filesystem.js";
import type { ByteSource } from "../../contracts/io.js";
import { normalizePath } from "../../contracts/virtual-path.js";
import { assertCallbackAuthorityAllowed, compareEntries, registerEntryAuthority } from "../mount/comparison.js";
import type { EntryAuthority } from "../mount/comparison.js";
import { getOwnedS3Entry } from "../s3/registry.js";
import { getOwnedWebDavEntry } from "../webdav/resource-id.js";
import { admitDirectoryEntries, directoryEntryLimit } from "../directory-admission.js";
import { openFileDescriptor } from "../descriptor.js";
import { directoryAncestryPaths, runStagingGuard, snapshotDirectoryAncestry, snapshotStagingResolution } from "../staging-ancestry.js";
import { compareIdentity } from "../mount/identity.js";
import { createStagingCleanup, snapshotStagingCreation } from "../staging-cleanup.js";
import { resolveMissingTarget } from "./missing-target.js";
import { registerMemoryAtomicView } from "./atomic-view.js";
import { snapshotConditionalChmod } from "../conditional-chmod.js";
import { MemoryAllocation, MemoryLedger } from "./ledger.js";
import { normalizeMemoryFileSystemLimits, type MemoryFileSystemOptions } from "./limits.js";

export { defaultMemoryFileSystemLimits, type MemoryFileSystemLimits, type MemoryFileSystemOptions } from "./limits.js";

interface Metadata {
  revision: number;
  mode: number;
  ino: number;
  nlink: number;
  atimeMs: number;
  mtimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;
  references: number;
}

interface FileNode extends Metadata {
  type: "file";
  byteLength: number;
  view: Uint8Array | undefined;
  data: Uint8Array;
  allocation: MemoryAllocation;
}

class MemoryFileNode implements FileNode {
  declare readonly type: "file";
  declare revision: number;
  declare mode: number;
  declare ino: number;
  declare nlink: number;
  declare atimeMs: number;
  declare mtimeMs: number;
  declare ctimeMs: number;
  declare birthtimeMs: number;
  declare references: number;
  declare byteLength: number;
  declare view: Uint8Array | undefined;
  declare allocation: MemoryAllocation;

  constructor(mode: number, ino: number, now: number, byteLength: number, allocation: MemoryAllocation, view?: Uint8Array) {
    this.mode = mode;
    this.ino = ino;
    this.atimeMs = now;
    this.mtimeMs = now;
    this.ctimeMs = now;
    this.birthtimeMs = now;
    this.byteLength = byteLength;
    this.allocation = allocation;
    this.view = view;
  }

  get data(): Uint8Array {
    return this.view ??= (this.byteLength === this.allocation.data.byteLength ? this.allocation.data : this.allocation.data.subarray(0, this.byteLength));
  }

  set data(value: Uint8Array) {
    this.view = value;
    this.byteLength = value.byteLength;
  }
}
Object.assign(MemoryFileNode.prototype, {
  type: "file",
  revision: 0,
  nlink: 1,
  references: 0,
});

const EMPTY_ALLOC_BYTES = new Uint8Array(0);
const SMALL_ALLOC_SLAB_SIZE = 8192;
let smallAllocSlab = new Uint8Array(SMALL_ALLOC_SLAB_SIZE);
let smallAllocOffset = 0;

interface DirectoryNode extends Metadata {
  type: "directory";
  entries: Map<string, MemoryNode>;
  cachedNlink?: number;
  cachedNlinkRev?: number;
}

interface SymlinkNode extends Metadata {
  type: "symlink";
  target: string;
}

type MemoryNode = FileNode | DirectoryNode | SymlinkNode;

interface Location {
  node: MemoryNode | undefined;
  parent: DirectoryNode;
  name: string;
  path: string;
}

interface ResolveOptions {
  resolutionSteps?: FileResolutionStep[];
  resizeCreate?: boolean;
  followFinal?: boolean;
  allowMissing?: boolean;
  createDirectories?: number;
}

interface WriteTarget {
  location: Location;
  mode: number;
  append: boolean;
}

class MemoryCache {
  readonly allocations: MemoryAllocation[] = [];
  readonly files: FileNode[] = [];
  readonly directories: DirectoryNode[] = [];
  readonly removedScratch: MemoryNode[] = [];
  lastFastDirPrefix = "";
  lastFastDirNode: DirectoryNode | undefined;
  lastFastFilePath = "";
  lastFastFileName = "";
  lastFastFileNode: FileNode | undefined;

  clearWrites(): void {
    this.lastFastDirPrefix = "";
    this.lastFastDirNode = undefined;
    this.lastFastFilePath = "";
    this.lastFastFileName = "";
    this.lastFastFileNode = undefined;
  }
}

const typeModes = { file: 0o100000, directory: 0o040000, symlink: 0o120000 } as const;
const emptyResolveOptions: ResolveOptions = Object.freeze({});
const noFollowResolveOptions: ResolveOptions = Object.freeze({ followFinal: false });
const resolvedVoid = Promise.resolve();
const preferredIoBlockSize = 64 * 1024;
const ext4HtreeEof64 = (1n << 63n) - 1n;
const extractionStreamGuard = Symbol("extractionStreamGuard");
type ConfinedWriteOptions = WriteFileOptions & { readonly [extractionStreamGuard]?: (node: FileNode) => void };
const ownedStats = new WeakMap<FileStat, { filesystem: FileSystem; path: string; root: DirectoryNode }>();
const ownedStores = new WeakMap<FileSystem, { root: DirectoryNode; ledger: MemoryLedger; capabilities: FileSystem["capabilities"]; intact: () => boolean }>();
// Ensure V8 uses Tagged representation for timestamp fields so all 4 fields share one HeapNumber pointer.
{
  const dummyAlloc = new MemoryAllocation(new Uint8Array(0), new MemoryLedger(normalizeMemoryFileSystemLimits({})));
  const dummyFile = new MemoryFileNode(0, 0, null as unknown as number, 0, dummyAlloc, dummyAlloc.data);
  dummyFile.atimeMs = dummyFile.mtimeMs = dummyFile.ctimeMs = dummyFile.birthtimeMs = 1700000000000;
}
// Forwarded receivers share the ledger, so mutations invalidate the owner's cache.
const memoryCaches = new WeakMap<MemoryLedger, MemoryCache>();
const registeredAuthorities = new WeakSet<FileSystem>();
const compareOwnedMemory: EntryAuthority = async (own, peer, options) => {
  options.signal?.throwIfAborted();
  let explicit = false;
  let answer: EntryComparison = "unknown";
  const visited = new Set<FileSystem>();
  for (const [left, right] of [[own, peer], [peer, own]] as const) {
    if (!registeredAuthorities.has(left.filesystem) || visited.has(left.filesystem)) continue;
    visited.add(left.filesystem);
    const comparison = left.filesystem.compareEntry;
    if (comparison === memoryImplementation.compareEntry?.value) continue;
    explicit = true;
    if (!comparison) continue;
    options.signal?.throwIfAborted();
    assertCallbackAuthorityAllowed();
    const result = await comparison.call(left.filesystem, left.path, right.filesystem, right.path, options);
    options.signal?.throwIfAborted();
    if (result !== "same" && result !== "distinct" && result !== "unknown") {
      throw new FsError("EIO", { path: own.path, dest: peer.path, message: "invalid explicit Memory comparison" });
    }
    if (result === "unknown") continue;
    if (answer !== "unknown" && answer !== result) {
      throw new FsError("EIO", { path: own.path, dest: peer.path, message: "conflicting explicit Memory comparisons" });
    }
    answer = result;
  }
  if (explicit) return answer;
  const owner = ownedStores.get(own.filesystem);
  const observation = ownedStats.get(own.stat);
  if (!owner?.intact() || observation?.filesystem !== own.filesystem || observation.path !== own.path
    || observation.root !== owner.root) return "unknown";
  const qualified = getOwnedS3Entry(peer) ?? getOwnedWebDavEntry(peer);
  options.signal?.throwIfAborted();
  return qualified ? "distinct" : "unknown";
};


export interface ConditionalMutationBinding {
  readonly path: string;
  readonly parent: FileStat;
  readonly expected: FileStat;
  readonly ancestors: readonly FileStagingEntry[];
}

const activeConditionalMutations = new Map<object | symbol, ConditionalMutationBinding>();

export async function bindConditionalMutation<Result>(
  identityScope: object | symbol | undefined,
  binding: ConditionalMutationBinding,
  action: () => Promise<Result>,
): Promise<Result> {
  if (identityScope === undefined || identityScope === null) return action();
  activeConditionalMutations.set(identityScope, binding);
  try {
    return await action();
  } finally {
    if (activeConditionalMutations.get(identityScope) === binding) {
      activeConditionalMutations.delete(identityScope);
    }
  }
}

const STREAM_DONE_RESULT: IteratorResult<Uint8Array> = Object.freeze({ done: true, value: undefined });
const STREAM_RESOLVED_DONE: Promise<IteratorResult<Uint8Array>> = Promise.resolve(STREAM_DONE_RESULT);

class MemoryReadStream implements ByteSource, AsyncIterableIterator<Uint8Array> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  declare readonly fs: any;
  declare readonly path: string;
  declare readonly options: ReadStreamOptions;
  declare readonly abortSignal: AbortSignal | undefined;
  declare initialized: boolean;
  declare finished: boolean;
  declare offset: number;
  declare end: number;
  declare chunkSize: number;
  declare node: FileNode | undefined;
  declare allocation: FileNode["allocation"] | undefined;
  declare data: Uint8Array | undefined;

  constructor(fs: MemoryFileSystem, path: string, options: ReadStreamOptions) {
    this.fs = fs;
    this.path = path;
    this.options = options;
    this.abortSignal = options.signal;
    this.initialized = false;
    this.finished = false;
    this.offset = 0;
    this.end = 0;
    this.chunkSize = preferredIoBlockSize;
    this.node = undefined;
    this.allocation = undefined;
    this.data = undefined;
  }

  [Symbol.asyncIterator](): this {
    if (this.initialized || this.finished) {
      return new MemoryReadStream(this.fs, this.path, this.options) as this;
    }
    return this;
  }

  _release(): void {
    if (this.finished) return;
    this.finished = true;
    if (this.allocation) {
      this.allocation.release();
      this.allocation = undefined;
    }
    if (this.node) {
      const releasedNode = this.node;
      this.node = undefined;
      this.fs.releaseReference(releasedNode, this.path);
    }
    this.data = undefined;
  }

  tryNextSync(): IteratorResult<Uint8Array> {
    if (this.finished) return STREAM_DONE_RESULT;
    try {
      const options = this.options;
      options.signal?.throwIfAborted();
      if (!this.initialized) {
        this.initialized = true;
        const fs = this.fs;
        const path = this.path;
        const start = options.start ?? 0;
        const chunkSize = options.chunkSize ?? preferredIoBlockSize;
        this.chunkSize = chunkSize;
        fs.integer(start, "readStream", path);
        fs.integer(chunkSize, "readStream", path);
        if (chunkSize === 0) fs.fail("EINVAL", "readStream", path);
        if (options.endExclusive !== undefined) {
          fs.integer(options.endExclusive, "readStream", path);
          if (options.endExclusive < start) fs.fail("EINVAL", "readStream", path);
        }
        const target = fs.file(path, "readStream");
        fs.permission(target, 4, "readStream", path);
        fs.ledger.reserve(path.length * 2, 1, "readStream", path);
        target.references++;
        this.node = target;
        this.allocation = target.allocation;
        target.allocation.retain();
        const data = target.data;
        this.data = data;
        this.offset = start;
        this.end = Math.min(options.endExclusive ?? data.byteLength, data.byteLength);
        target.atimeMs = Date.now();
      }
      if (this.offset < this.end) {
        const nextEnd = Math.min(this.offset + this.chunkSize, this.end);
        const chunk = this.data!.slice(this.offset, nextEnd);
        this.offset = nextEnd;
        return { done: false, value: chunk };
      }
      this._release();
      return STREAM_DONE_RESULT;
    } catch (error) {
      this._release();
      throw error;
    }
  }

  next(): Promise<IteratorResult<Uint8Array>> {
    try {
      const res = this.tryNextSync();
      return res.done ? STREAM_RESOLVED_DONE : Promise.resolve(res);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  return(): Promise<IteratorResult<Uint8Array>> {
    this._release();
    return STREAM_RESOLVED_DONE;
  }
}

export class MemoryFileSystem implements FileSystem {
  capabilitiesFor?: NonNullable<FileSystem["capabilitiesFor"]>;
  readonly capabilities: FileSystemCapabilities = ((filesystem: MemoryFileSystem) => {
    return Object.freeze({
      read: true, stat: true, readdir: true, realpath: true, access: true, open: true,
      write: true, append: true, exclusiveCreate: true, explicitDirectories: true, implicitDirectories: false,
      mkdir: true, recursiveMkdir: true, remove: true, removeDirectory: true, recursiveRemove: true,
      rename: true, atomicRenameNoReplace: true, copy: true, exclusiveCopy: true, readlink: true, truncate: true,
      streamingAppend: true, randomAccessWrite: true,
      readOnly: false,
      symlinks: true, conditionalChmod: true,
      hardlinks: true,
      permissions: true,
      timestamps: true,
      atomicRename: true,
      atomicFileStaging: true, retainedStagingCleanup: true, atomicStagingAncestry: true, atomicFileMutation: true, atomicEntryRemoval: true, atomicEntryRemovalReceipt: true, atomicTreeRemoval: true,
      synchronousDirectoryValidation: true, synchronousStagingResolution: true, guardedStagingPublication: true,
      atomicDirectoryMetadata: true,
      streamingRead: true,
      retainedRead: true,
      get retainedResize() { return stockRetainedResize(filesystem); },
      streamingWrite: true,
      get descriptorWriteStream() { return stockDescriptorWrite(filesystem); },
    });
  })(this);

  private readonly identityScope = Symbol();
  private nextInode = 1;
  private readonly ledger: MemoryLedger;
  private readonly root: DirectoryNode;
  private totalBytes = 0;
  symlinkCount = 0;

  constructor(options: MemoryFileSystemOptions = {}) {
    this.ledger = new MemoryLedger(normalizeMemoryFileSystemLimits(options));
    memoryCaches.set(this.ledger, new MemoryCache());
    this.ledger.reserve(0, 1, "mkdir", "/");
    this.root = this.directory(0o755);
    const root = this.root;
    ownedStores.set(this, {
      root,
      ledger: this.ledger,
      capabilities: this.capabilities,
      intact: () => this.root === root,
    });
    registerMemoryAtomicView(this, {
      stat: (path) => {
        this.validatePath(path, "overlayAtomicView");
        let node: MemoryNode | undefined = this.root;
        for (const component of path.split("/").filter(Boolean)) {
          if (component === "." || component === "..") this.fail("EINVAL", "overlayAtomicView", path);
          if (!node) return undefined;
          if (node.type !== "directory") this.fail("ENOTDIR", "overlayAtomicView", path);
          this.permission(node, 1, "overlayAtomicView", path);
          node = node.entries.get(component);
        }
        return node ? this.snapshot(node) : undefined;
      },
      names: (path) => {
        const node = this.entry(path, "overlayAtomicView").node!;
        if (node.type !== "directory") this.fail("ENOTDIR", "overlayAtomicView", path);
        return [...node.entries.keys()];
      },
    }, () => {
      if (
        Object.getPrototypeOf(this) !== MemoryFileSystem.prototype ||
        this.root !== root ||
        this.ledger !== ownedStores.get(this)?.ledger ||
        this.capabilities !== ownedStores.get(this)?.capabilities
      ) {
        return false;
      }
      const proto = MemoryFileSystem.prototype as unknown as Record<string, unknown>;
      for (let i = 0; i < memoryImplementationKeys.length; i++) {
        const name = memoryImplementationKeys[i]!;
        const expected = memoryImplementationDescriptors[i]!;
        if (Object.prototype.hasOwnProperty.call(this, name)) {
          const actual = Object.getOwnPropertyDescriptor(this, name);
          if (!actual || actual.value !== expected.value || actual.get !== expected.get || actual.set !== expected.set) return false;
        } else if (expected.get !== undefined || expected.set !== undefined || proto[name] !== expected.value) {
          const actual = Object.getOwnPropertyDescriptor(MemoryFileSystem.prototype, name);
          if (!actual || actual.value !== expected.value || actual.get !== expected.get || actual.set !== expected.set) return false;
        }
      }
      return true;
    });
    if (this.compareEntry === memoryImplementation.compareEntry?.value) {
      registeredAuthorities.add(this);
      registerEntryAuthority(this, compareOwnedMemory);
    }
  }

  compareEntry(path: string, peer: FileSystem, peerPath: string, options: FsOptions = {}): Promise<EntryComparison> {
    return compareEntries(this, path, peer, peerPath, options);
  }

  canonicalizeMissingTarget(path: string, options: FsOptions = {}): string | undefined {
    options.signal?.throwIfAborted();
    if (!isStockMemoryMethods(this, missingTargetMethodNames)) return undefined;
    const owner = ownedStores.get(this)!;
    if (path !== "") this.validatePath(path, "realpath");
    return resolveMissingTarget(owner.root, path || ".", options.signal);
  }

  async confineExtraction(roots: readonly string[], options: FsOptions = {}): Promise<FileSystem> {
    options.signal?.throwIfAborted();
    const retained = new Map<string, MemoryNode>();
    for (const root of roots) {
      this.validatePath(root, "confineExtraction");
      let path = "";
      for (const component of root.split("/").filter(Boolean)) {
        if (component === "." || component === "..") this.fail("EINVAL", "confineExtraction", root);
        path += `/${component}`;
        const node = this.entry(path, "confineExtraction").node!;
        if (node.type !== "directory") this.fail("ENOTDIR", "confineExtraction", path);
        retained.set(path, node);
      }
      retained.set("/", this.root);
    }
    const capabilities = Object.freeze({ ...this.capabilities, retainedStagingCleanup: false });
    const allowed = new Set(["mkdir", "rm", "rmdir", "rename", "symlink", "link", "chmod", "utimes", "writeFile", "appendFile", "writeStream", "writeFileConditional", "removeFileConditional"]);
    const reads = new Set(["access", "capabilitiesFor", "compareEntry", "lstat", "stat", "readFile", "readStream", "readdir", "readlink", "realpath"]);
    const check = (path: string, followFinal: boolean): void => {
      if (!roots.some(root => root === "/" || path === root || path.startsWith(`${root}/`))) this.fail("EPERM", "confineExtraction", path);
      const components = path.split("/").filter(Boolean);
      if (components.some(component => component === "." || component === "..")) this.fail("EINVAL", "confineExtraction", path);
      let current = "";
      for (const [index, component] of components.entries()) {
        current += `/${component}`;
        const node = this.entry(current, "confineExtraction", true).node;
        if (retained.has(current) && node !== retained.get(current)) this.fail("EAGAIN", "confineExtraction", current);
        if (index < components.length - 1 && node?.type !== "directory") this.fail("ENOTDIR", "confineExtraction", current);
        if (followFinal && index === components.length - 1 && node?.type === "symlink") this.fail("ELOOP", "confineExtraction", current);
      }
    };
    return new Proxy(this, {
      get: (target, property) => {
        if (property === "objects" || property === "confineExtraction") return undefined;
        if (property === "capabilities") return capabilities;
        const value: unknown = Reflect.get(target, property);
        if (typeof value !== "function") return value;
        if (reads.has(String(property))) return value.bind(target);
        return (...args: unknown[]) => {
          if (!allowed.has(String(property))) throw new FsError("ENOTSUP", { syscall: String(property) });
          // Stock mutations resolve and commit synchronously. Streamed writes
          // repeat the boundary and file-binding check at each backend mutation.
          const paths = property === "symlink" ? [args[1]] : property === "link" || property === "rename" ? args.slice(0, 2) : [args[0]];
          for (const path of paths) {
            if (typeof path !== "string") throw new FsError("EINVAL");
            check(path, ["chmod", "utimes", "appendFile", "writeFile", "writeStream", "writeFileConditional", "link"].includes(String(property)));
          }
          if (property === "writeStream") {
            const path = args[0] as string;
            args[2] = { ...(args[2] as WriteFileOptions | undefined), [extractionStreamGuard]: (node: FileNode) => {
              check(path, true);
              if (this.resolve(path, "writeStream").node !== node) this.fail("EPERM", "writeStream", path);
            } } satisfies ConfinedWriteOptions;
          }
          return Reflect.apply(value, target, args);
        };
      },
    });
  }

  private metadata(mode: number): Metadata {
    const now = Date.now();
    return {
      mode, ino: this.nextInode++, nlink: 1, references: 0, revision: 0,
      atimeMs: now, mtimeMs: now, ctimeMs: now, birthtimeMs: now,
    };
  }

  private directory(mode: number): DirectoryNode {
    const now = Date.now();
    const fullMode = typeModes.directory | mode;
    const ino = this.nextInode++;
    const pooled = memoryCaches.get(this.ledger)?.directories.pop();
    if (pooled) {
      pooled.mode = fullMode;
      pooled.ino = ino;
      pooled.nlink = 1;
      pooled.references = 0;
      pooled.revision = 0;
      pooled.atimeMs = now;
      pooled.mtimeMs = now;
      pooled.ctimeMs = now;
      pooled.birthtimeMs = now;
      pooled.cachedNlink = 2;
      pooled.cachedNlinkRev = 0;
      return pooled;
    }
    const dir: DirectoryNode = {
      type: "directory",
      mode: fullMode,
      ino,
      nlink: 1,
      references: 0,
      revision: 0,
      atimeMs: null as unknown as number,
      mtimeMs: null as unknown as number,
      ctimeMs: null as unknown as number,
      birthtimeMs: null as unknown as number,
      entries: new Map(),
      cachedNlink: 2,
      cachedNlinkRev: 0,
    };
    dir.atimeMs = now;
    dir.mtimeMs = now;
    dir.ctimeMs = now;
    dir.birthtimeMs = now;
    return dir;
  }

  private addNode<Node extends MemoryNode>(parent: DirectoryNode, name: string, create: () => Node,
    syscall: string, path: string, retainedBytes = 0): Node {
    const bytes = name.length * 2 + retainedBytes;
    this.ledger.reserve(bytes, 2, syscall, path);
    try {
      const node = create();
      if (node.type === "file") this.admitSize(undefined, node.byteLength, syscall, path);
      parent.entries.set(name, node);
      if (node.type === "file") this.totalBytes += node.byteLength;
      else if (node.type === "symlink") this.symlinkCount++;
      this.changed(parent);
      return node;
    } catch (error) {
      this.ledger.release(bytes, 2);
      throw error;
    }
  }

  private releaseNode(node: MemoryNode): void {
    if (node.nlink !== 0 || node.references !== 0) return;
    const cache = memoryCaches.get(this.ledger)!;
    this.ledger.release(node.type === "symlink" ? node.target.length * 2 : 0, 1);
    if (node.type === "file") {
      if (cache.lastFastFileNode === node) {
        cache.lastFastFilePath = "";
        cache.lastFastFileName = "";
        cache.lastFastFileNode = undefined;
      }
      this.totalBytes -= node.byteLength;
      const alloc = node.allocation;
      node.view = undefined;
      alloc.release();
      if (alloc.isReleased64() && cache.allocations.length < 128) {
        cache.allocations.push(alloc);
      }
      if (cache.files.length < 128) {
        cache.files.push(node);
      }
    } else if (node.type === "symlink") {
      this.symlinkCount--;
    } else {
      if (cache.lastFastDirNode === node) {
        cache.lastFastDirPrefix = "";
        cache.lastFastDirNode = undefined;
      }
      if (node.entries.size === 0 && cache.directories.length < 32) {
        cache.directories.push(node);
      }
    }
  }

  private releaseReference(node: MemoryNode, path: string): void {
    node.references--;
    this.ledger.release(path.length * 2, 1);
    this.releaseNode(node);
  }

  private replaceData(node: FileNode, allocation: MemoryAllocation, length = allocation.data.byteLength): void {
    const previous = node.allocation;
    this.totalBytes += length - node.byteLength;
    node.byteLength = length;
    node.view = length === allocation.data.byteLength ? allocation.data : undefined;
    node.allocation = allocation;
    previous.release();
  }

  private admitSize(node: FileNode | undefined, length: number, syscall: string, path: string): void {
    this.ledger.fileSize(length, syscall, path);
    const maxBytes = this.ledger.limits.maxBytes;
    if (maxBytes !== undefined && length - (node?.byteLength ?? 0) > maxBytes - this.totalBytes) {
      this.fail("ENOSPC", syscall, path);
    }
  }

  private fail(code: ErrnoCode, syscall: string, path: string, dest?: string): never {
    throw new FsError(code, { syscall, path, ...(dest === undefined ? {} : { dest }) });
  }

  private validatePath(path: string, syscall: string): void {
    if (typeof path !== "string" || path.includes("\0")) this.fail("EINVAL", syscall, path);
    if (path.length === 0) this.fail("ENOENT", syscall, path);
  }

  private permission(node: MemoryNode, mask: number, syscall: string, path: string): void {
    if (((node.mode >> 6) & mask) !== mask) this.fail("EACCES", syscall, path);
  }

  private mode(mode: number | undefined, fallback: number, syscall: string, path: string): number {
    const value = mode ?? fallback;
    if (!Number.isInteger(value) || value < 0 || value > 0o7777) this.fail("EINVAL", syscall, path);
    return value;
  }

  private integer(value: number, syscall: string, path: string): void {
    if (!Number.isSafeInteger(value) || value < 0) this.fail("EINVAL", syscall, path);
  }

  private changed(node: MemoryNode, now = Date.now()): void {
    node.revision = node.revision < 1073741823 ? (node.revision + 1) | 0 : Math.min(Number.MAX_SAFE_INTEGER + 1, node.revision + 1);
    node.mtimeMs = node.ctimeMs = now;
  }

  private resolveNode(path: string, syscall: string, followFinal = true): MemoryNode {
    const cache = memoryCaches.get(this.ledger)!;
    if (this.symlinkCount === 0 && isCleanAbsolutePath(path)) {
      const fastDir = cache.lastFastDirNode;
      const fastPrefix = cache.lastFastDirPrefix;
      if (fastDir !== undefined && fastDir.nlink !== 0 && fastPrefix.length > 0 && path.startsWith(fastPrefix)) {
        const name = path.slice(fastPrefix.length);
        if (name.length > 0 && !name.includes("/")) {
          this.permission(fastDir, 1, syscall, path);
          if (exceedsComponentByteLimit(name)) this.fail("ENAMETOOLONG", syscall, path);
          const node = fastDir.entries.get(name);
          if (!node) this.fail("ENOENT", syscall, path);
          return node;
        }
      }
      let current: DirectoryNode = this.root;
      let start = 1;
      while (true) {
        this.permission(current, 1, syscall, path);
        const slash = path.indexOf("/", start);
        if (slash === -1) {
          cache.clearWrites();
          cache.lastFastDirPrefix = path.slice(0, start);
          cache.lastFastDirNode = current;
          const name = path.slice(start);
          if (exceedsComponentByteLimit(name)) this.fail("ENAMETOOLONG", syscall, path);
          const node = current.entries.get(name);
          if (!node) this.fail("ENOENT", syscall, path);
          return node;
        }
        const name = path.slice(start, slash);
        if (exceedsComponentByteLimit(name)) this.fail("ENAMETOOLONG", syscall, path);
        const next = current.entries.get(name);
        if (!next) this.fail("ENOENT", syscall, path);
        if (next.type !== "directory") this.fail("ENOTDIR", syscall, path);
        current = next;
        start = slash + 1;
      }
    }
    return this.resolve(path, syscall, followFinal ? emptyResolveOptions : noFollowResolveOptions).node!;
  }

  private resolve(path: string, syscall: string, options: ResolveOptions = emptyResolveOptions): Location {
    this.validatePath(path, syscall);
    if (this.symlinkCount === 0 && options.createDirectories === undefined && options.resizeCreate === undefined
      && options.resolutionSteps === undefined && isCleanAbsolutePath(path)) {
      let current: DirectoryNode = this.root;
      let start = 1;
      while (true) {
        this.permission(current, 1, syscall, path);
        const slash = path.indexOf("/", start);
        if (slash === -1) {
          const name = path.slice(start);
          if (exceedsComponentByteLimit(name)) this.fail("ENAMETOOLONG", syscall, path);
          const node = current.entries.get(name);
          if (!node && !options.allowMissing) this.fail("ENOENT", syscall, path);
          return { node, parent: current, name, path };
        }
        const name = path.slice(start, slash);
        if (exceedsComponentByteLimit(name)) this.fail("ENAMETOOLONG", syscall, path);
        const next = current.entries.get(name);
        if (!next) this.fail("ENOENT", syscall, path);
        if (next.type !== "directory") this.fail("ENOTDIR", syscall, path);
        current = next;
        start = slash + 1;
      }
    }
    // Bound all component arrays allocated by this resolution, including cycles.
    let remainingPathUnits = 65_536 - path.length;
    if (remainingPathUnits < 0) this.fail("ENAMETOOLONG", syscall, path);
    let initialComponents = 0;
    let inComp = false;
    for (let i = 0; i < path.length; i++) {
      if (path.charCodeAt(i) === 47) inComp = false;
      else if (!inComp) {
        inComp = true;
        if (++initialComponents > 256) this.fail("ENAMETOOLONG", syscall, path);
      }
    }
    const pending = path.split("/").filter(Boolean);
    let remainingComponents = 256 - pending.length;
    if (path.endsWith("/")) pending.push("");
    const stack: { node: MemoryNode; name: string }[] = [{ node: this.root, name: "" }];
    let recordedUnits = 0;
    const observe = (node: MemoryNode, entryPath: string): void => {
      if (!options.resolutionSteps) return;
      recordedUnits += entryPath.length + (node.type === "symlink" ? node.target.length : 0);
      if (options.resolutionSteps.length >= 4096 || recordedUnits > 1_048_576) this.fail("EFBIG", syscall, path);
      options.resolutionSteps.push({ path: entryPath, stat: this.snapshot(node), ...(node.type === "symlink" ? { linkTarget: node.target } : {}) });
    };
    observe(this.root, "/");
    let links = 0;
    while (pending.length > 0) {
      const component = pending.shift()!;
      const current = stack[stack.length - 1]!.node;
      if (current.type !== "directory") this.fail("ENOTDIR", syscall, path);
      if (!(component === "" && pending.length === 0 && options.resizeCreate !== undefined)) this.permission(current, 1, syscall, path);
      if (component === "." || component === "") continue;
      if (component === "..") {
        if (stack.length > 1) stack.pop();
        continue;
      }
      if (exceedsComponentByteLimit(component)) this.fail("ENAMETOOLONG", syscall, path);
      if (options.resizeCreate === true && pending.length === 1 && pending[0] === "") this.fail("EISDIR", syscall, path);
      let node = current.entries.get(component);
      if (!node && options.createDirectories !== undefined) {
        this.permission(current, 3, syscall, path);
        const mode = options.createDirectories;
        node = this.addNode(current, component, () => this.directory(mode), syscall, path);
      }
      if (!node) {
        if (options.allowMissing && pending.length === 0) {
          return { node, parent: current, name: component, path: [...stack.map((entry) => entry.name), component].join("/") };
        }
        this.fail("ENOENT", syscall, path);
      }
      if (options.resolutionSteps) observe(node, [...stack.map(entry => entry.name), component].join("/"));
      if (node.type === "symlink" && (options.followFinal !== false || pending.length > 0)) {
        if (++links > 40) this.fail("ELOOP", syscall, path);
        if (node.target.length > remainingPathUnits) this.fail("ENAMETOOLONG", syscall, path);
        remainingPathUnits -= node.target.length;
        const target = node.target.split("/").filter(Boolean);
        if (target.length > remainingComponents) this.fail("ENAMETOOLONG", syscall, path);
        remainingComponents -= target.length;
        if (node.target.endsWith("/")) target.push("");
        if (options.resizeCreate !== undefined && target.at(-1) === "" && pending[0] === "") target.pop();
        pending.unshift(...target);
        if (node.target.startsWith("/")) stack.splice(1);
        continue;
      }
      stack.push({ node, name: component });
    }
    const entry = stack[stack.length - 1]!;
    return {
      node: entry.node,
      parent: (stack[stack.length - 2]?.node ?? this.root) as DirectoryNode,
      name: entry.name,
      path: stack.map((part) => part.name).join("/") || "/",
    };
  }

  private file(path: string, syscall: string): FileNode {
    const cache = memoryCaches.get(this.ledger)!;
    if (this.symlinkCount === 0 && isCleanAbsolutePath(path)) {
      const fastDir = cache.lastFastDirNode;
      const fastPrefix = cache.lastFastDirPrefix;
      if (fastDir !== undefined && fastDir.nlink !== 0 && fastPrefix.length > 0 && path.startsWith(fastPrefix)) {
        const name = path.slice(fastPrefix.length);
        if (name.length > 0 && !name.includes("/")) {
          this.permission(fastDir, 1, syscall, path);
          if (exceedsComponentByteLimit(name)) this.fail("ENAMETOOLONG", syscall, path);
          const node = fastDir.entries.get(name);
          if (!node) this.fail("ENOENT", syscall, path);
          if (node.type !== "file") this.fail("EISDIR", syscall, path);
          return node;
        }
      }
      let current: DirectoryNode = this.root;
      let start = 1;
      while (true) {
        this.permission(current, 1, syscall, path);
        const slash = path.indexOf("/", start);
        if (slash === -1) {
          cache.clearWrites();
          cache.lastFastDirPrefix = path.slice(0, start);
          cache.lastFastDirNode = current;
          const name = path.slice(start);
          if (exceedsComponentByteLimit(name)) this.fail("ENAMETOOLONG", syscall, path);
          const node = current.entries.get(name);
          if (!node) this.fail("ENOENT", syscall, path);
          if (node.type !== "file") this.fail("EISDIR", syscall, path);
          return node;
        }
        const name = path.slice(start, slash);
        if (exceedsComponentByteLimit(name)) this.fail("ENAMETOOLONG", syscall, path);
        const next = current.entries.get(name);
        if (!next) this.fail("ENOENT", syscall, path);
        if (next.type !== "directory") this.fail("ENOTDIR", syscall, path);
        current = next;
        start = slash + 1;
      }
    }
    const node = this.resolve(path, syscall).node!;
    if (node.type !== "file") this.fail("EISDIR", syscall, path);
    return node;
  }

  private entry(path: string, syscall: string, allowMissing = false): Location {
    this.validatePath(path, syscall);
    const location = this.resolve(path.replace(/\/+$/, "") || "/", syscall, { followFinal: false, allowMissing });
    if (path.endsWith("/") && location.node && location.node.type !== "directory") this.fail("ENOTDIR", syscall, path);
    return location;
  }

  private terminalDot(path: string): boolean {
    return /(?:^|\/)\.{1,2}\/*$/.test(path);
  }

  private directoryNlink(node: DirectoryNode): number {
    if (node.cachedNlinkRev === node.revision && node.cachedNlink !== undefined) {
      return node.cachedNlink;
    }
    let nlink = 2;
    node.entries.forEach(entry => {
      if (entry.type === "directory") nlink++;
    });
    node.cachedNlinkRev = node.revision;
    node.cachedNlink = nlink;
    return nlink;
  }

  private snapshot(node: MemoryNode): FileStat {
    const hasRev = Number.isSafeInteger(node.revision);
    const hasScope = ownedStores.get(this)?.intact() === true;
    const size = node.type === "file" ? node.byteLength
      : node.type === "symlink" ? new TextEncoder().encode(node.target).byteLength : 0;
    const nlink = node.type === "directory" && node.nlink !== 0
      ? this.directoryNlink(node) : node.nlink;
    if (hasRev && hasScope) {
      return {
        type: node.type,
        filesystemType: "memory",
        ioBlockSize: preferredIoBlockSize,
        revision: node.revision,
        preferredIoBlockSize: 4096,
        size,
        mode: node.mode,
        identityScope: this.identityScope,
        ino: node.ino,
        dev: 0,
        uid: 0,
        gid: 0,
        nlink,
        atimeMs: node.atimeMs,
        mtimeMs: node.mtimeMs,
        ctimeMs: node.ctimeMs,
        birthtimeMs: node.birthtimeMs,
      };
    }
    return {
      type: node.type,
      filesystemType: "memory",
      ioBlockSize: preferredIoBlockSize,
      ...(hasRev ? { revision: node.revision } : {}),
      preferredIoBlockSize: 4096,
      size,
      mode: node.mode,
      ...(hasScope ? { identityScope: this.identityScope } : {}),
      ino: node.ino, dev: 0, uid: 0, gid: 0,
      nlink,
      atimeMs: node.atimeMs, mtimeMs: node.mtimeMs, ctimeMs: node.ctimeMs, birthtimeMs: node.birthtimeMs,
    };
  }

  private bytes(data: Uint8Array, syscall: string, path: string): MemoryAllocation {
    const allocation = this.allocate(data.byteLength, syscall, path);
    try {
      allocation.data.set(data);
      return allocation;
    } catch (error) {
      allocation.release();
      throw error;
    }
  }

  private allocate(length: number, syscall: string, path: string): MemoryAllocation {
    this.ledger.fileSize(length, syscall, path);
    this.ledger.reserve(length, 0, syscall, path);
    if (length === 0) {
      return new MemoryAllocation(EMPTY_ALLOC_BYTES, this.ledger);
    }
    const allocations = memoryCaches.get(this.ledger)!.allocations;
    if (length === 64 && allocations.length > 0) {
      const pooled = allocations.pop()!;
      pooled.reuse();
      return pooled;
    }
    if (length > 0 && length <= 64) {
      if (smallAllocOffset + length > SMALL_ALLOC_SLAB_SIZE) {
        smallAllocSlab = new Uint8Array(SMALL_ALLOC_SLAB_SIZE);
        smallAllocOffset = 0;
      }
      const slice = smallAllocSlab.subarray(smallAllocOffset, smallAllocOffset + length);
      smallAllocOffset += length;
      return new MemoryAllocation(slice, this.ledger);
    }
    try {
      return new MemoryAllocation(new Uint8Array(length), this.ledger);
    } catch (cause) {
      this.ledger.release(length, 0);
      throw new FsError("EFBIG", { syscall, path, cause });
    }
  }

  open(path: string, options: OpenFileOptions): Promise<FileDescriptor> {
    return openFileDescriptor<{ fs: MemoryFileSystem; path: string; append: boolean; node: FileNode | undefined; position: number }>(path, options, MEMORY_DESCRIPTOR_CAPABILITIES, async admitted => {
      const location = this.resolve(path, "open", {
        followFinal: !admitted.noFollow && admitted.creation !== "exclusive", allowMissing: admitted.creation !== "never",
      });
      let node = location.node;
      if (node) {
        if (admitted.creation === "exclusive") this.fail("EEXIST", "open", path);
        if (node.type === "symlink" && admitted.noFollow) this.fail("ELOOP", "open", path);
        if (node.type !== "file") this.fail("EISDIR", "open", path);
        this.permission(node, admitted.access === "read" ? 4 : admitted.access === "write" ? 2 : 6, "open", path);
      } else {
        this.permission(location.parent, 3, "open", path);
      }
      this.ledger.reserve(path.length * 2, 1, "open", path);
      try {
        node ??= this.openWrite(path, {}, "open", { location, mode: admitted.mode, append: false });
        if (admitted.truncate) this.resizeNode(node, 0, "open", path);
      } catch (error) {
        this.ledger.release(path.length * 2, 1);
        throw error;
      }
      node.references++;
      const resource = { fs: this, path, append: admitted.append, node, position: 0 };
      return {
        resource,
        getPosition: memoryDescriptorGetPosition,
        stat: memoryDescriptorStat,
        read: memoryDescriptorRead,
        write: memoryDescriptorWrite,
        truncate: memoryDescriptorTruncate,
        sync: memoryDescriptorSync,
        close: memoryDescriptorClose,
      };
    });
  }

  private prepareWrite(path: string, options: WriteFileOptions, syscall: string): WriteTarget {
    const flag = options.flag ?? "w";
    if (!["w", "wx", "a", "ax"].includes(flag)) this.fail("EINVAL", syscall, path);
    const mode = this.mode(options.mode, 0o666, syscall, path);
    const exclusive = flag === "wx" || flag === "ax";
    const location = this.resolve(path, syscall, { followFinal: !exclusive, allowMissing: true });
    if (location.node) {
      if (exclusive) this.fail("EEXIST", syscall, path);
      if (location.node.type !== "file") this.fail("EISDIR", syscall, path);
      this.permission(location.node, 2, syscall, path);
    } else {
      this.permission(location.parent, 3, syscall, path);
    }
    return { location, mode, append: flag === "a" || flag === "ax" };
  }

  private openWrite(path: string, options: WriteFileOptions, syscall: string,
    target = this.prepareWrite(path, options, syscall)): FileNode {
    const { location, mode } = target;
    if (location.node) return location.node as FileNode;
    return this.addNode(location.parent, location.name, (): FileNode => {
      const allocation = new MemoryAllocation(new Uint8Array(), this.ledger);
      const meta = this.metadata(typeModes.file | mode);
      return new MemoryFileNode(meta.mode, meta.ino, meta.atimeMs, 0, allocation, allocation.data);
    }, syscall, path);
  }

  private writeData(path: string, data: Uint8Array, options: WriteFileOptions, syscall: string): FileNode {
    if (!(data instanceof Uint8Array)) throw new TypeError("Memory files require Uint8Array data");
    const target = this.prepareWrite(path, options, syscall);
    const current = target.location.node as FileNode | undefined;
    const length = (target.append ? current?.byteLength ?? 0 : 0) + data.byteLength;
    this.admitSize(current, length, syscall, path);
    const growth = target.append && length > (current?.allocation.data.byteLength ?? 0) ? length : 0;
    this.ledger.check(data.byteLength + growth + (current ? 0 : target.location.name.length * 2), current ? 0 : 2, syscall, path);
    if (current && target.append) {
      this.writeAt(current, data, current.byteLength, syscall, path);
      return current;
    }
    if (!current) {
      const capacity = length > 0 && (target.append || (length < 64 && this.ledger.availableBytes > 65536 && this.ledger.limits.maxFileBytes >= 64))
        ? Math.min(Math.max(length, 64), this.ledger.limits.maxFileBytes,
          this.ledger.availableBytes - target.location.name.length * 2)
        : length;
      const allocation = this.allocate(capacity, syscall, path);
      try {
        allocation.data.set(data);
        return this.addNode(target.location.parent, target.location.name, (): FileNode => {
          const now = Date.now();
          const fileMode = typeModes.file | target.mode;
          const view = capacity === length ? allocation.data : undefined;
          const pooled = memoryCaches.get(this.ledger)!.files.pop();
          if (pooled) {
            pooled.mode = fileMode;
            pooled.ino = this.nextInode++;
            pooled.nlink = 1;
            pooled.references = 0;
            pooled.revision = 0;
            pooled.atimeMs = now;
            pooled.mtimeMs = now;
            pooled.ctimeMs = now;
            pooled.birthtimeMs = now;
            pooled.byteLength = length;
            pooled.view = view;
            pooled.allocation = allocation;
            return pooled;
          }
          return new MemoryFileNode(fileMode, this.nextInode++, now, length, allocation, view);
        }, syscall, path);
      } catch (error) {
        allocation.release();
        throw error;
      }
    }
    const copied = this.bytes(data, syscall, path);
    try {
      this.replaceData(current, copied);
      this.changed(current);
      return current;
    } catch (error) {
      copied.release();
      throw error;
    }
  }

  private writeAt(node: FileNode, data: Uint8Array, position: number, syscall: string, path: string): void {
    if (data.byteLength === 0) {
      this.changed(node);
      return;
    }
    const end = position + data.byteLength;
    this.ledger.fileSize(end, syscall, path);
    const curLen = node.byteLength;
    const length = Math.max(curLen, end);
    this.admitSize(node, length, syscall, path);
    let allocation = node.allocation;
    if (length > allocation.data.byteLength) {
      this.ledger.check(length, 0, syscall, path);
      const capacity = Math.min(Math.max(length, curLen * 2, 64),
        this.ledger.limits.maxFileBytes, this.ledger.availableBytes);
      allocation = this.allocate(capacity, syscall, path);
    }
    try {
      const storage = allocation.data;
      if (allocation !== node.allocation) storage.set(node.view ?? (curLen === node.allocation.data.byteLength ? node.allocation.data : node.allocation.data.subarray(0, curLen)));
      if (position > curLen) storage.fill(0, curLen, position);
      storage.set(data, position);
    } catch (error) {
      if (allocation !== node.allocation) allocation.release();
      throw error;
    }
    if (allocation !== node.allocation) this.replaceData(node, allocation, length);
    else {
      this.totalBytes += length - curLen;
      node.byteLength = length;
      node.view = length === allocation.data.byteLength ? allocation.data : undefined;
    }
    this.changed(node);
  }

  writeMemoryFileFast(path: string, data: Uint8Array, append: boolean, mode: number): void {
    const cache = memoryCaches.get(this.ledger)!;
    const syscall = append ? "appendFile" : "writeFile";
    if (
      append &&
      path === cache.lastFastFilePath &&
      cache.lastFastFileNode !== undefined &&
      cache.lastFastFileNode.nlink !== 0 &&
      cache.lastFastDirNode !== undefined &&
      cache.lastFastDirNode.nlink !== 0 &&
      (cache.lastFastDirNode.mode & 1) !== 0 &&
      (cache.lastFastFileNode.mode & 2) !== 0
    ) {
      const current = cache.lastFastFileNode;
      const length = current.byteLength + data.byteLength;
      this.admitSize(current, length, syscall, path);
      const growth = length > current.allocation.data.byteLength ? length : 0;
      this.ledger.check(data.byteLength + growth, 0, syscall, path);
      this.writeAt(current, data, current.byteLength, syscall, path);
      return;
    }
    let parent: DirectoryNode = this.root;
    let start = 1;
    let name = "";
    const cachedPrefix = cache.lastFastDirPrefix;
    const cachedDir = cache.lastFastDirNode;
    if (
      cachedDir !== undefined &&
      cachedDir.nlink !== 0 &&
      (cachedDir.mode & 1) !== 0 &&
      cachedPrefix.length > 1 &&
      path.startsWith(cachedPrefix) &&
      path.indexOf("/", cachedPrefix.length) === -1
    ) {
      parent = cachedDir;
      name = path.slice(cachedPrefix.length);
      if (exceedsComponentByteLimit(name)) this.fail("ENAMETOOLONG", syscall, path);
    } else {
      while (true) {
        this.permission(parent, 1, syscall, path);
        const slash = path.indexOf("/", start);
        if (slash === -1) {
          name = path.slice(start);
          if (exceedsComponentByteLimit(name)) this.fail("ENAMETOOLONG", syscall, path);
          if (start > 1 && (parent.mode & 1) !== 0) {
            cache.lastFastDirPrefix = path.slice(0, start);
            cache.lastFastDirNode = parent;
          }
          break;
        }
        const seg = path.slice(start, slash);
        if (exceedsComponentByteLimit(seg)) this.fail("ENAMETOOLONG", syscall, path);
        const next = parent.entries.get(seg);
        if (!next) this.fail("ENOENT", syscall, path);
        if (next.type !== "directory") this.fail("ENOTDIR", syscall, path);
        parent = next;
        start = slash + 1;
      }
    }
    const existing = parent.entries.get(name);
    if (existing) {
      if (existing.type !== "file") this.fail("EISDIR", syscall, path);
      this.permission(existing, 2, syscall, path);
    } else {
      this.permission(parent, 3, syscall, path);
    }
    const current = existing as FileNode | undefined;
    const length = (append ? current?.byteLength ?? 0 : 0) + data.byteLength;
    this.admitSize(current, length, syscall, path);
    const growth = append && length > (current?.allocation.data.byteLength ?? 0) ? length : 0;
    const nameBytes = name.length * 2;
    this.ledger.check(data.byteLength + growth + (current ? 0 : nameBytes), current ? 0 : 2, syscall, path);
    if (current && append) {
      this.writeAt(current, data, current.byteLength, syscall, path);
      cache.lastFastFilePath = path;
      cache.lastFastFileName = name;
      cache.lastFastFileNode = current;
      return;
    }
    if (!current) {
      const capacity = length;
      const allocation = this.allocate(capacity, syscall, path);
      try {
        allocation.data.set(data);
        this.ledger.reserve(nameBytes, 2, syscall, path);
        try {
          const now = Date.now();
          const fileMode = typeModes.file | mode;
          const view = allocation.data;
          let node = cache.files.pop();
          if (node) {
            node.mode = fileMode;
            node.ino = this.nextInode++;
            node.nlink = 1;
            node.references = 0;
            node.revision = 0;
            node.atimeMs = now;
            node.mtimeMs = now;
            node.ctimeMs = now;
            node.birthtimeMs = now;
            node.byteLength = length;
            node.view = view;
            node.allocation = allocation;
          } else {
            node = new MemoryFileNode(fileMode, this.nextInode++, now, length, allocation, view);
          }
          const prevNlink = parent.cachedNlinkRev === parent.revision ? parent.cachedNlink : (parent.entries.size === 0 ? 2 : undefined);
          parent.entries.set(name, node);
          this.totalBytes += length;
          this.changed(parent, now);
          if (prevNlink !== undefined) {
            parent.cachedNlink = prevNlink;
            parent.cachedNlinkRev = parent.revision;
          }
          cache.lastFastFilePath = path;
          cache.lastFastFileName = name;
          cache.lastFastFileNode = node;
        } catch (error) {
          this.ledger.release(nameBytes, 2);
          throw error;
        }
      } catch (error) {
        allocation.release();
        throw error;
      }
      return;
    }
    const copied = this.bytes(data, syscall, path);
    try {
      this.replaceData(current, copied);
      this.changed(current);
      cache.lastFastFilePath = path;
      cache.lastFastFileName = name;
      cache.lastFastFileNode = current;
    } catch (error) {
      copied.release();
      throw error;
    }
  }

  writeMemoryFileInDirFast(dirPrefix: string, name: string, data: Uint8Array, append: boolean, mode: number): void {
    const cache = memoryCaches.get(this.ledger)!;
    const syscall = append ? "appendFile" : "writeFile";
    try {
      if (
        append &&
        dirPrefix === cache.lastFastDirPrefix &&
        name === cache.lastFastFileName &&
        cache.lastFastFileNode !== undefined &&
        cache.lastFastFileNode.nlink !== 0 &&
        cache.lastFastDirNode !== undefined &&
        cache.lastFastDirNode.nlink !== 0 &&
        (cache.lastFastDirNode.mode & 1) !== 0 &&
        (cache.lastFastFileNode.mode & 2) !== 0
      ) {
        const current = cache.lastFastFileNode;
        const length = current.byteLength + data.byteLength;
        this.admitSize(current, length, syscall, name);
        const growth = length > current.allocation.data.byteLength ? length : 0;
        this.ledger.check(data.byteLength + growth, 0, syscall, name);
        this.writeAt(current, data, current.byteLength, syscall, name);
        return;
      }
      let parent: DirectoryNode = this.root;
      const cachedDir = cache.lastFastDirNode;
      if (
        cachedDir !== undefined &&
        cachedDir.nlink !== 0 &&
        (cachedDir.mode & 1) !== 0 &&
        dirPrefix === cache.lastFastDirPrefix
      ) {
        parent = cachedDir;
        if (exceedsComponentByteLimit(name)) this.fail("ENAMETOOLONG", syscall, name);
      } else {
        let start = 1;
        while (start < dirPrefix.length) {
          this.permission(parent, 1, syscall, name);
          const slash = dirPrefix.indexOf("/", start);
          const seg = slash === -1 ? dirPrefix.slice(start) : dirPrefix.slice(start, slash);
          if (exceedsComponentByteLimit(seg)) this.fail("ENAMETOOLONG", syscall, name);
          const next = parent.entries.get(seg);
          if (!next) this.fail("ENOENT", syscall, name);
          if (next.type !== "directory") this.fail("ENOTDIR", syscall, name);
          parent = next;
          if (slash === -1) break;
          start = slash + 1;
        }
        this.permission(parent, 1, syscall, name);
        if (exceedsComponentByteLimit(name)) this.fail("ENAMETOOLONG", syscall, name);
        if (dirPrefix.length > 1 && (parent.mode & 1) !== 0) {
          cache.lastFastDirPrefix = dirPrefix;
          cache.lastFastDirNode = parent;
        }
      }
      const existing = parent.entries.get(name);
      if (existing) {
        if (existing.type !== "file") this.fail("EISDIR", syscall, name);
        this.permission(existing, 2, syscall, name);
      } else {
        this.permission(parent, 3, syscall, name);
      }
      const current = existing as FileNode | undefined;
      const length = (append ? current?.byteLength ?? 0 : 0) + data.byteLength;
      this.admitSize(current, length, syscall, name);
      const growth = append && length > (current?.allocation.data.byteLength ?? 0) ? length : 0;
      const nameBytes = name.length * 2;
      this.ledger.check(data.byteLength + growth + (current ? 0 : nameBytes), current ? 0 : 2, syscall, name);
      if (current && append) {
        this.writeAt(current, data, current.byteLength, syscall, name);
        cache.lastFastFilePath = "";
        cache.lastFastFileName = name;
        cache.lastFastFileNode = current;
        return;
      }
      if (!current) {
        const capacity = length;
        const allocation = this.allocate(capacity, syscall, name);
        try {
          allocation.data.set(data);
          this.ledger.reserve(nameBytes, 2, syscall, name);
          try {
            const now = Date.now();
            const fileMode = typeModes.file | mode;
            const view = allocation.data;
            let node = cache.files.pop();
            if (node) {
              node.mode = fileMode;
              node.ino = this.nextInode++;
              node.nlink = 1;
              node.references = 0;
              node.revision = 0;
              node.atimeMs = now;
              node.mtimeMs = now;
              node.ctimeMs = now;
              node.birthtimeMs = now;
              node.byteLength = length;
              node.view = view;
              node.allocation = allocation;
            } else {
              node = new MemoryFileNode(fileMode, this.nextInode++, now, length, allocation, view);
            }
            const prevNlink = parent.cachedNlinkRev === parent.revision ? parent.cachedNlink : (parent.entries.size === 0 ? 2 : undefined);
            parent.entries.set(name, node);
            this.totalBytes += length;
            this.changed(parent, now);
            if (prevNlink !== undefined) {
              parent.cachedNlink = prevNlink;
              parent.cachedNlinkRev = parent.revision;
            }
            cache.lastFastFilePath = "";
            cache.lastFastFileName = name;
            cache.lastFastFileNode = node;
          } catch (error) {
            this.ledger.release(nameBytes, 2);
            throw error;
          }
        } catch (error) {
          allocation.release();
          throw error;
        }
        return;
      }
      const copied = this.bytes(data, syscall, name);
      try {
        this.replaceData(current, copied);
        this.changed(current);
        cache.lastFastFilePath = "";
        cache.lastFastFileName = name;
        cache.lastFastFileNode = current;
      } catch (error) {
        copied.release();
        throw error;
      }
    } catch (error) {
      if (error instanceof FsError && error.path === name) {
        throw new FsError(error.code, {
          syscall: error.syscall ?? syscall,
          path: dirPrefix + name,
          ...(error.dest === undefined ? {} : { dest: error.dest }),
        });
      }
      throw error;
    }
  }

  async readFile(path: string, options: ReadFileOptions = {}): Promise<Uint8Array> {
    options.signal?.throwIfAborted();
    if (options.maxBytes !== undefined) this.integer(options.maxBytes, "readFile", path);
    const node = this.file(path, "readFile");
    this.permission(node, 4, "readFile", path);
    if (options.maxBytes !== undefined && node.data.byteLength > options.maxBytes) this.fail("EFBIG", "readFile", path);
    node.atimeMs = Date.now();
    return new Uint8Array(node.data);
  }

  private expectEntry(node: MemoryNode | undefined, expected: FileStat | null, path: string, unchanged = true): void {
    if (expected === null) {
      if (node) this.fail("EAGAIN", "fileStaging", path);
      return;
    }
    if (!node) this.fail("EAGAIN", "fileStaging", path);
    if (!unchanged) {
      const currentScope = ownedStores.get(this)?.intact() ? this.identityScope : undefined;
      if (!expected.identityScope || expected.identityScope !== currentScope
        || !Number.isSafeInteger(expected.ino) || !Number.isSafeInteger(expected.dev)) this.fail("ENOTSUP", "fileStaging", path);
      if (node.ino !== expected.ino || expected.dev !== 0 || node.type !== expected.type) this.fail("EAGAIN", "fileStaging", path);
      return;
    }
    const current = this.snapshot(node);
    if (!expected.identityScope || expected.identityScope !== current.identityScope
      || !Number.isSafeInteger(expected.ino) || !Number.isSafeInteger(expected.dev)) this.fail("ENOTSUP", "fileStaging", path);
    if (current.ino !== expected.ino || current.dev !== expected.dev || current.type !== expected.type) this.fail("EAGAIN", "fileStaging", path);
    if (!Number.isSafeInteger(expected.revision) || !Number.isSafeInteger(current.revision)) this.fail("ENOTSUP", "fileStaging", path);
    if (current.revision !== expected.revision || current.size !== expected.size || current.mode !== expected.mode
      || current.nlink !== expected.nlink || current.mtimeMs !== expected.mtimeMs || current.ctimeMs !== expected.ctimeMs) this.fail("EAGAIN", "fileStaging", path);
  }

  private stagingLocations(staging: FileStaging): { directory: Location; file: Location } {
    const parent = this.entry(staging.parent.path, "fileStaging");
    this.expectEntry(parent.node, staging.parent.stat, staging.parent.path, false);
    if (parent.node!.type !== "directory") this.fail("ENOTDIR", "fileStaging", staging.parent.path);
    const directory = this.entry(staging.directory.path, "fileStaging");
    this.expectEntry(directory.node, staging.directory.stat, staging.directory.path, false);
    if (directory.parent !== parent.node || directory.node!.type !== "directory" || (directory.node!.mode & 0o777) !== 0o700) this.fail("EAGAIN", "fileStaging", staging.directory.path);
    const file = this.entry(staging.file.path, "fileStaging", true);
    if (file.parent !== directory.node || !["file", "symlink"].includes(staging.file.stat.type)) this.fail("EAGAIN", "fileStaging", staging.file.path);
    return { directory, file };
  }

  async createStagedFile(directoryPath: string, name: string, content: StagedFileContent, options: CreateStagedFileOptions): Promise<FileStaging> {
    options = snapshotStagingCreation(options, directoryPath);
    options.signal?.throwIfAborted();
    if (options.retainCleanup === true && this.capabilities.retainedStagingCleanup !== true) this.fail("ENOTSUP", "createStagedFile", directoryPath);
    if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\0")) this.fail("EINVAL", "createStagedFile", directoryPath);
    const location = this.entry(directoryPath, "createStagedFile", true);
    if (location.node) this.fail("EEXIST", "createStagedFile", directoryPath);
    this.expectEntry(location.parent, options.parent, directoryPath, false);
    this.permission(location.parent, 3, "createStagedFile", directoryPath);
    const mode = this.mode(options.mode, content.type === "file" ? 0o666 : 0o777, "createStagedFile", directoryPath);
    for (const time of [options.atimeMs, options.mtimeMs]) if (time !== undefined && !Number.isFinite(time)) this.fail("EINVAL", "createStagedFile", directoryPath);
    if (content.type === "file" && !(content.data instanceof Uint8Array)) throw new TypeError("Staged files require Uint8Array data");
    if (content.type === "file") this.admitSize(undefined, content.data.byteLength, "createStagedFile", directoryPath);
    if (content.type === "symlink") this.validatePath(content.target, "createStagedFile");
    const retained = (location.name.length + name.length) * 2 + (content.type === "symlink" ? content.target.length * 2 : 0);
    const parentPath = location.path.slice(0, location.path.lastIndexOf("/")) || "/";
    const filePath = `${location.path}/${name}`;
    const cleanupBytes = options.retainCleanup ? (parentPath.length + location.path.length + filePath.length) * 2 : 0;
    const cleanupUnits = options.retainCleanup ? 3 : 0;
    this.ledger.reserve(retained + cleanupBytes, 4 + cleanupUnits, "createStagedFile", directoryPath);
    let allocation: MemoryAllocation | undefined;
    let directory: DirectoryNode;
    let file: FileNode | SymlinkNode;
    try {
      if (content.type === "file") allocation = this.bytes(content.data, "createStagedFile", directoryPath);
      directory = this.directory(0o700);
      file = content.type === "file"
        ? (() => { const m = this.metadata(typeModes.file | mode); return new MemoryFileNode(m.mode, m.ino, m.atimeMs, allocation!.data.byteLength, allocation!, allocation!.data); })()
        : { ...this.metadata(typeModes.symlink | mode), type: "symlink", target: content.target };
      if (options.atimeMs !== undefined) file.atimeMs = options.atimeMs;
      if (options.mtimeMs !== undefined) file.mtimeMs = options.mtimeMs;
      directory.entries.set(name, file);
      location.parent.entries.set(location.name, directory);
      if (file.type === "file") this.totalBytes += file.data.byteLength;
    } catch (error) { allocation?.release(); this.ledger.release(retained + cleanupBytes, 4 + cleanupUnits); throw error; }
    this.changed(location.parent);
    const receipt = (path: string, node: MemoryNode) => Object.freeze({ path, stat: Object.freeze(this.snapshot(node)) });
    const staging = Object.freeze({ parent: receipt(parentPath, location.parent), directory: receipt(location.path, directory), file: receipt(filePath, file) });
    if (!options.retainCleanup) return staging;
    // Reservations above include these references before either entry is exposed.
    location.parent.references++; directory.references++; file.references++;
    return Object.freeze({ ...staging, cleanup: this.retainStagingCleanup(staging, location.parent, directory, file, location.name, name) });
  }

  private retainStagingCleanup(staging: FileStaging, parent: DirectoryNode, directory: DirectoryNode,
    file: FileNode | SymlinkNode, directoryName: string, fileName: string): FileStagingCleanup {
    // Clear this state on release, so keeping the closed handle does not keep
    // detached nodes alive outside the Memory ledger.
    let retained: { parent: DirectoryNode; directory: DirectoryNode; file: FileNode | SymlinkNode } | undefined = { parent, directory, file };
    return createStagingCleanup(staging.directory.path, options => {
      options.signal?.throwIfAborted();
      const state = retained!;
      if (state.parent.nlink === 0 || state.parent.entries.get(directoryName) !== state.directory) this.fail("EAGAIN", "removeStagedFile", staging.directory.path);
      this.expectEntry(state.parent, staging.parent.stat, staging.parent.path, false);
      this.expectEntry(state.directory, staging.directory.stat, staging.directory.path, false);
      if ((state.directory.mode & 0o777) !== 0o700) this.fail("EAGAIN", "removeStagedFile", staging.directory.path);
      const child = state.directory.entries.get(fileName);
      if (child && child !== state.file) this.fail("EAGAIN", "removeStagedFile", staging.file.path);
      this.removeStagingLocations(staging, {
        node: state.directory, parent: state.parent, name: directoryName, path: staging.directory.path,
      }, { node: child, parent: state.directory, name: fileName, path: staging.file.path });
    }, () => {
      const state = retained!;
      retained = undefined;
      this.releaseReference(state.file, staging.file.path);
      this.releaseReference(state.directory, staging.directory.path);
      this.releaseReference(state.parent, staging.parent.path);
    });
  }

  async prepareDirectoryAncestry(ancestors: readonly FileStagingEntry[], options: FsOptions = {}): Promise<() => true> {
    const entries = snapshotDirectoryAncestry(ancestors);
    const controls: FsOptions = options.signal === undefined ? {} : { signal: options.signal };
    controls.signal?.throwIfAborted();
    return () => this.verifyDirectoryAncestry(entries, controls);
  }

  async prepareStagingResolution(path: string, options: FsOptions = {}): Promise<FileStagingResolution> {
    const controls: FsOptions = options.signal === undefined ? {} : { signal: options.signal };
    controls.signal?.throwIfAborted();
    this.validatePath(path, "prepareStagingResolution");
    if (!path.startsWith("/") || normalizePath(path) !== path) this.fail("EINVAL", "prepareStagingResolution", path);
    const traversed: FileResolutionStep[] = [];
    const location = this.resolve(path, "prepareStagingResolution", { followFinal: false, allowMissing: true, resolutionSteps: traversed });
    if (location.node && location.node.type !== "file") this.fail("ENOTSUP", "prepareStagingResolution", path);
    const parentPath = location.path.slice(0, location.path.lastIndexOf("/")) || "/";
    const ancestors = snapshotDirectoryAncestry(directoryAncestryPaths(parentPath).map(entryPath => ({
      path: entryPath, stat: this.snapshot(this.entry(entryPath, "prepareStagingResolution").node!),
    })));
    const steps = traversed.map(entry => ({ ...entry, stat: { ...entry.stat } }));
    const canonical = location.path;
    const destination = location.node ? this.snapshot(location.node) : null;
    const validate = (): true => {
      controls.signal?.throwIfAborted();
      const currentSteps: FileResolutionStep[] = [];
      let current: Location;
      try { current = this.resolve(path, "verifyStagingResolution", { followFinal: false, allowMissing: true, resolutionSteps: currentSteps }); }
      catch (error) {
        if (error instanceof FsError && ["ENOENT", "ENOTDIR", "ELOOP"].includes(error.code)) this.fail("EAGAIN", "verifyStagingResolution", path);
        throw error;
      }
      if (current.path !== canonical || steps.length !== currentSteps.length) this.fail("EAGAIN", "verifyStagingResolution", path);
      for (const [index, before] of steps.entries()) {
        const after = currentSteps[index]!;
        if (before.path !== after.path || before.linkTarget !== after.linkTarget || before.stat.type !== after.stat.type
          || compareIdentity(before.stat, after.stat) !== "same"
          || before.stat.type !== "directory" && (["revision", "size", "mode", "nlink", "mtimeMs", "ctimeMs"] as const).some(field => before.stat[field] !== after.stat[field])) {
          this.fail("EAGAIN", "verifyStagingResolution", before.path);
        }
      }
      this.expectEntry(current.node, destination, path);
      return this.verifyDirectoryAncestry(ancestors, controls);
    };
    return snapshotStagingResolution({ path: canonical, parent: this.snapshot(location.parent), destination, ancestors, traversed: steps, validate });
  }

  private verifyDirectoryAncestry(ancestors: readonly FileStagingEntry[], options: FsOptions): true {
    const entries = snapshotDirectoryAncestry(ancestors);
    options.signal?.throwIfAborted();
    let node: MemoryNode | undefined = this.root;
    for (const [index, expected] of entries.entries()) {
      if (index > 0) node = (node as DirectoryNode).entries.get(expected.path.slice(expected.path.lastIndexOf("/") + 1));
      if (node?.type !== "directory") this.fail("EAGAIN", "verifyDirectoryAncestry", expected.path);
      this.expectEntry(node, expected.stat, expected.path, false);
      this.permission(node, 1, "verifyDirectoryAncestry", expected.path);
    }
    return true;
  }

  async publishStagedFile(receipt: FileStaging, destination: string, options: PublishStagedFileOptions): Promise<void> {
    const signal = options.signal;
    const guard = options.commitGuard;
    const ancestors = options.ancestors === undefined ? undefined : snapshotDirectoryAncestry(options.ancestors);
    const snapshot = (entry: FileStagingEntry): FileStagingEntry => ({ path: entry.path, stat: { ...entry.stat } });
    const staging = { parent: snapshot(receipt.parent), directory: snapshot(receipt.directory), file: snapshot(receipt.file) };
    const parent = { ...options.parent };
    const expected = options.destination === null ? null : { ...options.destination };
    const parentPath = destination.slice(0, destination.lastIndexOf("/")) || "/";
    if (ancestors && ancestors.at(-1)?.path !== parentPath) this.fail("EINVAL", "publishStagedFile", destination);
    const controls: FsOptions = signal === undefined ? {} : { signal };
    signal?.throwIfAborted();
    if (guard !== undefined) runStagingGuard(guard);
    signal?.throwIfAborted();
    // All inputs were copied before the guard. Neither outer validation nor
    // these local checks yield before the stock rename commits.
    if (ancestors) runStagingGuard(() => this.verifyDirectoryAncestry(ancestors, controls));
    const { directory, file } = this.stagingLocations(staging);
    this.expectEntry(file.node, staging.file.stat, staging.file.path);
    const target = this.entry(destination, "publishStagedFile", true);
    this.expectEntry(target.parent, parent, destination, false);
    this.expectEntry(target.node, expected, destination);
    if (target.parent === directory.node || target.node === directory.node || target.node === file.node) this.fail("EINVAL", "publishStagedFile", destination);
    if (target.node && target.node.type !== "file") this.fail("EAGAIN", "publishStagedFile", destination);
    return MemoryFileSystem.prototype.rename.call(this, staging.file.path, destination, { ...controls, noReplace: expected === null });
  }

  async removeStagedFile(staging: FileStaging, options: FsOptions = {}): Promise<void> {
    options.signal?.throwIfAborted();
    const { directory, file } = this.stagingLocations(staging);
    this.removeStagingLocations(staging, directory, file);
  }

  private removeStagingLocations(staging: FileStaging, directory: Location, file: Location): void {
    if (file.node) this.expectEntry(file.node, staging.file.stat, staging.file.path);
    const node = directory.node as DirectoryNode;
    if (node.entries.size !== (file.node ? 1 : 0)) this.fail("ENOTEMPTY", "removeStagedFile", staging.directory.path);
    this.permission(directory.parent, 3, "removeStagedFile", staging.directory.path);
    this.permission(node, 3, "removeStagedFile", staging.file.path);
    directory.parent.entries.delete(directory.name);
    if (file.node) {
      node.entries.delete(file.name);
      this.ledger.release(file.name.length * 2, 1);
      file.node.nlink--;
      file.node.ctimeMs = Date.now();
      file.node.revision = Math.min(Number.MAX_SAFE_INTEGER + 1, file.node.revision + 1);
      this.releaseNode(file.node);
    }
    this.ledger.release(directory.name.length * 2, 1);
    node.nlink = 0;
    node.ctimeMs = Date.now();
    node.revision = Math.min(Number.MAX_SAFE_INTEGER + 1, node.revision + 1);
    this.releaseNode(node);
    this.changed(directory.parent);
  }

  async prepareDirectory(path: string, options: PrepareDirectoryOptions): Promise<FileStat> {
    options.signal?.throwIfAborted();
    const location = this.entry(path, "prepareDirectory", true);
    this.expectEntry(location.parent, options.parent, path, false);
    this.expectEntry(location.node, options.expected, path, false);
    const mode = options.mode === undefined ? undefined : this.mode(options.mode, 0, "prepareDirectory", path);
    for (const time of [options.atimeMs, options.mtimeMs]) if (time !== undefined && !Number.isFinite(time)) this.fail("EINVAL", "prepareDirectory", path);
    let node = location.node;
    if (!node) {
      this.permission(location.parent, 3, "prepareDirectory", path);
      node = this.addNode(location.parent, location.name, () => this.directory(mode ?? 0o777), "prepareDirectory", path);
    }
    if (node.type !== "directory") this.fail("ENOTDIR", "prepareDirectory", path);
    if (mode !== undefined) {
      node.mode = typeModes.directory | mode;
      memoryCaches.get(this.ledger)!.clearWrites();
    }
    if (options.atimeMs !== undefined) node.atimeMs = options.atimeMs;
    if (options.mtimeMs !== undefined) node.mtimeMs = options.mtimeMs;
    node.ctimeMs = Date.now();
    node.revision = Math.min(Number.MAX_SAFE_INTEGER + 1, node.revision + 1);
    return Object.freeze(this.snapshot(node));
  }

  async writeFileConditional(path: string, data: Uint8Array, options: ConditionalWriteFileOptions): Promise<FileStat> {
    options.signal?.throwIfAborted();
    const location = this.entry(path, "writeFileConditional", true);
    this.expectEntry(location.parent, options.parent, path, false);
    this.expectEntry(location.node, options.expected, path);
    if (location.node && location.node.type !== "file") this.fail("EINVAL", "writeFileConditional", path);
    if (options.atimeMs !== undefined) this.integer(options.atimeMs, "writeFileConditional", path);
    if (options.mtimeMs !== undefined) this.integer(options.mtimeMs, "writeFileConditional", path);
    const node = this.writeData(path, data, { ...(options.mode === undefined ? {} : { mode: options.mode }), flag: options.append ? "a" : "w" }, "writeFileConditional");
    if (options.atimeMs !== undefined) node.atimeMs = options.atimeMs;
    if (options.mtimeMs !== undefined) node.mtimeMs = options.mtimeMs;
    return Object.freeze(this.snapshot(node));
  }

  removeEntryConditional(path: string, options: ConditionalRemoveEntryOptions & { readonly returnRemainingStat?: false | undefined }): Promise<void>;
  removeEntryConditional(path: string, options: ConditionalRemoveEntryReceiptOptions): Promise<void | FileStat>;
  async removeEntryConditional(path: string, options: ConditionalRemoveEntryReceiptOptions): Promise<void | FileStat> {
    options.signal?.throwIfAborted();
    const returnRemainingStat = options.returnRemainingStat === true;
    const location = this.entry(path, "removeEntryConditional", true);
    this.expectEntry(location.parent, options.parent, path, false);
    this.expectEntry(location.node, options.expected, path);
    const node = location.node!;
    if (this.terminalDot(path)) this.fail("EINVAL", "removeEntryConditional", path);
    if (node === this.root) this.fail("EBUSY", "removeEntryConditional", path);
    if (node.type !== "file" && node.type !== "symlink" && node.type !== "directory") this.fail("EINVAL", "removeEntryConditional", path);
    this.permission(location.parent, 3, "removeEntryConditional", path);
    if (node.type === "directory" && node.entries.size > 0) this.fail("ENOTEMPTY", "removeEntryConditional", path);
    location.parent.entries.delete(location.name);
    memoryCaches.get(this.ledger)!.clearWrites();
    this.ledger.release(location.name.length * 2, 1);
    node.nlink--;
    node.ctimeMs = Date.now();
    node.revision = Math.min(Number.MAX_SAFE_INTEGER + 1, node.revision + 1);
    this.releaseNode(node);
    this.changed(location.parent);
    if (returnRemainingStat) return Object.freeze(this.snapshot(node));
  }

  async removeFileConditional(path: string, options: ConditionalRemoveFileOptions): Promise<void> {
    options.signal?.throwIfAborted();
    const location = this.entry(path, "removeFileConditional", true);
    this.expectEntry(location.parent, options.parent, path, false);
    this.expectEntry(location.node, options.expected, path);
    const node = location.node!;
    if (node.type !== "file") this.fail("EINVAL", "removeFileConditional", path);
    this.permission(location.parent, 3, "removeFileConditional", path);
    location.parent.entries.delete(location.name);
    memoryCaches.get(this.ledger)!.clearWrites();
    this.ledger.release(location.name.length * 2, 1);
    node.nlink--;
    node.ctimeMs = Date.now();
    node.revision = Math.min(Number.MAX_SAFE_INTEGER + 1, node.revision + 1);
    this.releaseNode(node);
    this.changed(location.parent);
  }

  async removeTreeConditional(path: string, options: ConditionalRemoveEntryOptions): Promise<void> {
    options.signal?.throwIfAborted();
    const location = this.entry(path, "removeTreeConditional", true);
    this.expectEntry(location.parent, options.parent, path, false);
    this.expectEntry(location.node, options.expected, path, false);
    if (location.node?.type !== "directory") this.fail("ENOTDIR", "removeTreeConditional", path);
    this.removeLocation(location, path, "removeTreeConditional", true);
  }

  async writeFile(path: string, data: Uint8Array, options: WriteFileOptions = {}): Promise<void> {
    options.signal?.throwIfAborted();
    this.writeData(path, data, options, "writeFile");
  }

  async appendFile(path: string, data: Uint8Array, options: AppendFileOptions = {}): Promise<void> {
    options.signal?.throwIfAborted();
    this.writeData(path, data, { ...options, flag: "a" }, "appendFile");
  }

  async stat(path: string, options: FsOptions = {}): Promise<FileStat> {
    options.signal?.throwIfAborted();
    return this.snapshot(this.resolveNode(path, "stat", true));
  }

  async lstat(path: string, options: FsOptions = {}): Promise<FileStat> {
    options.signal?.throwIfAborted();
    const stat = this.snapshot(this.resolveNode(path, "lstat", false));
    ownedStats.set(stat, { filesystem: this, path, root: this.root });
    return stat;
  }

  async readdir(path: string, options: ReadDirectoryOptions = {}): Promise<DirectoryEntry[]> {
    const limit = directoryEntryLimit(options, path);
    const node = this.resolveNode(path, "readdir", true);
    if (node.type !== "directory") this.fail("ENOTDIR", "readdir", path);
    this.permission(node, 4, "readdir", path);
    admitDirectoryEntries(node.entries.size, limit, path);
    node.atimeMs = Date.now();
    const result = new Array<DirectoryEntry>(node.entries.size);
    let idx = 0;
    for (const [name, entry] of node.entries) {
      result[idx++] = { name, type: entry.type };
    }
    return result.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  }

  mkdir(path: string, options: MkdirOptions = {}): Promise<void> {
    try {
      options.signal?.throwIfAborted();
      this.validatePath(path, "mkdir");
      const mode = this.mode(options.mode, 0o777, "mkdir", path);
      if (options.recursive) {
        const node = this.resolve(path, "mkdir", { createDirectories: mode }).node!;
        if (node.type !== "directory") this.fail("EEXIST", "mkdir", path);
        return resolvedVoid;
      }
      const location = this.resolve(path.replace(/\/+$/, "") || "/", "mkdir", { allowMissing: true, followFinal: false });
      if (location.node) this.fail("EEXIST", "mkdir", path);
      this.permission(location.parent, 3, "mkdir", path);
      this.addNode(location.parent, location.name, () => this.directory(mode), "mkdir", path);
      return resolvedVoid;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async rmdir(path: string, options: FsOptions = {}): Promise<void> {
    options.signal?.throwIfAborted();
    const location = this.entry(path, "rmdir");
    const node = location.node!;
    if (this.terminalDot(path)) this.fail("EINVAL", "rmdir", path);
    if (node === this.root) this.fail("EBUSY", "rmdir", path);
    if (node.type !== "directory") this.fail("ENOTDIR", "rmdir", path);
    this.permission(location.parent, 3, "rmdir", path);
    if (node.entries.size > 0) this.fail("ENOTEMPTY", "rmdir", path);
    location.parent.entries.delete(location.name);
    this.ledger.release(location.name.length * 2, 1);
    node.nlink = 0;
    node.ctimeMs = Date.now();
    node.revision = Math.min(Number.MAX_SAFE_INTEGER + 1, node.revision + 1);
    this.releaseNode(node);
    this.changed(location.parent);
  }

  rm(path: string, options: RemoveOptions & Partial<ConditionalMutationBinding> = {}): Promise<void> {
    try {
      options.signal?.throwIfAborted();
      const bound = activeConditionalMutations.get(this.identityScope);
      const active = bound?.path === path ? bound : undefined;
      const ancestors = options.ancestors ?? active?.ancestors;
      const expectedParent = options.parent ?? active?.parent;
      const expectedNode = options.expected ?? active?.expected;
      if (ancestors !== undefined) this.verifyDirectoryAncestry(ancestors, options);
      let location: Location;
      try {
        location = this.entry(path, "rm", expectedNode !== undefined || expectedParent !== undefined);
      } catch (error) {
        if (options.force && error instanceof FsError && error.code === "ENOENT") return resolvedVoid;
        throw error;
      }
      if (expectedParent !== undefined) this.expectEntry(location.parent, expectedParent, path, false);
      if (expectedNode !== undefined) {
        if (options.force && !location.node) return resolvedVoid;
        this.expectEntry(location.node, expectedNode, path, location.node?.type !== "directory");
      }
      this.removeLocation(location, path, "rm", options.recursive === true);
      return resolvedVoid;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private removeLocation(location: Location, path: string, syscall: string, recursive: boolean): void {
    const node = location.node!;
    if (this.terminalDot(path)) this.fail("EINVAL", syscall, path);
    if (node === this.root) this.fail("EBUSY", syscall, path);
    this.permission(location.parent, 3, syscall, path);
    if (node.type === "directory" && !recursive) this.fail("EISDIR", syscall, path);
    const cache = memoryCaches.get(this.ledger)!;
    cache.clearWrites();
    const removed = cache.removedScratch;
    removed.length = 0;
    removed.push(node);
    let keyChars = 0;
    let keyEntries = 0;
    for (let index = 0; index < removed.length; index++) {
      const entry = removed[index]!;
      if (entry.type === "directory" && entry.entries.size > 0) {
        this.permission(entry, 7, syscall, path);
        entry.entries.forEach((child, name) => {
          removed.push(child);
          keyChars += name.length;
          keyEntries++;
        });
      }
    }
    location.parent.entries.delete(location.name);
    this.ledger.release((location.name.length + keyChars) * 2, 1 + keyEntries);
    const now = Date.now();
    for (let i = 0; i < removed.length; i++) {
      const entry = removed[i]!;
      if (entry.type === "directory") {
        entry.entries.clear();
      }
      entry.nlink--;
      if (entry.nlink !== 0 || entry.references !== 0) {
        entry.ctimeMs = now;
        entry.revision = Math.min(Number.MAX_SAFE_INTEGER + 1, entry.revision + 1);
      }
      this.releaseNode(entry);
    }
    removed.length = 0;
    this.changed(location.parent);
  }

  unlink(path: string, options: FsOptions = {}): Promise<void> {
    // Do not allow an untyped recursive option to widen final-entry removal.
    return this.rm(path, { ...(options.signal === undefined ? {} : { signal: options.signal }) });
  }

  async rename(source: string, destination: string, options: RenameOptions = {}): Promise<void> {
    options.signal?.throwIfAborted();
    try {
      const origin = this.entry(source, "rename");
      const target = this.entry(destination, "rename", true);
      const node = origin.node!;
      if (this.terminalDot(source) || this.terminalDot(destination)) this.fail("EINVAL", "rename", source, destination);
      if (node === this.root || target.node === this.root) this.fail("EBUSY", "rename", source, destination);
      if (destination.endsWith("/") && node.type !== "directory") this.fail("ENOTDIR", "rename", source, destination);
      if (options.noReplace && target.node) this.fail("EEXIST", "rename", source, destination);
      if (target.node === node) return;
      if (node.type === "directory" && target.path.startsWith(`${origin.path}/`)) this.fail("EINVAL", "rename", source, destination);
      this.permission(origin.parent, 3, "rename", source);
      this.permission(target.parent, 3, "rename", destination);
      if (target.node) {
        if (node.type === "directory" && target.node.type !== "directory") this.fail("ENOTDIR", "rename", source, destination);
        if (node.type !== "directory" && target.node.type === "directory") this.fail("EISDIR", "rename", source, destination);
        if (target.node.type === "directory" && target.node.entries.size > 0) this.fail("ENOTEMPTY", "rename", source, destination);
      }
      const nameGrowth = target.node ? 0 : (target.name.length - origin.name.length) * 2;
      this.ledger.reserve(Math.max(0, nameGrowth), 0, "rename", source);
      try { target.parent.entries.set(target.name, node); }
      catch (error) { this.ledger.release(Math.max(0, nameGrowth), 0); throw error; }
      memoryCaches.get(this.ledger)!.clearWrites();
      origin.parent.entries.delete(origin.name);
      if (target.node) {
        this.ledger.release(origin.name.length * 2, 1);
        target.node.nlink--;
        target.node.ctimeMs = Date.now();
        target.node.revision = Math.min(Number.MAX_SAFE_INTEGER + 1, target.node.revision + 1);
        this.releaseNode(target.node);
      } else if (nameGrowth < 0) this.ledger.release(-nameGrowth, 0);
      this.changed(origin.parent);
      this.changed(target.parent);
      node.ctimeMs = Date.now();
      node.revision = Math.min(Number.MAX_SAFE_INTEGER + 1, node.revision + 1);
    } catch (error) {
      if (error instanceof FsError) throw new FsError(error.code, { syscall: "rename", path: source, dest: destination, cause: error });
      throw error;
    }
  }

  async copyFile(source: string, destination: string, options: CopyFileOptions = {}): Promise<void> {
    options.signal?.throwIfAborted();
    try {
      const origin = this.file(source, "copyFile");
      this.permission(origin, 4, "copyFile", source);
      const target = this.resolve(destination, "copyFile", { followFinal: !options.exclusive, allowMissing: true });
      if (target.node && options.exclusive) this.fail("EEXIST", "copyFile", source, destination);
      if (target.node === origin) this.fail("EINVAL", "copyFile", source, destination);
      const node = this.writeData(destination, origin.data, { mode: origin.mode & 0o7777, flag: options.exclusive ? "wx" : "w" }, "copyFile");
      node.mode = origin.mode;
      origin.atimeMs = Date.now();
    } catch (error) {
      if (error instanceof FsError) throw new FsError(error.code, { syscall: "copyFile", path: source, dest: destination, cause: error });
      throw error;
    }
  }

  async realpath(path: string, options: FsOptions = {}): Promise<string> {
    options.signal?.throwIfAborted();
    return this.resolve(path, "realpath").path;
  }

  access(path: string, mode = 0, options: FsOptions = {}): Promise<void> {
    try {
      options.signal?.throwIfAborted();
      if (!Number.isInteger(mode) || mode < 0 || mode > 7) this.fail("EINVAL", "access", path);
      this.permission(this.resolveNode(path, "access", true), mode, "access", path);
      return resolvedVoid;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async readlink(path: string, options: FsOptions = {}): Promise<string> {
    options.signal?.throwIfAborted();
    const node = this.resolve(path, "readlink", { followFinal: false }).node!;
    if (node.type !== "symlink") this.fail("EINVAL", "readlink", path);
    return node.target;
  }

  async symlink(target: string, path: string, options: FsOptions = {}): Promise<void> {
    options.signal?.throwIfAborted();
    this.validatePath(target, "symlink");
    const location = this.resolve(path, "symlink", { followFinal: false, allowMissing: true });
    if (location.node) this.fail("EEXIST", "symlink", path);
    this.permission(location.parent, 3, "symlink", path);
    this.addNode(location.parent, location.name, (): SymlinkNode => ({
      ...this.metadata(typeModes.symlink | 0o777), type: "symlink", target,
    }), "symlink", path, target.length * 2);
  }

  async link(existingPath: string, newPath: string, options: FsOptions = {}): Promise<void> {
    options.signal?.throwIfAborted();
    const node = this.resolve(existingPath, "link", { followFinal: false }).node!;
    if (node.type === "directory") this.fail("EPERM", "link", existingPath, newPath);
    const target = this.resolve(newPath, "link", { followFinal: false, allowMissing: true });
    if (target.node) this.fail("EEXIST", "link", existingPath, newPath);
    this.permission(target.parent, 3, "link", newPath);
    this.ledger.reserve(target.name.length * 2, 1, "link", newPath);
    try { target.parent.entries.set(target.name, node); }
    catch (error) { this.ledger.release(target.name.length * 2, 1); throw error; }
    node.nlink++;
    node.ctimeMs = Date.now();
    node.revision = Math.min(Number.MAX_SAFE_INTEGER + 1, node.revision + 1);
    this.changed(target.parent);
  }

  async chmod(path: string, mode: number, options: ChmodOptions = {}): Promise<void> {
    options.signal?.throwIfAborted();
    const permissions = this.mode(mode, 0, "chmod", path);
    const bound = activeConditionalMutations.get(this.identityScope);
    const active = bound?.path === path ? bound : undefined;
    const conditional = snapshotConditionalChmod(path, active ? { ...active, ...options } : options);
    const controls = conditional ?? options;
    const ancestors = conditional?.ancestors;
    const expectedParent = conditional?.parent;
    const expectedNode = conditional?.expected;
    if (conditional?.commitGuard) runStagingGuard(conditional.commitGuard);
    controls.signal?.throwIfAborted();
    if (ancestors !== undefined) this.verifyDirectoryAncestry(ancestors, controls);
    const location = expectedNode !== undefined || expectedParent !== undefined
      ? this.entry(path, "chmod", true)
      : this.resolve(path, "chmod");
    if (expectedParent !== undefined) this.expectEntry(location.parent, expectedParent, path, false);
    if (expectedNode !== undefined) this.expectEntry(location.node, expectedNode, path, location.node?.type !== "directory");
    const node = location.node!;
    if (node.type === "directory") memoryCaches.get(this.ledger)!.clearWrites();
    node.mode = typeModes[node.type] | permissions;
    node.ctimeMs = Date.now();
    node.revision = Math.min(Number.MAX_SAFE_INTEGER + 1, node.revision + 1);
  }

  async utimes(path: string, atimeMs: number, mtimeMs: number, options: FsOptions = {}): Promise<void> {
    options.signal?.throwIfAborted();
    if (!Number.isFinite(atimeMs) || !Number.isFinite(mtimeMs)) this.fail("EINVAL", "utimes", path);
    const node = this.resolve(path, "utimes").node!;
    node.atimeMs = atimeMs;
    node.mtimeMs = mtimeMs;
    node.ctimeMs = Date.now();
    node.revision = Math.min(Number.MAX_SAFE_INTEGER + 1, node.revision + 1);
  }

  async truncate(path: string, length = 0, options: FsOptions = {}): Promise<void> {
    options.signal?.throwIfAborted();
    this.integer(length, "truncate", path);
    const node = this.file(path, "truncate");
    this.permission(node, 2, "truncate", path);
    this.resizeNode(node, length, "truncate", path);
  }

  private resizeNode(node: FileNode, length: number, syscall: string, path: string): void {
    this.admitSize(node, length, syscall, path);
    const data = this.allocate(length, syscall, path);
    try { data.data.set(node.data.subarray(0, length)); }
    catch (error) { data.release(); throw error; }
    this.replaceData(node, data);
    this.changed(node);
  }

  async openResizeFile(path: string, options: OpenResizeFileOptions = {}): Promise<FileResizeHandle> {
    options.signal?.throwIfAborted();
    if (!stockRetainedResize(this)) throw new FsError("ENOTSUP", { syscall: "openResizeFile", path });
    const location = this.resolve(path, "openResizeFile", { allowMissing: options.create === true, resizeCreate: options.create ?? false });
    let mode = 0o666;
    if (location.node) {
      if (location.node.type !== "file") this.fail("EISDIR", "openResizeFile", path);
      this.permission(location.node, 2, "openResizeFile", path);
    } else {
      this.permission(location.parent, 3, "openResizeFile", path);
      mode = this.mode(options.mode, mode, "openResizeFile", path);
    }
    this.ledger.reserve(path.length * 2, 1, "openResizeFile", path);
    let node: FileNode | undefined;
    try {
      node = this.openWrite(path, {}, "openResizeFile", { location, mode, append: false });
      node.references++;
    } catch (error) {
      this.ledger.release(path.length * 2, 1);
      throw error;
    }
    const snapshot = this.snapshot.bind(this);
    const integer = this.integer.bind(this);
    const resizeNode = this.resizeNode.bind(this);
    const releaseReference = this.releaseReference.bind(this);
    let closing: Promise<void> | undefined;
    const current = (signal: AbortSignal | undefined, syscall: string): FileNode => {
      signal?.throwIfAborted();
      if (!node) throw new FsError("EBADF", { syscall, path });
      return node;
    };
    return {
      async stat(options = {}) { return snapshot(current(options.signal, "fstat")); },
      async seekEnd(options = {}) { return BigInt(current(options.signal, "lseek").data.byteLength); },
      async truncate(length, options = {}) {
        const file = current(options.signal, "ftruncate");
        integer(length, "ftruncate", path);
        resizeNode(file, length, "ftruncate", path);
      },
      close() {
        if (!closing) {
          const retained = node;
          node = undefined;
          closing = Promise.resolve().then(() => { if (retained) releaseReference(retained, path); });
        }
        return closing;
      },
    };
  }

  async openReadFile(path: string, options: OpenReadFileOptions = {}): Promise<FileReadHandle> {
    const signal = options.signal;
    signal?.throwIfAborted();
    const allowDirectory = options.allowDirectory === true;
    signal?.throwIfAborted();
    const unsupported = (): never => { throw new FsError("ENOTSUP", { syscall: "openReadFile", path }); };
    const owner = ownedStores.get(this);
    if (!owner || Object.getPrototypeOf(this) !== MemoryFileSystem.prototype
      || Object.getOwnPropertyDescriptor(this, "root")?.value !== owner.root
      || Object.getOwnPropertyDescriptor(this, "ledger")?.value !== owner.ledger) unsupported();
    for (const name of ["openReadFile", "readFile", "readStream", "stat", "lstat", "realpath", "access",
      "file", "resolve", "permission", "validatePath", "fail", "snapshot", "integer", "releaseReference", "releaseNode"]) {
      const descriptor = Object.getOwnPropertyDescriptor(this, name)
        ?? Object.getOwnPropertyDescriptor(MemoryFileSystem.prototype, name);
      if (!descriptor || !("value" in descriptor) || descriptor.value !== memoryImplementation[name]?.value) unsupported();
    }
    const retainedRead = Object.getOwnPropertyDescriptor(this, "capabilities")?.value?.retainedRead;
    signal?.throwIfAborted();
    if (retainedRead !== true) unsupported();
    const selected = allowDirectory ? this.resolve(path, "openReadFile").node! : this.file(path, "openReadFile");
    if (selected.type !== "file" && selected.type !== "directory") this.fail("EISDIR", "openReadFile", path);
    let node: FileNode | DirectoryNode | undefined = selected;
    this.permission(node, 4, "openReadFile", path);
    signal?.throwIfAborted();
    this.ledger.reserve(path.length * 2, 1, "openReadFile", path);
    node.references++;
    const snapshot = this.snapshot.bind(this);
    const integer = this.integer.bind(this);
    const releaseReference = this.releaseReference.bind(this);
    let closing: Promise<void> | undefined;
    const current = (signal: AbortSignal | undefined, syscall: string): FileNode | DirectoryNode => {
      signal?.throwIfAborted();
      if (!node) throw new FsError("EBADF", { syscall, path });
      return node;
    };
    return {
      async stat(options = {}) {
        return snapshot(current(options.signal, "fstat"));
      },
      async seekEnd(options = {}) {
        const file = current(options.signal, "lseek");
        return file.type === "directory" ? ext4HtreeEof64 : BigInt(file.data.byteLength);
      },
      async read(position, maxBytes, options = {}) {
        const file = current(options.signal, "read");
        integer(position, "read", path);
        integer(maxBytes, "read", path);
        if (maxBytes === 0 || maxBytes > Number.MAX_SAFE_INTEGER - position) {
          throw new FsError("EINVAL", { syscall: "read", path });
        }
        if (file.type === "directory") throw new FsError("EISDIR", { syscall: "read", path });
        const bytes = file.data.slice(position, position + maxBytes);
        file.atimeMs = Date.now();
        return bytes;
      },
      close() {
        if (node) {
          releaseReference(node, path);
          node = undefined;
        }
        closing ??= Promise.resolve();
        return closing;
      },
    };
  }

  readStream(path: string, options: ReadStreamOptions = {}): ByteSource {
    return new MemoryReadStream(this, path, options);
  }

  async writeStream(path: string, source: ByteSource, options: WriteFileOptions = {}): Promise<void> {
    options.signal?.throwIfAborted();
    this.validatePath(path, "writeStream");
    this.ledger.reserve(path.length * 2, 1, "writeStream", path);
    let node: FileNode | undefined;
    try {
      node = this.openWrite(path, options, "writeStream");
      const guard = (options as ConfinedWriteOptions)[extractionStreamGuard];
      node.references++;
      guard?.(node);
      const append = options.flag === "a" || options.flag === "ax";
      let position = 0;
      if (!append) {
        this.replaceData(node, new MemoryAllocation(new Uint8Array(), this.ledger));
        this.changed(node);
      }
      for await (const chunk of source) {
        options.signal?.throwIfAborted();
        guard?.(node);
        if (!(chunk instanceof Uint8Array)) throw new TypeError("Memory files require Uint8Array data");
        this.writeAt(node, chunk, append ? node.data.byteLength : position, "writeStream", path);
        if (!append) position += chunk.byteLength;
      }
      options.signal?.throwIfAborted();
    } finally {
      if (node) this.releaseReference(node, path);
      else this.ledger.release(path.length * 2, 1);
    }
  }
}

const memoryImplementation = Object.getOwnPropertyDescriptors(MemoryFileSystem.prototype);
const memoryImplementationKeys = Object.keys(memoryImplementation);
const memoryImplementationDescriptors = memoryImplementationKeys.map(key => memoryImplementation[key]!);
const MEMORY_DESCRIPTOR_CAPABILITIES = Object.freeze({
  noFollow: true, positionedRead: true, positionedWrite: true, truncate: true, synchronization: "volatile" as const, position: true,
});
interface MemoryDescriptorResource {
  fs: MemoryFileSystem;
  path: string;
  append: boolean;
  node: FileNode | undefined;
  position: number;
}
const memoryDescriptorGetPosition = async (retained: MemoryDescriptorResource): Promise<number> => retained.position;
const memoryDescriptorStat = async (retained: MemoryDescriptorResource): Promise<FileStat> => (retained.fs as any).snapshot(retained.node!);
const memoryDescriptorRead = async (retained: MemoryDescriptorResource, buffer: Uint8Array, position: number | null): Promise<number> => {
  const inode = retained.node!;
  const start = position ?? retained.position;
  const count = Math.min(buffer.byteLength, Math.max(0, inode.data.byteLength - start));
  buffer.set(inode.data.subarray(start, start + count));
  if (position === null) retained.position += count;
  inode.atimeMs = Date.now();
  return count;
};
const memoryDescriptorWrite = async (retained: MemoryDescriptorResource, buffer: Uint8Array, position: number | null): Promise<number> => {
  const inode = retained.node!;
  const start = retained.append ? inode.data.byteLength : position ?? retained.position;
  const end = start + buffer.byteLength;
  (retained.fs as any).writeAt(inode, buffer, start, "write", retained.path);
  if (position === null) retained.position = end;
  return buffer.byteLength;
};
const memoryDescriptorTruncate = async (retained: MemoryDescriptorResource, length: number): Promise<void> => {
  (retained.fs as any).resizeNode(retained.node!, length, "ftruncate", retained.path);
};
const memoryDescriptorSync = async (): Promise<void> => {};
const memoryDescriptorClose = async (retained: MemoryDescriptorResource): Promise<void> => {
  const inode = retained.node!;
  retained.node = undefined;
  (retained.fs as any).releaseReference(inode, retained.path);
};

const stockDescriptorWriteMethodNames = [
  "writeStream", "writeFile", "appendFile", "access", "stat", "lstat", "realpath",
  "openWrite", "prepareWrite", "writeData", "addNode", "replaceData", "releaseReference", "releaseNode",
  "resolve", "permission", "validatePath", "mode", "bytes", "allocate", "admitSize", "changed", "metadata", "integer", "writeAt", "fail",
] as const;

const stockRetainedResizeMethodNames = [
  "openResizeFile", "truncate", "resizeNode", "snapshot",
] as const;

function stockDescriptorWrite(filesystem: MemoryFileSystem): boolean {
  if (!isStockMemoryMethods(filesystem, stockDescriptorWriteMethodNames, true)) return false;
  const owner = ownedStores.get(filesystem)!;
  const capDesc = Object.getOwnPropertyDescriptor(filesystem, "capabilities");
  return !!capDesc && "value" in capDesc && capDesc.value === owner.capabilities;
}

function stockRetainedResize(filesystem: MemoryFileSystem): boolean {
  if (!stockDescriptorWrite(filesystem) || !isStockMemoryMethods(filesystem, stockRetainedResizeMethodNames, false)) return false;
  const owner = ownedStores.get(filesystem)!;
  const ledgerDesc = Object.getOwnPropertyDescriptor(filesystem, "ledger");
  return !!ledgerDesc && "value" in ledgerDesc && ledgerDesc.value === owner.ledger;
}

export function createMemoryFileSystem(options: MemoryFileSystemOptions | Readonly<Record<string, unknown>> = {}): MemoryFileSystem {
  return new MemoryFileSystem(options);
}

const missingTargetMethodNames = ["realpath", "lstat", "resolve", "permission", "validatePath", "fail", "snapshot"] as const;
const deviceFastMethodNames = ["lstat", "readlink", "resolve", "permission", "validatePath", "fail", "snapshot"] as const;
const readFileFastMethodNames = ["readFile", "file", "resolve", "permission", "validatePath", "fail", "integer"] as const;
const writeFileFastMethodNames = [
  "writeFile", "appendFile", "writeData", "prepareWrite", "openWrite", "writeAt",
  "addNode", "replaceData", "resolve", "permission", "validatePath", "mode",
  "bytes", "allocate", "admitSize", "changed", "metadata", "fail",
] as const;

export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

function exceedsComponentByteLimit(value: string): boolean {
  return value.length > 85 && (value.length > 255 || utf8ByteLength(value) > 255);
}

export function isCleanAbsolutePath(path: string): boolean {
  const len = path.length;
  if (len <= 1 || len > 65536 || path.charCodeAt(0) !== 47 || path.charCodeAt(len - 1) === 47) return false;
  let segStart = 1;
  let components = 1;
  for (let i = 1; i < len; i++) {
    const c = path.charCodeAt(i);
    if (c === 0) return false;
    if (c === 47) {
      const segLen = i - segStart;
      if (segLen === 0) return false;
      if (segLen === 1 && path.charCodeAt(segStart) === 46) return false;
      if (segLen === 2 && path.charCodeAt(segStart) === 46 && path.charCodeAt(segStart + 1) === 46) return false;
      if (++components > 256) return false;
      segStart = i + 1;
    }
  }
  const lastLen = len - segStart;
  if (lastLen === 1 && path.charCodeAt(segStart) === 46) return false;
  if (lastLen === 2 && path.charCodeAt(segStart) === 46 && path.charCodeAt(segStart + 1) === 46) return false;
  return true;
}

export function tryResolveMemoryDevicePath(filesystem: FileSystem, path: string, resizeCreate?: boolean): string | undefined {
  const mem = filesystem as MemoryFileSystem;
  if (!ownedStores.has(mem) || mem.symlinkCount !== 0 || !isStockMemoryMethods(mem, deviceFastMethodNames, false)) return undefined;
  if (!isCleanAbsolutePath(path) || path === "/dev" || path.startsWith("/dev/")) return undefined;
  let current: DirectoryNode = (mem as unknown as { root: DirectoryNode }).root;
  let start = 1;
  while (true) {
    if (((current.mode >> 6) & 1) !== 1) return undefined;
    const slash = path.indexOf("/", start);
    if (slash === -1) {
      const name = path.slice(start);
      if (exceedsComponentByteLimit(name)) return undefined;
      if (resizeCreate === false && !current.entries.has(name)) return undefined;
      return path;
    }
    const name = path.slice(start, slash);
    if (exceedsComponentByteLimit(name)) return undefined;
    const next = current.entries.get(name);
    if (!next) {
      if (resizeCreate !== undefined) return undefined;
      let remStart = slash + 1;
      while (true) {
        const nextSlash = path.indexOf("/", remStart);
        const seg = nextSlash === -1 ? path.slice(remStart) : path.slice(remStart, nextSlash);
        if (exceedsComponentByteLimit(seg)) return undefined;
        if (nextSlash === -1) return path;
        remStart = nextSlash + 1;
      }
    }
    if (next.type !== "directory") return undefined;
    current = next;
    start = slash + 1;
  }
}

function isStockMemoryMethods(mem: MemoryFileSystem, names: readonly string[], checkRootAccessor = true): boolean {
  const owner = ownedStores.get(mem);
  if (!owner || Object.getPrototypeOf(mem) !== MemoryFileSystem.prototype) return false;
  if (checkRootAccessor) {
    const rootDesc = Object.getOwnPropertyDescriptor(mem, "root");
    if (!rootDesc || !("value" in rootDesc) || rootDesc.value !== owner.root) return false;
  } else if ((mem as unknown as { root: unknown }).root !== owner.root) {
    return false;
  }
  for (let i = 0; i < names.length; i++) {
    const name = names[i]!;
    if (Object.prototype.hasOwnProperty.call(mem, name)) {
      const descriptor = Object.getOwnPropertyDescriptor(mem, name);
      if (!descriptor || !("value" in descriptor) || descriptor.value !== memoryImplementation[name]?.value) return false;
    } else if ((MemoryFileSystem.prototype as unknown as Record<string, unknown>)[name] !== memoryImplementation[name]?.value) {
      return false;
    }
  }
  return true;
}

export function tryReadMemoryFileViewSync(filesystem: FileSystem, path: string, maxBytes?: number, signal?: AbortSignal): Uint8Array | undefined {
  const mem = filesystem as MemoryFileSystem;
  if (!ownedStores.has(mem) || !isStockMemoryMethods(mem, readFileFastMethodNames, false)) return undefined;
  signal?.throwIfAborted();
  if (maxBytes !== undefined) (mem as unknown as { integer: (v: number, s: string, p: string) => void }).integer(maxBytes, "readFile", path);
  const node = (mem as unknown as { file: (p: string, s: string) => FileNode }).file(path, "readFile");
  (mem as unknown as { permission: (n: MemoryNode, m: number, s: string, p: string) => void }).permission(node, 4, "readFile", path);
  if (maxBytes !== undefined && node.data.byteLength > maxBytes) (mem as unknown as { fail: (c: ErrnoCode, s: string, p: string) => never }).fail("EFBIG", "readFile", path);
  node.atimeMs = Date.now();
  return node.data;
}

export function tryGetMemoryDirectoryEntryNamesSync(filesystem: FileSystem, path: string): ReadonlyMap<string, { readonly type: "file" | "directory" | "symlink" }> | undefined {
  const mem = filesystem as MemoryFileSystem;
  if (!ownedStores.has(mem) || mem.symlinkCount !== 0 || !isStockMemoryMethods(mem, readFileFastMethodNames, false)) return undefined;
  const root: DirectoryNode = (mem as unknown as { root: DirectoryNode }).root;
  if (path === "/") {
    if (((root.mode >> 6) & 4) !== 4) return undefined;
    return root.entries;
  }
  if (!isCleanAbsolutePath(path) || path === "/dev" || path.startsWith("/dev/")) return undefined;
  let current: DirectoryNode = root;
  let start = 1;
  while (true) {
    if (((current.mode >> 6) & 1) !== 1) return undefined;
    const slash = path.indexOf("/", start);
    if (slash === -1) {
      const next = current.entries.get(path.slice(start));
      if (!next || next.type !== "directory" || ((next.mode >> 6) & 4) !== 4) return undefined;
      return next.entries;
    }
    const next = current.entries.get(path.slice(start, slash));
    if (!next || next.type !== "directory") return undefined;
    current = next;
    start = slash + 1;
  }
}

export function tryWriteMemoryFileSync(
  filesystem: FileSystem,
  path: string,
  data: Uint8Array,
  append: boolean,
  mode: number,
  signal?: AbortSignal,
): boolean {
  const mem = filesystem as MemoryFileSystem;
  const owner = ownedStores.get(mem);
  if (
    !owner ||
    mem.symlinkCount !== 0 ||
    mem.capabilities !== owner.capabilities ||
    !isStockMemoryMethods(mem, writeFileFastMethodNames, false) ||
    !isCleanAbsolutePath(path) ||
    path === "/dev" ||
    path.startsWith("/dev/")
  ) {
    return false;
  }
  signal?.throwIfAborted();
  mem.writeMemoryFileFast(path, data, append, mode);
  return true;
}

export function tryWriteMemoryFileInDirSync(
  filesystem: FileSystem,
  dirPrefix: string,
  name: string,
  data: Uint8Array,
  append: boolean,
  mode: number,
  signal?: AbortSignal,
): boolean {
  const mem = filesystem as MemoryFileSystem;
  const owner = ownedStores.get(mem);
  if (
    !owner ||
    mem.symlinkCount !== 0 ||
    mem.capabilities !== owner.capabilities ||
    !isStockMemoryMethods(mem, writeFileFastMethodNames, false) ||
    name.length === 0 ||
    name === "." ||
    name === ".." ||
    name.indexOf("/") !== -1 ||
    name.indexOf("\0") !== -1 ||
    dirPrefix.length + name.length > 65536
  ) {
    return false;
  }
  signal?.throwIfAborted();
  mem.writeMemoryFileInDirFast(dirPrefix, name, data, append, mode);
  return true;
}
