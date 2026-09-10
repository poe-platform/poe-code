import { readBytes, type ByteSource, type CommandContext, type FileStat } from "../../../contracts/index.js";
import { retainFileSystemCleanup } from "poe-code/safe-fs/core";
import { checkPath, fail, hasIdentity, sameIdentity, type ArchiveLimits } from "../internal.js";

export class ZipScope {
  readonly context: CommandContext;
  private readonly controller = new AbortController();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly readers = new Set<() => Promise<void>>();
  private readonly closedReason = new Error("ZIP command is closed");
  private drain: Promise<void> | undefined;
  private work = 0;
  constructor(private readonly original: CommandContext, readonly limits: ArchiveLimits) {
    this.context = { ...original, signal: AbortSignal.any([original.signal, this.controller.signal]) };
    original.registerCleanup?.(this.close);
  }
  readonly close = (): Promise<void> => {
    if (!this.drain) {
      this.drain = Promise.resolve().then(async () => {
        while (this.pending.size) await Promise.allSettled([...this.pending]);
        const results = await Promise.allSettled([...this.readers].map(close => close()));
        const failures = results.filter(result => result.status === "rejected").map(result => result.reason);
        if (failures.length === 1) throw failures[0];
        if (failures.length) throw new AggregateError(failures, "ZIP reader cleanup failed");
      });
      this.controller.abort(this.original.signal.aborted ? this.original.signal.reason : this.closedReason);
    }
    return this.drain;
  };
  async operation<Value>(action: () => Value | PromiseLike<Value>): Promise<Value> {
    this.context.signal.throwIfAborted();
    if (++this.work > this.limits.maxPatternSteps) fail("filesystem work limit exceeded");
    const pending = Promise.resolve().then(() => { this.context.signal.throwIfAborted(); return action(); });
    this.pending.add(pending);
    try {
      const value = await pending;
      this.context.signal.throwIfAborted();
      return value;
    } finally { this.pending.delete(pending); }
  }
  async stat(path: string): Promise<FileStat | undefined> {
    try { return await this.operation(() => this.context.fs.lstat(path, { signal: this.context.signal })); }
    catch (error) {
      this.context.signal.throwIfAborted();
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    }
  }
  private source(source: ByteSource): ByteSource {
    const iterator = source[Symbol.asyncIterator]();
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => closing ??= (async () => {
      try { await iterator.return?.(); }
      finally { this.readers.delete(close); }
    })();
    this.readers.add(close);
    return { [Symbol.asyncIterator]: () => ({
      next: () => this.operation(async () => {
        const result = await iterator.next();
        if (result.done) this.readers.delete(close);
        return result;
      }),
      async return() { await close(); return { done: true as const, value: undefined }; },
    }) };
  }
  async *input(path: string): ByteSource {
    const { fs, signal } = this.context;
    const capabilities = await this.operation(() => fs.capabilitiesFor?.(path, { signal }) ?? fs.capabilities);
    if (fs.readStream && capabilities.streamingRead !== false) {
      const source = await this.operation(() => this.source(fs.readStream!(path, { signal, chunkSize: this.limits.chunkSize })));
      yield* readBytes(source, signal);
    } else {
      const stat = await this.operation(() => fs.stat(path, { signal }));
      if (stat.size > this.limits.maxBufferedFileBytes) fail("filesystem lacks streaming reads: buffered file limit exceeded");
      const bytes = await this.operation(() => fs.readFile(path, { signal, maxBytes: this.limits.maxBufferedFileBytes }));
      if (bytes.length > this.limits.maxBufferedFileBytes) fail("buffered file limit exceeded");
      yield bytes;
    }
  }
}

export interface ZipPublication {
  readonly output: string;
  readonly parent: string;
  readonly parentName: string;
  readonly existing: FileStat | undefined;
  readonly bytes: Uint8Array;
}

