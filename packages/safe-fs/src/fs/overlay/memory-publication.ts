import { FsError, isFsError } from "../../contracts/errors.js";
import type {
  CreateStagedFileOptions, FileStaging, FileStagingEntry, FileStat, FileSystem,
  FsOptions, ChmodOptions, MkdirOptions, PublishStagedFileOptions, RemoveOptions, StagedFileContent,
} from "../../contracts/filesystem.js";
import { dirname, isPathWithin, validatePath } from "../../contracts/virtual-path.js";
import { memoryAtomicView, type MemoryAtomicView } from "../memory/atomic-view.js";
import { compareIdentity } from "../mount/identity.js";
import { snapshotConditionalChmod } from "../conditional-chmod.js";
import { runStagingGuard } from "../staging-ancestry.js";

interface Observation {
  path: string;
  upper?: FileStat;
  lower?: FileStat;
}

/** Stock Memory mutations commit before returning their promise. No user code or
 * await is allowed between inspecting the two stores and invoking a mutation. */
export class OverlayMemoryPublication {
  private readonly receipts = new WeakMap<FileStat, Observation>();
  private readonly directories = new Map<string, Observation & { identityScope: symbol; ino: number; dev: number }>();
  private readonly origins = new Map<string, { upper: FileStat; lower: FileStat }>();
  private readonly stages = new WeakMap<FileStaging, FileStaging>();

  constructor(
    private readonly upper: FileSystem,
    private readonly lower: FileSystem,
    private readonly whiteouts: Set<string>,
    private readonly opaque: Set<string>,
    private readonly hidden: Set<string>,
  ) {}

  supported(): boolean { return this.upper.capabilities.readOnly !== true && !!memoryAtomicView(this.upper) && !!memoryAtomicView(this.lower); }

  private stores(): { upper: MemoryAtomicView; lower: MemoryAtomicView } {
    const upper = memoryAtomicView(this.upper), lower = memoryAtomicView(this.lower);
    if (!upper || !lower || this.upper.capabilities.readOnly === true) throw new FsError("ENOTSUP", { syscall: "overlayPublication" });
    return { upper, lower };
  }

  private path(path: string): void {
    validatePath(path);
    if (!path.startsWith("/") || (path !== "/" && path.endsWith("/"))
      || path.split("/").some(component => component === "." || component === "..")) {
      throw new FsError("EINVAL", { path });
    }
  }

  private physical(view: MemoryAtomicView, path: string): FileStat | undefined {
    try { return view.stat(path); }
    catch (error) { if (isFsError(error, "ENOENT") || isFsError(error, "ENOTDIR")) return undefined; throw error; }
  }

  private observation(path: string): Observation {
    const stores = this.stores();
    const upper = this.physical(stores.upper, path);
    const lowerHidden = [...this.whiteouts].some(root => isPathWithin(root, path))
      || [...this.opaque].some(root => root !== path && isPathWithin(root, path));
    const lower = lowerHidden ? undefined : this.physical(stores.lower, path);
    return { path, ...(upper ? { upper } : {}), ...(lower ? { lower } : {}) };
  }

  private visible(observation: Observation): FileStat | undefined {
    return observation.upper ?? observation.lower;
  }

  copiedDirectory(path: string, lower: FileStat): void {
    if (!this.supported()) return;
    const upper = this.physical(this.stores().upper, path);
    if (upper?.type === "directory") {
      this.origins.set(path, { upper, lower });
      const directory = this.directories.get(path);
      if (directory && !directory.upper && this.same(directory.lower, lower)) directory.upper = upper;
    }
  }

  stat(path: string, physical: FileStat): FileStat {
    if (!this.supported()) return physical;
    const observation = this.observation(path);
    if (!this.same(physical, this.visible(observation), physical.type === "file")) throw new FsError("EAGAIN", { path });
    let logical = physical;
    if (physical.type === "directory") {
      let directory = this.directories.get(path);
      if (!directory || !this.same(directory.upper, observation.upper) || !this.same(directory.lower, observation.lower)) {
        directory = { ...observation, identityScope: Symbol("overlay directory"), ino: physical.ino!, dev: physical.dev! };
        this.directories.set(path, directory);
      }
      logical = { ...physical, identityScope: directory.identityScope, dev: directory.dev, ino: directory.ino };
    }
    this.receipts.set(logical, observation);
    return logical;
  }

  private same(actual: FileStat | undefined, expected: FileStat | undefined, unchanged = false): boolean {
    if (!actual || !expected) return actual === expected;
    return compareIdentity(actual, expected) === "same" && actual.type === expected.type
      && (!unchanged || ["revision", "size", "mode", "nlink", "mtimeMs", "ctimeMs"].every(key =>
        actual[key as keyof FileStat] === expected[key as keyof FileStat]));
  }

