import type { ZipReadSource } from "./ranges.js";
import { readFileStream } from "safe-bash-contracts/filesystem";
import { retainFileSystemCleanup } from "@poe-code/safe-fs/core";
import { collectBytes,readBytes,type ByteSource,type CommandContext,type FileReadHandle,type FileStaging,type FileStat } from "safe-bash-contracts";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output";
import { admitArchiveInput,archiveStorageContext,checkPath,fail,hasIdentity as hasPosixIdentity,sameIdentity as samePosixIdentity,type ArchiveLimits } from "safe-bash-io-engine/commands/archive/internal";

export function hasZipIdentity(stat: FileStat): boolean {
  return hasPosixIdentity(stat) || ((typeof stat.identityScope === "object" && stat.identityScope !== null || typeof stat.identityScope === "symbol")
    && typeof stat.opaqueIdentity === "string" && stat.opaqueIdentity.length > 0 && stat.opaqueIdentity.length <= 4096
    && hasZipVersion(stat));
}

function hasZipVersion(stat: FileStat): boolean {
  return typeof stat.opaqueVersion === "string" && stat.opaqueVersion.length > 0 && stat.opaqueVersion.length <= 4096;
}

export function sameZipIdentity(first: FileStat, second: FileStat): boolean {
  return samePosixIdentity(first, second) || hasZipIdentity(first) && hasZipIdentity(second)
    && first.opaqueIdentity !== undefined && first.identityScope === second.identityScope && first.opaqueIdentity === second.opaqueIdentity;
}

export function unchangedZipSource(before: FileStat, after: FileStat): boolean {
  return before.type === after.type && before.size === after.size && before.mode === after.mode
    && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs
    && before.nlink === after.nlink && before.opaqueVersion === after.opaqueVersion && before.revision === after.revision
    && (!hasZipIdentity(before) || sameZipIdentity(before, after));
}

export async function safeZipFile(scope: ZipScope, path: string, stat: FileStat, allowHardlinked = false): Promise<boolean> {
  if (stat.type !== "file" || !hasZipIdentity(stat)) return false;
  if (stat.nlink !== undefined) {
    if (stat.nlink === 1) return true;
    if (!allowHardlinked || stat.nlink < 1 || !hasPosixIdentity(stat)) return false;
    const capabilities = await scope.operation(() => scope.context.fs.capabilitiesFor?.(path, { signal: scope.context.signal }) ?? scope.context.fs.capabilities);
    return capabilities.hardlinks === true && capabilities.atomicFileMutation === true && typeof scope.context.fs.writeFileConditional === "function";
  }
  const capabilities = await scope.operation(() => scope.context.fs.capabilitiesFor?.(path, { signal: scope.context.signal }) ?? scope.context.fs.capabilities);
  return stat.opaqueIdentity !== undefined && capabilities.hardlinks === false;
}

