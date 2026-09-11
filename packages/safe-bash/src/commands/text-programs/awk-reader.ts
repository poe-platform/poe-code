import { readBytes, type ByteSource } from "../../contracts/index.js";
import type { AwkRetention } from "./awk-retention.js";
import { Budget, ProgramError } from "./shared.js";

interface Scan {
  block: number;
  offset: number;
  bytes: number;
  newline: number;
  paragraphEnd: number;
}

export class Reader {
  private readonly iterator: AsyncIterator<Uint8Array>;
  private blocks: (Uint8Array | undefined)[] = [];
  private head = 0;
  private offset = 0;
  private buffered = 0;
  private ownedBytes = 0;
  private ended = false;
  private closed = false;
  private closing?: Promise<void>;

  constructor(source: ByteSource, private readonly budget: Budget, private readonly retention: Pick<AwkRetention, "replace" | "release">) {
    this.iterator = readBytes(source, budget.context.signal)[Symbol.asyncIterator]();
  }

  private async fill(): Promise<void> {
    this.budget.step();
    const next = await this.iterator.next();
    this.budget.context.signal.throwIfAborted();
    if (this.closed) return;
    if (next.done) { this.ended = true; return; }
    const length = next.value.byteLength;
    if (length > this.budget.maxBufferBytes - this.buffered) throw new ProgramError("text buffer limit exceeded");
    if (length === 0) return;
    const block = this.retention.replace(0, length, () => {
      const owned = new Uint8Array(length);
      owned.set(next.value);
      return owned;
    });
    try { this.blocks.push(block); }
    catch (error) { this.retention.release(length); throw error; }
    this.buffered += length;
    this.ownedBytes += length;
  }

  private consume(length: number): void {
    this.buffered -= length;
    while (length > 0) {
      const block = this.blocks[this.head]!;
      const available = block.length - this.offset;
      if (length < available) { this.offset += length; break; }
      length -= available;
      this.retention.release(block.length);
      this.ownedBytes -= block.length;
      this.blocks[this.head++] = undefined;
      this.offset = 0;
    }
    if (this.head === this.blocks.length) { this.blocks = []; this.head = 0; }
    else if (this.head >= 256 && this.head * 2 >= this.blocks.length) {
      this.blocks = this.blocks.slice(this.head);
      this.head = 0;
    }
  }

  private finish(length: number, consumed: number): string {
    // The returned record is a bounded transient; runtime slots own its charge.
    const bytes = new Uint8Array(length);
    let written = 0;
    for (let index = this.head; written < length; index++) {
      const block = this.blocks[index]!;
      const start = index === this.head ? this.offset : 0;
      const count = Math.min(length - written, block.length - start);
      bytes.set(block.subarray(start, start + count), written);
      written += count;
    }
    const record = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
    this.consume(consumed);
    return record;
  }

  private trimLeading(): boolean {
    const block = this.blocks[this.head];
    if (!block) return false;
    let end = this.offset;
    const stop = Math.min(block.length, end + 4096);
    while (end < stop && block[end] === 10) end++;
    const found = end < block.length && block[end] !== 10;
    this.consume(end - this.offset);
    return found;
  }

  private scan(separator: string, state: Scan): { length: number; consumed: number } | undefined {
    let work = 4096;
    while (state.block < this.blocks.length && work > 0) {
      const block = this.blocks[state.block]!;
      while (state.offset < block.length && work-- > 0) {
        const byte = block[state.offset++]!;
        const index = state.bytes++;
        if (separator === "") {
          if (state.paragraphEnd >= 0) {
            if (byte !== 10) return { length: state.paragraphEnd, consumed: index };
          } else {
            if (byte === 10 && state.newline === index - 1) state.paragraphEnd = index - 1;
            state.newline = byte === 10 ? index : -1;
          }
        } else if (byte === separator.charCodeAt(0)) return { length: index, consumed: index + 1 };
      }
      if (state.offset === block.length) { state.block++; state.offset = 0; }
    }
    return undefined;
  }

  async read(separator: string): Promise<string | undefined> {
    this.budget.context.signal.throwIfAborted();
    if (separator.length > 1) throw new ProgramError("RS must be one byte or empty for paragraph records");
    if (separator === "") {
      while (!this.closed) {
        this.budget.step();
        if (this.trimLeading()) break;
        if (this.buffered === 0) {
          if (this.ended) return undefined;
          await this.fill();
        }
        await this.budget.checkpoint();
      }
    }
    const state: Scan = { block: this.head, offset: this.offset, bytes: 0, newline: -1, paragraphEnd: -1 };
    while (true) {
      this.budget.step();
      if (this.closed) return undefined;
      const found = this.scan(separator, state);
      if (found) return this.finish(found.length, found.consumed);
      if (state.block === this.blocks.length) {
        if (this.ended) {
          if (this.buffered === 0) return undefined;
          const length = separator !== "" ? this.buffered : state.paragraphEnd >= 0 ? state.paragraphEnd
            : state.newline === this.buffered - 1 ? this.buffered - 1 : this.buffered;
          return this.finish(length, this.buffered);
        }
        await this.fill();
      }
      await this.budget.checkpoint();
    }
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.ended = true;
    this.blocks = [];
    this.head = this.offset = this.buffered = 0;
    this.retention.release(this.ownedBytes);
    this.ownedBytes = 0;
    this.closing = Promise.resolve().then(async () => { await this.iterator.return?.(); });
    return this.closing;
  }
}