export async function publishZip(scope: ZipScope, prepared: ZipPublication): Promise<void> {
  const { fs, signal } = scope.context;
  const capabilities = await scope.operation(() => fs.capabilitiesFor?.(prepared.output, { signal }) ?? fs.capabilities);
  if (capabilities.atomicRename !== true || capabilities.exclusiveCreate !== true || capabilities.explicitDirectories !== true
    || capabilities.permissions !== true || !fs.rmdir || (prepared.existing ? !fs.chmod : capabilities.atomicRenameNoReplace !== true)) fail("ZIP publication requires atomic rename, exclusive creation, private directories and mode preservation");
  let directory: { path: string; stat: FileStat } | undefined;
  let temporary = "";
  let identity: FileStat | undefined;
  let published = false;
  let collision = false;
  let failure: { reason: unknown } | undefined;
  const checkOwner = async (): Promise<void> => {
    const parent = await scope.operation(() => fs.realpath(prepared.parentName, { signal }));
    const owner = directory && await scope.stat(directory.path);
    if (parent !== prepared.parent || !owner || owner.type !== "directory" || !sameIdentity(owner, directory!.stat)) fail("ZIP temporary ownership changed before mutation");
  };
  const close = retainFileSystemCleanup(fs, async cleanup => {
    if (!directory || !hasIdentity(directory.stat)) return;
    const parent = await cleanup.realpath(prepared.parentName);
    const owner = await cleanup.lstat(directory.path);
    if (parent !== prepared.parent || owner.type !== "directory" || !sameIdentity(owner, directory.stat)) fail("ZIP temporary ownership changed before cleanup");
    if (temporary && !published && !collision) {
      let current: FileStat | undefined;
      try { current = await cleanup.lstat(temporary); }
      catch (error) { if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "ENOENT") throw error; }
      if (current) {
        if (!identity || !sameIdentity(current, identity) || current.type !== "file" || current.nlink !== 1) fail("ZIP temporary file changed before cleanup");
        await cleanup.rm(temporary);
      }
    }
    await cleanup.rmdir!(directory.path);
  }, { maxOperations: 16 });
  try {
    for (let attempt = 0; attempt < Math.min(64, scope.limits.maxMembers); attempt++) {
      const path = `${prepared.parent === "/" ? "" : prepared.parent}/.zip-${attempt + 1}`;
      checkPath(path, scope.limits);
      if (path === prepared.output) continue;
      try {
        await scope.operation(async () => {
          await fs.mkdir(path, { signal, mode: 0o700 });
          directory = { path, stat: await fs.lstat(path) };
        });
        break;
      } catch (error) {
        signal.throwIfAborted();
        if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "EEXIST") throw error;
      }
    }
    if (!directory) fail("ZIP temporary directory attempt limit exceeded");
    if (directory.stat.type !== "directory" || !hasIdentity(directory.stat) || (directory.stat.mode & 0o777) !== 0o700) fail("ZIP temporary directory ownership unavailable");
    temporary = `${directory.path}/archive.zip`;
    checkPath(temporary, scope.limits);
    await checkOwner();
    await scope.operation(async () => {
      let writeFailure: { reason: unknown } | undefined;
      try { await fs.writeFile(temporary, prepared.bytes, { signal, flag: "wx", ...(prepared.existing ? { mode: prepared.existing.mode & 0o7777 } : {}) }); }
      catch (error) {
        collision = typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
        writeFailure = { reason: error };
      }
      if (!collision) {
        await checkOwner();
        try { identity = await fs.lstat(temporary); }
        catch (error) { if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "ENOENT") throw error; }
      }
      if (writeFailure) throw writeFailure.reason;
    });
    if (!identity || !hasIdentity(identity) || identity.type !== "file" || identity.nlink !== 1 || identity.size !== prepared.bytes.length) fail("ZIP staged archive identity or size changed");
    if (prepared.existing) {
      await checkOwner();
      await scope.operation(() => fs.chmod!(temporary, prepared.existing!.mode & 0o7777, { signal }));
    }
    const parent = await scope.operation(() => fs.realpath(prepared.parentName, { signal }));
    const current = await scope.stat(prepared.output);
    if (parent !== prepared.parent || (prepared.existing ? !current || !sameIdentity(prepared.existing, current)
      || current.type !== "file" || current.nlink !== 1 || current.size !== prepared.existing.size
      || current.mode !== prepared.existing.mode || current.mtimeMs !== prepared.existing.mtimeMs || current.ctimeMs !== prepared.existing.ctimeMs : current !== undefined)) fail("archive backing entry changed before publication");
    const staging = await scope.stat(temporary);
    const owner = await scope.stat(directory.path);
    if (!staging || !sameIdentity(staging, identity) || staging.type !== "file" || staging.nlink !== 1 || staging.size !== prepared.bytes.length
      || !owner || !sameIdentity(owner, directory.stat) || owner.type !== "directory") fail("ZIP temporary ownership changed before publication");
    await scope.operation(async () => {
      await fs.rename(temporary, prepared.output, { signal, ...(!prepared.existing ? { noReplace: true } : {}) });
      published = true;
    });
  } catch (error) { failure = { reason: error }; }
  try { await close(); }
  catch (error) {
    if (failure) throw new AggregateError([failure.reason, error], "ZIP publication and cleanup failed");
    throw error;
  }
  if (failure) throw failure.reason;
}
