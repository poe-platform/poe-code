import { setImmediate } from "node:timers/promises";
import type { XanLimits } from "./options.js";

export class XanError extends Error {}
export class LimitError extends XanError {
  constructor(readonly limit: keyof XanLimits) { super(`${limit} limit exceeded`); }
}
export class Budget {
  readonly totals = new Map<keyof XanLimits, number>();
  retained = 0;
  private workSinceYield = 0;
  constructor(readonly limits: XanLimits, public signal: AbortSignal) {}
  check(): void { this.signal.throwIfAborted(); }
  bound(name: keyof XanLimits, value: number): void {
    this.check();
    if (!Number.isSafeInteger(value) || value < 0 || value > this.limits[name]) throw new LimitError(name);
  }
  add(name: keyof XanLimits, value: number): void {
    const next = (this.totals.get(name) ?? 0) + value;
    this.bound(name, next);
    this.totals.set(name, next);
  }
  hold(bytes: number): void { this.bound("maxRetainedBytes", this.retained + bytes); this.retained += bytes; }
  release(bytes: number): void { this.retained -= bytes; }
  work(bytes = 1): void { this.add("maxWork", bytes); this.workSinceYield += bytes; }
  async checkpoint(): Promise<void> {
    this.check();
    if (this.workSinceYield >= 65536) { this.workSinceYield = 0; await setImmediate(); this.check(); }
  }
  async textSize(text: string): Promise<number> {
    let bytes = 0;
    for (let offset = 0; offset < text.length; offset++) {
      const code = text.charCodeAt(offset);
      if (code >= 0xd800 && code <= 0xdbff) {
        const low = text.charCodeAt(++offset);
        if (!(low >= 0xdc00 && low <= 0xdfff)) throw new XanError("invalid scalar argument");
        bytes += 4; this.work(4);
      } else {
        if (code >= 0xdc00 && code <= 0xdfff) throw new XanError("invalid scalar argument");
        const size = code < 128 ? 1 : code < 2048 ? 2 : 3;
        bytes += size; this.work(size);
      }
      if ((offset & 1023) === 0) await this.checkpoint();
    }
    return bytes;
  }
  async encode(text: string): Promise<Uint8Array> {
    const size = await this.textSize(text);
    this.hold(size);
    try {
      const result = new Uint8Array(size);
      let offset = 0;
      for (let cursor = 0; cursor < text.length; cursor++) {
        let code = text.charCodeAt(cursor);
        if (code >= 0xd800 && code <= 0xdbff) code = 0x10000 + ((code - 0xd800) << 10) + text.charCodeAt(++cursor) - 0xdc00;
        const begin = offset;
        if (code < 128) result[offset++] = code;
        else if (code < 2048) { result[offset++] = 192 | (code >> 6); result[offset++] = 128 | (code & 63); }
        else if (code < 65536) { result[offset++] = 224 | (code >> 12); result[offset++] = 128 | ((code >> 6) & 63); result[offset++] = 128 | (code & 63); }
        else { result[offset++] = 240 | (code >> 18); result[offset++] = 128 | ((code >> 12) & 63); result[offset++] = 128 | ((code >> 6) & 63); result[offset++] = 128 | (code & 63); }
        this.work(offset - begin);
        if ((cursor & 1023) === 0) await this.checkpoint();
      }
      return result;
    }
    catch (error) { this.release(size); throw error; }
  }
}

export class Bytes {
  private storage = new Uint8Array(0);
  length = 0;
  constructor(readonly budget: Budget) {}
  get capacity(): number { return this.storage.byteLength; }
  at(index: number): number | undefined { return this.storage[index]; }
  view(): Uint8Array { return this.storage.subarray(0, this.length); }
  async push(value: number): Promise<void> {
    if (this.length === this.storage.length) {
      const capacity = Math.max(1, this.storage.length * 2);
      this.budget.hold(capacity);
      try {
        const next = new Uint8Array(capacity);
        for (let offset = 0; offset < this.length; offset += 4096) {
          const fragment = this.storage.subarray(offset, Math.min(this.length, offset + 4096));
          this.budget.work(fragment.length); next.set(fragment, offset); await this.budget.checkpoint();
        }
        this.budget.release(this.storage.length);
        this.storage = next;
      } catch (error) { this.budget.release(capacity); throw error; }
    }
    this.budget.work(); this.storage[this.length++] = value;
  }
  pop(): void { if (this.length) this.length--; }
  free(): void { this.budget.release(this.storage.length); this.storage = new Uint8Array(0); this.length = 0; }
}
