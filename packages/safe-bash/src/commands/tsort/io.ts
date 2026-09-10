import { FsError, resolvePath, type ByteSource } from "../../contracts/index.js";
import type { OutputOperation } from "../../contracts/output.js";
import { Budget, TsortError, bytes, fileQuote, pathText } from "./internal.js";

export class Lifecycle {
  private readonly pending = new Set<Promise<unknown>>();
  private readonly cleanups: (() => Promise<void>)[] = [];
  private closing: Promise<void> | undefined;
  constructor(readonly budget: Budget, output: OutputOperation) { output.registerCleanup(() => this.close()); }
  cleanup(action: () => Promise<void>): void { this.assertOpen(); this.cleanups.push(action); }
  assertOpen(): void {
    this.budget.signal.throwIfAborted();
    if (this.closing) throw new TsortError("command is closed");
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
      if (failures.length > 1) throw new AggregateError(failures, "tsort cleanup failed");
    });
  }
  async write(value: string, diagnostic = false): Promise<void> {
    this.budget.emitted(value.length, diagnostic);
    await this.operation(async () => {
      if (!diagnostic) this.budget.retain(value.length * 3);
      try {
        const sink = diagnostic ? this.budget.context.stderr : this.budget.context.stdout;
        await (sink.ownedOutput ?? sink).write(bytes(value));
      } finally { if (!diagnostic) this.budget.retain(-value.length * 3); }
    }, diagnostic);
  }
}

export class Reader {
  private iterator: AsyncIterator<Uint8Array> | undefined;
  private chunk: Uint8Array = new Uint8Array();
  private offset = 0;
  private ended = false;
  private empties = 0;
  private snapshotBytes = 0;
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
    const { budget } = this.lifecycle;
    const { fs, stdin } = budget.context;
    try {
      await this.lifecycle.operation(async () => {
        let source: ByteSource;
        if (this.name === "-") source = stdin;
        else {
          const path = resolvePath(budget.context.cwd, pathText(this.name));
          const stat = await fs.stat(path, { signal: budget.signal });
          budget.signal.throwIfAborted();
          if (stat.type === "directory") { this.ended = true; return; }
          if (stat.type !== "file" && stat.type !== "character") throw new FsError("ENOTSUP", { path });
          const capabilities = await fs.capabilitiesFor?.(path, { signal: budget.signal }) ?? fs.capabilities;
          budget.signal.throwIfAborted();
          if (fs.readStream && capabilities.streamingRead !== false) source = fs.readStream(path, { signal: budget.signal, chunkSize: 16_384 });
          else {
            const maximum = Math.min(budget.limits.maxInputBytes, Math.floor(budget.limits.maxBufferedBytes / 2));
            budget.check(stat.size, maximum, "buffered input bytes");
            budget.retain(maximum);
            this.snapshotBytes = maximum;
            const content = await fs.readFile(path, { signal: budget.signal, maxBytes: maximum });
            if (!(content instanceof Uint8Array)) throw new TypeError("tsort input requires bytes");
            budget.check(content.length, maximum, "buffered input bytes");
            budget.retain(content.length - maximum);
            this.snapshotBytes = content.length;
            const { releaseSnapshot } = this;
            source = { async *[Symbol.asyncIterator]() { try { yield content; } finally { releaseSnapshot(); } } };
          }
        }
        this.iterator = source[Symbol.asyncIterator]();
      });
    } catch (error) {
      if (error instanceof FsError) throw new TsortError(`${fileQuote(this.name)}: ${fsDetail(error)}`);
      throw error;
    }
  }
  async get(): Promise<number> {
    const { budget } = this.lifecycle;
    budget.charge();
    await budget.checkpointWork();
    while (this.offset === this.chunk.length) {
      if (this.ended) return -1;
      let next: IteratorResult<Uint8Array>;
      try { next = await this.lifecycle.operation(() => this.iterator!.next()); }
      catch (error) {
        if (error instanceof FsError) throw new TsortError(`${fileQuote(this.name)}: ${fsDetail(error)}`);
        throw error;
      }
      budget.retain(-this.chunk.length);
      this.chunk = new Uint8Array();
      this.offset = 0;
      if (next.done) { this.ended = true; this.iterator = undefined; return -1; }
      if (!(next.value instanceof Uint8Array)) throw new TypeError("tsort input requires bytes");
      budget.inputBytes(next.value.length);
      budget.charge(next.value.length);
      budget.retain(next.value.length);
      this.chunk = Uint8Array.from(next.value);
      if (!this.chunk.length) budget.check(++this.empties, budget.limits.maxEmptyChunks, "empty input chunks");
    }
    return this.chunk[this.offset++]!;
  }
}

function fsDetail(error: FsError): string {
  const details: Partial<Record<FsError["code"], string>> = {
    EACCES: "Permission denied", EPERM: "Operation not permitted", ENOENT: "No such file or directory",
    EISDIR: "Is a directory", ENOTDIR: "Not a directory", EIO: "Input/output error", ELOOP: "Too many levels of symbolic links",
    ENAMETOOLONG: "File name too long", ENOTSUP: "Operation not supported",
  };
  return details[error.code] ?? error.message;
}
