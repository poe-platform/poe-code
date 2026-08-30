import { readBytes, type ByteSource, type CommandContext } from "../../contracts/index.js";
import { pathOf } from "../internal.js";
import type { Budget } from "./budget.js";
import { Parser, type HtmlNode } from "./parser.js";

class Cursor implements ByteSource {
  private iterator: AsyncIterator<Uint8Array> | undefined;
  private done = false;
  private closing: Promise<void> | undefined;
  constructor(readonly source: ByteSource, readonly signal: AbortSignal) {}
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    return {
      next: async () => {
        if (this.done) return { done: true, value: undefined };
        this.signal.throwIfAborted();
        this.iterator ??= this.source[Symbol.asyncIterator]();
        const next = await this.iterator.next();
        this.signal.throwIfAborted();
        if (this.done || next.done) { this.done = true; return { done: true, value: undefined }; }
        return next;
      },
      return: async () => { await this.close(); return { done: true, value: undefined }; },
    };
  }
  close(): Promise<void> {
    if (!this.closing) {
      const iterator = this.done ? undefined : this.iterator;
      this.done = true;
      this.closing = Promise.resolve().then(async () => { await iterator?.return?.(); });
    }
    return this.closing;
  }
}

export class Inputs {
  private readonly cursors: Cursor[] = [];
  private stdin: Cursor | undefined;
  private closed = false;
  private primaryFailure = false;
  private completion: Promise<void> | undefined;
  constructor(readonly context: CommandContext, readonly budget: Budget) {
    context.registerCleanup?.(this.close);
  }

  preservePrimaryFailure(): void { this.primaryFailure = true; }

  private open(name: string): Cursor {
    this.context.signal.throwIfAborted();
    if (this.closed) throw new Error("html-to-markdown input is closed");
    if (name === "-" && this.stdin) return this.stdin;
    let source: ByteSource;
    if (name === "-") source = this.context.stdin;
    else {
      const context = this.context, budget = this.budget, path = pathOf(context, name);
      if (context.fs.readStream) source = context.fs.readStream(path, { signal: context.signal, chunkSize: 16_384 });
      else {
        let consumed = false;
        source = { [Symbol.asyncIterator]() { return {
          async next() {
            if (consumed) return { done: true, value: undefined };
            consumed = true;
            const value = await context.fs.readFile(path, { signal: context.signal, maxBytes: budget.limits.maxInputBytes - budget.input });
            context.signal.throwIfAborted();
            return { done: false, value };
          },
          async return() { consumed = true; return { done: true, value: undefined }; },
        }; } };
      }
    }
    const cursor = new Cursor(source, this.context.signal);
    this.cursors.push(cursor);
    if (name === "-") this.stdin = cursor;
    return cursor;
  }

  async document(name: string): Promise<HtmlNode> {
    const cursor = this.open(name), decoder = new TextDecoder("utf-8", { fatal: true });
    const parser = new Parser(this.budget);
    for await (const chunk of readBytes(cursor, this.context.signal)) {
      this.budget.add("input", chunk.byteLength);
      this.budget.work(Math.max(1, chunk.byteLength));
      const owned = new Uint8Array(chunk);
      for (let offset = 0; offset < owned.length; offset += 4096) {
        await parser.feed(decoder.decode(owned.subarray(offset, offset + 4096), { stream: true }));
        await this.budget.checkpoint();
      }
      await this.budget.checkpoint();
    }
    await parser.feed(decoder.decode());
    this.context.signal.throwIfAborted();
    return parser.finish();
  }

  readonly close = (): Promise<void> => {
    this.closed = true;
    this.completion ??= Promise.allSettled(this.cursors.map(cursor => cursor.close())).then(results => {
      const failure = results.find(result => result.status === "rejected");
      if (failure?.status === "rejected" && !this.primaryFailure) throw failure.reason;
    });
    return this.completion;
  };
}
