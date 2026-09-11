import { dirname, isPathWithin, readBytes, resolvePath, type ByteSource, type CommandContext, type FileStat, type FileStaging } from "../../../contracts/index.js";
import { retainFileSystemCleanup } from "poe-code/safe-fs/core";
import { checkPath, display, fail, hasIdentity, sameIdentity, type ArchiveLimits } from "../internal.js";

export class Extraction {
  private readonly pending = new Set<Promise<unknown>>();
  private readonly publications = new Set<Promise<void>>();
  private readonly readers = new Set<() => Promise<void>>();
  private closed = false;
  private work = 0;
  private serial = 0;
  constructor(readonly context: CommandContext, readonly limits: ArchiveLimits) {}
  async operation<Value>(action: () => Promise<Value>): Promise<Value> {
    this.context.signal.throwIfAborted();
    if (this.closed) fail("extraction is closed");
    if (++this.work > this.limits.maxPatternSteps) fail("filesystem work limit exceeded");
    const pending = Promise.resolve().then(() => { this.context.signal.throwIfAborted(); return action(); });
    this.pending.add(pending);
    try { const value = await pending; this.context.signal.throwIfAborted(); return value; }
    finally { this.pending.delete(pending); }
  }
  async close(): Promise<void> {
    this.closed = true;
    while (this.pending.size) await Promise.allSettled([...this.pending]);
    while (this.publications.size) await Promise.allSettled([...this.publications]);
    await Promise.allSettled([...this.readers].map(close => close()));
  }
  source(source: ByteSource): ByteSource {
    return { [Symbol.asyncIterator]: () => {
      const state: { iterator?: AsyncIterator<Uint8Array> } = {};
      let closing: Promise<void> | undefined;
      const close = () => closing ??= (async () => {
        try { await state.iterator?.return?.(); }
        finally { this.readers.delete(close); }
      })();
      this.readers.add(close);
      this.context.signal.throwIfAborted();
      state.iterator = source[Symbol.asyncIterator]();
      return {
        next: () => this.operation(async () => {
          const result = await state.iterator!.next();
          if (result.done) this.readers.delete(close);
          return result;
        }),
        async return() { await close(); return { done: true as const, value: undefined }; },
      };
    } };
  }
  async *input(path: string): ByteSource {
    const { fs, signal } = this.context;
    const capabilities = await this.operation(async () => await fs.capabilitiesFor?.(path, { signal }) ?? fs.capabilities);
    if (fs.readStream && capabilities.streamingRead !== false) {
      const source = await this.operation(async () => fs.readStream!(path, { signal, chunkSize: this.limits.chunkSize }));
      yield* readBytes(this.source(source), signal);
    } else {
      const stat = await this.operation(() => fs.stat(path, { signal }));
      if (stat.size > this.limits.maxBufferedFileBytes) fail("filesystem lacks streaming reads: buffered file limit exceeded");
      const bytes = await this.operation(() => fs.readFile(path, { signal, maxBytes: this.limits.maxBufferedFileBytes }));
      if (bytes.length > this.limits.maxBufferedFileBytes) fail("buffered file limit exceeded");
      yield bytes;
    }
  }
  async stat(path: string): Promise<FileStat | undefined> {
    try { return await this.operation(() => this.context.fs.lstat(path, { signal: this.context.signal })); }
    catch (error) {
      this.context.signal.throwIfAborted();
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    }
  }
  async directory(raw: string, create: boolean): Promise<string> {
    checkPath(raw, this.limits);
    let current = "/";
    const { fs, signal } = this.context;
    for (const component of raw.split("/")) {
      if (!component || component === ".") continue;
      const parent = await this.operation(() => fs.lstat(current, { signal }));
      current = resolvePath(current, component);
      const stat = await this.stat(current);
      if (!stat && create) await this.createDirectory(current, parent);
      else if (!stat || stat.type !== "directory") fail(`unsafe non-directory or symlink ancestor: ${display(current)}`);
    }
    return current;
  }
  async createDirectory(path: string, parent: FileStat): Promise<FileStat> {
    const { fs, signal } = this.context;
    const capabilities = await this.operation(async () => await fs.capabilitiesFor?.(path, { signal }) ?? fs.capabilities);
    if (capabilities.atomicDirectoryMetadata !== true || !fs.prepareDirectory) fail("extraction requires atomic directory creation");
    return this.operation(() => fs.prepareDirectory!(path, {
      signal, parent, expected: null,
      ...(capabilities.permissions === false ? {} : { mode: 0o755 }),
    }));
  }
  async parents(root: string, path: string, create: boolean): Promise<void> {
    if (!isPathWithin(root, path)) fail("extraction path escapes root");
    await this.directory(dirname(path), create);
  }
  member(root: string, name: string): string {
    checkPath(name, this.limits);
    if (name.startsWith("/") || name.split("/").includes("..")) fail(`unsafe archive member: ${display(name)}`);
    const path = resolvePath(root, name);
    checkPath(path, this.limits);
    if (!isPathWithin(root, path)) fail("extraction path escapes root");
    return path;
  }
  async target(root: string, path: string, target: string): Promise<void> {
    checkPath(target, this.limits);
    if (target.startsWith("/")) fail("symlink target escapes extraction root");
    let current = dirname(path);
    const components = (value: string): string[] => {
      checkPath(value, this.limits);
      let descended = false;
      const result = value.split("/");
      for (const component of result) {
        if (component === ".." && descended) fail("unsafe non-leading parent in symlink target");
        if (component && component !== "." && component !== "..") descended = true;
      }
      return result;
    };
    let pending = components(target);
    let links = 0;
    let steps = 0;
    while (pending.length) {
      if (++steps > this.limits.maxDepth * 41) fail("symlink target resolution limit exceeded");
      const component = pending.shift()!;
      if (!component || component === ".") continue;
      if (component === "..") {
        if (current === root) fail("symlink target escapes extraction root");
        current = dirname(current); continue;
      }
      const candidate = resolvePath(current, component);
      checkPath(candidate, this.limits);
      if (!isPathWithin(root, candidate)) fail("symlink target escapes extraction root");
      const stat = await this.stat(candidate);
      if (stat?.type === "symlink") {
        if (++links > 40 || !this.context.fs.readlink) fail("symlink target chain cannot be safely resolved");
        const link = await this.operation(() => this.context.fs.readlink!(candidate, { signal: this.context.signal }));
        if (link.startsWith("/")) fail("absolute symlink target chain is unsafe");
        pending = [...components(link), ...pending];
        if (pending.length > this.limits.maxDepth * 41) fail("symlink target resolution limit exceeded");
      } else current = candidate;
    }
  }
  async destination(path: string, archivePath: string, archiveStat: FileStat): Promise<FileStat | undefined> {
    const stat = await this.stat(path);
    if (path === archivePath || (stat && sameIdentity(stat, archiveStat))) fail("entry would overwrite input archive");
    if (stat && stat.type !== "file") fail(`unsafe non-regular destination: ${display(path)}`);
    if (stat && (!hasIdentity(stat) || !hasIdentity(archiveStat))) fail("cannot overwrite file with unknown input-archive backing identity");
    return stat;
  }
  async checked(root: string, path: string, expected: FileStat): Promise<void> {
    await this.parents(root, path, false);
    const current = await this.stat(path);
    if (!current || current.type !== expected.type || !sameIdentity(current, expected)) fail("extraction entry changed before mutation");
  }
  async metadata(root: string, path: string, identity: FileStat, parent: FileStat, mode: number, modified: Date): Promise<void> {
    const { fs, signal } = this.context;
    await this.parents(root, path, false);
    const capabilities = await this.operation(async () => await fs.capabilitiesFor?.(path, { signal }) ?? fs.capabilities);
    if (capabilities.permissions === false && capabilities.timestamps === false) return;
    if (capabilities.atomicDirectoryMetadata !== true || !fs.prepareDirectory) fail("extraction metadata requires atomic entry conditions");
    await this.operation(() => fs.prepareDirectory!(path, {
      signal, expected: identity, parent,
      ...(capabilities.permissions === false ? {} : { mode: mode & 0o777 }),
      ...(capabilities.timestamps === false ? {} : { atimeMs: modified.getTime(), mtimeMs: modified.getTime() }),
    }));
  }
  publish(root: string, path: string, chunks: readonly Uint8Array[], expected: FileStat | undefined, parent: FileStat, mode: number, modified: Date, target?: string): Promise<void> {
    const publication = this.stage(root, path, chunks, expected, parent, mode, modified, target);
    this.publications.add(publication);
    return publication.finally(() => { this.publications.delete(publication); });
  }
  private async stage(root: string, path: string, chunks: readonly Uint8Array[], expected: FileStat | undefined, parent: FileStat, mode: number, modified: Date, target: string | undefined): Promise<void> {
    const { fs, signal } = this.context;
    const capabilities = await this.operation(async () => await fs.capabilitiesFor?.(path, { signal }) ?? fs.capabilities);
    if (capabilities.atomicFileStaging !== true || !fs.createStagedFile || !fs.publishStagedFile || !fs.removeStagedFile) fail("extraction requires atomic owned file staging");
    let staging: FileStaging | undefined;
    let failure: { reason: unknown } | undefined;
    const cleanup = retainFileSystemCleanup(fs, async view => {
      if (staging) {
        if (!view.removeStagedFile) fail("extraction atomic cleanup unavailable");
        await view.removeStagedFile(staging);
      }
    }, { maxOperations: Math.min(4096, this.limits.maxDepth + 3) });
    try {
      await this.parents(root, path, false);
      const content = target === undefined ? { type: "file" as const, data: Buffer.concat(chunks) } : { type: "symlink" as const, target };
      for (let attempt = 0; attempt < this.limits.maxMembers; attempt++) {
        const temporary = resolvePath(dirname(path), `.unzip-${++this.serial}`);
        checkPath(temporary, this.limits);
        checkPath(`${temporary}/entry`, this.limits);
        if (temporary === path) continue;
        try {
          await this.operation(async () => {
            staging = await fs.createStagedFile!(temporary, "entry", content, {
              signal, parent,
              ...(target !== undefined || capabilities.permissions === false ? {} : { mode: mode & 0o777 }),
              ...(target !== undefined || capabilities.timestamps === false ? {} : { atimeMs: modified.getTime(), mtimeMs: modified.getTime() }),
            });
          });
          break;
        } catch (error) {
          signal.throwIfAborted();
          if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "EEXIST") throw error;
        }
      }
      if (!staging) fail("temporary file attempt limit exceeded");
      await this.parents(root, path, false);
      await this.operation(() => fs.publishStagedFile!(staging!, path, { signal, parent, destination: expected ?? null }));
    } catch (error) { failure = { reason: error }; }
    try { await cleanup(); }
    catch (error) {
      if (failure) throw new AggregateError([failure.reason, error], "unzip publication and cleanup failed");
      throw error;
    }
    if (failure) throw failure.reason;
  }
}
