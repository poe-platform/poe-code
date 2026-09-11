import { FsError } from "../../contracts/index.js";
import type { OutputOperation } from "../../contracts/output.js";
import { Budget, FactorError, bytes, raw } from "./internal.js";

export class Lifecycle {
  private readonly pending = new Set<Promise<unknown>>();
  private readonly cleanups: (() => Promise<void>)[] = [];
  private closing: Promise<void> | undefined;
  constructor(readonly budget: Budget, output: OutputOperation) { output.registerCleanup(() => this.close()); }
  cleanup(action: () => Promise<void>): void { this.assertOpen(); this.cleanups.push(action); }
  assertOpen(): void {
    this.budget.signal.throwIfAborted();
    if (this.closing) throw new FactorError("command is closed");
  }
  async operation<Value>(action: () => Value | Promise<Value>): Promise<Value> {
    this.assertOpen();
    const pending = Promise.resolve().then(() => { this.assertOpen(); return action(); });
    this.pending.add(pending);
    try { const value = await pending; this.assertOpen(); return value; }
    finally { this.pending.delete(pending); }
  }
  close(): Promise<void> {
    return this.closing ??= Promise.resolve().then(async () => {
      while (this.pending.size) await Promise.allSettled([...this.pending]);
      const failures: unknown[] = [];
      for (const cleanup of this.cleanups) { try { await cleanup(); } catch (error) { failures.push(error); } }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, "factor cleanup failed");
    });
  }
  async write(value: Uint8Array, diagnostic = false): Promise<void> {
    this.budget.emitted(value.length, diagnostic);
    await this.operation(async () => {
      const sink = diagnostic ? this.budget.context.stderr : this.budget.context.stdout;
      this.assertOpen();
      const destination = sink.ownedOutput ?? sink;
      this.assertOpen();
      const write = destination.write;
      this.assertOpen();
      await Reflect.apply(write, destination, [value]);
    });
  }
  async diagnostic(value: string): Promise<void> {
    this.budget.diagnosticRoom(value.length);
    await this.write(bytes(value), true);
  }
}

export class TokenReader {
  private iterator: AsyncIterator<Uint8Array> | undefined;
  private chunk: Uint8Array = new Uint8Array();
  private token: Uint8Array = new Uint8Array();
  private offset = 0;
  private ended = false;
  private empties = 0;
  constructor(readonly lifecycle: Lifecycle) {
    lifecycle.cleanup(async () => {
      try { if (!this.ended) await this.iterator?.return?.(); }
      finally {
        this.iterator = undefined;
        lifecycle.budget.retain(-this.chunk.length - this.token.length);
        this.chunk = new Uint8Array();
        this.token = new Uint8Array();
      }
    });
  }
  private async get(): Promise<number> {
    const { budget } = this.lifecycle;
    budget.charge();
    await budget.checkpointWork();
    while (this.offset === this.chunk.length) {
      if (this.ended) return -1;
      let next: IteratorResult<Uint8Array>;
      try {
        if (!this.iterator) await this.lifecycle.operation(() => {
          const source = budget.context.stdin;
          this.lifecycle.assertOpen();
          const factory = source[Symbol.asyncIterator];
          this.lifecycle.assertOpen();
          this.iterator = Reflect.apply(factory, source, []);
        });
        budget.charge();
        next = await this.lifecycle.operation(() => {
          const iterator = this.iterator!;
          const advance = iterator.next;
          this.lifecycle.assertOpen();
          return Reflect.apply(advance, iterator, []);
        });
      } catch (error) {
        if (error instanceof FsError) throw new FactorError(`standard input: ${error.code === "EIO" ? "Input/output error" : error.message}`);
        throw error;
      }
      budget.retain(-this.chunk.length);
      this.chunk = new Uint8Array();
      this.offset = 0;
      if (next.done) { this.ended = true; this.iterator = undefined; return -1; }
      if (!(next.value instanceof Uint8Array)) throw new TypeError("factor input requires bytes");
      budget.inputBytes(next.value.length);
      budget.charge(next.value.length);
      budget.retain(next.value.length);
      this.chunk = Uint8Array.from(next.value);
      if (!this.chunk.length) budget.check(++this.empties, budget.limits.maxEmptyChunks, "empty input chunks");
    }
    return this.chunk[this.offset++]!;
  }
  async next(): Promise<string | undefined> {
    const { budget } = this.lifecycle;
    let length = 0, kept = 0;
    let nul = false;
    for (;;) {
      const value = await this.get();
      if (value < 0 || value === 32 || value === 9 || value === 10) {
        if (length) { budget.charge(kept); budget.retain(kept * 4); return raw(this.token.subarray(0, kept)); }
        if (value < 0) return undefined;
      } else {
        budget.check(++length, budget.limits.maxTokenBytes, "token bytes");
        if (value === 0) nul = true;
        if (!nul) {
          if (kept === this.token.length) {
            const capacity = Math.min(budget.limits.maxTokenBytes, Math.max(64, this.token.length * 2));
            budget.retain(capacity);
            budget.charge(this.token.length);
            const grown = new Uint8Array(capacity);
            grown.set(this.token);
            budget.retain(-this.token.length);
            this.token = grown;
          }
          this.token[kept++] = value;
        }
      }
    }
  }
}

export class RecordWriter {
  private buffer: Uint8Array;
  private used = 0;
  constructor(readonly lifecycle: Lifecycle) {
    lifecycle.budget.retain(1024);
    this.buffer = new Uint8Array(1024);
    lifecycle.cleanup(async () => { lifecycle.budget.retain(-this.buffer.length); this.buffer = new Uint8Array(); });
  }
  async append(record: string): Promise<void> {
    const { budget } = this.lifecycle;
    this.lifecycle.assertOpen();
    budget.outputRoom(this.used + record.length);
    budget.charge(record.length);
    for (let offset = 0; offset < record.length; offset++) this.buffer[this.used++] = record.charCodeAt(offset);
    if (this.used >= 512) {
      let end = 512;
      while (this.buffer[end - 1] !== 10) end--;
      await this.lifecycle.write(this.buffer.subarray(0, end));
      this.buffer.copyWithin(0, end, this.used);
      this.used -= end;
    }
  }
  async finish(): Promise<void> {
    if (this.used) { await this.lifecycle.write(this.buffer.subarray(0, this.used)); this.used = 0; }
  }
}
