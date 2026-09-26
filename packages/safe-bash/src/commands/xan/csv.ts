import type { ByteSource } from "../../contracts/io.js";
import { readBytes } from "../../contracts/io.js";
import { Budget, Bytes, XanError } from "./budget.js";
import type { Subcommand } from "./argv.js";

export interface Cell { decoded: Bytes; raw: Bytes; faithful: boolean }
export interface RecordRow { cells: Cell[]; width: number; offset: number; number: number; free(): void }
export class Scanner {
  private readonly iterator: AsyncIterator<Uint8Array>;
  private chunk: Uint8Array = new Uint8Array(0);
  private cursor = 0;
  private absolute = 0;
  private initial = true;
  private endByte: bigint | undefined;
  private prefix: number[] = [];
  private skipLF = false;
  private count = 0;
  private finished = false;
  private closePromise?: Promise<void>;
  constructor(source: ByteSource, readonly delimiter: number, readonly dialect: Subcommand, readonly budget: Budget, readonly signal: AbortSignal = budget.signal) {
    this.iterator = readBytes(source, signal)[Symbol.asyncIterator]();
  }
  close(): Promise<void> {
    this.closePromise ??= (async () => { if (!this.finished) await this.iterator.return?.(); this.chunk = new Uint8Array(0); })();
    return this.closePromise;
  }
  private nextByte(): number | undefined | Promise<number | undefined> {
    if (this.budget.aborted) this.signal.throwIfAborted();
    if (this.endByte !== undefined && BigInt(this.absolute) >= this.endByte) return undefined;
    if (this.prefix.length) return this.prefix.shift()!;
    if (this.cursor < this.chunk.length) {
      this.absolute++;
      this.budget.work();
      const c = this.budget.checkpoint();
      const b = this.chunk[this.cursor++]!;
      return c ? c.then(() => b) : b;
    }
    return this.nextByteAsync();
  }
  private async nextByteAsync(): Promise<number | undefined> {
    while (this.cursor === this.chunk.length) {
      this.budget.check();
      const next = await this.iterator.next();
      this.budget.check();
      this.chunk = new Uint8Array(0); this.cursor = 0;
      if (next.done) { this.finished = true; return undefined; }
      this.budget.bound("maxChunkBytes", next.value.length);
      this.budget.add("maxChunks", 1); this.budget.add("maxInputBytes", next.value.length);
      this.chunk = next.value;
    }
    this.absolute++;
    this.budget.work();
    const c = this.budget.checkpoint(); if (c) await c;
    return this.chunk[this.cursor++];
  }
  async position(start: bigint, end?: bigint): Promise<void> {
    this.initial = false;
    while (BigInt(this.absolute) < start) if (await this.nextByte() === undefined) break;
    this.endByte = end;
  }
  async *raw(): ByteSource {
    const bytes = new Bytes(this.budget);
    try {
      while (true) {
        const byte = await this.nextByte();
        if (byte === undefined) break;
        { const p = bytes.push(byte); if (p) await p; }
        if (bytes.length === 4096) { this.budget.add("maxOutputBytes", bytes.length); yield bytes.view(); bytes.free(); }
      }
      if (bytes.length) { this.budget.add("maxOutputBytes", bytes.length); yield bytes.view(); }
    } finally { bytes.free(); await this.close(); }
  }
  async next(): Promise<RecordRow | undefined> {
    this.budget.check();
    if (this.initial) {
      this.initial = false;
      const first = await this.nextByte();
      if (first === 239) {
        const second = await this.nextByte();
        if (second === 187) {
          const third = await this.nextByte();
          if (third !== 191) this.prefix = third === undefined ? [first, second] : [first, second, third];
        } else this.prefix = second === undefined ? [first] : [first, second];
      } else if (first !== undefined) this.prefix = [first];
    }
    const cells: Cell[] = [];
    const countOnly = this.dialect === "count";
    let raw = countOnly ? undefined! : new Bytes(this.budget);
    let decoded = countOnly ? undefined! : new Bytes(this.budget);
    let state: "start" | "plain" | "quoted" | "closed" = "start";
    const quoted = (): boolean => state === "quoted";
    let active = false;
    let recordBytes = 0;
    let cellBytes = 0;
    let width = 0;
    let pendingCR = false;
    let offset = this.absolute - this.prefix.length;
    let faithful = true;
    let rowHeld = false;
    const account = (byte: number, separator = false): void | Promise<void> => {
      this.budget.bound("maxRecordBytes", ++recordBytes);
      if (!separator) this.budget.bound("maxCellBytes", ++cellBytes);
      if (!countOnly && !separator) return raw.push(byte);
    };
    const cell = (): void => {
      this.budget.bound("maxColumns", ++width);
      if (!countOnly) {
        this.budget.hold(32); cells.push({ decoded, raw, faithful });
        raw = new Bytes(this.budget); decoded = new Bytes(this.budget);
      }
      cellBytes = 0; state = "start"; faithful = true;
    };
    const chain = (a: void | Promise<void>, b: () => void | Promise<void>): void | Promise<void> => a ? a.then(b) : b();
    const content = (byte: number): void | Promise<void> => {
      if (!active) {
        this.budget.add("maxRecords", 1); this.count++;
        this.budget.bound("maxColumns", 1); this.budget.hold(32); rowHeld = true;
      }
      active = true;
      if (byte === this.delimiter && state !== "quoted") this.budget.bound("maxColumns", width + 2);
      if (countOnly) {
        if (byte === 34) { const p = account(byte); state = state === "quoted" ? "plain" : "quoted"; return p; }
        if (byte === this.delimiter && state !== "quoted") { const p = account(byte, true); return p ? p.then(cell) : cell(); }
        const p = account(byte); if (state !== "quoted") state = "plain"; return p;
      }
      if (state === "quoted") {
        const p = account(byte);
        if (byte === 34) { state = "closed"; return p; }
        return chain(p, () => decoded.push(byte));
      }
      if (state === "closed" && byte === 34) {
        state = "quoted";
        return chain(account(byte), () => decoded.push(byte));
      }
      if (byte === this.delimiter) {
        const p = account(byte, true);
        return p ? p.then(cell) : cell();
      }
      if (byte === 34 && state === "start") {
        state = "quoted";
        return account(byte);
      }
      if (this.dialect !== "headers" && (byte === 34 || state === "closed")) throw new XanError("unsupported malformed CSV quoting");
      state = "plain";
      return chain(account(byte), () => decoded.push(byte));
    };
    try {
      while (true) {
        const nb = this.nextByte();
        const byte = typeof nb === "number" || nb === undefined ? nb : await nb;
        if (byte === undefined) {
          if (pendingCR && this.dialect !== "slice") { const p = content(13); if (p) await p; }
          if (!active) return undefined;
          if (quoted()) faithful = false;
          cell(); break;
        }
        if (this.skipLF) { this.skipLF = false; if (byte === 10) { offset = this.absolute; continue; } }
        if (pendingCR) {
          pendingCR = false;
          if (byte === 10) { cell(); break; }
          const p = content(13); if (p) await p;
        }
        if (!quoted()) {
          if (!active && (byte === 10 || byte === 13)) { offset = this.absolute; continue; }
          if (byte === 10 || (byte === 13 && this.dialect === "headers")) { if (byte === 13) this.skipLF = true; cell(); break; }
          if (byte === 13) { pendingCR = true; continue; }
        }
        const p = content(byte);
        if (p) await p;
      }
      let released = false;
      rowHeld = false;
      return { cells, width, offset, number: this.count, free: () => {
        if (released) return; released = true;
        for (const value of cells) { value.decoded.free(); value.raw.free(); this.budget.release(32); }
        this.budget.release(32);
        cells.length = 0;
      } };
    } catch (error) {
      for (const value of cells) { value.decoded.free(); value.raw.free(); this.budget.release(32); }
      throw error;
    } finally { if (!countOnly) { raw.free(); decoded.free(); } if (rowHeld) this.budget.release(32); }
  }
}
