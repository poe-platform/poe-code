import { FsError } from "../../contracts/errors.js";
import type { ErrnoCode } from "../../contracts/errors.js";
import type {
  AppendFileOptions, CopyFileOptions, DirectoryEntry, EntryComparison, FileReadHandle, FileResizeHandle, FileStat, FileSystem,
  FsOptions, RenameOptions, MkdirOptions, ReadDirectoryOptions, ReadFileOptions, ReadStreamOptions, RemoveOptions,
  OpenReadFileOptions, OpenResizeFileOptions, WriteFileOptions,
  ConditionalWriteFileOptions, ConditionalRemoveFileOptions, CreateStagedFileOptions, FileStaging, PublishStagedFileOptions, PrepareDirectoryOptions, StagedFileContent,
} from "../../contracts/filesystem.js";
import type { ByteSource } from "../../contracts/io.js";
import { assertCallbackAuthorityAllowed, compareEntries, registerEntryAuthority } from "../mount/comparison.js";
import type { EntryAuthority } from "../mount/comparison.js";
import { getOwnedS3Entry } from "../s3/registry.js";
import { getOwnedWebDavEntry } from "../webdav/resource-id.js";
import { admitDirectoryEntries, directoryEntryLimit } from "../directory-admission.js";
import { resolveMissingTarget } from "./missing-target.js";
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
  data: Uint8Array;
  allocation: MemoryAllocation;
}