  private expect(path: string, expected: FileStat, unchanged = false): void {
    const receipt = this.receipts.get(expected);
    if (!receipt || receipt.path !== path) throw new FsError("ENOTSUP", { path, message: "unowned overlay publication receipt" });
    const actual = this.observation(path);
    const origin = this.origins.get(path);
    const copied = !receipt.upper && receipt.lower?.type === "directory" && origin
      && this.same(origin.upper, actual.upper) && this.same(origin.lower, receipt.lower);
    if ((!copied && !this.same(actual.upper, receipt.upper, unchanged))
      || !this.same(actual.lower, receipt.lower, unchanged)) throw new FsError("EAGAIN", { path });
  }

  private ancestors(path: string): string[] {
    const paths = ["/"];
    for (const component of dirname(path).split("/").filter(Boolean)) {
      paths.push(`${paths.at(-1) === "/" ? "" : paths.at(-1)}/${component}`);
    }
    return paths;
  }

  private inspect(path: string): FileStat | undefined {
    this.path(path);
    for (const parent of this.ancestors(path)) {
      const stat = this.visible(this.observation(parent));
      if (!stat) throw new FsError("ENOENT", { path: parent });
      if (stat.type !== "directory") throw new FsError("ENOTDIR", { path: parent });
      if (((stat.mode >> 6) & 1) !== 1) throw new FsError("EACCES", { path: parent });
    }
    return this.visible(this.observation(path));
  }

  private capture(path: string): FileStagingEntry[] {
    return this.ancestors(path).map(parent => {
      const physical = this.inspect(parent);
      if (physical?.type !== "directory") throw new FsError("ENOTDIR", { path: parent });
      return { path: parent, stat: this.stat(parent, physical) };
    });
  }

  private check(entries: readonly FileStagingEntry[]): void {
    for (const entry of entries) {
      this.expect(entry.path, entry.stat);
      if (this.inspect(entry.path)?.type !== "directory") throw new FsError("ENOTDIR", { path: entry.path });
    }
  }

  prepareChmod(path: string, options: ChmodOptions): (() => true) | undefined {
    const { signal, parent, expected, ancestors, commitGuard } = options;
    const sources = ancestors?.map(entry => ({ path: entry.path, stat: entry.stat }));
    const captured = snapshotConditionalChmod(path, {
      ...(signal === undefined ? {} : { signal }), ...(parent === undefined ? {} : { parent }),
      ...(expected === undefined ? {} : { expected }), ...(sources === undefined ? {} : { ancestors: sources }),
      ...(commitGuard === undefined ? {} : { commitGuard }),
    });
    if (!captured) return undefined;
    this.stores();
    this.path(path);
    const retain = (source: FileStat, snapshot: FileStat): void => {
      const receipt = this.receipts.get(source);
      if (!receipt) throw new FsError("ENOTSUP", { path, message: "unowned overlay chmod receipt" });
      this.receipts.set(snapshot, receipt);
    };
    retain(parent!, captured.parent);
    retain(expected!, captured.expected);
    for (const [index, entry] of captured.ancestors.entries()) retain(sources![index]!.stat, entry.stat);
    return () => {
      signal?.throwIfAborted();
      if (captured.commitGuard) runStagingGuard(captured.commitGuard);
      this.stores();
      this.check(captured.ancestors);
      this.expect(dirname(path), captured.parent);
      this.expect(path, captured.expected, captured.expected.type !== "directory");
      if (this.inspect(path)?.type !== captured.expected.type) throw new FsError("EAGAIN", { path });
      return true;
    };
  }

  private async copyParents(entries: readonly FileStagingEntry[], options: FsOptions): Promise<void> {
    for (const entry of entries) {
      options.signal?.throwIfAborted();
      this.check(entries);
      const observation = this.observation(entry.path);
      if (observation.upper) continue;
      const lower = observation.lower!;
      // Stock mkdir performs its complete mutation synchronously.
      const pending = this.upper.mkdir(entry.path, { ...options, mode: lower.mode & 0o7777 });
      this.copiedDirectory(entry.path, lower);
      await pending;
    }
  }

  async create(directory: string, name: string, content: StagedFileContent, options: CreateStagedFileOptions): Promise<FileStaging> {
    options.signal?.throwIfAborted();
    this.path(directory);
    this.expect(dirname(directory), options.parent);
    if (this.inspect(directory)) throw new FsError("EEXIST", { path: directory });
    const ancestors = this.capture(directory);
    await this.copyParents(ancestors, options);
    options.signal?.throwIfAborted();
    this.check(ancestors);
    this.expect(dirname(directory), options.parent);
    if (this.inspect(directory)) throw new FsError("EEXIST", { path: directory });
    const parent = this.observation(dirname(directory)).upper!;
    const staging = await this.upper.createStagedFile!(directory, name, content, { ...options, parent });
    this.stages.set(staging, staging);
    this.hidden.add(directory);
    return staging;
  }

