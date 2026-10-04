import { IntegerTable } from '@poe-code/safe-fs/storage';
import type { Cell } from '@poe-code/spreadsheet-ast';
import { SsconvertError, type WorkingStorage } from '@poe-code/spreadsheet-engine/contracts';

/** One coordinate cache and transfer window shared by every sheet. Backing
 * lifetime belongs to the caller; replay returns an owned individual cell. */
export function createOdfCellStorage(storage: WorkingStorage, signal: AbortSignal) {
  let index: IntegerTable | undefined = new IntegerTable(storage, 128);
  const scratch = new Uint8Array(16384), view = new DataView(scratch.buffer);
  let closed = false, pending: Promise<unknown> = Promise.resolve();
  const check = () => { signal.throwIfAborted(); if (closed) throw new SsconvertError('invalid-request', 'ODF cells are closed'); };
  function serial<T>(action: () => Promise<T>) {
    const result = pending.then(() => { check(); return action(); });
    pending = result.then(() => undefined, () => undefined); return result;
  }
  const base = (sheet: number) => BigInt(sheet) << 38n;
  async function read(pointer: bigint): Promise<Cell> {
    const address = Number(pointer), header = await storage.read(address, 8); check();
    if (header.length !== 8) throw new SsconvertError('io', 'Truncated ODF cell header');
    const length = new DataView(header.buffer, header.byteOffset, 8).getFloat64(0, true);
    if (!Number.isSafeInteger(length) || length < 0 || length > (Number.MAX_SAFE_INTEGER - address - 8) / 2)
      throw new SsconvertError('io', 'Invalid ODF cell length');
    let text = '';
    for (let offset = 0; offset < length; offset += 8192) {
      const count = Math.min(8192, length - offset), bytes = await storage.read(address + 8 + offset * 2, count * 2); check();
      if (bytes.length !== count * 2) throw new SsconvertError('io', 'Truncated ODF cell');
      const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), units: number[] = [];
      for (let i = 0; i < count; i++) units.push(data.getUint16(i * 2, true));
      text += String.fromCharCode(...units);
    }
    const [cell, zeros] = JSON.parse(text) as [Cell, number[]];
    let ordinal = 0, next = 0;
    function restore(value: unknown) {
      if (!value || typeof value !== 'object') return;
      const object = value as Record<string, unknown>;
      for (const key of Object.keys(object)) {
        if (typeof object[key] === 'number') { if (zeros[next] === ordinal) { object[key] = -0; next++; } ordinal++; }
        else restore(object[key]);
      }
    }
    if (zeros.length) restore(cell);
    return cell;
  }
  return {
    async close() { closed = true; await pending; scratch.fill(0); index = undefined; },
    append(sheet: number, cell: Cell) {
      check();
      // Serialize before yielding, so producers can immediately reuse their cell.
      let ordinal = 0;
      const zeros: number[] = [];
      const payload = JSON.stringify(cell, (_key, value: unknown) => {
        if (typeof value === 'number') { if (Object.is(value, -0)) zeros.push(ordinal); ordinal++; }
        return value;
      });
      const text = '[' + payload + ',' + JSON.stringify(zeros) + ']';
      const key = base(sheet) | BigInt(cell.row) << 14n | BigInt(cell.column);
      return serial(async () => {
        const address = storage.allocate(8 + text.length * 2);
        view.setFloat64(0, text.length, true); await storage.write(address, scratch.subarray(0, 8)); check();
        for (let offset = 0; offset < text.length; offset += 8192) {
          const count = Math.min(8192, text.length - offset);
          for (let i = 0; i < count; i++) view.setUint16(i * 2, text.charCodeAt(offset + i), true);
          await storage.write(address + 8 + offset * 2, scratch.subarray(0, count * 2)); check();
        }
        await index!.set(key, BigInt(address)); check();
      });
    },
    async *cells(sheet: number): AsyncGenerator<Cell> {
      check(); const entries = index!.entries(base(sheet), base(sheet + 1));
      try {
        while (true) {
          const cell = await serial(async () => { const next = await entries.next(); check(); return next.done ? undefined : read(next.value[1]); });
          if (!cell) break;
          yield cell;
        }
        check();
      } finally { await entries.return(undefined); }
    }
  };
}
