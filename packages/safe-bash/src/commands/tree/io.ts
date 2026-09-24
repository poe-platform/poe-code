import { publicDiagnosticMessage } from "../../diagnostics.js";
import { yieldTurn } from "../../contracts/yield.js";
import { escapeText } from "../../escaping.js";
import { FsError, writeBytes, type ByteSink, type CommandContext } from "../../contracts/index.js";
import type { TreeLimits } from "./options.js";
import { environmentCharset, type Charset } from "./charset.js";

export class UsageError extends Error {}

export class TreeLimitError extends FsError {
  constructor(label: string, maximum: number) {
    super("EFBIG", { message: `tree ${label} limit exceeded (${maximum})` });
  }
}

export function message(error: unknown, budget: WalkBudget): string {
  const text = publicDiagnosticMessage(error, budget.context.onInternalError);
  budget.text(text);
  return error instanceof Error ? text.replace(/^[A-Z][A-Z0-9]+: /u, "") : text;
}

export function escaped(value: string, budget: WalkBudget): string {
  budget.outputText(value);
  return escapeText(value, "display", size => budget.checkOutput(size));
}

export function escapedName(value: string, budget: WalkBudget): string {
  budget.outputText(value);
  let result = "", bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    const localeSensitive = point === 32 || point >= 127;
    const utf8 = localeSensitive && budget.filenameCharset() === "UTF-8";
    const part = point === 32 && !utf8 ? "\\ "
      : utf8 && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u.test(character) ? character
      : escapeText(character, "display");
    bytes += Buffer.byteLength(part);
    budget.checkOutput(bytes);
    result += part;
  }
  return result;
}

export class WalkBudget {
  private entries = 0;
  private metadata = 0;
  private output = 0;
  private steps = 0;
  private operations = 0;
  private nameCharset: Charset | undefined;
  constructor(readonly context: CommandContext, readonly limits: TreeLimits) {}

  get remainingEntries(): number { return this.limits.maxEntries - this.entries; }

  filenameCharset(): Charset { return this.nameCharset ??= environmentCharset(this, false); }

  check(value: number, maximum: number, label: string): void {
    this.context.signal.throwIfAborted();
    if (value > maximum) throw new TreeLimitError(label, maximum);
  }

  step(count = 1): void { this.check(this.steps += count, this.limits.maxSteps, "work"); }

  entry(count = 1): void { this.check(this.entries += count, this.limits.maxEntries, "entry"); }

  text(value: string): void {
    this.check(value.length, this.limits.maxPathBytes, "path/name");
    this.check(this.metadata + value.length, this.limits.maxMetadataBytes, "metadata");
    const size = Buffer.byteLength(value);
    this.check(size, this.limits.maxPathBytes, "path/name");
    this.check(this.metadata += size, this.limits.maxMetadataBytes, "metadata");
  }

  checkOutput(size: number): void { this.check(this.output + size, this.limits.maxOutputBytes, "output"); }

  outputText(value: string): number {
    this.checkOutput(value.length);
    const size = Buffer.byteLength(value);
    this.checkOutput(size);
    return size;
  }

  async fs<Result>(operation: () => Promise<Result>): Promise<Result> {
    this.step();
    const { signal } = this.context;
    if (++this.operations % 64 === 0) await yieldTurn(signal);
    signal.throwIfAborted();
    let abort!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
    });
    try {
      const result = await Promise.race([Promise.resolve().then(() => {
        signal.throwIfAborted();
        return operation();
      }), aborted]);
      signal.throwIfAborted();
      return result;
    } finally { signal.removeEventListener("abort", abort); }
  }

  async emit(sink: ByteSink, value: string): Promise<void> {
    const size = this.outputText(value);
    this.output += size;
    const bytes = new TextEncoder().encode(value);
    for (let offset = 0; offset < bytes.length; offset += 16384) {
      await writeBytes(sink, bytes.slice(offset, offset + 16384), this.context.signal);
      this.context.signal.throwIfAborted();
    }
  }
}
