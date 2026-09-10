import { FsError, dirname, resolvePath, type ByteSource, type FileStat } from "../../contracts/index.js";
import { writeFileOutput } from "../../contracts/filesystem-output.js";
import { retainFileSystemCleanup } from "poe-code/safe-fs/core";
import { Budget, CsplitError, fsDetail, missing, pathText } from "./internal.js";
import type { Options } from "./options.js";

export function sameIdentity(first: FileStat, second: FileStat): boolean {
  return ((typeof first.identityScope === "object" && first.identityScope !== null) || typeof first.identityScope === "symbol")
    && first.identityScope === second.identityScope && Number.isSafeInteger(first.dev) && Number.isSafeInteger(first.ino)
    && first.dev! >= 0 && first.ino! >= 0 && first.dev === second.dev && first.ino === second.ino;
}

export class Lifecycle {
  private readonly pending = new Set<Promise<unknown>>();
  private readonly cleanups: (() => Promise<void>)[] = [];
  private closing: Promise<void> | undefined;
  constructor(readonly budget: Budget) { budget.context.registerCleanup?.(() => this.close()); }
  cleanup(action: () => Promise<void>): void {
    this.assertOpen();
    this.cleanups.push(action);
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
    lifecycle.cleanup(async () => { if (!this.ended) await this.iterator?.return?.(); });
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
    const value = await this.lifecycle.operation(() => fs.readFile(this.path!, { signal, maxBytes: limits.maxInputBytes }));
    return { async *[Symbol.asyncIterator]() { yield value; } };
  }
  private appendLine(): void {
    const { budget } = this.lifecycle;
    budget.check(this.lines.length + 1, budget.limits.maxLines, "line count");
    const line = new Uint8Array(this.partialBytes);
    let offset = 0;
    for (const part of this.partial) { line.set(part, offset); offset += part.length; }
    this.lines.push(line);
    this.partial = [];
    this.partialBytes = 0;
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
      budget.check(this.total * 2, budget.limits.maxBufferedBytes, "buffered bytes");
      if (!chunk.length) budget.check(++this.emptyChunks, budget.limits.maxEmptyChunks, "empty input chunks");
      budget.charge(chunk.length);
      const owned = Uint8Array.from(chunk);
      let start = 0;
      for (let offset = 0; offset < owned.length; offset++) {
        if (owned[offset] === 10) {
          this.partialBytes += offset + 1 - start;
          budget.check(this.partialBytes, budget.limits.maxLineBytes, "line bytes");
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
        this.partial.push(owned.subarray(start));
      }
      await budget.checkpointWork();
    }
    return this.lines[number - 1];
  }
}

interface Output {
  readonly path: string;
  readonly name: string;
  readonly parents: readonly { path: string; identity: FileStat }[];
  identity?: FileStat;
  created: boolean;
  removed: boolean;
  elided: boolean;
  failed: boolean;
  size: number;
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
      const identity = await this.lifecycle.operation(() => context.fs.lstat(current, { signal: context.signal }));
      if (identity.type !== "directory" || !sameIdentity(identity, identity)) throw new CsplitError("unsafe output directory identity");
      parents.push({ path: current, identity });
    }
    return parents;
  }
  private async checked(output: Output): Promise<void> {
    await this.checkedParents(output.parents);
    const { context } = this.lifecycle.budget;
    const current = await this.lifecycle.operation(() => context.fs.lstat(output.path, { signal: context.signal }));
    if (!output.identity || current.type !== "file" || !sameIdentity(current, output.identity)) throw new CsplitError("output changed before mutation");
  }
  private async checkedParents(parents: Output["parents"]): Promise<void> {
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
    const parents = await this.parents(path);
    let existing: FileStat | undefined;
    try { existing = await this.lifecycle.operation(() => context.fs.lstat(path, { signal: context.signal })); }
    catch (error) { context.signal.throwIfAborted(); if (!missing(error)) throw error; }
    if (existing && (existing.type !== "file" || !sameIdentity(existing, existing))) throw new CsplitError(`unsafe output file ${budget.quote(name)}`);
    this.input.assertOutput(path, existing);
    const output: Output = { path, name, parents, created: false, removed: false, elided: false, failed: false, size: 0, cleanup: async () => {} };
    output.cleanup = retainFileSystemCleanup(context.fs, async view => {
      if (!output.created || !output.identity || !output.elided && (this.succeeded || this.options.keep || this.preserve)) return;
      try {
        for (const parent of parents) {
          const current = await view.lstat(parent.path);
          if (current.type !== "directory" || !sameIdentity(current, parent.identity)) return;
        }
        const current = await view.lstat(path);
        if (current.type === "file" && sameIdentity(current, output.identity)) {
          await view.rm(path);
          output.removed = true;
        }
      } catch (error) { if (!missing(error)) throw error; }
    }, { maxOperations: limits.maxPathDepth + 3 });
    this.lifecycle.cleanup(output.cleanup);
    await this.checkedParents(parents);
    let admitted: FileStat | undefined;
    try { admitted = await this.lifecycle.operation(() => context.fs.lstat(path, { signal: context.signal })); }
    catch (error) { context.signal.throwIfAborted(); if (!missing(error)) throw error; }
    if (admitted ? !existing || admitted.type !== "file" || !sameIdentity(admitted, existing) : existing !== undefined) throw new CsplitError("output changed before creation");
    await this.checkedParents(parents);
    await this.lifecycle.operation(async () => {
      await context.fs.writeFile(path, new Uint8Array(), { signal: context.signal, flag: existing ? "w" : "wx" });
      output.created = true;
      if (existing) output.identity = existing;
      const identity = await context.fs.lstat(path, { signal: context.signal });
      if (identity.type !== "file" || !sameIdentity(identity, identity) || existing && !sameIdentity(existing, identity)) throw new CsplitError("output creation identity unavailable");
      output.identity = identity;
    });
    this.index++;
    this.current = output;
    } catch (error) {
      if (error instanceof FsError) throw new CsplitError(`${name}: ${fsDetail(error)}`);
      throw error;
    }
  }
  async write(value: Uint8Array): Promise<void> {
    const output = this.current;
    if (!output) throw new CsplitError("output is not open");
    const { budget } = this.lifecycle;
    budget.fileBytes(value.length);
    try {
      await this.checked(output);
      await this.lifecycle.operation(() => writeFileOutput(budget.context, value, chunk => budget.context.fs.appendFile(output.path, chunk, { signal: budget.context.signal })));
      output.size += value.length;
    } catch (error) { output.failed = true; throw error; }
  }
  async finish(): Promise<void> {
    const output = this.current;
    if (!output) return;
    this.current = undefined;
    if (output.failed) return;
    if (!output.size && this.options.elide) {
      await this.checked(output);
      output.elided = true;
      await output.cleanup();
      if (!output.removed) throw new CsplitError("output changed before empty-file removal");
      this.index--;
    } else if (!this.options.quiet) await this.lifecycle.budget.print(`${output.size}\n`);
  }
}
