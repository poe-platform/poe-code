import { scanOggPages, type AudioProbeSource } from "@poe-code/audio-ast";
import { IntegerTable, PagedStorage, type PagedStorageContext } from "@poe-code/safe-fs/storage";
import { yieldTurn } from "safe-bash-contracts/yield";

interface IndexedOggStream {
  readonly serial: number;
  readonly size: number;
  readonly granule: bigint;
  readonly packets: number;
  readonly group: number;
  readonly pageGranule: bigint;
  readonly head: AudioProbeSource | undefined;
  readonly comments: AudioProbeSource | undefined;
}

/** Logical state and the first two packet span chains live in caller backing. */
export class OggIndex {
  private readonly storage: PagedStorage;
  private readonly serials: IntegerTable;
  private first = 0;
  private last = 0;
  private firstPage = 0;
  private lastPage = 0;
  private started = false;
  private ready = false;
  private closed = false;
  readonly close: () => Promise<void>;
  constructor(private readonly source: AudioProbeSource, private readonly context: PagedStorageContext) {
    this.storage = new PagedStorage(context, 4);
    this.serials = new IntegerTable(this.storage, 128);
    this.close = async () => { this.closed = true; await this.storage.close(); };
  }

  private check(): void {
    this.context.signal.throwIfAborted();
    if (this.closed) throw new Error("Ogg index is closed");
  }

  async scan(): Promise<void> {
    this.check();
    if (this.started) throw new Error("Ogg index already scanned");
    this.started = true;
    let active = 0, seen = 0, group = 0;
    for await (const page of scanOggPages(this.source, { signal: this.context.signal, checkpoint: async () => { this.check(); await yieldTurn(this.context.signal); this.check(); } })) {
      const key = BigInt(page.serial), existing = await this.serials.get(key);
      const position = existing === undefined ? this.storage.allocate(128) : Number(existing);
      const bytes = existing === undefined ? new Uint8Array(128) : await this.storage.read(position, 128);
      const row = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      if (existing === undefined) {
        if (!(page.flags & 2) || page.sequence !== 0) throw new Error("Missing Ogg beginning-of-stream");
        row.setUint32(8, 0xffffffff, true);
        row.setUint32(96, page.serial, true);
        await this.serials.set(key, BigInt(position));
        if (!active) group++;
        row.setFloat64(120, group, true);
        if (this.lastPage) { const link = new Uint8Array(8); new DataView(link.buffer).setFloat64(0, position, true); await this.storage.write(this.lastPage + 104, link); }
        else this.firstPage = position;
        this.lastPage = position;
        active++; seen++;
      }
      if (bytes[12] || page.sequence !== (row.getUint32(8, true) + 1) >>> 0 || !!(page.flags & 1) !== !!bytes[13])
        throw new Error("Invalid Ogg sequence/continuation");
      row.setUint32(8, page.sequence, true);
      if (page.granule !== 0xffffffffffffffffn) row.setBigUint64(112, page.granule, true);
      row.setFloat64(32, row.getFloat64(32, true) + page.size, true);
      let packet = row.getFloat64(16, true), pending = row.getFloat64(24, true);
      let sourceOffset = page.payloadOffset, spanSize = 0, completed = false;
      for (let i = 0; i < page.lacing.length; i++) {
        const lace = page.lacing[i]!;
        spanSize += lace;
        if (lace === 255 && i !== page.lacing.length - 1) continue;
        if (packet < 2 && spanSize) {
          const span = this.storage.allocate(32), data = new Uint8Array(32), record = new DataView(data.buffer);
          record.setFloat64(8, pending, true); record.setFloat64(16, sourceOffset, true); record.setFloat64(24, spanSize, true);
          await this.storage.write(span, data);
          const field = 48 + packet * 24, tail = row.getFloat64(field + 8, true);
          if (tail) { const link = new Uint8Array(8); new DataView(link.buffer).setFloat64(0, span, true); await this.storage.write(tail, link); }
          else row.setFloat64(field, span, true);
          row.setFloat64(field + 8, span, true); row.setFloat64(field + 16, pending + spanSize, true);
        }
        sourceOffset += spanSize; pending += spanSize; spanSize = 0;
        bytes[13] = lace === 255 ? 1 : 0;
        if (lace < 255) {
          // Match resident packet order: a later BOS may finish its first packet
          // before an earlier stream whose identification packet spans pages.
          if (packet === 0) {
            if (this.last) { const link = new Uint8Array(8); new DataView(link.buffer).setFloat64(0, position, true); await this.storage.write(this.last, link); }
            else this.first = position;
            this.last = position;
          }
          packet++; pending = 0; completed = true;
        }
      }
      if (completed && page.granule !== 0xffffffffffffffffn) row.setBigUint64(40, page.granule, true);
      if (page.flags & 4) {
        if (bytes[13]) throw new Error("Incomplete final Ogg packet");
        bytes[12] = 1; active--;
      }
      row.setFloat64(16, packet, true); row.setFloat64(24, pending, true);
      await this.storage.write(position, bytes);
    }
    if (!seen || active) throw new Error("Incomplete Ogg stream");
    this.ready = true;
  }

  private packet(first: number, size: number): AudioProbeSource {
    const { storage, source, context } = this, check = this.check.bind(this);
    let cached: { position: number; next: number; start: number; offset: number; length: number } | undefined;
    return { size, async read(offset, length) {
      check();
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > size)
        throw new RangeError("Invalid Ogg packet range");
      const output = new Uint8Array(Math.min(length, size - offset, 16384));
      let used = 0, steps = 0, position = cached && offset >= cached.start ? cached.position : first;
      while (used < output.length) {
        if (++steps % 256 === 0) { await yieldTurn(context.signal); check(); }
        if (!position) throw new Error("Truncated Ogg packet index");
        if (!cached || position !== cached.position) {
          const bytes = await storage.read(position, 32), row = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
          cached = { position, next: row.getFloat64(0, true), start: row.getFloat64(8, true), offset: row.getFloat64(16, true), length: row.getFloat64(24, true) };
        }
        if (offset >= cached.start + cached.length) { position = cached.next; continue; }
        if (offset < cached.start) throw new Error("Invalid Ogg packet index");
        const take = Math.min(output.length - used, cached.start + cached.length - offset);
        const chunk = await source.read(cached.offset + offset - cached.start, take);
        check();
        if (!chunk.length || chunk.length > take) throw new Error("Truncated Ogg packet source");
        output.set(chunk, used); used += chunk.length; offset += chunk.length;
      }
      return output;
    } };
  }

  async *streams(pageOrder = false): AsyncGenerator<IndexedOggStream, void> {
    this.check();
    if (!this.ready) throw new Error("Ogg index is not validated");
    let steps = 0;
    for (let position = pageOrder ? this.firstPage : this.first; position;) {
      if (++steps % 256 === 0) { await yieldTurn(this.context.signal); this.check(); }
      const bytes = await this.storage.read(position, 128), row = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      const packets = row.getFloat64(16, true);
      yield { group: row.getFloat64(120, true), pageGranule: row.getBigUint64(112, true), serial: row.getUint32(96, true), size: row.getFloat64(32, true), granule: row.getBigUint64(40, true), packets,
        head: packets ? this.packet(row.getFloat64(48, true), row.getFloat64(64, true)) : undefined,
        comments: packets > 1 ? this.packet(row.getFloat64(72, true), row.getFloat64(88, true)) : undefined };
      position = row.getFloat64(pageOrder ? 104 : 0, true);
    }
  }
}