export class ZipScope {
  readonly context: CommandContext;
  private readonly controller = new AbortController();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly readers = new Set<() => Promise<void>>();
  private readonly closedReason = new Error("ZIP command is closed");
  private drain: Promise<void> | undefined;
  private inputDrain: Promise<void> | undefined;
  private work = 0;
  private stdinSource: ByteSource | undefined;
  constructor(private readonly original: CommandContext, readonly limits: ArchiveLimits) {
    this.context = Object.create(Object.getPrototypeOf(original), {
      ...Object.getOwnPropertyDescriptors(original),
      signal: { value: AbortSignal.any([original.signal, this.controller.signal]), enumerable: true },
    }) as CommandContext;
    original.registerCleanup?.(this.close);
  }
  readonly close = (): Promise<void> => {
    if (!this.drain) {
      this.drain = Promise.resolve().then(async () => {
        while (this.pending.size) await Promise.allSettled([...this.pending]);
        await this.closeInputs();
      });
      this.controller.abort(this.original.signal.aborted ? this.original.signal.reason : this.closedReason);
    }
    return this.drain;
  };
  retain(close: () => Promise<void>): void {
    if (this.inputDrain) fail("ZIP inputs are closed");
    this.readers.add(close);
  }
  closeInputs(): Promise<void> {
    return this.inputDrain ??= Promise.allSettled([...this.readers].map(close => close())).then(results => {
      const failures = results.filter(result => result.status === "rejected").map(result => result.reason);
      if (failures.length === 1) throw failures[0];
      if (failures.length) throw new AggregateError(failures, "ZIP reader cleanup failed");
    });
  }
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
  get stdin(): ByteSource {
    return this.stdinSource ??= this.source(this.original.stdin);
  }
  source(source: ByteSource, controller?: AbortController): ByteSource {
    if (this.inputDrain) fail("ZIP inputs are closed");
    const iterator = source[Symbol.asyncIterator]();
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => closing ??= (async () => {
      controller?.abort(this.closedReason);
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
  async *input(path: string, fifo = false, expected?: FileStat): ByteSource {
    const { fs } = this.context;
    if (expected) {
      const capabilities = await this.operation(() => fs.capabilitiesFor?.(path, { signal: this.context.signal }) ?? fs.capabilities);
      if (!hasZipIdentity(expected) || !fs.openReadFile || capabilities.retainedRead !== true) {
        const { signal } = this.context;
        const canonical = await this.operation(() => fs.realpath(path, { signal }));
        const before = await this.operation(() => fs.stat(path, { signal }));
        if (!unchangedZipSource(expected, before)) fail(`source changed while opening: ${path}`);
        let size = 0;
        for await (const bytes of this.input(path)) {
          if (bytes.length > expected.size - size) fail(`source changed while reading: ${path}`);
          size += bytes.length;
          yield bytes;
        }
        const current = await this.operation(() => fs.stat(path, { signal }));
        if (size !== expected.size || !unchangedZipSource(expected, current)
          || canonical !== await this.operation(() => fs.realpath(path, { signal }))) fail(`source changed while reading: ${path}`);
        return;
      }
      const controller = new AbortController();
      const signal = AbortSignal.any([this.context.signal, controller.signal]);
      let handle: FileReadHandle | undefined;
      let acquisition: Promise<void> | undefined;
      let reading: Promise<unknown> | undefined;
      let closing: Promise<void> | undefined;
      const close = (): Promise<void> => closing ??= (async () => {
        controller.abort(this.closedReason);
        try {
          await acquisition?.catch(() => {});
          await reading?.catch(() => {});
          await handle?.close();
        }
        finally { this.readers.delete(close); }
      })();
      if (this.inputDrain) fail("ZIP inputs are closed");
      this.readers.add(close);
      try {
        await (acquisition = this.operation(async () => {
          const capabilities = await (fs.capabilitiesFor?.(path, { signal }) ?? fs.capabilities);
          signal.throwIfAborted();
          if (capabilities.retainedRead !== true || !fs.openReadFile) fail("ZIP source requires retained reads");
          handle = await fs.openReadFile(path, { signal });
        }));
        if (this.inputDrain) fail("ZIP inputs are closed");
        const stat = await (reading = this.operation(() => handle!.stat({ signal })));
        if (!unchangedZipSource(expected, stat)) fail(`source changed while opening: ${path}`);
        let position = 0;
        while (position < expected.size) {
          const size = Math.min(this.limits.chunkSize, expected.size - position);
          signal.throwIfAborted();
          const bytes = await (reading = this.operation(() => handle!.read(position, size, { signal })));
          signal.throwIfAborted();
          if (!bytes.length || bytes.length > size) fail(`source changed while reading: ${path}`);
          position += bytes.length;
          yield bytes;
        }
        signal.throwIfAborted();
        const current = await (reading = this.operation(() => handle!.stat({ signal })));
        if (!unchangedZipSource(expected, current)) fail(`source changed while reading: ${path}`);
      } finally { await close(); }
      return;
    }
    const controller = new AbortController();
    const signal = AbortSignal.any([this.context.signal, controller.signal]);
    const capabilities = await this.operation(() => fs.capabilitiesFor?.(path, { signal }) ?? fs.capabilities);
    if (fifo && (!fs.readStream || capabilities.streamingRead !== true)) fail("filesystem lacks explicit FIFO byte stream capability");
    const source = await this.operation(() => this.source(readFileStream(fs, path, { signal, chunkSize: this.limits.chunkSize }), controller));
    yield* readBytes(source, signal);
  }
}

export interface ZipPublication {
  readonly output: string;
  readonly parent: string;
  readonly parentName: string;
  readonly existing: FileStat | undefined;
  readonly parentStat: FileStat;
  readonly bytes?: Uint8Array;
  readonly source?: ByteSource;
  readonly mtimeMs?: number;
  readonly stagingName?: string;
  readonly stagingParent?: string;
  readonly stagingParentStat?: FileStat;
  readonly validate?: (path: string) => Promise<void>;
}

export interface ZipStaging {
  readonly stagingPrefix?: string;
  readonly reservedPath?: string;
  readonly parent: string;
  readonly parentStat: FileStat;
  readonly existing?: FileStat | undefined;
  readonly bytes?: Uint8Array;
  readonly source?: ByteSource;
  readonly mtimeMs?: number;
}

/** Own a temporary archive through acquisition, writing, consumption and cleanup. */
export async function stageZip(scope: ZipScope, prepared: ZipStaging, consume: (staging: FileStaging) => Promise<void>): Promise<void> {
  const { fs, signal } = scope.context;
  const capabilities = await scope.operation(() => fs.capabilitiesFor?.(prepared.parent, { signal }) ?? fs.capabilities);
  if ((capabilities.atomicFileStaging !== true && capabilities.trustedOwnedStaging !== true) || !fs.createStagedFile || !fs.removeStagedFile) fail("ZIP temporary path requires atomic owned file staging");
  if (prepared.source && ((capabilities.atomicFileMutation !== true && capabilities.trustedOwnedStaging !== true) || !fs.writeFileConditional)) fail("ZIP temporary path requires atomic conditional writes");
  // Caller-owned receipts can be opaque and immutable. Without retained
  // writers, complete the bytes before creating the receipt so publication and
  // cleanup receive exactly the object (and file version) the caller owns.
  const buffered = prepared.source && capabilities.retainedStagingWrite !== true
    ? await collectBytes(prepared.source, { signal, maxBytes: scope.limits.maxArchiveBytes }) : undefined;
  let staging: FileStaging | undefined;
  let failure: { reason: unknown } | undefined;
  const close = retainFileSystemCleanup(fs, async cleanup => {
    if (staging) {
      if (!cleanup.removeStagedFile) fail("ZIP atomic cleanup unavailable");
      if (staging.cleanup) await staging.cleanup.remove();
      else await cleanup.removeStagedFile(staging);
    }
  }, { maxOperations: 16 });
  try {
    for (let attempt = 0; attempt < scope.limits.maxMembers; attempt++) {
      const path = `${prepared.parent === "/" ? "" : prepared.parent}/.${prepared.stagingPrefix ?? "zip"}-${attempt + 1}`;
      checkPath(path, scope.limits);
      checkPath(`${path}/archive.zip`, scope.limits);
      if (path === prepared.reservedPath) continue;
      try {
        await scope.operation(async () => {
          staging = await fs.createStagedFile!(path, "archive.zip", { type: "file", data: buffered ?? prepared.bytes ?? new Uint8Array() }, {
            signal, parent: prepared.parentStat, ...(capabilities.retainedStagingCleanup ? { retainCleanup: true } : {}), ...(prepared.existing ? { mode: prepared.existing.mode & 0o7777 } : {}),
            ...(prepared.mtimeMs === undefined ? {} : { mtimeMs: prepared.mtimeMs, atimeMs: prepared.mtimeMs }),
          });
        });
        break;
      } catch (error) {
        signal.throwIfAborted();
        if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "EEXIST") throw error;
      }
    }
    if (!staging) fail("ZIP temporary directory attempt limit exceeded");
    if (prepared.source && buffered === undefined) {
      for await (const chunk of readBytes(prepared.source, signal)) {
        try { await writeFileOutput(scope.context, chunk, bytes => scope.operation(async () => {
          if (staging!.writer) {
            await staging!.writer.write(bytes, { signal });
            return;
          }
          const stat = await fs.writeFileConditional!(staging!.file.path, bytes, {
            signal, parent: staging!.directory.stat, expected: staging!.file.stat, append: true,
          });
          staging = { ...staging!, file: { path: staging!.file.path, stat } };
        })); } catch (error) {
          void scope.closeInputs().catch(() => {});
          throw error;
        }
      }
    }
    if (staging.writer) {
      const stat = await scope.operation(() => staging!.writer!.finish({ signal }));
      staging = { ...staging, file: { ...staging.file, stat } };
    }
    if (prepared.mtimeMs !== undefined && (staging.file.stat.mtimeMs !== prepared.mtimeMs || staging.file.stat.atimeMs !== prepared.mtimeMs)) fail("ZIP staging did not retain archive modification time");
    await consume(staging);
  } catch (error) { failure = { reason: error }; }
  try { await close(); }
  catch (error) {
    if (failure) throw new AggregateError([failure.reason, error], "ZIP publication and cleanup failed");
    throw error;
  }
  if (failure) throw failure.reason;
}

export async function publishZip(scope: ZipScope, prepared: ZipPublication): Promise<void> {
  const { fs, signal } = scope.context;
  const capabilities = await scope.operation(() => fs.capabilitiesFor?.(prepared.output, { signal, create: true }) ?? fs.capabilities);
  if (capabilities.atomicFilePublication === true && fs.publishFileConditional && !prepared.validate && prepared.stagingName === undefined) {
    if (capabilities.readOnly === true || capabilities.write === false) fail("ZIP destination is not writable");
    if (prepared.existing && (!hasZipIdentity(prepared.existing) || !hasZipVersion(prepared.existing))) fail("ZIP conditional publication requires an observed opaque version");
    const parent = await scope.operation(() => fs.realpath(prepared.parentName, { signal }));
    if (parent !== prepared.parent) fail("archive parent changed before publication");
    let size = 0;
    let completed = false;
    let active = true;
    const input = prepared.source ?? { async *[Symbol.asyncIterator]() { yield prepared.bytes ?? new Uint8Array(); } };
    const source = scope.source((async function* (): ByteSource {
      for await (const chunk of readBytes(input, signal)) {
        if (!active) fail("ZIP publication source is closed");
        if (chunk.length > scope.limits.maxArchiveBytes - size) fail("archive byte limit exceeded");
        size += chunk.length;
        let owned = chunk;
        if (prepared.source) await writeFileOutput(scope.context, chunk, async bytes => { owned = Uint8Array.from(bytes); });
        yield owned;
      }
      completed = true;
    })());
    try {
      const receipt = await scope.operation(() => fs.publishFileConditional!(prepared.output, source, {
        signal, parent: prepared.parentStat, expected: prepared.existing ?? null, maxBytes: Number.isFinite(scope.limits.maxArchiveBytes) ? scope.limits.maxArchiveBytes : Number.MAX_SAFE_INTEGER,
        ...(prepared.existing && capabilities.permissions !== false ? { mode: prepared.existing.mode & 0o7777 } : {}),
        ...(prepared.mtimeMs === undefined ? {} : { mtimeMs: prepared.mtimeMs }),
      }));
      if (!completed || receipt.type !== "file" || receipt.size !== size || !hasZipIdentity(receipt)
        || !hasZipVersion(receipt) || prepared.existing?.opaqueVersion === receipt.opaqueVersion) fail("Invalid ZIP conditional publication acknowledgement");
    } finally {
      active = false;
      await scope.closeInputs();
    }
    return;
  }
  if ((capabilities.atomicFileStaging !== true && capabilities.trustedOwnedStaging !== true) || !fs.publishStagedFile) {
    if (prepared.existing || capabilities.exclusiveCreate !== true || prepared.validate || prepared.stagingName !== undefined || prepared.mtimeMs !== undefined) fail("ZIP publication requires atomic owned file staging");
    // Complete and verify every source before creating a new remote archive.
    // Exclusive creation preserves a destination that appeared during encoding.
    const maxBytes = Math.min(scope.limits.maxArchiveBytes, scope.limits.maxBufferedFileBytes);
    const bytes = prepared.bytes ?? await collectBytes(prepared.source!, { signal, ...(Number.isFinite(maxBytes) ? { maxBytes } : {}) });
    if (bytes.length > maxBytes) fail("buffered archive byte limit exceeded");
    const parent = await scope.operation(() => fs.realpath(prepared.parentName, { signal }));
    if (parent !== prepared.parent) fail("archive parent changed before publication");
    const write = (data: Uint8Array) => scope.operation(() => fs.writeFile(prepared.output, data, { signal, flag: "wx" }));
    if (prepared.source) await writeFileOutput(scope.context, bytes, write);
    else await write(bytes);
    return;
  }
  await stageZip(scope, {
    ...prepared, reservedPath: prepared.output, parent: prepared.stagingParent ?? prepared.parent, parentStat: prepared.stagingParentStat ?? prepared.parentStat,
  }, async staging => {
    if (prepared.validate) await prepared.validate(staging.file.path);
    if (prepared.stagingName !== undefined) {
      const current = await scope.operation(() => fs.realpath(prepared.stagingName!, { signal }));
      if (current !== prepared.stagingParent) fail("ZIP temporary path changed before publication");
    }
    const parent = await scope.operation(() => fs.realpath(prepared.parentName, { signal }));
    if (parent !== prepared.parent) fail("archive parent changed before publication");
    if (prepared.existing && (prepared.existing.nlink ?? 1) > 1) {
      if (capabilities.atomicFileMutation !== true || !fs.writeFileConditional) fail("ZIP hardlinked archive update requires conditional in-place file mutation");
      if (capabilities.atomicStagedFileMutation === true) {
        await scope.operation(() => fs.publishStagedFile!(staging, prepared.output, { signal, parent: prepared.parentStat, destination: prepared.existing!, preserveIdentity: true }));
        return;
      }
      const stagedBytes = await scope.operation(() => fs.readFile(staging.file.path, { signal, ...(Number.isFinite(scope.limits.maxArchiveBytes) ? { maxBytes: scope.limits.maxArchiveBytes } : {}) }));
      const receipt = await scope.operation(() => fs.writeFileConditional!(prepared.output, stagedBytes, {
        signal, parent: prepared.parentStat, expected: prepared.existing!,
        ...(capabilities.permissions !== false ? { mode: prepared.existing!.mode & 0o7777 } : {}),
        ...(prepared.mtimeMs === undefined ? {} : { mtimeMs: prepared.mtimeMs, atimeMs: prepared.mtimeMs }),
      }));
      if (prepared.mtimeMs !== undefined && (receipt.mtimeMs !== prepared.mtimeMs || receipt.atimeMs !== prepared.mtimeMs)) fail("ZIP publication did not retain archive modification time");
      return;
    }
    await scope.operation(() => fs.publishStagedFile!(staging, prepared.output, {
      signal, parent: prepared.parentStat, destination: prepared.existing ?? null,
    }));
  });
}

/** Retain one archive object, validating its version around every range read. */
export async function openZipSource(scope: Pick<ZipScope, "context" | "limits" | "operation">, path: string, maximum = scope.limits.maxArchiveBytes, allowSpool = true): Promise<{ source: ZipReadSource; stat: FileStat; close(): Promise<void> }> {
  const { fs, signal } = scope.context;
  let handle: FileReadHandle | undefined;
  let closed: Promise<void> | undefined;
  const close = () => closed ??= Promise.resolve().then(() => handle?.close());
  const capabilities = await scope.operation(() => fs.capabilitiesFor?.(path, { signal }) ?? fs.capabilities);
  if (!fs.openReadFile || capabilities.retainedRead !== true) {
    if (!allowSpool) fail("ZIP staging requires retained reads");
    const canonical = await scope.operation(() => fs.realpath(path, { signal }));
    const stat = await scope.operation(() => fs.stat(path, { signal }));
    if (stat.type !== "file" || !Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > maximum) fail("ZIP invalid archive input");
    const scratch = await scope.operation(() => fs.capabilitiesFor?.(scope.context.cwd, { signal }) ?? fs.capabilities);
    const canSpool = fs.openReadFile && fs.createStagedFile && scratch.retainedRead === true
      && scratch.retainedStagingWrite === true && scratch.retainedStagingCleanup === true;
    const input = (async function* (): ByteSource {
      let size = 0;
      for await (const chunk of readFileStream(fs, path, { signal, chunkSize: scope.limits.chunkSize })) {
        if (chunk.length > maximum - size) fail("archive byte limit exceeded");
        size += chunk.length;
        yield chunk;
      }
      const current = await fs.stat(path, { signal });
      if (size !== stat.size || !unchangedZipSource(stat, current) || canonical !== await fs.realpath(path, { signal })) fail("ZIP archive changed while reading");
    })();
    if (!canSpool) {
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of readBytes(input, signal)) {
        if (chunk.length > scope.limits.maxBufferedFileBytes - size) fail("ZIP buffered file byte limit exceeded");
        if (chunk.buffer.byteLength > scope.limits.maxInputMemoryBytes - size - chunk.length) fail("ZIP input memory budget exceeded");
        size += chunk.length;
        if (chunk.length) chunks.push(Uint8Array.from(chunk));
      }
      if (size > scope.limits.maxInputMemoryBytes - size) fail("ZIP input memory budget exceeded");
      let bytes: Uint8Array | undefined = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      chunks.length = 0;
      return { stat, source: { size, async read(offset, length) {
        signal.throwIfAborted();
        if (!bytes) fail("ZIP buffered archive is closed");
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > size || length > size - offset) fail("ZIP invalid archive range");
        return bytes.slice(offset, offset + length);
      } }, async close() { bytes = undefined; } };
    }
    const spool = await spoolZipSource(scope, scope.context.cwd, input, maximum);
    return { source: spool.source, stat, close: spool.close };
  }
  try {
    await scope.operation(async () => {
      const capabilities = await fs.capabilitiesFor?.(path, { signal }) ?? fs.capabilities;
      if (!fs.openReadFile || capabilities.retainedRead !== true) fail("ZIP range input requires retained reads");
      handle = await archiveStorageContext(scope.context).fs.openReadFile!(path, { signal });
    });
    const stat = await scope.operation(() => handle!.stat({ signal }));
    if (stat.type !== "file" || !hasZipIdentity(stat) || !Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > maximum) fail("ZIP invalid retained archive");
    admitArchiveInput(scope.context, stat.size);
    const source = { size: stat.size, async read(offset: number, length: number): Promise<Uint8Array> {
      return scope.operation(async () => {
        if (closed) fail("ZIP retained archive is closed");
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > stat.size || length > stat.size - offset) fail("ZIP invalid archive range");
        if (!unchangedZipSource(stat, await handle!.stat({ signal }))) fail("ZIP archive changed while reading");
        const bytes = await handle!.read(offset, length, { signal });
        if (bytes.length > length) fail("ZIP invalid archive range");
        if (!unchangedZipSource(stat, await handle!.stat({ signal }))) fail("ZIP archive changed while reading");
        return bytes;
      });
    } };
    return { source, stat, close };
  } catch (error) { await close(); throw error; }
}

