import { IntegerTable, type PagedStorage } from "@poe-code/safe-fs/storage";
import type { Cell } from "@poe-code/spreadsheet-ast";
import { SsconvertError, type CellIndex, type Cleanup } from "../contracts.js";

/** Cache only 128 pointers; all other coordinates live in the shared page store.
 * Close drops the pointer cache between sheets, even before the session ends. */
export async function createCellIndex(supplied: readonly Cell[], storage: PagedStorage,
  check: () => void, own: (cleanup: Cleanup) => void): Promise<CellIndex> {
  check();
  let cells: readonly Cell[] | undefined = supplied;
  let table: IntegerTable | undefined = new IntegerTable(storage, 128);
  let pending: Promise<unknown> = Promise.resolve();
  let closed = false, closing: Promise<void> | undefined;
  const close = () => {
    closed = true;
    return closing ??= pending.then(() => { table = undefined; cells = undefined; });
  };
  own(close);
  const admit = () => {
    check();
    if (closed) throw new SsconvertError("invalid-request", "ssconvert cell index is closed");
  };
  const key = (row: number, column: number) => {
    if (!Number.isSafeInteger(row) || row < 0 || row > 0xffffffff || !Number.isSafeInteger(column) || column < 0 || column > 0xffffffff)
      throw new SsconvertError("invalid-request", "Invalid ssconvert cell index coordinate");
    // Keep tall, narrow sheets dense in the radix tree.
    return BigInt(column) << 32n | BigInt(row);
  };
  const build = (async () => {
    for (let index = 0; index < cells!.length; index++) {
      admit();
      const cell = cells![index]!;
      await table!.set(key(cell.row, cell.column), BigInt(index));
    }
    admit();
  })();
  pending = build.then(() => undefined, () => undefined);
  try { await build; }
  catch (error) { await close(); throw error; }
  return Object.freeze({ close, get(row: number, column: number): Promise<Cell | undefined> {
    const reading = pending.then(async () => {
      admit();
      const index = await table!.get(key(row, column));
      admit();
      return index === undefined ? undefined : cells![Number(index)];
    });
    pending = reading.then(() => undefined, () => undefined);
    return reading;
  } });
}
