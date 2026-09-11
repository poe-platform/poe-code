import { readBytes, type ByteSource, type CommandContext, type FileStat, type FileStaging } from "../../../contracts/index.js";
import { retainFileSystemCleanup } from "poe-code/safe-fs/core";
import { checkPath, fail, type ArchiveLimits } from "../internal.js";

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
  readonly parentStat: FileStat;
  readonly bytes: Uint8Array;
}

export async function publishZip(scope: ZipScope, prepared: ZipPublication): Promise<void> {
  const { fs, signal } = scope.context;
  const capabilities = await scope.operation(() => fs.capabilitiesFor?.(prepared.output, { signal, create: true }) ?? fs.capabilities);
  if (capabilities.atomicFileStaging !== true || !fs.createStagedFile || !fs.publishStagedFile || !fs.removeStagedFile) fail("ZIP publication requires atomic owned file staging");
  let staging: FileStaging | undefined;
  let failure: { reason: unknown } | undefined;
  const close = retainFileSystemCleanup(fs, async cleanup => {
    if (staging) {
      if (!cleanup.removeStagedFile) fail("ZIP atomic cleanup unavailable");
      await cleanup.removeStagedFile(staging);
    }
  }, { maxOperations: 16 });
  try {
    for (let attempt = 0; attempt < Math.min(64, scope.limits.maxMembers); attempt++) {
      const path = `${prepared.parent === "/" ? "" : prepared.parent}/.zip-${attempt + 1}`;
      checkPath(path, scope.limits);
      checkPath(`${path}/archive.zip`, scope.limits);
      if (path === prepared.output) continue;
      try {
        await scope.operation(async () => {
          staging = await fs.createStagedFile!(path, "archive.zip", { type: "file", data: prepared.bytes }, {
            signal, parent: prepared.parentStat, ...(prepared.existing ? { mode: prepared.existing.mode & 0o7777 } : {}),
          });
        });
        break;
      } catch (error) {
        signal.throwIfAborted();
        if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "EEXIST") throw error;
      }
    }
    if (!staging) fail("ZIP temporary directory attempt limit exceeded");
    const parent = await scope.operation(() => fs.realpath(prepared.parentName, { signal }));
    if (parent !== prepared.parent) fail("archive parent changed before publication");
    await scope.operation(() => fs.publishStagedFile!(staging!, prepared.output, {
      signal, parent: prepared.parentStat, destination: prepared.existing ?? null,
    }));
  } catch (error) { failure = { reason: error }; }
  try { await close(); }
  catch (error) {
    if (failure) throw new AggregateError([failure.reason, error], "ZIP publication and cleanup failed");
    throw error;
  }
  if (failure) throw failure.reason;
}