const spoolOwners = new WeakMap<CommandContext, { active: Set<() => Promise<void>>; closing?: Promise<void> }>();

function retainSpool(context: CommandContext, cleanup: () => Promise<void>): () => void {
  let owner = spoolOwners.get(context);
  if (!owner) {
    const created: { active: Set<() => Promise<void>>; closing?: Promise<void> } = { active: new Set() };
    spoolOwners.set(context, created);
    context.registerCleanup?.(() => created.closing ??= Promise.resolve().then(async () => {
      const results = await Promise.allSettled([...created.active].map(close => close()));
      const failures = results.filter(result => result.status === "rejected").map(result => result.reason);
      if (failures.length === 1) throw failures[0];
      if (failures.length) throw new AggregateError(failures, "ZIP spool cleanup failed");
    }));
    owner = created;
  }
  if (owner.closing) fail("ZIP spool owner is closed");
  owner.active.add(cleanup);
  return () => { owner.active.delete(cleanup); };
}

/** Fully consume and validate a stream before exposing its owned staging object. */
export async function spoolZipSource(scope: Pick<ZipScope, "context" | "limits" | "operation">, parentPath: string, source: ByteSource, maximum: number): Promise<{ source: ZipReadSource; stat: FileStat; path: string; close(): Promise<void> }> {
  const context = archiveStorageContext(scope.context);
  const controller = new AbortController();
  const signal = AbortSignal.any([scope.context.signal, controller.signal]);
  const fs = context.fs;
  const admitted = new Set<Promise<unknown>>();
  const owned = {
    context: { ...context, signal }, limits: scope.limits,
    async operation<Value>(action: () => Value | PromiseLike<Value>): Promise<Value> {
      signal.throwIfAborted();
      const pending = scope.operation(action);
      admitted.add(pending);
      try { return await pending; } finally { admitted.delete(pending); }
    },
  };
  let staging: FileStaging | undefined;
  let retained: Awaited<ReturnType<typeof openZipSource>> | undefined;
  const remove = retainFileSystemCleanup(fs, async view => {
    await retained?.close();
    if (staging?.cleanup) await staging.cleanup.remove();
    else if (staging) await view.removeStagedFile!(staging);
  }, { maxOperations: 16 });
  let closing: Promise<void> | undefined;
  const cleanup = (): Promise<void> => {
    if (!closing) {
      controller.abort(new Error("ZIP spool is closed"));
      closing = Promise.resolve().then(async () => {
        await work.catch(() => {});
        while (admitted.size) await Promise.allSettled([...admitted]);
        try { await remove(); } finally { releaseOwnership(); }
      });
    }
    return closing;
  };
  const releaseOwnership = retainSpool(scope.context, cleanup);
  const work = (async () => {
    const parent = await owned.operation(() => fs.stat(parentPath, { signal }));
    const capabilities = await owned.operation(() => fs.capabilitiesFor?.(parentPath, { signal }) ?? fs.capabilities);
    if (!fs.createStagedFile || capabilities.retainedStagingWrite !== true || capabilities.retainedStagingCleanup !== true) fail("ZIP spool requires owned streaming staging");
    for (let attempt = 0; attempt < scope.limits.maxMembers; attempt++) {
      const path = `${parentPath === "/" ? "" : parentPath}/.zip-spool-${attempt + 1}`;
      checkPath(`${path}/payload`, scope.limits);
      try {
        await owned.operation(async () => { staging = await fs.createStagedFile!(path, "payload", { type: "file", data: new Uint8Array() }, { signal, parent, mode: 0o600, retainCleanup: true }); });
        break;
      } catch (error) {
        signal.throwIfAborted();
        if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "EEXIST") throw error;
      }
    }
    if (!staging?.writer) fail("ZIP spool requires retained staged writer");
    let size = 0;
    for await (const chunk of readBytes(source)) {
      signal.throwIfAborted();
      if (chunk.length > maximum - size) fail("ZIP spool byte limit exceeded");
      size += chunk.length;
      for (let offset = 0; offset < chunk.length; offset += scope.limits.chunkSize) {
        await staging.writer.write(chunk.subarray(offset, offset + scope.limits.chunkSize), { signal });
      }
    }
    signal.throwIfAborted();
    const stat = await staging.writer.finish({ signal });
    staging = { ...staging, file: { ...staging.file, stat } };
    retained = await openZipSource(owned, staging.file.path, maximum, false);
    return { source: retained.source, path: staging.file.path, stat: retained.stat, close: cleanup };
  })();
  try { return await work; } catch (error) {
    try { await cleanup(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], "ZIP spool and cleanup failed"); }
    throw error;
  }
}
