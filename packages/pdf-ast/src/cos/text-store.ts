import { IntegerTable, PagedStorage } from "@poe-code/safe-fs/storage";
import { cosString, type PdfPixelStorage } from "../ast.js";
import { appendStoredRecord, readStoredItems } from "../content/stored-record.js";
import { PdfError } from "../errors.js";
import type { PdfIndexStorage } from "./object-index.js";
import { serializeCosNodeBytes } from "./writer.js";

/** Caller-backed UTF-16 text with fixed caches and stable numeric identities.
 * Failed appends remain unreachable; close releases all text and index backing. */
export class PdfTextStore {
  private readonly backing: PagedStorage;
  private readonly retained: PdfPixelStorage;
  private readonly index: IntegerTable;
  private readonly controller = new AbortController();
  private readonly signal: AbortSignal;
  private count = 0;
  private work = 0;
  private pending: Promise<unknown> = Promise.resolve();
  private closing: Promise<void> | undefined;
  constructor(storage: PdfIndexStorage, options: { readonly signal?: AbortSignal; readonly maxStagingBytes?: number } = {}) {
    const maximum = options.maxStagingBytes ?? Infinity;
    if (maximum !== Infinity && (!Number.isSafeInteger(maximum) || maximum < 0)) throw new RangeError("Invalid PDF text staging limit");
    this.signal = options.signal ? AbortSignal.any([options.signal, this.controller.signal]) : this.controller.signal;
    this.backing = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal: this.signal }, 4);
    let allocated = 0;
    this.retained = { allocate: length => {
      if (!Number.isSafeInteger(length) || length < 0 || length > Math.min(maximum, Number.MAX_SAFE_INTEGER) - allocated) throw new PdfError("E_LIMIT", "PDF text staging byte limit exceeded");
      const position = this.backing.allocate(length); allocated += length; return position;
    }, read: this.backing.read.bind(this.backing), write: this.backing.write.bind(this.backing) };
    this.index = new IntegerTable(this.retained, 64);
  }
  private async checkpoint() {
    this.signal.throwIfAborted();
    if (++this.work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    this.signal.throwIfAborted();
  }
  append(input: string | AsyncIterable<string>): Promise<number> {
    const operation = this.pending.then(async () => {
      await this.checkpoint(); let first = -1, last = -1, count = 0, utf16 = false;
      const chunks = typeof input === "string" ? [input] : input;
      let buffered = "";
      const flush = async () => {
        if (!buffered) return;
        utf16 ||= cosString(buffered).format === "hex";
        const position = await appendStoredRecord(this.retained, buffered, last, this.signal);
        if (first === -1) first = position;
        last = position; count++; buffered = "";
      };
      for await (const text of chunks) {
        await this.checkpoint();
        for (let at = 0; at < text.length;) {
          await this.checkpoint(); const length = Math.min(2048 - buffered.length, text.length - at);
          buffered += text.slice(at, at + length); at += length;
          if (buffered.length === 2048) await flush();
        }
      }
      await flush();
      const id = this.count;
      await this.index.set(BigInt(id) * 3n, BigInt(first + 1));
      await this.index.set(BigInt(id) * 3n + 1n, BigInt(count));
      await this.index.set(BigInt(id) * 3n + 2n, utf16 ? 1n : 0n);
      this.signal.throwIfAborted(); this.count++; return id;
    });
    this.pending = operation.catch(() => {}); return operation;
  }
  private async identity(id: number) {
    await this.checkpoint();
    if (!Number.isSafeInteger(id) || id < 0 || id >= this.count) throw new RangeError("Unknown PDF text identity");
    return BigInt(id) * 3n;
  }
  async *text(id: number): AsyncGenerator<string, void, void> {
    const key = await this.identity(id), position = Number(await this.index.get(key)) - 1, length = Number(await this.index.get(key + 1n));
    let high = "";
    for await (const part of readStoredItems<string>({ storage: this.retained, position, length }, this.signal)) {
      await this.checkpoint(); let text = high + part; high = "";
      const last = text.charCodeAt(text.length - 1);
      if (last >= 0xd800 && last <= 0xdbff) { high = text.slice(-1); text = text.slice(0, -1); }
      if (text) yield text;
    }
    if (high) yield high;
  }
  /** Same encoding and bytes as cosString(), including its literal escaping. */
  async *serialized(id: number): AsyncGenerator<Uint8Array, void, void> {
    const key = await this.identity(id), utf16 = (await this.index.get(key + 2n)) === 1n, encoder = new TextEncoder();
    yield encoder.encode(utf16 ? "<FEFF" : "(");
    for await (const text of this.text(id)) {
      if (utf16) {
        let hex = ""; for (let at = 0; at < text.length; at++) hex += text.charCodeAt(at).toString(16).padStart(4, "0").toUpperCase();
        yield encoder.encode(hex);
      } else { const bytes = serializeCosNodeBytes(cosString(text)); yield bytes.subarray(1, bytes.length - 1); }
    }
    yield encoder.encode(utf16 ? ">" : ")");
  }
  close(): Promise<void> {
    if (!this.closing) {
      this.controller.abort(new PdfError("E_CAPABILITY", "PDF text store is closed"));
      this.closing = this.pending.then(() => this.backing.close());
    }
    return this.closing;
  }
}