interface DirectoryNode extends Metadata {
  type: "directory";
  entries: Map<string, MemoryNode>;
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

const typeModes = { file: 0o100000, directory: 0o040000, symlink: 0o120000 } as const;
const ext4HtreeEof64 = (1n << 63n) - 1n;
const ownedStats = new WeakMap<FileStat, { filesystem: FileSystem; path: string; root: DirectoryNode }>();
const ownedStores = new WeakMap<FileSystem, { root: DirectoryNode; ledger: MemoryLedger; capabilities: FileSystem["capabilities"]; intact: () => boolean }>();
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

export class MemoryFileSystem implements FileSystem {
  readonly capabilities = ((filesystem: MemoryFileSystem) => {
    return Object.freeze({
      read: true, stat: true, readdir: true, realpath: true, access: true,
      write: true, append: true, exclusiveCreate: true, explicitDirectories: true, implicitDirectories: false,
      mkdir: true, recursiveMkdir: true, remove: true, removeDirectory: true, recursiveRemove: true,
      rename: true, atomicRenameNoReplace: true, copy: true, exclusiveCopy: true, readlink: true, truncate: true,
      streamingAppend: true, randomAccessWrite: true,
      readOnly: false,
      symlinks: true,
      hardlinks: true,
      permissions: true,
      timestamps: true,
      atomicRename: true,
      atomicFileStaging: true, atomicFileMutation: true,
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

  constructor(options: MemoryFileSystemOptions = {}) {
    this.ledger = new MemoryLedger(normalizeMemoryFileSystemLimits(options));
    this.ledger.reserve(0, 1, "mkdir", "/");
    this.root = this.directory(0o755);
    const root = this.root;
    ownedStores.set(this, {
      root,
      ledger: this.ledger,
      capabilities: this.capabilities,
      intact: () => this.root === root,
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
    const owner = ownedStores.get(this);
    if (!owner || Object.getPrototypeOf(this) !== MemoryFileSystem.prototype
      || Object.getOwnPropertyDescriptor(this, "root")?.value !== owner.root) return undefined;
    for (const name of ["realpath", "lstat", "resolve", "permission", "validatePath", "fail", "snapshot"]) {
      const descriptor = Object.getOwnPropertyDescriptor(this, name)
        ?? Object.getOwnPropertyDescriptor(MemoryFileSystem.prototype, name);
      if (!descriptor || !("value" in descriptor) || descriptor.value !== memoryImplementation[name]?.value) return undefined;
    }
    if (path !== "") this.validatePath(path, "realpath");
    return resolveMissingTarget(owner.root, path || ".", options.signal);
  }

  private metadata(mode: number): Metadata {
    const now = Date.now();
    return {
      mode, ino: this.nextInode++, nlink: 1, references: 0, revision: 0,
      atimeMs: now, mtimeMs: now, ctimeMs: now, birthtimeMs: now,
    };
  }

  private directory(mode: number): DirectoryNode {
    return { ...this.metadata(typeModes.directory | mode), type: "directory", entries: new Map() };
  }

  private addNode<Node extends MemoryNode>(parent: DirectoryNode, name: string, create: () => Node,
    syscall: string, path: string, retainedBytes = 0): Node {
    const bytes = name.length * 2 + retainedBytes;
    this.ledger.reserve(bytes, 2, syscall, path);
    try {
      const node = create();
      parent.entries.set(name, node);
      this.changed(parent);
      return node;
    } catch (error) {
      this.ledger.release(bytes, 2);
      throw error;
    }
  }

  private releaseNode(node: MemoryNode): void {
    if (node.nlink !== 0 || node.references !== 0) return;
    this.ledger.release(node.type === "symlink" ? node.target.length * 2 : 0, 1);
    if (node.type === "file") node.allocation.release();
  }

  private releaseReference(node: FileNode | DirectoryNode, path: string): void {
    node.references--;
    this.ledger.release(path.length * 2, 1);
    this.releaseNode(node);
  }

  private replaceData(node: FileNode, allocation: MemoryAllocation, length = allocation.data.byteLength): void {
    const previous = node.allocation;
    node.data = allocation.data.subarray(0, length);
    node.allocation = allocation;
    previous.release();
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

  private changed(node: MemoryNode): void {
    node.revision = Math.min(Number.MAX_SAFE_INTEGER + 1, node.revision + 1);
    node.mtimeMs = node.ctimeMs = Date.now();
  }

  private resolve(path: string, syscall: string, options: ResolveOptions = {}): Location {
    this.validatePath(path, syscall);
    const pending = path.split("/").filter(Boolean);
    if (path.endsWith("/")) pending.push("");
    const stack: { node: MemoryNode; name: string }[] = [{ node: this.root, name: "" }];
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
      if (new TextEncoder().encode(component).byteLength > 255) this.fail("ENAMETOOLONG", syscall, path);
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
      if (node.type === "symlink" && (options.followFinal !== false || pending.length > 0)) {
        if (++links > 40) this.fail("ELOOP", syscall, path);
        const target = node.target.split("/").filter(Boolean);
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

  private snapshot(node: MemoryNode): FileStat {
    return {
      type: node.type,
      ...(Number.isSafeInteger(node.revision) ? { revision: node.revision } : {}),
      preferredIoBlockSize: 4096,
      size: node.type === "file" ? node.data.byteLength
        : node.type === "symlink" ? new TextEncoder().encode(node.target).byteLength : 0,
      mode: node.mode, ...(ownedStores.get(this)?.intact() ? { identityScope: this.identityScope } : {}),
      ino: node.ino, dev: 0, uid: 0, gid: 0,
      nlink: node.type === "directory" && node.nlink !== 0
        ? 2 + [...node.entries.values()].filter((entry) => entry.type === "directory").length : node.nlink,
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
    try {
      return new MemoryAllocation(new Uint8Array(length), this.ledger);
    } catch (cause) {
      this.ledger.release(length, 0);
      throw new FsError("EFBIG", { syscall, path, cause });
    }
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
      return { ...this.metadata(typeModes.file | mode), type: "file", data: allocation.data, allocation };
    }, syscall, path);
  }

  private writeData(path: string, data: Uint8Array, options: WriteFileOptions, syscall: string): FileNode {
    if (!(data instanceof Uint8Array)) throw new TypeError("Memory files require Uint8Array data");
    const target = this.prepareWrite(path, options, syscall);
    const current = target.location.node as FileNode | undefined;
    const length = (target.append ? current?.data.byteLength ?? 0 : 0) + data.byteLength;
    this.ledger.fileSize(length, syscall, path);
    const growth = target.append && length > (current?.allocation.data.byteLength ?? 0) ? length : 0;
    this.ledger.check(data.byteLength + growth + (current ? 0 : target.location.name.length * 2), current ? 0 : 2, syscall, path);
    const copied = this.bytes(data, syscall, path);
    let allocation = copied;
    let transferred = false;
    try {
      if (!current) {
        if (target.append && length > 0) {
          const capacity = Math.min(Math.max(length, 64), this.ledger.limits.maxFileBytes,
            this.ledger.availableBytes - target.location.name.length * 2);
          allocation = this.allocate(capacity, syscall, path);
          allocation.data.set(copied.data);
        }
        const node = this.addNode(target.location.parent, target.location.name, (): FileNode => ({
          ...this.metadata(typeModes.file | target.mode), type: "file",
          data: allocation.data.subarray(0, length), allocation,
        }), syscall, path);
        transferred = true;
        return node;
      }
      if (target.append) this.writeAt(current, copied.data, current.data.byteLength, syscall, path);
      else {
        this.replaceData(current, copied);
        transferred = true;
        this.changed(current);
      }
      return current;
    } finally {
      if (allocation !== copied && !transferred) allocation.release();
      if (!transferred || allocation !== copied) copied.release();
    }
  }

  private writeAt(node: FileNode, data: Uint8Array, position: number, syscall: string, path: string): void {
    if (data.byteLength === 0) {
      this.changed(node);
      return;
    }
    const end = position + data.byteLength;
    this.ledger.fileSize(end, syscall, path);
    const length = Math.max(node.data.byteLength, end);
    let allocation = node.allocation;
    if (length > allocation.data.byteLength) {
      this.ledger.check(length, 0, syscall, path);
      const capacity = Math.min(Math.max(length, node.data.byteLength * 2, 64),
        this.ledger.limits.maxFileBytes, this.ledger.availableBytes);
      allocation = this.allocate(capacity, syscall, path);
    }
    try {
      const storage = allocation.data;
      if (allocation !== node.allocation) storage.set(node.data);
      if (position > node.data.byteLength) storage.fill(0, node.data.byteLength, position);
      storage.set(data, position);
    } catch (error) {
      if (allocation !== node.allocation) allocation.release();
      throw error;
    }
    if (allocation !== node.allocation) this.replaceData(node, allocation, length);
    else node.data = allocation.data.subarray(0, length);
    this.changed(node);
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
    const current = this.snapshot(node);
    if (!expected.identityScope || expected.identityScope !== current.identityScope
      || !Number.isSafeInteger(expected.ino) || !Number.isSafeInteger(expected.dev)) this.fail("ENOTSUP", "fileStaging", path);
    if (current.ino !== expected.ino || current.dev !== expected.dev || current.type !== expected.type) this.fail("EAGAIN", "fileStaging", path);
    if (unchanged) {
      if (!Number.isSafeInteger(expected.revision) || !Number.isSafeInteger(current.revision)) this.fail("ENOTSUP", "fileStaging", path);
      if (current.revision !== expected.revision || current.size !== expected.size || current.mode !== expected.mode
        || current.nlink !== expected.nlink || current.mtimeMs !== expected.mtimeMs || current.ctimeMs !== expected.ctimeMs) this.fail("EAGAIN", "fileStaging", path);
    }
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
    options.signal?.throwIfAborted();
    if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\0")) this.fail("EINVAL", "createStagedFile", directoryPath);
    const location = this.entry(directoryPath, "createStagedFile", true);
    if (location.node) this.fail("EEXIST", "createStagedFile", directoryPath);
    this.expectEntry(location.parent, options.parent, directoryPath, false);
    this.permission(location.parent, 3, "createStagedFile", directoryPath);
    const mode = this.mode(options.mode, content.type === "file" ? 0o666 : 0o777, "createStagedFile", directoryPath);
    for (const time of [options.atimeMs, options.mtimeMs]) if (time !== undefined && !Number.isFinite(time)) this.fail("EINVAL", "createStagedFile", directoryPath);
    if (content.type === "file" && !(content.data instanceof Uint8Array)) throw new TypeError("Staged files require Uint8Array data");
    if (content.type === "symlink") this.validatePath(content.target, "createStagedFile");
    const retained = (location.name.length + name.length) * 2 + (content.type === "symlink" ? content.target.length * 2 : 0);
    this.ledger.reserve(retained, 4, "createStagedFile", directoryPath);
    let allocation: MemoryAllocation | undefined;
    let directory: DirectoryNode;
    let file: FileNode | SymlinkNode;
    try {
      if (content.type === "file") allocation = this.bytes(content.data, "createStagedFile", directoryPath);
      directory = this.directory(0o700);
      file = content.type === "file"
        ? { ...this.metadata(typeModes.file | mode), type: "file", data: allocation!.data, allocation: allocation! }
        : { ...this.metadata(typeModes.symlink | mode), type: "symlink", target: content.target };
      if (options.atimeMs !== undefined) file.atimeMs = options.atimeMs;
      if (options.mtimeMs !== undefined) file.mtimeMs = options.mtimeMs;
      directory.entries.set(name, file);
      location.parent.entries.set(location.name, directory);
    } catch (error) { allocation?.release(); this.ledger.release(retained, 4); throw error; }
    this.changed(location.parent);
    const parentPath = location.path.slice(0, location.path.lastIndexOf("/")) || "/";
    const receipt = (path: string, node: MemoryNode) => Object.freeze({ path, stat: Object.freeze(this.snapshot(node)) });
    return Object.freeze({ parent: receipt(parentPath, location.parent), directory: receipt(location.path, directory), file: receipt(`${location.path}/${name}`, file) });
  }

  async publishStagedFile(staging: FileStaging, destination: string, options: PublishStagedFileOptions): Promise<void> {
    options.signal?.throwIfAborted();
    const { directory, file } = this.stagingLocations(staging);
    this.expectEntry(file.node, staging.file.stat, staging.file.path);
    const target = this.entry(destination, "publishStagedFile", true);
    this.expectEntry(target.parent, options.parent, destination, false);
    this.expectEntry(target.node, options.destination, destination);
    if (target.parent === directory.node || target.node === directory.node || target.node === file.node) this.fail("EINVAL", "publishStagedFile", destination);
    if (target.node && (target.node.type !== "file" || target.node.nlink !== 1)) this.fail("EAGAIN", "publishStagedFile", destination);
    return MemoryFileSystem.prototype.rename.call(this, staging.file.path, destination, { ...options, noReplace: options.destination === null });
  }

  async removeStagedFile(staging: FileStaging, options: FsOptions = {}): Promise<void> {
    options.signal?.throwIfAborted();
    const { directory, file } = this.stagingLocations(staging);
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
    if (mode !== undefined) node.mode = typeModes.directory | mode;
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
    this.writeData(path, data, { ...(options.mode === undefined ? {} : { mode: options.mode }), flag: options.append ? "a" : "w" }, "writeFileConditional");
    return Object.freeze(this.snapshot(location.parent.entries.get(location.name)!));
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
    this.ledger.release(location.name.length * 2, 1);
    node.nlink--;
    node.ctimeMs = Date.now();
    node.revision = Math.min(Number.MAX_SAFE_INTEGER + 1, node.revision + 1);
    this.releaseNode(node);
    this.changed(location.parent);
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
    return this.snapshot(this.resolve(path, "stat").node!);
  }

  async lstat(path: string, options: FsOptions = {}): Promise<FileStat> {
    options.signal?.throwIfAborted();
    const stat = this.snapshot(this.resolve(path, "lstat", { followFinal: false }).node!);
    ownedStats.set(stat, { filesystem: this, path, root: this.root });
    return stat;
  }

  async readdir(path: string, options: ReadDirectoryOptions = {}): Promise<DirectoryEntry[]> {
    const limit = directoryEntryLimit(options, path);
    const node = this.resolve(path, "readdir").node!;
    if (node.type !== "directory") this.fail("ENOTDIR", "readdir", path);
    this.permission(node, 4, "readdir", path);
    admitDirectoryEntries(node.entries.size, limit, path);
    node.atimeMs = Date.now();
    return [...node.entries].map(([name, entry]) => ({ name, type: entry.type }))
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  }

  async mkdir(path: string, options: MkdirOptions = {}): Promise<void> {
    options.signal?.throwIfAborted();
    this.validatePath(path, "mkdir");
    const mode = this.mode(options.mode, 0o777, "mkdir", path);
    if (options.recursive) {
      const node = this.resolve(path, "mkdir", { createDirectories: mode }).node!;
      if (node.type !== "directory") this.fail("EEXIST", "mkdir", path);
      return;
    }
    const location = this.resolve(path.replace(/\/+$/, "") || "/", "mkdir", { allowMissing: true, followFinal: false });
    if (location.node) this.fail("EEXIST", "mkdir", path);
    this.permission(location.parent, 3, "mkdir", path);
    this.addNode(location.parent, location.name, () => this.directory(mode), "mkdir", path);
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

  async rm(path: string, options: RemoveOptions = {}): Promise<void> {
    options.signal?.throwIfAborted();
    let location: Location;
    try {
      location = this.entry(path, "rm");
    } catch (error) {
      if (options.force && error instanceof FsError && error.code === "ENOENT") return;
      throw error;
    }
    const node = location.node!;
    if (this.terminalDot(path)) this.fail("EINVAL", "rm", path);
    if (node === this.root) this.fail("EBUSY", "rm", path);
    this.permission(location.parent, 3, "rm", path);
    if (node.type === "directory" && !options.recursive) this.fail("EISDIR", "rm", path);
    const removed: MemoryNode[] = [node];
    for (let index = 0; index < removed.length; index++) {
      const entry = removed[index]!;
      if (entry.type === "directory" && entry.entries.size > 0) {
        this.permission(entry, 7, "rm", path);
        for (const child of entry.entries.values()) removed.push(child);
      }
    }
    location.parent.entries.delete(location.name);
    this.ledger.release(location.name.length * 2, 1);
    for (const entry of removed) {
      if (entry.type === "directory") {
        for (const name of entry.entries.keys()) this.ledger.release(name.length * 2, 1);
        entry.entries.clear();
      }
      entry.nlink--;
      entry.ctimeMs = Date.now();
      entry.revision = Math.min(Number.MAX_SAFE_INTEGER + 1, entry.revision + 1);
      this.releaseNode(entry);
    }
    this.changed(location.parent);
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
      this.changed(node);
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

  async access(path: string, mode = 0, options: FsOptions = {}): Promise<void> {
    options.signal?.throwIfAborted();
    if (!Number.isInteger(mode) || mode < 0 || mode > 7) this.fail("EINVAL", "access", path);
    this.permission(this.resolve(path, "access").node!, mode, "access", path);
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

  async chmod(path: string, mode: number, options: FsOptions = {}): Promise<void> {
    options.signal?.throwIfAborted();
    const permissions = this.mode(mode, 0, "chmod", path);
    const node = this.resolve(path, "chmod").node!;
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

  async *readStream(path: string, options: ReadStreamOptions = {}): ByteSource {
    options.signal?.throwIfAborted();
    const start = options.start ?? 0;
    const chunkSize = options.chunkSize ?? 64 * 1024;
    this.integer(start, "readStream", path);
    this.integer(chunkSize, "readStream", path);
    if (chunkSize === 0) this.fail("EINVAL", "readStream", path);
    if (options.endExclusive !== undefined) {
      this.integer(options.endExclusive, "readStream", path);
      if (options.endExclusive < start) this.fail("EINVAL", "readStream", path);
    }
    const node = this.file(path, "readStream");
    this.permission(node, 4, "readStream", path);
    this.ledger.reserve(path.length * 2, 1, "readStream", path);
    node.references++;
    const allocation = node.allocation;
    allocation.retain();
    const data = node.data;
    try {
      const end = Math.min(options.endExclusive ?? data.byteLength, data.byteLength);
      node.atimeMs = Date.now();
      for (let offset = start; offset < end; offset += chunkSize) {
        options.signal?.throwIfAborted();
        yield data.slice(offset, Math.min(offset + chunkSize, end));
      }
      options.signal?.throwIfAborted();
    } finally {
      allocation.release();
      this.releaseReference(node, path);
    }
  }

  async writeStream(path: string, source: ByteSource, options: WriteFileOptions = {}): Promise<void> {
    options.signal?.throwIfAborted();
    this.validatePath(path, "writeStream");
    this.ledger.reserve(path.length * 2, 1, "writeStream", path);
    let node: FileNode | undefined;
    try {
      node = this.openWrite(path, options, "writeStream");
      node.references++;
      const append = options.flag === "a" || options.flag === "ax";
      let position = 0;
      if (!append) {
        this.replaceData(node, new MemoryAllocation(new Uint8Array(), this.ledger));
        this.changed(node);
      }
      for await (const chunk of source) {
        options.signal?.throwIfAborted();
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

function stockDescriptorWrite(filesystem: MemoryFileSystem): boolean {
  if (Object.getPrototypeOf(filesystem) !== MemoryFileSystem.prototype) return false;
  const owner = ownedStores.get(filesystem);
  if (!owner || Object.getOwnPropertyDescriptor(filesystem, "root")?.value !== owner.root
    || Object.getOwnPropertyDescriptor(filesystem, "capabilities")?.value !== owner.capabilities) return false;
  for (const name of ["writeStream", "writeFile", "appendFile", "access", "stat", "lstat", "realpath",
    "openWrite", "prepareWrite", "writeData", "addNode", "replaceData", "releaseReference", "releaseNode",
    "resolve", "permission", "validatePath", "mode", "bytes", "allocate", "changed", "metadata", "integer", "writeAt", "fail"]) {
    const descriptor = Object.getOwnPropertyDescriptor(filesystem, name)
      ?? Object.getOwnPropertyDescriptor(MemoryFileSystem.prototype, name);
    if (!descriptor || !("value" in descriptor) || descriptor.value !== memoryImplementation[name]?.value) return false;
  }
  return true;
}

function stockRetainedResize(filesystem: MemoryFileSystem): boolean {
  if (!stockDescriptorWrite(filesystem)) return false;
  const owner = ownedStores.get(filesystem);
  if (!owner || Object.getOwnPropertyDescriptor(filesystem, "ledger")?.value !== owner.ledger) return false;
  for (const name of ["openResizeFile", "truncate", "resizeNode", "snapshot"]) {
    const descriptor = Object.getOwnPropertyDescriptor(filesystem, name)
      ?? Object.getOwnPropertyDescriptor(MemoryFileSystem.prototype, name);
    if (!descriptor || !("value" in descriptor) || descriptor.value !== memoryImplementation[name]?.value) return false;
  }
  return true;
}

export function createMemoryFileSystem(options: MemoryFileSystemOptions | Readonly<Record<string, unknown>> = {}): MemoryFileSystem {
  return new MemoryFileSystem(normalizeMemoryFileSystemLimits(options));
}
