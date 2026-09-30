import type { CommandContext } from "safe-bash-contracts";
import { yieldTurn } from "safe-bash-contracts/yield";
import { Diagnostic, quote, unicodeLocale, wordMax } from "./args.js";
import { FileInput } from "./input.js";

export class RandomIntegers {
  private value = 0n;
  private maximum = 0n;
  private bytes = new Uint8Array();
  private offset = 0;
  private source: FileInput | undefined;
  private state: Uint32Array | undefined;
  private closed = false;
  private closing: Promise<void> | undefined;
  private opening: Promise<void> | undefined;
  private readonly controller = new AbortController();
  private readonly signal: AbortSignal;

  constructor(private readonly context: CommandContext, private readonly name: string | undefined, private readonly maxBytes = Infinity) {
    this.signal = AbortSignal.any([context.signal, this.controller.signal]);
    context.registerCleanup?.(() => this.close());
  }

  open(): Promise<void> {
    if (this.closed) return Promise.reject(this.signal.reason);
    return this.opening ??= Promise.resolve().then(async () => {
      const signal = this.signal;
      signal.throwIfAborted();
      if (this.name === undefined) return;
      this.source = new FileInput({ ...this.context, signal }, this.maxBytes);
      await this.source.open(this.name);
      signal.throwIfAborted();
    });
  }

  close(): Promise<void> {
    this.closed = true;
    this.controller.abort(new Error("shuf random source is closed"));
    return this.closing ??= (async () => {
      await this.source?.close();
      this.bytes.fill(0);
      this.value = this.maximum = 0n;
    })();
  }

  seed(): void {
    if (!this.state) {
      this.state = globalThis.crypto.getRandomValues(new Uint32Array(4));
      if (this.state.every(value => value === 0)) this.state[0] = 1;
    }
  }

  private refill(): void {
    this.seed();
    const state = this.state!;
    const product = Math.imul(state[1]!, 5);
    const result = Math.imul((product << 7) | (product >>> 25), 9) >>> 0;
    const shifted = state[1]! << 9;
    state[2] = state[2]! ^ state[0]!;
    state[3] = state[3]! ^ state[1]!;
    state[1] = state[1]! ^ state[2]!;
    state[0] = state[0]! ^ state[3]!;
    state[2] = state[2]! ^ shifted;
    state[3] = (state[3]! << 11) | (state[3]! >>> 21);
    this.bytes = Uint8Array.of(result & 255, (result >>> 8) & 255, (result >>> 16) & 255, result >>> 24);
  }

  private async byte(): Promise<number> {
    this.signal.throwIfAborted();
    if (this.closed) throw new Error("shuf random source is closed");
    while (this.offset === this.bytes.length) {
      if (this.source) {
        const next = await this.source.next();
        this.signal.throwIfAborted();
        if (next.done) throw new Diagnostic(`shuf: ${quote(this.name!, unicodeLocale(this.context))}: end of file\n`);
        if (next.value.byteLength > this.maxBytes) throw new Diagnostic("shuf: maxInputBytes limit exceeded\n");
        this.bytes = new Uint8Array(next.value);
      } else {
        this.refill();
      }
      this.offset = 0;
      this.signal.throwIfAborted();
    }
    return this.bytes[this.offset++]!;
  }

  chooseSync(size: bigint): bigint {
    if (size < 1n || size > wordMax) throw new RangeError("shuf choice size out of range");
    const target = size - 1n;
    while (true) {
      this.signal.throwIfAborted();
      if (this.closed) throw new Error("shuf random source is closed");
      while (this.maximum < target) {
        if (this.offset === this.bytes.length) {
          this.refill();
          this.offset = 0;
        }
        this.value = ((this.value << 8n) + BigInt(this.bytes[this.offset++]!)) & wordMax;
        this.maximum = ((this.maximum << 8n) + 255n) & wordMax;
      }
      if (this.maximum === target) {
        const chosen = this.value;
        this.value = this.maximum = 0n;
        return chosen;
      }
      const excess = this.maximum - target;
      const unusable = excess % size;
      const remainder = this.value % size;
      if (this.value <= this.maximum - unusable) {
        this.value /= size;
        this.maximum = excess / size;
        return remainder;
      }
      this.value = remainder;
      this.maximum = unusable - 1n;
    }
  }

  async choose(size: bigint): Promise<bigint> {
    if (size < 1n || size > wordMax) throw new RangeError("shuf choice size out of range");
    const target = size - 1n;
    let attempts = 0;
    while (true) {
      this.signal.throwIfAborted();
      if (++attempts % 256 === 0) await yieldTurn(this.signal);
      while (this.maximum < target) {
        this.value = ((this.value << 8n) + BigInt(await this.byte())) & wordMax;
        this.maximum = ((this.maximum << 8n) + 255n) & wordMax;
      }
      if (this.maximum === target) {
        const chosen = this.value;
        this.value = this.maximum = 0n;
        return chosen;
      }
      const excess = this.maximum - target;
      const unusable = excess % size;
      const remainder = this.value % size;
      if (this.value <= this.maximum - unusable) {
        this.value /= size;
        this.maximum = excess / size;
        return remainder;
      }
      this.value = remainder;
      this.maximum = unusable - 1n;
    }
  }
}
