import { utf8ByteLength } from "safe-bash-byte-engine";
import { inheritYieldCheckpoint, yieldTurn } from "safe-bash-contracts/yield";
import { writeBytes, type ByteSink, type CommandContext } from "safe-bash-contracts";

export interface FileLimits {
  readonly maxSniffBytes: number;
  readonly maxReadFileBytes: number;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxChunkBytes: number;
  readonly maxEntries: number;
  readonly maxSteps: number;
  readonly maxArgumentBytes: number;
  readonly maxDurationMs: number;
}

export interface FileCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<FileLimits>;
}

export function settings(options: FileCommandsOptions): FileLimits {
  const limits: FileLimits = {
    maxSniffBytes: Infinity, maxReadFileBytes: Infinity, maxInputBytes: Infinity,
    maxOutputBytes: Infinity, maxChunkBytes: Infinity, maxEntries: Infinity,
    maxSteps: Infinity, maxArgumentBytes: Infinity, maxDurationMs: Infinity, ...options.limits,
  };
  for (const [name, value] of Object.entries(limits)) {
    if ((value !== Infinity && !Number.isSafeInteger(value)) || value < 1) {
      throw new RangeError(`Invalid file limit: ${name}`);
    }
  }
  return limits;
}

export class FileFailure extends Error {}
export class FileLimitError extends FileFailure {}

const utf8Encoder = new TextEncoder();
const printableAsciiNoBackslash = /^[\x20-\x5b\x5d-\x7e]*$/;
const hostAbortWaiters = new WeakMap<AbortSignal, Set<() => void>>();

function subscribeHostAbort(signal: AbortSignal, fn: () => void): () => void {
  let waiters = hostAbortWaiters.get(signal);
  if (!waiters) {
    waiters = new Set();
    hostAbortWaiters.set(signal, waiters);
    signal.addEventListener("abort", () => {
      const current = Array.from(waiters!);
      waiters!.clear();
      for (let i = 0; i < current.length; i++) current[i]!();
    }, { once: true });
  }
  waiters.add(fn);
  return () => {
    waiters!.delete(fn);
  };
}

export class SharedBudget {
  private inputBytes = 0;
  private outputBytes = 0;
  private steps = 0;
  private failureUnits = 64;
  private untilYield = 128;
  private readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly deadline: number;
  readonly signal: AbortSignal;

  constructor(readonly context: CommandContext, readonly limits: FileLimits) {
    this.signal = AbortSignal.any([context.signal, this.controller.signal]);
    inheritYieldCheckpoint(context.signal, this.signal);
    this.deadline = performance.now() + limits.maxDurationMs;
    if (Number.isFinite(limits.maxDurationMs)) {
      const expire = (): void => {
        const remaining = this.deadline - performance.now();
        if (remaining <= 0) this.controller.abort(new FileLimitError("time limit exceeded"));
        else this.timer = setTimeout(expire, Math.min(remaining, 2147483647));
      };
      expire();
    }
  }

  dispose(): void { clearTimeout(this.timer); }
  get remainingInputBytes(): number { return this.limits.maxInputBytes - this.inputBytes; }

  check(size: number, maximum: number, label: string): void {
    if (size > maximum) throw new FileLimitError(`${label} limit exceeded`);
  }

  checkTime(): void {
    if (performance.now() >= this.deadline && !this.signal.aborted) this.controller.abort(new FileLimitError("time limit exceeded"));
    this.signal.throwIfAborted();
  }

  work(count: number): void {
    this.checkTime();
    this.check(count, this.limits.maxSteps - this.steps, "step");
    this.steps += count;
  }

  async step(count = 1): Promise<void> {
    this.work(count);
    if (--this.untilYield <= 0) {
      this.untilYield = 128;
      await yieldTurn(this.signal);
      this.checkTime();
    }
  }

