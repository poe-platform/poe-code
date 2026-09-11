import { FsError, dirname, resolvePath, type ByteSource, type FileStat } from "../../contracts/index.js";
import { writeFileOutput } from "../../contracts/filesystem-output.js";
import { retainFileSystemCleanup } from "poe-code/safe-fs/core";
import { Budget, CsplitError, fsDetail, missing, pathText } from "./internal.js";
import type { Options } from "./options.js";

const retainedLineUnits = 128;
const retainedOutputUnits = 256;
const outputBufferBytes = 65_536;

export function sameIdentity(first: FileStat, second: FileStat): boolean {
  return ((typeof first.identityScope === "object" && first.identityScope !== null) || typeof first.identityScope === "symbol")
    && first.identityScope === second.identityScope && Number.isSafeInteger(first.dev) && Number.isSafeInteger(first.ino)
    && first.dev! >= 0 && first.ino! >= 0 && first.dev === second.dev && first.ino === second.ino;
}

export class Lifecycle {
  private readonly pending = new Set<Promise<unknown>>();
  private readonly cleanups = new Set<() => Promise<void>>();
  private closing: Promise<void> | undefined;
  constructor(readonly budget: Budget) { budget.context.registerCleanup?.(() => this.close()); }
  cleanup(action: () => Promise<void>): () => Promise<void> {
    this.assertOpen();
    const owned = async () => { try { await action(); } finally { this.cleanups.delete(owned); } };
    this.cleanups.add(owned);
    return owned;
  }
  assertOpen(): void {
    this.budget.context.signal.throwIfAborted();
    if (this.closing) throw new CsplitError("command is closed");
  }
  async operation<Value>(action: () => Promise<Value>): Promise<Value> {
    this.assertOpen();
    this.budget.charge();
    const pending = Promise.resolve().then(() => { this.assertOpen(); return action(); });
    this.pending.add(pending);
    try { const value = await pending; this.assertOpen(); return value; }
    finally { this.pending.delete(pending); }
  }
  close(): Promise<void> {
    return this.closing ??= (async () => {
      while (this.pending.size) await Promise.allSettled([...this.pending]);
      const failures: unknown[] = [];
      for (const cleanup of this.cleanups) {
        try { await cleanup(); }
        catch (error) { failures.push(error); }
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, "csplit cleanup failed");
    })();
  }
}

