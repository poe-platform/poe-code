import { readFileStream } from "safe-bash-contracts/filesystem";
import { subscribeAbort } from "safe-bash-contracts";
import { yieldTurn } from "safe-bash-contracts/yield";
import { FsError, readBytes, type ByteSource, type CommandContext } from "safe-bash-contracts";
import { pathOf } from "safe-bash-io-engine/internal";
import type { SplitLimits } from "./options.js";

export async function interruptible<Result>(operation: () => Promise<Result>, signal: AbortSignal): Promise<Result> {
  signal.throwIfAborted();
  return new Promise<Result>((resolve, reject) => {
    const unsubscribe = subscribeAbort(signal, () => reject(signal.reason));
    Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); }).then(
      value => { unsubscribe(); resolve(value); },
      error => { unsubscribe(); reject(error); },
    );
  });
}

export class Budget {
  private inputBytes = 0;
  private outputBytes = 0;
  private steps = 0;
  private untilYield = 65536;
  constructor(readonly limits: SplitLimits, readonly signal: AbortSignal) {}
  check(value: number, maximum: number, label: string): void {
    if (value > maximum) throw new FsError("EFBIG", { message: `split ${label} limit exceeded` });
  }
  input(size: number): void {
    this.check(size, this.limits.maxInputBytes - this.inputBytes, "input");
    this.inputBytes += size;
  }
  output(size: number): void {
    this.signal.throwIfAborted();
    this.check(size, this.limits.maxOutputBytes - this.outputBytes, "output");
    this.outputBytes += size;
  }
  step(count = 1): void | Promise<void> {
    this.signal.throwIfAborted();
    this.check(count, this.limits.maxSteps - this.steps, "work");
    this.steps += count;
    this.untilYield -= count;
    if (this.untilYield > 0) return;
    this.untilYield = 65536;
    return yieldTurn(this.signal).catch(error => { this.signal.throwIfAborted(); throw error; }).then(() => {
      this.signal.throwIfAborted();
    });
  }
}

export class Cursor {
  private readonly iterator: AsyncGenerator<Uint8Array>;
  private bytes: Uint8Array = new Uint8Array();
  private offset = 0;
  private ended = false;

  constructor(context: CommandContext, input: string, readonly budget: Budget) {
    const { signal, limits } = budget;
    const source = (async function* (): ByteSource {
      if (input === "-") yield* readBytes(context.stdin, signal);
      else {
        const path = pathOf(context, input);
        yield* readFileStream(context.fs, path, { signal, chunkSize: Math.min(65536, limits.maxChunkBytes) });
      }
    })();
    this.iterator = readBytes(source, signal);
  }

  async peek(): Promise<Uint8Array> {
    while (!this.ended && this.offset === this.bytes.length) {
      { const s = this.budget.step(); if (s) await s; }
      const result = await this.iterator.next();
      if (result.done) { this.ended = true; this.bytes = new Uint8Array(); this.offset = 0; break; }
      this.budget.input(result.value.byteLength);
      this.bytes = result.value;
      this.offset = 0;
    }
    return this.bytes.subarray(this.offset, Math.min(this.bytes.length, this.offset + this.budget.limits.maxChunkBytes));
  }

  take(size: number): Uint8Array {
    const result = new Uint8Array(this.bytes.subarray(this.offset, this.offset + size));
    this.offset += size;
    return result;
  }

  close(): void {
    void this.iterator.return(undefined).catch(() => {});
  }
}
