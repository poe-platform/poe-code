import type { ByteSink, ByteSource } from "safe-bash-contracts";
import { yieldTurn } from "safe-bash-contracts/yield";
import { Diagnostic } from "./args.js";
import { IntegerTable, ShufStorage } from "./storage.js";

export interface StoredRecord { readonly position: number; readonly length: number }

export class RecordTable {
  length = 0;
  private readonly index: IntegerTable;
  constructor(private readonly storage: ShufStorage) { this.index = new IntegerTable(storage); }

  async push(record: StoredRecord): Promise<void> {
    await this.set(this.length, record);
    this.length++;
  }

  async set(index: number, record: StoredRecord): Promise<void> {
    const bytes = new Uint8Array(16);
    const view = new DataView(bytes.buffer);
    view.setBigUint64(0, BigInt(record.position), true);
    view.setBigUint64(8, BigInt(record.length), true);
    const position = await this.storage.append(bytes);
    await this.index.set(BigInt(index), BigInt(position));
  }

  async get(index: number): Promise<StoredRecord> {
    const position = await this.index.get(BigInt(index));
    if (position === undefined) throw new RangeError("Missing shuf record");
    const bytes = await this.storage.read(Number(position), 16);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { position: Number(view.getBigUint64(0, true)), length: Number(view.getBigUint64(8, true)) };
  }

  async output(index: number, sink: ByteSink): Promise<void> {
    const record = await this.get(index);
    for (let offset = 0; offset < record.length; offset += 16384) {
      await sink.write(await this.storage.read(record.position + offset, Math.min(16384, record.length - offset)));
    }
  }
}

/** Store record pieces as they arrive; even an unterminated record can exceed RAM. */
export async function* storedRecords(source: ByteSource, delimiter: number, limit: number, signal: AbortSignal, storage: ShufStorage): AsyncGenerator<StoredRecord> {
  let position = 0;
  let length = 0;
  let scanned = 0;
  for await (const chunk of source) {
    for (let offset = 0; offset < chunk.length;) {
      signal.throwIfAborted();
      const partEnd = Math.min(chunk.length, offset + 16384);
      const relative = chunk.subarray(offset, partEnd).indexOf(delimiter);
      const boundary = relative < 0 ? -1 : offset + relative;
      const end = boundary < 0 ? partEnd : boundary + 1;
      if (length + end - offset > limit) throw new Diagnostic("shuf: maxInputBytes limit exceeded\n");
      const next = await storage.append(Uint8Array.prototype.slice.call(chunk, offset, end));
      if (length === 0) position = next;
      length += end - offset;
      offset = end;
      if (boundary >= 0 && end === boundary + 1) {
        const record = { position, length };
        length = 0;
        yield record;
      }
      if (++scanned % 1024 === 0) await yieldTurn(signal);
    }
  }
  if (length) {
    if (length >= limit) throw new Diagnostic("shuf: maxInputBytes limit exceeded\n");
    await storage.append(Uint8Array.of(delimiter));
    yield { position, length: length + 1 };
  }
}
