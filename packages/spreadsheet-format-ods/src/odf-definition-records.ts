import type { CapabilityContext, WorkingStorage } from "@poe-code/spreadsheet-engine/contracts";

type Record = readonly [number, number, number];

/** Fixed descriptors reference imported nodes or externally stored generated text. */
export function createDefinitionRecords(context: CapabilityContext, storage?: WorkingStorage) {
  const records: Record[] = [], texts: string[] = [];
  return {
    async put(record: Record): Promise<number> {
      context.signal.throwIfAborted();
      if (!storage) { records.push(record); return records.length; }
      const address = storage.allocate(24), bytes = new Uint8Array(24), view = new DataView(bytes.buffer);
      record.forEach((value, index) => view.setFloat64(index * 8, value, true));
      await storage.write(address, bytes); context.signal.throwIfAborted(); return address;
    },
    async get(address: number): Promise<Record> {
      context.signal.throwIfAborted();
      if (!storage) return records[address - 1]!;
      const bytes = new Uint8Array(await storage.read(address, 24));
      context.signal.throwIfAborted();
      if (bytes.length !== 24) throw new RangeError("Truncated ODF definition record");
      const view = new DataView(bytes.buffer), result = [view.getFloat64(0, true), view.getFloat64(8, true), view.getFloat64(16, true)] as const;
      if (result.some(value => !Number.isSafeInteger(value) || value < 0)) throw new RangeError("Invalid ODF definition record");
      return result;
    },
    async putText(value: string): Promise<number> {
      context.signal.throwIfAborted();
      if (!storage) { texts.push(value); return texts.length; }
      const address = storage.allocate(8 + value.length * 2), header = new Uint8Array(8), buffer = new Uint8Array(4096), view = new DataView(buffer.buffer);
      new DataView(header.buffer).setFloat64(0, value.length, true);
      try {
        await storage.write(address, header);
        for (let offset = 0; offset < value.length; offset += 2048) {
          context.signal.throwIfAborted(); const count = Math.min(2048, value.length - offset);
          for (let index = 0; index < count; index++) view.setUint16(index * 2, value.charCodeAt(offset + index), true);
          await storage.write(address + 8 + offset * 2, buffer.subarray(0, count * 2));
        }
        context.signal.throwIfAborted(); return address;
      } finally { buffer.fill(0); }
    },
    async *text(address: number): AsyncGenerator<string> {
      context.signal.throwIfAborted();
      if (!storage) { yield texts[address - 1]!; return; }
      const header = new Uint8Array(await storage.read(address, 8));
      context.signal.throwIfAborted();
      if (header.length !== 8) throw new RangeError("Truncated ODF definition text");
      const length = new DataView(header.buffer).getFloat64(0, true);
      if (!Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(address + 8 + length * 2)) throw new RangeError("Invalid ODF definition text");
      for (let offset = 0; offset < length; offset += 2048) {
        context.signal.throwIfAborted(); const count = Math.min(2048, length - offset), bytes = await storage.read(address + 8 + offset * 2, count * 2);
        context.signal.throwIfAborted();
        if (bytes.length !== count * 2) throw new RangeError("Truncated ODF definition text");
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), units: number[] = [];
        for (let index = 0; index < count; index++) units.push(view.getUint16(index * 2, true));
        yield String.fromCharCode(...units);
      }
    }
  };
}
