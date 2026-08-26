import type { ByteSource } from "../contracts/index.js";
import { Budget, interruptible } from "./runtime.js";

export class ShellInput implements ByteSource {
  readonly #iterator: AsyncIterator<Uint8Array>;
  #pending: Uint8Array | undefined;
  #ended = false;
  #reading = false;

  constructor(source: ByteSource, readonly budget: Budget, readonly signal = budget.signal) {
    this.#iterator = source[Symbol.asyncIterator]();
  }

  async next(): Promise<IteratorResult<Uint8Array>> {
    this.signal.throwIfAborted();
    if (this.#pending) {
      const value = this.#pending;
      this.#pending = undefined;
      return { value, done: false };
    }
    if (this.#ended) return { value: undefined, done: true };
    this.#reading = true;
    try {
      const result = await interruptible(this.#iterator.next(), this.signal);
      if (result.done) this.#ended = true;
      else if (!(result.value instanceof Uint8Array)) throw new TypeError("Shell stdin must yield Uint8Array");
      return result;
    } finally { this.#reading = false; }
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<Uint8Array> {
    return { next: () => this.next(), [Symbol.asyncIterator]() { return this; } };
  }

  async line(raw: boolean): Promise<{ value: string; terminated: boolean }> {
    const chunks: Uint8Array[] = [];
    let length = 0;
    let terminated = false;
    while (true) {
      const result = await this.next();
      if (result.done) break;
      const newline = result.value.indexOf(10);
      const chunk = newline < 0 ? result.value : result.value.subarray(0, newline);
      if (chunk.byteLength > this.budget.limits.maxOutputBytes - length) this.budget.fail("maxOutputBytes");
      chunks.push(new Uint8Array(chunk));
      length += chunk.byteLength;
      if (newline >= 0) {
        if (newline + 1 < result.value.length) this.#pending = result.value.subarray(newline + 1);
        let slashes = 0;
        if (!raw) {
          for (let chunkIndex = chunks.length - 1; chunkIndex >= 0; chunkIndex--) {
            const bytes = chunks[chunkIndex]!;
            let offset = bytes.length - 1;
            while (offset >= 0 && bytes[offset] === 92) { slashes++; offset--; }
            if (offset >= 0) break;
          }
        }
        if (slashes % 2 === 1) {
          while (chunks.at(-1)?.length === 0) chunks.pop();
          chunks[chunks.length - 1] = chunks.at(-1)!.subarray(0, -1);
          length--;
        } else { terminated = true; break; }
      }
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const value = new TextDecoder().decode(bytes).replace(/\0/gu, "");
    return { value: raw ? value : value.replace(/\\(.)/gsu, "$1"), terminated };
  }

  async close(): Promise<void> {
    if (this.#ended) return;
    this.#ended = true;
    try {
      const returned = Promise.resolve(this.#iterator.return?.()).then(() => undefined, () => undefined);
      if (!this.#reading && !this.signal.aborted) await returned;
    } catch {}
  }
}
