import { IntegerTable, PagedStorage, type PagedStorageContext } from "@poe-code/safe-fs/storage";
import type { AudioProbeSource, WavTagSpan } from "@poe-code/audio-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

/** Fixed-width INFO keys, ordered records and source spans in caller backing. */
export class WavTags {
  private readonly storage: PagedStorage;
  private readonly keys: IntegerTable;
  private readonly numeric: IntegerTable;
  private head = 0;
  private tail = 0;
  count = 0;
  readonly close: () => Promise<void>;
  constructor(private readonly source: AudioProbeSource, private readonly context: PagedStorageContext) {
    this.storage = new PagedStorage(context, 4);
    this.close = this.storage.close.bind(this.storage);
    this.keys = new IntegerTable(this.storage, 128);
    this.numeric = new IntegerTable(this.storage, 128);
  }

  private async *decoded(offset: number, length: number) {
    const decoder = new TextDecoder(); let steps = 0;
    for (let at = 0; at < length; at += 16384) {
      this.context.signal.throwIfAborted();
      const bytes = await this.source.read(offset + at, Math.min(16384, length - at));
      this.context.signal.throwIfAborted();
      if (bytes.length !== Math.min(16384, length - at)) throw new Error("Truncated WAV tag");
      yield decoder.decode(bytes, { stream: true });
      if (++steps % 256 === 0) await yieldTurn(this.context.signal);
    }
    yield decoder.decode();
  }

  async add(span: WavTagSpan) {
    let units = 0, kept = 0;
    for await (const text of this.decoded(span.offset, span.length)) {
      const zero = text.indexOf("\0"), part = zero < 0 ? text : text.slice(0, zero);
      for (const unit of part) { units += unit.length; if (unit.trimEnd()) kept = units; }
      if (zero >= 0) break;
    }
    // Raw INFO identifiers have four Windows-1252 code units (< 0x8000).
    // Longer normalized names are ASCII and use the disjoint high-bit namespace.
    let key = 0n;
    for (let i = 0; i < span.key.length; i++) key = (key << (span.key.length > 4 ? 7n : 16n)) | BigInt(span.key.charCodeAt(i));
    if (span.key.length > 4) key |= 1n << 63n;
    const existing = await this.keys.get(key);
    const position = existing === undefined ? this.storage.allocate(56) : Number(existing);
    const bytes = existing === undefined ? new Uint8Array(56) : await this.storage.read(position, 56);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    view.setFloat64(8, span.offset, true); view.setFloat64(16, span.length, true); view.setFloat64(24, kept, true);
    view.setUint16(32, span.key.length, true);
    for (let i = 0; i < span.key.length; i++) view.setUint16(34 + i * 2, span.key.charCodeAt(i), true);
    await this.storage.write(position, bytes);
    if (existing !== undefined) return;
    await this.keys.set(key, BigInt(position)); this.count++;
    const numeric = Number(span.key);
    if (Number.isInteger(numeric) && numeric >= 0 && numeric < 0xffffffff && String(numeric) === span.key) await this.numeric.set(BigInt(numeric), BigInt(position));
    else {
      if (this.tail) { const link = new Uint8Array(8); new DataView(link.buffer).setFloat64(0, position, true); await this.storage.write(this.tail, link); }
      else this.head = position;
      this.tail = position;
    }
  }

  private async record(position: number) {
    const bytes = await this.storage.read(position, 56), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    let key = ""; for (let i = 0; i < view.getUint16(32, true); i++) key += String.fromCharCode(view.getUint16(34 + i * 2, true));
    const offset = view.getFloat64(8, true), length = view.getFloat64(16, true), kept = view.getFloat64(24, true), decoded = this.decoded.bind(this);
    return { key, next: view.getFloat64(0, true), async *text() {
      let remaining = kept;
      if (!remaining) return;
      for await (const part of decoded(offset, length)) {
        const take = Math.min(remaining, part.length); if (take) yield part.slice(0, take);
        remaining -= take; if (!remaining) return;
      }
    } };
  }

  async *entries() {
    for await (const [, position] of this.numeric.entries()) yield await this.record(Number(position));
    for (let position = this.head; position;) { const entry = await this.record(position); position = entry.next; yield entry; }
  }

}
