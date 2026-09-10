import { FsError, resolvePath, type ByteSource, type FileStat } from "../../contracts/index.js";
import type { OutputOperation } from "../../contracts/output.js";
import { Budget, PrError, PrReadError, bytes, fileQuote, pathText } from "./internal.js";

export class Lifecycle {
  private readonly pending = new Set<Promise<unknown>>();
  private readonly cleanups: (() => Promise<void>)[] = [];
  private closing: Promise<void> | undefined;
  constructor(readonly budget: Budget, output: OutputOperation) { output.registerCleanup(() => this.close()); }
  cleanup(action: () => Promise<void>): void { this.assertOpen(); this.cleanups.push(action); }
  assertOpen(): void {
    this.budget.signal.throwIfAborted();
    if (this.closing) throw new PrError("command is closed");
  }
  async operation<Value>(action: () => Value | Promise<Value>, diagnostic = false): Promise<Value> {
    this.assertOpen();
    if (!diagnostic) this.budget.charge();
    const pending = Promise.resolve().then(() => { this.assertOpen(); return action(); });
    this.pending.add(pending);
    try { const value = await pending; this.assertOpen(); return value; }
    finally { this.pending.delete(pending); }
  }
  close(): Promise<void> {
    return this.closing ??= Promise.resolve().then(async () => {
      while (this.pending.size) await Promise.allSettled([...this.pending]);
      const failures: unknown[] = [];
      for (const cleanup of this.cleanups) {
        try { await cleanup(); } catch (error) { failures.push(error); }
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, "pr cleanup failed");
    });
  }
  async write(value: string, diagnostic = false): Promise<void> {
    const { budget } = this;
    budget.emitted(value.length, diagnostic);
    await this.operation(async () => {
      if (!diagnostic) budget.retain(value.length * 3);
      try {
        const sink = diagnostic ? budget.context.stderr : budget.context.stdout;
        await (sink.ownedOutput ?? sink).write(bytes(value));
      } finally { if (!diagnostic) budget.retain(-value.length * 3); }
    }, diagnostic);
  }
}

export class Reader {
  private iterator: AsyncIterator<Uint8Array> | undefined;
  private chunk: Uint8Array = new Uint8Array();
  private offset = 0;
  private pushed = -1;
  private ended = false;
  private empties = 0;
  private length = 0;
  private snapshotBytes = 0;
  private path: string | undefined;
  stat: FileStat | undefined;
  constructor(readonly name: string, readonly lifecycle: Lifecycle) {
    lifecycle.cleanup(async () => {
      try { if (!this.ended) await this.iterator?.return?.(); }
      finally {
        this.iterator = undefined;
        this.releaseSnapshot();
        lifecycle.budget.retain(-this.chunk.length);
        this.chunk = new Uint8Array();
      }
    });
  }
  private readonly releaseSnapshot = (): void => {
    this.lifecycle.budget.retain(-this.snapshotBytes);
    this.snapshotBytes = 0;
  };
  async open(): Promise<void> {
    if (this.name === "-") return;
    const { budget } = this.lifecycle;
    this.path = resolvePath(budget.context.cwd, pathText(this.name));
    this.stat = await this.lifecycle.operation(() => budget.context.fs.stat(this.path!, { signal: budget.signal }));
    if (this.stat.type !== "file" && this.stat.type !== "directory" && this.stat.type !== "character") throw new FsError("ENOTSUP", { path: this.path });
  }
  private async acquire(): Promise<void> {
    const { budget } = this.lifecycle;
    const { fs, stdin } = budget.context;
    await this.lifecycle.operation(async () => {
      let source: ByteSource;
      if (this.path === undefined) source = stdin;
      else {
        const capabilities = await fs.capabilitiesFor?.(this.path, { signal: budget.signal }) ?? fs.capabilities;
        budget.signal.throwIfAborted();
        if (fs.readStream && capabilities.streamingRead !== false) source = fs.readStream(this.path, { signal: budget.signal, chunkSize: 16_384 });
        else {
          const maximum = Math.min(budget.limits.maxInputBytes, Math.floor(budget.limits.maxBufferedBytes / 2));
          budget.check(this.stat!.size, maximum, "buffered input bytes");
          budget.retain(maximum);
          this.snapshotBytes = maximum;
          const content = await fs.readFile(this.path, { signal: budget.signal, maxBytes: maximum });
          if (!(content instanceof Uint8Array)) throw new TypeError("pr input requires bytes");
          budget.check(content.length, maximum, "buffered input bytes");
          budget.retain(content.length - maximum);
          this.snapshotBytes = content.length;
          const { releaseSnapshot } = this;
          source = { async *[Symbol.asyncIterator]() { try { yield content; } finally { releaseSnapshot(); } } };
        }
      }
      this.iterator = source[Symbol.asyncIterator]();
    });
  }
  unget(value: number): void { this.pushed = value; }
  async get(): Promise<number> {
    const { budget } = this.lifecycle;
    budget.charge();
    await budget.checkpointWork();
    if (this.stat?.type === "directory") throw new PrReadError(`${fileQuote(this.name)}: Is a directory`);
    if (this.pushed >= 0) { const value = this.pushed; this.pushed = -1; return value; }
    while (this.offset === this.chunk.length) {
      if (this.ended) return -1;
      let next: IteratorResult<Uint8Array>;
      try {
        if (!this.iterator) await this.acquire();
        next = await this.lifecycle.operation(() => this.iterator!.next());
      } catch (error) {
        if (error instanceof FsError) throw new PrReadError(`${fileQuote(this.name === "-" ? "standard input" : this.name)}: ${fsDetail(error)}`);
        throw error;
      }
      budget.retain(-this.chunk.length);
      this.chunk = new Uint8Array();
      this.offset = 0;
      if (next.done) {
        this.ended = true;
        this.iterator = undefined;
        if (this.length > 0) { this.length = 0; budget.line(); }
        return -1;
      }
      if (!(next.value instanceof Uint8Array)) throw new TypeError("pr input requires bytes");
      budget.inputBytes(next.value.length);
      budget.retain(next.value.length);
      this.chunk = Uint8Array.from(next.value);
      if (!this.chunk.length) budget.check(++this.empties, budget.limits.maxEmptyChunks, "empty input chunks");
    }
    const value = this.chunk[this.offset++]!;
    if (value === 10 || value === 12) { this.length = 0; budget.line(); }
    else budget.check(++this.length, budget.limits.maxLineBytes, "input line bytes");
    return value;
  }
}

export function fsDetail(error: FsError): string {
  const details: Partial<Record<FsError["code"], string>> = {
    EACCES: "Permission denied", EPERM: "Operation not permitted", ENOENT: "No such file or directory",
    EISDIR: "Is a directory", ENOTDIR: "Not a directory", EIO: "Input/output error", ELOOP: "Too many levels of symbolic links",
    ENAMETOOLONG: "File name too long", ENOTSUP: "Operation not supported",
  };
  return details[error.code] ?? error.message;
}