export class Lines {
  private readonly fallbackAllocation = {};
  private readonly lines: Uint8Array[] = [];
  private partial: Uint8Array[] = [];
  private partialBytes = 0;
  private total = 0;
  private emptyChunks = 0;
  private iterator: AsyncIterator<Uint8Array> | undefined;
  private ended = false;
  private path: string | undefined;
  identity: FileStat | undefined;
  constructor(readonly lifecycle: Lifecycle) {
    lifecycle.cleanup(async () => {
      try { if (!this.ended) await this.iterator?.return?.(); }
      finally {
        this.lines.length = 0; this.partial = [];
        lifecycle.budget.reserveBuffered(this, 0);
        lifecycle.budget.reserveBuffered(this.fallbackAllocation, 0);
      }
    });
  }
  private reserve(extraLines = 0, extraParts = 0): void {
    this.lifecycle.budget.reserveBuffered(this, this.total * 2 + (this.lines.length + extraLines + this.partial.length + extraParts) * retainedLineUnits);
  }
  async open(name: string): Promise<void> {
    if (name === "-") { this.identity = this.lifecycle.budget.context.stdinInput?.stat; return; }
    const { context, limits } = this.lifecycle.budget;
    this.lifecycle.budget.check(name.length, limits.maxPathBytes, "input path bytes");
    this.path = resolvePath(context.cwd, pathText(name));
    this.identity = await this.lifecycle.operation(() => context.fs.stat(this.path!, { signal: context.signal }));
    if (this.identity.type !== "file") throw new CsplitError("read error: Is a directory");
  }
  assertOutput(path: string, existing: FileStat | undefined): void {
    if (path === this.path || existing && this.identity && sameIdentity(existing, this.identity)) throw new CsplitError("output would overwrite the input file");
    if (existing && this.identity && !sameIdentity(this.identity, this.identity)) throw new CsplitError("cannot overwrite an existing output with unknown input identity");
  }
  private async source(): Promise<ByteSource> {
    const { context, limits } = this.lifecycle.budget;
    if (this.path === undefined) return context.stdin;
    const { fs, signal } = context;
    const capabilities = await this.lifecycle.operation(async () => await fs.capabilitiesFor?.(this.path!, { signal }) ?? fs.capabilities);
    if (fs.readStream && capabilities.streamingRead !== false) return fs.readStream(this.path, { signal, chunkSize: 65_536 });
    if (this.identity!.size > Math.min(limits.maxInputBytes, limits.maxBufferedBytes / 2)) throw new CsplitError("buffered input bytes limit exceeded");
    const admittedBytes = this.identity!.size;
    this.lifecycle.budget.reserveBuffered(this.fallbackAllocation, admittedBytes);
    this.lifecycle.budget.reserveBuffered(this, admittedBytes * 2);
    const value = await this.lifecycle.operation(() => fs.readFile(this.path!, { signal, maxBytes: admittedBytes }));
    this.lifecycle.budget.check(value.length, admittedBytes, "input bytes");
    return { async *[Symbol.asyncIterator]() { yield value; } };
  }
  private appendLine(): void {
    const { budget } = this.lifecycle;
    budget.check(this.lines.length + 1, budget.limits.maxLines, "line count");
    this.reserve(1);
    const line = new Uint8Array(this.partialBytes);
    let offset = 0;
    for (const part of this.partial) { line.set(part, offset); offset += part.length; }
    this.lines.push(line);
    this.partial = [];
    this.partialBytes = 0;
    this.reserve();
  }
  async get(number: number): Promise<Uint8Array | undefined> {
    const { budget } = this.lifecycle;
    while (this.lines.length < number && !this.ended) {
      this.lifecycle.assertOpen();
      if (!this.iterator) await this.lifecycle.operation(async () => {
        this.iterator = (await this.source())[Symbol.asyncIterator]();
      });
      const result = await this.lifecycle.operation(() => this.iterator!.next());
      if (result.done) {
        this.ended = true;
        if (this.partialBytes) this.appendLine();
        break;
      }
      const chunk = result.value;
      if (!(chunk instanceof Uint8Array)) throw new CsplitError("input produced a non-byte chunk");
      this.total += chunk.length;
      budget.check(this.total, budget.limits.maxInputBytes, "input bytes");
      this.reserve();
      if (!chunk.length) budget.check(++this.emptyChunks, budget.limits.maxEmptyChunks, "empty input chunks");
      budget.charge(chunk.length);
      const owned = Uint8Array.from(chunk);
      let start = 0;
      for (let offset = 0; offset < owned.length; offset++) {
        if (owned[offset] === 10) {
          this.partialBytes += offset + 1 - start;
          budget.check(this.partialBytes, budget.limits.maxLineBytes, "line bytes");
          this.reserve(0, 1);
          this.partial.push(owned.subarray(start, offset + 1));
          this.appendLine(); start = offset + 1;
        }
        if (offset % 4096 === 0) {
          budget.charge(Math.min(4096, owned.length - offset));
          await budget.checkpointWork();
        }
      }
      if (start < owned.length) {
        this.partialBytes += owned.length - start;
        budget.check(this.partialBytes, budget.limits.maxLineBytes, "line bytes");
        this.reserve(0, 1);
        this.partial.push(owned.subarray(start));
      }
      await budget.checkpointWork();
    }
    return this.lines[number - 1];
  }
}

interface Output {
  readonly path: string;
  readonly parent: FileStat;
  readonly metadataBytes: number;
  identity?: FileStat;
  created: boolean;
  removed: boolean;
  elided: boolean;
  failed: boolean;
  size: number;
  buffer?: Uint8Array;
  buffered: number;
  cleanup(): Promise<void>;
}

