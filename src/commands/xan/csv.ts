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
  private prefix: number[] = [];
  private skipLF = false;
  private count = 0;
  private finished = false;
  private closePromise?: Promise<void>;
  constructor(source: ByteSource, readonly delimiter: number, readonly dialect: Subcommand, readonly budget: Budget) {
    this.iterator = readBytes(source, budget.signal)[Symbol.asyncIterator]();
  }
  close(): Promise<void> {
    this.closePromise ??= (async () => { if (!this.finished) await this.iterator.return?.(); this.chunk = new Uint8Array(0); })();
    return this.closePromise;
  }
  private async nextByte(): Promise<number | undefined> {
    if (this.prefix.length) return this.prefix.shift()!;
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
    this.budget.work(); await this.budget.checkpoint();
    return this.chunk[this.cursor++];
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
    let raw = new Bytes(this.budget);
    let decoded = new Bytes(this.budget);
    let state: "start" | "plain" | "quoted" | "closed" = "start";
    const quoted = (): boolean => state === "quoted";
    let active = false;
    let recordBytes = 0;
    let cellBytes = 0;
    let width = 0;
    let pendingCR = false;
    let offset = this.absolute - this.prefix.length;
    let faithful = true;
    const countOnly = this.dialect === "count";
    const account = (byte: number, separator = false): void => {
      this.budget.bound("maxRecordBytes", ++recordBytes);
      if (!separator) this.budget.bound("maxCellBytes", ++cellBytes);
      if (!countOnly && !separator) raw.push(byte);
    };
    const cell = (): void => {
      this.budget.bound("maxColumns", ++width);
      if (!countOnly) { this.budget.hold(32); cells.push({ decoded, raw, faithful }); }
      raw = new Bytes(this.budget); decoded = new Bytes(this.budget); cellBytes = 0; state = "start"; faithful = true;
    };
    const content = (byte: number): void => {
      active = true;
      if (countOnly) {
        if (byte === 34) { account(byte); state = state === "quoted" ? "plain" : "quoted"; }
        else if (byte === this.delimiter && state !== "quoted") { account(byte, true); cell(); }
        else { account(byte); if (state !== "quoted") state = "plain"; }
        return;
      }
      if (state === "quoted") {
        account(byte);
        if (byte === 34) state = "closed";
        else decoded.push(byte);
      } else if (state === "closed" && byte === 34) {
        account(byte); decoded.push(byte); state = "quoted";
      } else if (byte === this.delimiter) { account(byte, true); cell(); }
      else if (byte === 34 && state === "start") { account(byte); state = "quoted"; }
      else {
        if (this.dialect !== "headers" && (byte === 34 || state === "closed")) throw new XanError("unsupported malformed CSV quoting");
        account(byte); decoded.push(byte); state = "plain";
      }
    };
    try {
      while (true) {
        const byte = await this.nextByte();
        if (byte === undefined) {
          if (pendingCR && this.dialect !== "slice") content(13);
          if (!active) return undefined;
          if (quoted()) faithful = false;
          cell(); break;
        }
        if (this.skipLF) { this.skipLF = false; if (byte === 10) { offset = this.absolute; continue; } }
        if (pendingCR) {
          pendingCR = false;
          if (byte === 10) { cell(); break; }
          content(13);
        }
        if (!quoted()) {
          if (!active && (byte === 10 || byte === 13)) { offset = this.absolute; continue; }
          if (byte === 10 || (byte === 13 && this.dialect === "headers")) { if (byte === 13) this.skipLF = true; cell(); break; }
          if (byte === 13) { pendingCR = true; continue; }
        }
        content(byte);
      }
      this.budget.add("maxRecords", 1); this.count++;
      let released = false;
      return { cells, width, offset, number: this.count, free: () => {
        if (released) return; released = true;
        for (const value of cells) { value.decoded.free(); value.raw.free(); this.budget.release(32); }
        cells.length = 0;
      } };
    } catch (error) {
      for (const value of cells) { value.decoded.free(); value.raw.free(); this.budget.release(32); }
      throw error;
    } finally { raw.free(); decoded.free(); }
  }
}
