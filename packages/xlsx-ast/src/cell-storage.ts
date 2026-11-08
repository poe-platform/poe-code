import { IntegerTable } from '@poe-code/safe-fs/storage';
import type { Cell, CellValue } from '@poe-code/spreadsheet-ast';
import type { CapabilityContext } from '@poe-code/spreadsheet-engine/contracts';
import { createXlsxRecords } from './stored-records.js';

type Record = [Cell, string | null, string | null];
const special = (value: CellValue | undefined): string | null => value?.kind === 'number' && (!Number.isFinite(value.value) || Object.is(value.value, -0)) ? Object.is(value.value, -0) ? '-0' : String(value.value) : null;

/** Cells retain insertion ordinals for duplicate/array updates, plus a separate
 * coordinate index for row-major source replay. Both caches span all sheets. */
export function createXlsxCellStorage(context: CapabilityContext) {
  let ordinals: IntegerTable | undefined, coordinates: IntegerTable | undefined;
  const { storage, check, serial, append, read } = createXlsxRecords(context, () => { ordinals = undefined; coordinates = undefined; });
  ordinals = new IntegerTable(storage, 128); coordinates = new IntegerTable(storage, 128);
  const base = (sheet: number) => BigInt(sheet) << 34n;
  async function decode(pointer: bigint): Promise<Cell> {
    const { value: [cell, value, cache] } = await read<Record>(Number(pointer));
    return { ...cell, ...(value === null ? {} : { value: { kind: 'number' as const, value: Number(value) } }),
      ...(cache === null ? {} : { cachedResult: { kind: 'number' as const, value: Number(cache) } }) };
  }
  async function* values(sheet: number, sorted = false): AsyncGenerator<Cell> {
    check(); const entries = (sorted ? coordinates! : ordinals!).entries(base(sheet), base(sheet + 1));
    try {
      while (true) {
        const cell = await serial(async () => {
          const next = await entries.next(); check();
          return next.done ? undefined : decode(next.value[1]);
        });
        if (cell === undefined) return; yield cell;
      }
    } finally { await entries.return(undefined); }
  }
  return {
    values,
    sheet(sheet: number) {
      check(); let size = 0;
      return {
        get size() { return size; },
        get(ordinal: number): Promise<Cell | undefined> { return serial(async () => {
          const pointer = await ordinals!.get(base(sheet) | BigInt(ordinal)); check();
          return pointer === undefined ? undefined : decode(pointer);
        }); },
        set(ordinal: number, cell: Cell) { return serial(async () => {
          const pointer = BigInt(await append([cell, special(cell.value), special(cell.cachedResult)]));
          await ordinals!.set(base(sheet) | BigInt(ordinal), pointer); check();
          await coordinates!.set(base(sheet) | BigInt(cell.row * 16384 + cell.column), pointer); check();
          size = Math.max(size, ordinal + 1);
        }); },
        values: values.bind(undefined, sheet)
      };
    }
  };
}
