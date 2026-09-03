import { yieldTurn } from "../../contracts/yield.js";
import { FsError, readBytes, type ByteSource, type CommandContext } from "../../contracts/index.js";
import { pathOf } from "../internal.js";
import type { SplitLimits } from "./options.js";

export async function interruptible<Result>(operation: () => Promise<Result>, signal: AbortSignal): Promise<Result> {
  signal.throwIfAborted();
  return new Promise<Result>((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); }).then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
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
  async step(count = 1): Promise<void> {
    this.signal.throwIfAborted();
    this.check(count, this.limits.maxSteps - this.steps, "work");
    this.steps += count;
    this.untilYield -= count;
    if (this.untilYield <= 0) {
      this.untilYield = 65536;
      await yieldTurn(this.signal).catch(error => { this.signal.throwIfAborted(); throw error; });
    }
    this.signal.throwIfAborted();
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
        if (context.fs.readStream && context.fs.capabilities.streamingRead !== false) {
          yield* readBytes(context.fs.readStream(path, { signal, chunkSize: limits.maxChunkBytes }), signal);
        } else {
          const maxBytes = Math.min(limits.maxInputBytes, limits.maxBufferBytes);
          const bytes = await interruptible(() => context.fs.readFile(path, { signal, maxBytes }), signal);
          budget.check(bytes.byteLength, maxBytes, "read buffer");
          yield bytes;
        }
      }
    })();
    this.iterator = readBytes(source, signal);
  }

  async peek(): Promise<Uint8Array> {
    while (!this.ended && this.offset === this.bytes.length) {
      await this.budget.step();
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
