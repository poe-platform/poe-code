import { readBytes, type ByteSource } from "../../contracts/index.js";
import type { AwkRetention } from "./awk-retention.js";
import { Budget, ProgramError, getCachedLatin1Batch } from "./shared.js";

interface Scan {
  block: number;
  offset: number;
  bytes: number;
  newline: number;
  paragraphEnd: number;
}

const resolvedVoid = Promise.resolve();
const RELEASED_READER_ITERATOR: AsyncIterator<Uint8Array> = {
  next() { return Promise.resolve({ done: true as const, value: undefined }); },
};

export class Reader {
  private iterator: AsyncIterator<Uint8Array>;
  private blocks: (Buffer | undefined)[] = [];
  readonly blockStrings: (string | undefined)[] = [];
  readonly blockEnds: (Int32Array | undefined)[] = [];
  blocksLen = 0;
  private blockEndIdx = 0;
  private head = 0;
  offset = 0;
  buffered = 0;
  private ownedBytes = 0;
  ended = false;
  private closed = false;
  private closing?: Promise<void> | undefined;

  constructor(source: ByteSource | undefined, private budget: Budget, private retention: Pick<AwkRetention, "admit" | "replace" | "release">) {
    this.iterator = source === undefined
      ? RELEASED_READER_ITERATOR
      : typeof (source as { tryNextSync?: unknown }).tryNextSync === "function"
      ? source[Symbol.asyncIterator]()
      : readBytes(source, budget.context.signal)[Symbol.asyncIterator]();
  }

  static fromMemoryView(chunk: Uint8Array, budget: Budget, retention: Pick<AwkRetention, "admit" | "replace" | "release">): Reader {
    const reader = new Reader(undefined, budget, retention);
    reader.ended = true;
    budget.step();
    const length = chunk.byteLength;
    if (length > budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
    if (length > 0) {
      retention.admit(0, length);
      try {
        const batch = getCachedLatin1Batch(chunk);
        const block = batch !== undefined
          ? (chunk as unknown as Buffer)
          : (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk.buffer, chunk.byteOffset, length));
        reader.blocks[0] = block;
        reader.blockStrings[0] = batch?.text;
        reader.blockEnds[0] = batch?.ends;
        reader.blocksLen = 1;
      } catch (error) {
        retention.release(length);
        throw error;
      }
      reader.buffered = length;
      reader.ownedBytes = length;
    }
    return reader;
  }

  get isEnded(): boolean {
    return this.ended && this.buffered === 0;
  }

