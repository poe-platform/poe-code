import { IntegerTable, PagedStorage, type PagedStorageContext } from "@poe-code/safe-fs/storage";
import { normalizeVorbisCommentKey, type AudioProbeSource, type FlacCommentSpan } from "@poe-code/audio-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

/** Arbitrary UTF-16 keys, collision chains and ordered value spans in caller backing. */
export class FlacTags {
  private readonly storage: PagedStorage;
  private readonly keys: IntegerTable;
  private readonly numeric: IntegerTable;
  private head = 0;
  private tail = 0;
  private work = 0;
  count = 0;
  readonly close: () => Promise<void>;
  constructor(private readonly source: AudioProbeSource, private readonly context: PagedStorageContext) {
    this.storage = new PagedStorage(context, 4);
    this.close = this.storage.close.bind(this.storage);
    this.keys = new IntegerTable(this.storage, 128);
    this.numeric = new IntegerTable(this.storage, 128);
  }
  private async read(offset: number, length: number) {
    this.context.signal.throwIfAborted();
    const bytes = await this.source.read(offset, length);
    this.context.signal.throwIfAborted();
    if (bytes.length !== length) throw new Error("Truncated FLAC comment");
    return bytes;
  }
  private async *decoded(offset: number, length: number, ignoreBOM: boolean) {
    const decoder = new TextDecoder("utf-8", { ignoreBOM });
    let steps = 0;
    for (let at = 0; at < length; at += 16384) {
      yield decoder.decode(await this.read(offset + at, Math.min(16384, length - at)), { stream: true });
      if (++steps % 256 === 0) await yieldTurn(this.context.signal);
    }
    yield decoder.decode();
  }
  private async record(position: number) {
    const bytes = await this.storage.read(position, 64), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    return Array.from({ length: 8 }, (_, i) => view.getFloat64(i * 8, true));
  }
  private async write(position: number, values: number[]) {
    const bytes = new Uint8Array(values.length * 8), view = new DataView(bytes.buffer);
    values.forEach((value, i) => view.setFloat64(i * 8, value, true));
    await this.storage.write(position, bytes);
  }
  private async equal(a: number, b: number, units: number) {
    for (let at = 0; at < units * 2; at += 16384) {
      const size = Math.min(16384, units * 2 - at), left = await this.storage.read(a + at, size), right = await this.storage.read(b + at, size);
      if (!left.every((value, i) => value === right[i])) return false;
    }
    return true;
  }
  private async *keyText(position: number, units: number) {
    let pending = "";
    for (let at = 0; at < units; at += 8192) {
      const bytes = await this.storage.read(position + at * 2, Math.min(8192, units - at) * 2), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      let text = pending; pending = "";
      for (let i = 0; i < bytes.length; i += 2) text += String.fromCharCode(view.getUint16(i, true));
      const last = text.charCodeAt(text.length - 1);
      if (last >= 0xd800 && last <= 0xdbff) { pending = text.slice(-1); text = text.slice(0, -1); }
      if (text) yield text;
    }
    if (pending) yield pending;
  }
  async add(span: FlacCommentSpan) {
    if (++this.work % 256 === 0) await yieldTurn(this.context.signal);
    let split = -1;
    for (let at = 0; at < span.length; at += 16384) {
      const bytes = await this.read(span.offset + at, Math.min(16384, span.length - at)), found = bytes.indexOf(61);
      if (found >= 0) { split = at + found; break; }
      if ((at / 16384 + 1) % 256 === 0) await yieldTurn(this.context.signal);
    }
    if (split <= 0) return;
    let keyPosition = this.storage.allocate(0), units = 0, hash = 2166136261, short = "";
    const appendKey = async (text: string) => {
      for (let at = 0; at < text.length; at += 8192) {
        const part = text.slice(at, at + 8192), bytes = new Uint8Array(part.length * 2), view = new DataView(bytes.buffer);
        for (let i = 0; i < part.length; i++) { const code = part.charCodeAt(i); view.setUint16(i * 2, code, true); hash = Math.imul(hash ^ code, 16777619) >>> 0; }
        await this.storage.append(bytes); units += part.length;
        if (short.length <= 12) short += part.slice(0, 13 - short.length);
      }
    };
    for await (const part of this.decoded(span.offset, split, false)) await appendKey(part.toUpperCase());
    if (!units) return;
    if (units <= 12) {
      const normalized = normalizeVorbisCommentKey(short);
      if (normalized !== short) { keyPosition = this.storage.allocate(0); units = 0; hash = 2166136261; short = ""; await appendKey(normalized); }
    }
    const first = await this.keys.get(BigInt(hash));
    let existing = 0, row: number[] | undefined;
    for (let position = Number(first ?? 0n); position;) {
      const candidate = await this.record(position);
      if (candidate[3] === units && await this.equal(candidate[2]!, keyPosition, units)) { existing = position; row = candidate; break; }
      position = candidate[1]!;
    }
    // Records: insertion-next, collision-next, key-offset/units, block, first/last-value, truthy.
    const position = existing || this.storage.allocate(64);
    row ??= [0, Number(first ?? 0n), keyPosition, units, span.block, 0, 0, 0];
    const append = row[4] === span.block && !!row[7], value = this.storage.allocate(32), offset = span.offset + split + 1, length = span.length - split - 1;
    await this.write(value, [0, offset, length, append ? 1 : 0]);
    if (append) await this.write(row[6]!, [value]); else row[5] = value;
    row[4] = span.block; row[6] = value; row[7] = append || length > 0 ? 1 : 0;
    await this.write(position, row);
    if (existing) return;
    await this.keys.set(BigInt(hash), BigInt(position)); this.count++;
    const numeric = units <= 10 ? Number(short) : NaN;
    if (Number.isInteger(numeric) && numeric >= 0 && numeric < 0xffffffff && String(numeric) === short) await this.numeric.set(BigInt(numeric), BigInt(position));
    else {
      if (this.tail) await this.write(this.tail, [position]); else this.head = position;
      this.tail = position;
    }
  }
  private async *valueText(value: number) {
    while (value) {
      const bytes = await this.storage.read(value, 32), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      if (view.getFloat64(24, true)) yield "\n";
      yield* this.decoded(view.getFloat64(8, true), view.getFloat64(16, true), true);
      value = view.getFloat64(0, true);
    }
  }
  private async entry(position: number) {
    const row = await this.record(position);
    return { next: row[0]!, key: () => this.keyText(row[2]!, row[3]!), text: () => this.valueText(row[5]!) };
  }
  async *entries() {
    for await (const [, position] of this.numeric.entries()) yield await this.entry(Number(position));
    for (let position = this.head; position;) { const entry = await this.entry(position); position = entry.next; yield entry; }
  }
}
