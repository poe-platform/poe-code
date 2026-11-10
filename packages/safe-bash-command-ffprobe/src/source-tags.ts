import { ProbeTextDecoder } from "./string-validation.js";
import { IntegerTable, PagedStorage, type PagedStorageContext } from "@poe-code/safe-fs/storage";
import { readId3Text, type AudioProbeSource, type WavTagSpan, type Mp3Tag } from "@poe-code/audio-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

/** Arbitrary WAV/ID3 keys, ordered records and source spans in caller backing. */
export class SourceAudioTags {
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

  private async *decoded(offset: number, length: number, encoding = 255, unsynchronized = false, binary = false) {
    if (encoding < 4) {
      yield* readId3Text(this.source, { key: "", offset, length, encoding, unsynchronized, binary }, { signal: this.context.signal, checkpoint: () => yieldTurn(this.context.signal) });
      return;
    }
    const decoder = new ProbeTextDecoder(); let steps = 0;
    for (let at = 0; at < length; at += 16384) {
      this.context.signal.throwIfAborted();
      const bytes = await (encoding === 254 ? this.storage : this.source).read(offset + at, Math.min(16384, length - at));
      this.context.signal.throwIfAborted();
      if (bytes.length !== Math.min(16384, length - at)) throw new Error("Truncated audio tag");
      yield decoder.decode(bytes, { stream: true });
      if (++steps % 256 === 0) await yieldTurn(this.context.signal);
    }
    yield decoder.decode();
  }

  async add(tag: WavTagSpan | Mp3Tag) {
    const literal = "value" in tag ? new TextEncoder().encode(tag.value) : undefined;
    const span = "value" in tag ? { key: tag.key, offset: await this.storage.append(literal!), length: literal!.length } : tag;
    const encoding = literal ? 254 : "encoding" in tag ? tag.encoding : 255;
    const unsynchronized = "unsynchronized" in tag && tag.unsynchronized;
    const binary = "binary" in tag && tag.binary === true;
    let units = 0, kept = 0;
    for await (const text of this.decoded(span.offset, span.length, encoding, unsynchronized, binary)) {
      if (binary) { kept += text.length; continue; }
      const zero = text.indexOf("\0"), part = zero < 0 ? text : text.slice(0, zero);
      for (const unit of part) { units += unit.length; if (unit.trimEnd()) kept = units; }
      if (zero >= 0) break;
    }
    let hash = 2166136261;
    for (let i = 0; i < span.key.length; i++) {
      hash = Math.imul(hash ^ span.key.charCodeAt(i), 16777619) >>> 0;
      if (i % 8192 === 8191) await yieldTurn(this.context.signal);
    }
    const first = Number(await this.keys.get(BigInt(hash)) ?? 0n);
    let existing = 0;
    for (let candidate = first; candidate;) {
      const bytes = await this.storage.read(candidate, 64), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      if (view.getFloat64(40, true) === span.key.length && await this.keyText(view.getFloat64(32, true), span.key.length) === span.key) { existing = candidate; break; }
      candidate = view.getFloat64(48, true);
    }
    // Records: insertion-next, value offset/length/units, key offset/units, collision-next, encoding/unsync/binary.
    const position = existing || this.storage.allocate(64);
    const bytes = existing ? await this.storage.read(position, 64) : new Uint8Array(64);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    view.setFloat64(8, span.offset, true); view.setFloat64(16, span.length, true); view.setFloat64(24, kept, true);
    if (!existing) {
      const offset = this.storage.allocate(span.key.length * 2);
      for (let at = 0; at < span.key.length; at += 8192) {
        const part = new Uint8Array(Math.min(8192, span.key.length - at) * 2), key = new DataView(part.buffer);
        for (let i = 0; i < part.length / 2; i++) key.setUint16(i * 2, span.key.charCodeAt(at + i), true);
        await this.storage.write(offset + at * 2, part);
        if (at + 8192 < span.key.length) await yieldTurn(this.context.signal);
      }
      view.setFloat64(32, offset, true); view.setFloat64(40, span.key.length, true); view.setFloat64(48, first, true);
    }
    bytes[56] = encoding; bytes[57] = (unsynchronized ? 1 : 0) | (binary ? 2 : 0);
    await this.storage.write(position, bytes);
    if (existing) return;
    await this.keys.set(BigInt(hash), BigInt(position)); this.count++;
    const numeric = Number(span.key);
    if (Number.isInteger(numeric) && numeric >= 0 && numeric < 0xffffffff && String(numeric) === span.key) await this.numeric.set(BigInt(numeric), BigInt(position));
    else {
      if (this.tail) { const link = new Uint8Array(8); new DataView(link.buffer).setFloat64(0, position, true); await this.storage.write(this.tail, link); }
      else this.head = position;
      this.tail = position;
    }
  }

  private async keyText(offset: number, units: number) {
    let key = "";
    for (let at = 0; at < units; at += 8192) {
      const bytes = await this.storage.read(offset + at * 2, Math.min(8192, units - at) * 2), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      for (let i = 0; i < bytes.length; i += 2) key += String.fromCharCode(view.getUint16(i, true));
      if (at + 8192 < units) await yieldTurn(this.context.signal);
    }
    return key;
  }

  private async record(position: number) {
    const bytes = await this.storage.read(position, 64), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    const key = await this.keyText(view.getFloat64(32, true), view.getFloat64(40, true));
    const offset = view.getFloat64(8, true), length = view.getFloat64(16, true), kept = view.getFloat64(24, true), decoded = this.decoded.bind(this), encoding = bytes[56]!, unsynchronized = !!(bytes[57]! & 1), binary = !!(bytes[57]! & 2);
    return { key, next: view.getFloat64(0, true), async *text() {
      let remaining = kept;
      if (!remaining) return;
      for await (const part of decoded(offset, length, encoding, unsynchronized, binary)) {
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
