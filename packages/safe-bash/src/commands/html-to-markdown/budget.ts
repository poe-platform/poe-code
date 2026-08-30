import { setImmediate as pause } from "node:timers/promises";
import { FsError, writeBytes, type CommandContext } from "../../contracts/index.js";
import type { HtmlToMarkdownLimits } from "./options.js";

export class Budget {
  input = 0;
  output = 0;
  tokens = 0;
  nodes = 0;
  cells = 0;
  private workUsed = 0;
  private sinceYield = 0;
  constructor(readonly context: CommandContext, readonly limits: HtmlToMarkdownLimits) {}

  check(amount: number, remaining: number, name: string): void {
    this.context.signal.throwIfAborted();
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > remaining) {
      throw new FsError("EFBIG", { message: `html-to-markdown ${name} limit exceeded` });
    }
  }

  work(amount: number): void {
    this.check(amount, this.limits.maxWorkUnits - this.workUsed, "work");
    this.workUsed += amount;
    this.sinceYield += amount;
  }

  async checkpoint(): Promise<void> {
    this.context.signal.throwIfAborted();
    if (this.sinceYield >= 4096) {
      this.sinceYield = 0;
      try { await pause(undefined, { signal: this.context.signal }); }
      catch (error) { this.context.signal.throwIfAborted(); throw error; }
    }
    this.context.signal.throwIfAborted();
  }

  add(kind: "input" | "tokens" | "nodes" | "cells", amount = 1): void {
    const maximum = kind === "input" ? this.limits.maxInputBytes : kind === "tokens" ? this.limits.maxTokens
      : kind === "nodes" ? this.limits.maxNodes : this.limits.maxTableCells;
    this.check(amount, maximum - this[kind], kind);
    this[kind] += amount;
  }

  async emit(text: string): Promise<void> {
    this.check(text.length, this.limits.maxOutputBytes - this.output, "output");
    const bytes = Buffer.byteLength(text);
    this.check(bytes, this.limits.maxOutputBytes - this.output, "output");
    this.output += bytes;
    for (let offset = 0; offset < text.length;) {
      let end = Math.min(text.length, offset + 4096);
      if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1]!)) end--;
      this.work(end - offset);
      await writeBytes(this.context.stdout, Buffer.from(text.slice(offset, end)), this.context.signal);
      offset = end;
      await this.checkpoint();
    }
  }
}

export class Builder {
  private readonly pieces: string[] = [];
  private bytes = 0;
  private tail = "";
  constructor(readonly budget: Budget, readonly maximum = budget.limits.maxOutputBytes - budget.output) {}
  append(text: string): void {
    if (!text) return;
    this.budget.check(text.length, this.maximum - this.bytes, "rendered bytes");
    const size = Buffer.byteLength(text);
    this.budget.check(size, this.maximum - this.bytes, "rendered bytes");
    this.budget.work(text.length);
    this.bytes += size;
    this.pieces.push(text);
    this.tail = (this.tail + text.slice(-2)).slice(-2);
  }
  get empty(): boolean { return this.bytes === 0; }
  get trailingSpace(): boolean { return this.tail.endsWith(" "); }
  get blockBoundary(): boolean { return this.empty || this.tail.endsWith("\n"); }
  separate(): void {
    if (!this.empty) this.append(this.tail.endsWith("\n\n") ? "" : this.tail.endsWith("\n") ? "\n" : "\n\n");
  }
  finish(): string { this.budget.work(this.bytes); return this.pieces.join(""); }
}
