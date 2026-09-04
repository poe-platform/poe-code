import { randomFillSync } from "node:crypto";
import type { CommandContext } from "../../contracts/index.js";
import { yieldTurn } from "../../contracts/yield.js";
import { Diagnostic, quote, wordMax } from "./args.js";
import { ownedBytes, virtualPath } from "./input.js";

export class RandomIntegers {
  private value = 0n;
  private maximum = 0n;
  private bytes = new Uint8Array();
  private offset = 0;
  private source: AsyncGenerator<Uint8Array> | undefined;
  private closed = false;
  private closing: Promise<void> | undefined;
  private opening: Promise<void> | undefined;
  private readonly controller = new AbortController();
  private readonly signal: AbortSignal;

  constructor(private readonly context: CommandContext, private readonly name: string | undefined, private readonly maxBytes = 64 * 1024 * 1024) {
    this.signal = AbortSignal.any([context.signal, this.controller.signal]);
    context.registerCleanup?.(() => this.close());
  }

  open(): Promise<void> {
    if (this.closed) return Promise.reject(this.signal.reason);
    return this.opening ??= Promise.resolve().then(async () => {
      const { fs } = this.context;
      const signal = this.signal;
      signal.throwIfAborted();
      if (this.name === undefined) return;
      const path = virtualPath(this.context.cwd, this.name);
      await fs.access(path, 4, { signal });
      signal.throwIfAborted();
      if (fs.readStream) this.source = ownedBytes(fs.readStream(path, { signal, chunkSize: Math.min(4096, this.maxBytes) }), signal);
      else {
        const maxBytes = this.maxBytes;
        this.source = ownedBytes((async function* () {
          const bytes = await fs.readFile(path, { signal, maxBytes });
          if (bytes.byteLength > maxBytes) throw new Diagnostic("shuf: maxInputBytes limit exceeded\n");
          yield bytes;
        })(), signal);
      }
      signal.throwIfAborted();
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    this.controller.abort(new Error("shuf random source is closed"));
    return this.closing ??= (async () => {
      await this.opening?.catch(() => {});
      await this.source?.return(undefined);
      this.bytes.fill(0);
      this.value = this.maximum = 0n;
    })();
  }

  private async byte(): Promise<number> {
    this.signal.throwIfAborted();
    if (this.closed) throw new Error("shuf random source is closed");
    while (this.offset === this.bytes.length) {
      if (this.source) {
        const next = await this.source.next();
        this.signal.throwIfAborted();
        if (next.done) throw new Diagnostic(`shuf: ${quote(this.name!)}: end of file\n`);
        if (next.value.byteLength > this.maxBytes) throw new Diagnostic("shuf: maxInputBytes limit exceeded\n");
        this.bytes = new Uint8Array(next.value);
      } else {
        this.bytes = randomFillSync(new Uint8Array(4096));
      }
      this.offset = 0;
      this.signal.throwIfAborted();
    }
    return this.bytes[this.offset++]!;
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
