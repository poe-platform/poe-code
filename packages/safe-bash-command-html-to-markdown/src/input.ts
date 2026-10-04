import { readFileStream } from "safe-bash-contracts/filesystem";
import { readBytes, type ByteSource, type CommandContext } from "safe-bash-contracts";
import { pathOf } from "safe-bash-io-engine/internal";
import type { Budget } from "./budget.js";
import { Parser, type HtmlEventSink, type HtmlNode } from "./parser.js";

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
      const context = this.context, path = pathOf(context, name);
      source = readFileStream(context.fs, path, { signal: context.signal, chunkSize: 16384 });
    }
    const cursor = new Cursor(source, this.context.signal);
    this.cursors.push(cursor);
    if (name === "-") this.stdin = cursor;
    return cursor;
  }

  async document(name: string, sink?: HtmlEventSink): Promise<HtmlNode> {
    const cursor = this.open(name), decoder = new TextDecoder("utf-8", { fatal: true });
    const parser = new Parser(this.budget, sink);
    for await (const chunk of readBytes(cursor, this.context.signal)) {
      this.budget.add("input", chunk.byteLength);
      this.budget.work(Math.max(1, chunk.byteLength));
      // Decode before awaiting. The resulting string owns its bytes, and the
      // producer is not advanced until this chunk has been completely consumed.
      for (let offset = 0; offset < chunk.length; offset += 4096) {
        await parser.feed(decoder.decode(chunk.subarray(offset, offset + 4096), { stream: true }));
        { const c = this.budget.checkpoint(); if (c) await c; }
      }
      { const c = this.budget.checkpoint(); if (c) await c; }
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