export class Outputs {
  private index = 0;
  private attempts = 0;
  private current: Output | undefined;
  preserve = false;
  succeeded = false;
  constructor(readonly lifecycle: Lifecycle, readonly options: Options, readonly format: (index: number) => string, readonly input: Lines) {}
  private async parents(path: string): Promise<{ path: string; identity: FileStat }[]> {
    const { budget } = this.lifecycle;
    const { context, limits } = budget;
    const components = dirname(path).split("/").filter(Boolean);
    budget.check(components.length, limits.maxPathDepth, "path depth");
    const parents: { path: string; identity: FileStat }[] = [];
    let current = "/";
    for (const component of ["", ...components]) {
      if (component) current = resolvePath(current, component);
      const identity = Object.freeze({ ...await this.lifecycle.operation(() => context.fs.lstat(current, { signal: context.signal })) });
      if (identity.type !== "directory" || !sameIdentity(identity, identity)) throw new CsplitError("unsafe output directory identity");
      parents.push({ path: current, identity });
    }
    return parents;
  }
  private async checkedParents(parents: readonly { path: string; identity: FileStat }[]): Promise<void> {
    const { context } = this.lifecycle.budget;
    for (const parent of parents) {
      const current = await this.lifecycle.operation(() => context.fs.lstat(parent.path, { signal: context.signal }));
      if (current.type !== "directory" || !sameIdentity(current, parent.identity)) throw new CsplitError("output parent changed before mutation");
    }
  }
  async open(): Promise<void> {
    const { budget } = this.lifecycle;
    const { context, limits } = budget;
    budget.check(++this.attempts, limits.maxFileAttempts, "output file attempts");
    budget.check(this.index + 1, limits.maxFiles, "output file count");
    const name = this.options.prefix + this.format(this.index);
    budget.check(name.length, limits.maxPathBytes, "output filename bytes");
    const path = resolvePath(context.cwd, pathText(name));
    try {
    const capabilities = await this.lifecycle.operation(async () => await context.fs.capabilitiesFor?.(path, { signal: context.signal, create: true }) ?? context.fs.capabilities);
    if (capabilities.atomicFileMutation !== true || !context.fs.writeFileConditional || !context.fs.removeFileConditional) throw new CsplitError("atomic output mutations are not supported");
    const parents = await this.parents(path);
    let existing: FileStat | undefined;
    try { existing = Object.freeze({ ...await this.lifecycle.operation(() => context.fs.lstat(path, { signal: context.signal })) }); }
    catch (error) { context.signal.throwIfAborted(); if (!missing(error)) throw error; }
    if (existing && (existing.type !== "file" || !sameIdentity(existing, existing))) throw new CsplitError(`unsafe output file ${budget.quote(name)}`);
    this.input.assertOutput(path, existing);
    const metadataBytes = retainedOutputUnits + path.length * 2;
    const output: Output = { path, parent: parents.at(-1)!.identity, metadataBytes, created: false, removed: false, elided: false, failed: false, size: 0, buffered: 0, cleanup: async () => {} };
    budget.reserveBuffered(output, metadataBytes);
    output.cleanup = this.lifecycle.cleanup(retainFileSystemCleanup(context.fs, async view => {
      delete output.buffer;
      output.buffered = 0;
      budget.reserveBuffered(output, 0);
      if (!output.created || !output.identity || !output.elided && (this.succeeded || this.options.keep || this.preserve)) return;
      try {
        if (!view.removeFileConditional) throw new FsError("ENOTSUP");
        await view.removeFileConditional(path, { expected: output.identity, parent: output.parent });
        output.removed = true;
      } catch (error) { if (!missing(error) && !(error instanceof FsError && error.code === "EAGAIN")) throw error; }
    }, { maxOperations: 1 }));
    try {
      await this.checkedParents(parents);
      await this.lifecycle.operation(async () => {
        output.identity = Object.freeze({ ...await context.fs.writeFileConditional!(path, new Uint8Array(), {
          signal: context.signal, expected: existing ?? null, parent: output.parent,
        }) });
        output.created = true;
      });
    } finally { parents.length = 0; }
    this.index++;
    this.current = output;
    } catch (error) {
      if (error instanceof FsError) throw new CsplitError(`${name}: ${fsDetail(error)}`);
      throw error;
    }
  }
  private async flush(output: Output): Promise<void> {
    if (!output.buffered) return;
    const { context } = this.lifecycle.budget;
    try {
      await this.lifecycle.operation(() => writeFileOutput(context, output.buffer!.subarray(0, output.buffered), async chunk => {
        output.identity = Object.freeze({ ...await context.fs.writeFileConditional!(output.path, chunk, {
          signal: context.signal, expected: output.identity!, parent: output.parent, append: true,
        }) });
        output.buffered = 0;
      }));
    } catch (error) { output.failed = true; throw error; }
  }
  async write(value: Uint8Array): Promise<void> {
    const output = this.current;
    if (!output) throw new CsplitError("output is not open");
    const { budget } = this.lifecycle;
    budget.fileBytes(value.length);
    if (!output.buffer) {
      const capacity = Math.min(outputBufferBytes, budget.limits.maxBufferedBytes);
      budget.reserveBuffered(output, output.metadataBytes + capacity);
      output.buffer = new Uint8Array(capacity);
    }
    for (let offset = 0; offset < value.length;) {
      this.lifecycle.assertOpen();
      const count = Math.min(value.length - offset, output.buffer.length - output.buffered);
      output.buffer.set(value.subarray(offset, offset + count), output.buffered);
      output.buffered += count;
      output.size += count;
      offset += count;
      if (output.buffered === output.buffer.length) await this.flush(output);
    }
  }
  async finish(): Promise<void> {
    const output = this.current;
    if (!output) return;
    this.current = undefined;
    if (output.failed) return;
    await this.flush(output);
    delete output.buffer;
    this.lifecycle.budget.reserveBuffered(output, output.metadataBytes);
    if (!output.size && this.options.elide) {
      output.elided = true;
      await output.cleanup();
      if (!output.removed) throw new CsplitError("output changed before empty-file removal");
      this.index--;
    } else if (!this.options.quiet) await this.lifecycle.budget.print(`${output.size}\n`);
  }
}