  async publish(staging: FileStaging, path: string, options: PublishStagedFileOptions): Promise<void> {
    options.signal?.throwIfAborted();
    this.path(path);
    const owned = this.stages.get(staging);
    if (!owned) throw new FsError("ENOTSUP", { path });
    const paths = this.ancestors(path);
    const ancestors = options.ancestors;
    if (!ancestors || ancestors.length !== paths.length || ancestors.some((entry, index) => entry.path !== paths[index])) {
      throw new FsError("EINVAL", { path, message: "complete overlay ancestry is required" });
    }
    this.check(ancestors);
    this.expect(dirname(path), options.parent);
    const current = this.inspect(path);
    if (options.destination === null) {
      if (current) throw new FsError("EAGAIN", { path });
    } else {
      this.expect(path, options.destination, true);
      if (current?.type !== "file" || current.nlink !== 1) throw new FsError("EAGAIN", { path });
    }
    const translated = ancestors.map(entry => ({ path: entry.path, stat: this.observation(entry.path).upper! }));
    const target = this.observation(path).upper;
    // No await between the logical checks above and the physical commit below.
    await this.upper.publishStagedFile!(owned, path, {
      ...options, ancestors: translated, parent: translated.at(-1)!.stat, destination: target ?? null,
    });
  }

  async cleanup(staging: FileStaging, options: FsOptions): Promise<void> {
    this.stores();
    const owned = this.stages.get(staging);
    if (!owned) throw new FsError("ENOTSUP", { path: staging.directory.path });
    await this.upper.removeStagedFile!(owned, options);
    this.hidden.delete(owned.directory.path);
    this.stages.delete(staging);
  }

  confine(roots: readonly string[], options: FsOptions, run: <T>(options: FsOptions, operation: () => Promise<T>) => Promise<T>, fs: FileSystem): FileSystem {
    options.signal?.throwIfAborted();
    const retained = new Map<string, FileStat>();
    for (const root of roots) {
      this.path(root);
      const entries = [...this.capture(root), { path: root, stat: this.stat(root, this.inspect(root)!) }];
      for (const entry of entries) {
        if (entry.stat.type !== "directory") throw new FsError("ENOTDIR", { path: entry.path });
        retained.set(entry.path, entry.stat);
      }
    }
    return new Proxy(fs, {
      get: (target, property) => {
        if (property === "confineExtraction" || property === "objects") return undefined;
        if (["mkdir", "rm", "rmdir"].includes(String(property))) return (path: string, mutation: MkdirOptions & RemoveOptions = {}) => run(mutation, async () => {
          mutation.signal?.throwIfAborted();
          this.path(path);
          if (!roots.some(root => isPathWithin(root, path))) throw new FsError("EPERM", { path });
          this.check([...retained].filter(([root]) => isPathWithin(root, path)).map(([path, stat]) => ({ path, stat })));
          const current = this.inspect(path);
          if (property === "mkdir") {
            if (current) {
              if (mutation.recursive && current.type === "directory") return;
              throw new FsError("EEXIST", { path });
            }
            const entries = this.capture(path);
            await this.copyParents(entries, mutation);
            this.check([...retained].filter(([root]) => isPathWithin(root, path)).map(([path, stat]) => ({ path, stat })));
            this.check(entries);
            if (this.inspect(path)) throw new FsError("EAGAIN", { path });
            await this.upper.mkdir(path, mutation);
            this.opaque.add(path);
            return;
          }
          if (!current) {
            if (property === "rm" && mutation.force) return;
            throw new FsError("ENOENT", { path });
          }
          if (path === "/") throw new FsError("EBUSY", { path });
          if (current.type === "directory") {
            const stores = this.stores();
            const observation = this.observation(path);
            const names = new Set([
              ...(observation.upper ? stores.upper.names(path) : []),
              ...(observation.lower && !this.opaque.has(path) ? stores.lower.names(path) : []),
            ]);
            if ([...names].some(name => this.inspect(`${path}/${name}`))) throw new FsError("ENOTEMPTY", { path });
          } else if (property === "rmdir") throw new FsError("ENOTDIR", { path });
          const parent = this.inspect(dirname(path))!;
          if (((parent.mode >> 6) & 3) !== 3) throw new FsError("EACCES", { path });
          const upper = this.observation(path).upper;
          const removal = upper ? property === "rmdir"
            ? this.upper.rmdir!(path, mutation) : this.upper.rm(path, mutation) : undefined;
          // Bind the whiteout in the same turn as the stock upper removal.
          // Rejected Memory mutations leave the entry present.
          if (!upper || !this.physical(this.stores().upper, path)) {
            this.whiteouts.add(path);
            this.origins.delete(path);
          }
          await removal;
        });
        const value: unknown = Reflect.get(target, property, target);
        if (typeof value !== "function") return value;
        if (["lstat", "stat", "readFile", "readStream", "openReadFile", "readdir", "realpath", "access", "capabilitiesFor", "readlink"].includes(String(property))) return value.bind(target);
        return () => { throw new FsError("ENOTSUP", { syscall: String(property) }); };
      },
    });
  }
}
