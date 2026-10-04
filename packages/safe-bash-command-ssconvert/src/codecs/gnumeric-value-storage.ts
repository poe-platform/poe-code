import { IntegerTable } from "@poe-code/safe-fs/storage";
import type { Cell } from "../workbook.js";
import { SsconvertError, type CapabilityContext, type WorkingStorage } from "../contracts.js";

/** A shared coordinate index and length-prefixed UTF-16 cell records. The index
 * retains 128 pointers; payload transfers retain one 16 KiB scratch window. */
export function createGnumericValueStorage(context: CapabilityContext) {
  let storage: WorkingStorage | undefined = undefined, table: IntegerTable | undefined;
  let closed = false, closing: Promise<void> | undefined, pending: Promise<unknown> = Promise.resolve();
  const scratch = new Uint8Array(16384), view = new DataView(scratch.buffer);
  const check = () => { context.signal.throwIfAborted(); if (closed) throw new SsconvertError("invalid-request", "Gnumeric cells are closed"); };
  context.own(() => {
    closed = true;
    return closing ??= pending.then(async () => { scratch.fill(0); table = undefined; await storage?.close(); });
  });
  check();
  if (!context.createWorkingStorage) throw new SsconvertError("capability-denied", "Gnumeric cells require caller storage");
  storage = context.createWorkingStorage(); check(); table = new IntegerTable(storage, 128);
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(() => { check(); return operation(); });
    pending = result.then(() => undefined, () => undefined); return result;
  }
  const base = (sheet: number) => BigInt(sheet) << 38n;
  return {
    append(sheet: number, cell: Cell) { return serial(async () => {
      const negativeZero = cell.value?.kind === "number" && Object.is(cell.value.value, -0);
      const text = JSON.stringify([cell, negativeZero]);
      const address = storage!.allocate(8 + text.length * 2);
      view.setFloat64(0, text.length, true); await storage!.write(address, scratch.subarray(0, 8)); check();
      for (let at = 0; at < text.length; at += 8192) {
        const count = Math.min(8192, text.length - at);
        for (let i = 0; i < count; i++) view.setUint16(i * 2, text.charCodeAt(at + i), true);
        await storage!.write(address + 8 + at * 2, scratch.subarray(0, count * 2)); check();
      }
      // Gnumeric admits at most 2^24 rows and 2^14 columns. Higher bits
      // identify the sheet; setting an existing coordinate replaces its record.
      await table!.set(base(sheet) | BigInt(cell.row) << 14n | BigInt(cell.column), BigInt(address)); check();
    }); },
    async *cells(sheet: number): AsyncGenerator<Cell> {
      check();
      const entries = table!.entries(base(sheet), base(sheet + 1));
      try {
        while (true) {
          const result = await serial(async () => {
            const entry = await entries.next(); check();
            if (entry.done) return undefined;
            const address = Number(entry.value[1]);
            const header = await storage!.read(address, 8); check();
            if (header.length !== 8) throw new SsconvertError("io", "Truncated Gnumeric cell header");
            const count = new DataView(header.buffer, header.byteOffset, 8).getFloat64(0, true);
            if (!Number.isSafeInteger(count) || count < 0 || count > (Number.MAX_SAFE_INTEGER - address - 8) / 2)
              throw new SsconvertError("io", "Invalid Gnumeric cell length");
            let text = '';
            for (let at = 0; at < count; at += 8192) {
              const take = Math.min(8192, count - at), bytes = await storage!.read(address + 8 + at * 2, take * 2); check();
              if (bytes.length !== take * 2) throw new SsconvertError("io", "Truncated Gnumeric cell payload");
              const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), units: number[] = [];
              for (let i = 0; i < take; i++) units.push(data.getUint16(i * 2, true));
              text += String.fromCharCode(...units);
            }
            const [cell, negativeZero] = JSON.parse(text) as [Cell, boolean];
            return negativeZero ? { ...cell, value: { kind: 'number' as const, value: -0 } } : cell;
          });
          if (result === undefined) return;
          yield result;
        }
      } finally { await entries.return(undefined); }
    }
  };
}