  input(size: number): void {
    this.check(size, this.limits.maxChunkBytes, "chunk");
    this.check(size, this.remainingInputBytes, "input");
    this.inputBytes += size;
  }

  async escapeName(value: string, metadata = false, render = true): Promise<string> {
    this.checkTime();
    if (metadata) this.check(value.length, this.remainingInputBytes, "input");
    if (render) this.check(value.length, this.limits.maxOutputBytes - this.outputBytes, "output");
    this.work(value.length);
    if (value.length < 4096 && printableAsciiNoBackslash.test(value)) {
      if (metadata) this.inputBytes += value.length;
      return render ? value : "";
    }
    const pieces: string[] = [];
    let outputBytes = 0;
    let untilYield = 4096;
    for (const character of value) {
      if (metadata) {
        const size = utf8ByteLength(character);
        this.check(size, this.remainingInputBytes, "input");
        this.inputBytes += size;
      }
      if (render) {
        const piece = character === "\\" ? "\\\\" : /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(character)
          ? `\\u{${character.codePointAt(0)!.toString(16)}}` : character;
        outputBytes += utf8ByteLength(piece);
        this.check(outputBytes, this.limits.maxOutputBytes - this.outputBytes, "output");
        pieces.push(piece);
      }
      untilYield -= character.length;
      if (untilYield <= 0) {
        untilYield = 4096;
        await yieldTurn(this.signal);
        this.checkTime();
      }
    }
    this.checkTime();
    return pieces.join("");
  }

  async output(sink: ByteSink, text: string, signal = this.signal): Promise<void> {
    this.checkTime();
    this.check(text.length, this.limits.maxOutputBytes - this.outputBytes, "output");
    this.work(text.length);
    const size = utf8ByteLength(text);
    this.check(size, this.limits.maxOutputBytes - this.outputBytes, "output");
    this.outputBytes += size;
    const bytes = utf8Encoder.encode(text);
    const width = Math.min(16384, this.limits.maxChunkBytes);
    for (let offset = 0; offset < bytes.length; offset += width) {
      await writeBytes(sink, bytes.slice(offset, offset + width), signal);
    }
  }

  async failure(text: string): Promise<void> {
    this.checkTime();
    const units = Math.min(this.failureUnits, this.limits.maxOutputBytes - this.outputBytes, text.length);
    this.failureUnits -= units;
    let end = units;
    if (end > 0 && end < text.length && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff
      && text.charCodeAt(end) >= 0xdc00 && text.charCodeAt(end) <= 0xdfff) end--;
    let bounded = "";
    let size = 0;
    for (const character of text.slice(0, end)) {
      const width = utf8ByteLength(character);
      if (width > this.limits.maxOutputBytes - this.outputBytes - size) break;
      size += width;
      bounded += character;
    }
    this.outputBytes += size;
    const bytes = utf8Encoder.encode(bounded);
    const width = Math.min(16384, this.limits.maxChunkBytes);
    for (let offset = 0; offset < bytes.length; offset += width) {
      await writeBytes(this.context.stderr, bytes.slice(offset, offset + width), this.signal);
    }
  }

  async host<Result>(operation: () => Promise<Result>): Promise<Result> {
    this.checkTime();
    return new Promise<Result>((resolve, reject) => {
      const unsubscribe = subscribeHostAbort(this.signal, () => reject(this.signal.reason));
      try {
        Promise.resolve(operation()).then(result => {
          unsubscribe();
          try { this.checkTime(); resolve(result); } catch (error) { reject(error); }
        }, error => { unsubscribe(); reject(error); });
      } catch (error) {
        unsubscribe();
        reject(error);
      }
    });
  }
}

export function limitMessage(error: FileLimitError): string {
  const message = error.message;
  return message.length <= 32 && ["argument", "entry", "readFile", "input", "chunk", "output", "step", "time"]
    .some(label => message === `${label} limit exceeded`) ? message : "resource limit exceeded";
}
