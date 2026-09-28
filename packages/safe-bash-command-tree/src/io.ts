import { utf8ByteLength } from "safe-bash-byte-engine";
const treeUtf8Encoder = new TextEncoder();
const treeSignalWaiters = new WeakMap<AbortSignal, Set<() => void>>();
function getTreeSignalWaiters(signal: AbortSignal): Set<() => void> {
  let waiters = treeSignalWaiters.get(signal);
  if (!waiters) {
    waiters = new Set();
    treeSignalWaiters.set(signal, waiters);
    signal.addEventListener("abort", () => {
      const pending = [...waiters!];
      waiters!.clear();
      for (const fn of pending) fn();
    }, { once: true });
  }
  return waiters;
}
import { publicDiagnosticMessage } from "safe-bash-contracts/diagnostics";
import { hasYieldCheckpoint, monotonicNow, yieldTurn } from "safe-bash-contracts/yield";
import { escapeText } from "safe-bash-contracts/escaping";
import { FsError, writeBytes, type ByteSink, type CommandContext } from "safe-bash-contracts";
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
    bytes += utf8ByteLength(part);
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
  private lastYield = monotonicNow();
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
    const size = utf8ByteLength(value);
    this.check(size, this.limits.maxPathBytes, "path/name");
    this.check(this.metadata += size, this.limits.maxMetadataBytes, "metadata");
  }

  checkOutput(size: number): void { this.check(this.output + size, this.limits.maxOutputBytes, "output"); }

  outputText(value: string): number {
    this.checkOutput(value.length);
    const size = utf8ByteLength(value);
    this.checkOutput(size);
    return size;
  }

  async fs<Result>(operation: () => Promise<Result>): Promise<Result> {
    this.step();
    const { signal } = this.context;
    if (++this.operations % 64 === 0 && (this.operations === 64 || hasYieldCheckpoint(signal) || monotonicNow() - this.lastYield >= 16)) {
      await yieldTurn(signal);
      this.lastYield = monotonicNow();
    }
    signal.throwIfAborted();
    const waiters = getTreeSignalWaiters(signal);
    const result = await new Promise<Result>((resolve, reject) => {
      const abort = () => { waiters.delete(abort); reject(signal.reason); };
      waiters.add(abort);
      Promise.resolve().then(() => {
        signal.throwIfAborted();
        return operation();
      }).then(
        value => { waiters.delete(abort); resolve(value); },
        error => { waiters.delete(abort); reject(error); },
      );
    });
    signal.throwIfAborted();
    return result;
  }

  async emit(sink: ByteSink, value: string): Promise<void> {
    const size = this.outputText(value);
    this.output += size;
    const bytes = treeUtf8Encoder.encode(value);
    for (let offset = 0; offset < bytes.length; offset += 16384) {
      await writeBytes(sink, bytes.slice(offset, offset + 16384), this.context.signal);
      this.context.signal.throwIfAborted();
    }
  }
}