  private retain(chunk: Uint8Array): void {
    const length = chunk.byteLength;
    if (length > this.budget.maxBufferBytes - this.buffered) throw new ProgramError("text buffer limit exceeded");
    if (length === 0) return;
    this.retention.admit(0, length);
    try {
      const block = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk.buffer, chunk.byteOffset, length);
      const batch = getCachedLatin1Batch(chunk);
      const idx = this.blocksLen++;
      this.blocks[idx] = block;
      this.blockStrings[idx] = batch?.text;
      this.blockEnds[idx] = batch?.ends;
    } catch (error) {
      this.retention.release(length);
      throw error;
    }
    this.buffered += length;
    this.ownedBytes += length;
  }

  private tryFillSync(): boolean {
    const syncIter = this.iterator as AsyncIterator<Uint8Array> & { tryNextSync?: () => IteratorResult<Uint8Array> | undefined };
    if (typeof syncIter.tryNextSync !== "function") return false;
    while (!this.ended && !this.closed) {
      this.budget.step();
      if (this.head < this.blocksLen) {
        const lastIdx = this.blocksLen - 1;
        this.blocks[lastIdx] = Buffer.from(this.blocks[lastIdx]!);
      }
      const next = syncIter.tryNextSync();
      if (next === undefined) return false;
      this.budget.context.signal.throwIfAborted();
      if (next.done) { this.ended = true; return true; }
      if (next.value.byteLength === 0) continue;
      this.retain(next.value);
      return true;
    }
    return true;
  }

  private async fill(): Promise<void> {
    this.budget.step();
    if (this.head < this.blocksLen) {
      const lastIdx = this.blocksLen - 1;
      this.blocks[lastIdx] = Buffer.from(this.blocks[lastIdx]!);
    }
    const next = await this.iterator.next();
    this.budget.context.signal.throwIfAborted();
    if (this.closed) return;
    if (next.done) { this.ended = true; return; }
    this.retain(next.value);
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
      this.blocks[this.head] = undefined;
      this.blockStrings[this.head] = undefined;
      this.blockEnds[this.head] = undefined;
      this.blockEndIdx = 0;
      this.head++;
      this.offset = 0;
    }
    if (this.head === this.blocksLen) {
      this.blocksLen = 0;
      this.blockEndIdx = 0;
      this.head = 0;
    } else if (this.head >= 256 && this.head * 2 >= this.blocksLen) {
      const rem = this.blocksLen - this.head;
      this.blocks.copyWithin(0, this.head, this.blocksLen);
      this.blockStrings.copyWithin(0, this.head, this.blocksLen);
      this.blockEnds.copyWithin(0, this.head, this.blocksLen);
      this.blocks.fill(undefined, rem, this.blocksLen);
      this.blockStrings.fill(undefined, rem, this.blocksLen);
      this.blockEnds.fill(undefined, rem, this.blocksLen);
      this.blocksLen = rem;
      this.head = 0;
    }
  }

  private finish(length: number, consumed: number): string {
    const firstBlock = this.blocks[this.head]!;
    if (length <= firstBlock.length - this.offset) {
      const str = (this.blockStrings[this.head] ??= firstBlock.toString("latin1"));
      const record = str.slice(this.offset, this.offset + length);
      this.consume(consumed);
      return record;
    }
    // The returned record is a bounded transient; runtime slots own its charge.
    const bytes = Buffer.allocUnsafe(length);
    let written = 0;
    for (let index = this.head; written < length; index++) {
      const block = this.blocks[index]!;
      const start = index === this.head ? this.offset : 0;
      const count = Math.min(length - written, block.length - start);
      bytes.set(block.subarray(start, start + count), written);
      written += count;
    }
    const record = bytes.toString("latin1");
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
    while (state.block < this.blocksLen && work > 0) {
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

  readSync(separator: string): string | undefined | Promise<string | undefined> {
    if (this.budget.context.signal.aborted) this.budget.context.signal.throwIfAborted();
    if (separator.length > 1) throw new ProgramError("RS must be one byte or empty for paragraph records");
    if (separator.length === 1 && !this.closed && this.head < this.blocksLen) {
      const headBlock = this.blocks[this.head]!;
      const idx = headBlock.indexOf(separator.charCodeAt(0), this.offset);
      if (idx >= 0 && idx - this.offset < 4096) {
        this.budget.step();
        const str = (this.blockStrings[this.head] ??= headBlock.toString("latin1"));
        const record = str.slice(this.offset, idx);
        this.consume(idx - this.offset + 1);
        return record;
      }
    }
    return this.read(separator);
  }

  readSliceSync(separator: string, out: { source: string; start: number; end: number }): boolean {
    if (this.budget.context.signal.aborted) this.budget.context.signal.throwIfAborted();
    if (separator.length === 1 && !this.closed) {
      if (this.head >= this.blocksLen && !this.ended) {
        this.tryFillSync();
      }
      if (this.head < this.blocksLen) {
        const headBlock = this.blocks[this.head]!;
        const sepCode = separator.charCodeAt(0);
        const cachedEnds = sepCode === 10 ? this.blockEnds[this.head] : undefined;
        if (cachedEnds !== undefined) {
          let eIdx = this.blockEndIdx;
          while (eIdx < cachedEnds.length && cachedEnds[eIdx]! < this.offset) eIdx++;
          if (eIdx < cachedEnds.length) {
            const idx = cachedEnds[eIdx]!;
            if (idx - this.offset < 4096) {
              this.blockEndIdx = eIdx + 1;
              out.source = (this.blockStrings[this.head] ??= headBlock.toString("latin1"));
              out.start = this.offset;
              out.end = idx;
              this.consume(idx - this.offset + 1);
              return true;
            }
          }
        }
        const idx = headBlock.indexOf(sepCode, this.offset);
        if (idx >= 0 && idx - this.offset < 4096) {
          out.source = (this.blockStrings[this.head] ??= headBlock.toString("latin1"));
          out.start = this.offset;
          out.end = idx;
          this.consume(idx - this.offset + 1);
          return true;
        }
        if (idx < 0 && this.head + 1 === this.blocksLen && !this.ended) {
          this.tryFillSync();
          if (this.head + 1 === this.blocksLen && this.ended && headBlock.length - this.offset < 4096) {
            out.source = (this.blockStrings[this.head] ??= headBlock.toString("latin1"));
            out.start = this.offset;
            out.end = headBlock.length;
            this.consume(headBlock.length - this.offset);
            return true;
          }
        }
      }
    }
    return false;
  }
  async read(separator: string): Promise<string | undefined> {
    this.budget.context.signal.throwIfAborted();
    if (separator.length > 1) throw new ProgramError("RS must be one byte or empty for paragraph records");
    if (separator.length === 1 && !this.closed && this.head < this.blocksLen) {
      const headBlock = this.blocks[this.head]!;
      const idx = headBlock.indexOf(separator.charCodeAt(0), this.offset);
      if (idx >= 0 && idx - this.offset < 4096) {
        this.budget.step();
        const record = headBlock.toString("latin1", this.offset, idx);
        this.consume(idx - this.offset + 1);
        return record;
      }
    }
    if (separator === "") {
      while (!this.closed) {
        this.budget.step();
        if (this.trimLeading()) break;
        if (this.buffered === 0) {
          if (this.ended) return undefined;
          await this.fill();
        }
        const pendingCheck = this.budget.checkpointSync();
        if (pendingCheck) await pendingCheck;
      }
    }
    const state: Scan = { block: this.head, offset: this.offset, bytes: 0, newline: -1, paragraphEnd: -1 };
    while (true) {
      this.budget.step();
      if (this.closed) return undefined;
      const found = this.scan(separator, state);
      if (found) return this.finish(found.length, found.consumed);
      if (state.block === this.blocksLen) {
        if (this.ended) {
          if (this.buffered === 0) return undefined;
          const length = separator !== "" ? this.buffered : state.paragraphEnd >= 0 ? state.paragraphEnd
            : state.newline === this.buffered - 1 ? this.buffered - 1 : this.buffered;
          return this.finish(length, this.buffered);
        }
        await this.fill();
      }
      const pendingCheck = this.budget.checkpointSync();
      if (pendingCheck) await pendingCheck;
    }
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    const wasEnded = this.ended;
    this.closed = true;
    this.ended = true;
    if (this.blocksLen > 0) {
      this.blocks.fill(undefined, 0, this.blocksLen);
      this.blockStrings.fill(undefined, 0, this.blocksLen);
      this.blockEnds.fill(undefined, 0, this.blocksLen);
      this.blocksLen = 0;
    }
    this.head = this.offset = this.buffered = 0;
    this.retention.release(this.ownedBytes);
    this.ownedBytes = 0;
    const origIter = this.iterator;
    this.iterator = RELEASED_READER_ITERATOR;
    if (wasEnded || !origIter.return) {
      this.closing = resolvedVoid;
      return resolvedVoid;
    }
    this.closing = Promise.resolve().then(async () => { await origIter.return?.(); });
    return this.closing;
  }

  closeSyncOrAsync(): Promise<void> | undefined {
    if (this.closing) return this.closing === resolvedVoid ? undefined : this.closing;
    const wasEnded = this.ended;
    this.closed = true;
    this.ended = true;
    if (this.blocksLen > 0) {
      this.blocks.fill(undefined, 0, this.blocksLen);
      this.blockStrings.fill(undefined, 0, this.blocksLen);
      this.blockEnds.fill(undefined, 0, this.blocksLen);
      this.blocksLen = 0;
    }
    this.head = this.offset = this.buffered = 0;
    this.retention.release(this.ownedBytes);
    this.ownedBytes = 0;
    const origIter = this.iterator;
    this.iterator = RELEASED_READER_ITERATOR;
    if (wasEnded || !origIter.return) {
      this.closing = resolvedVoid;
      return undefined;
    }
    this.closing = Promise.resolve().then(async () => { await origIter.return?.(); });
    return this.closing;
  }
}
