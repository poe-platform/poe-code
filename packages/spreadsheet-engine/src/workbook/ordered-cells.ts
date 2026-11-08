import type { Cell } from "@poe-code/spreadsheet-ast";
import { SsconvertError, type CapabilityContext, type WorkingStorage } from "../contracts.js";

const runCells = 1024;

/** Stable row-major traversal over borrowed immutable cells. Sorting retains only
 * 1024 indexes per sort run; fixed merge buffers read indexes from caller storage.
 * The array fallback is for SDK hosts that have not supplied working storage.
 */
export async function* orderedCells(cells: readonly Cell[], context: CapabilityContext): AsyncGenerator<Cell> {
  const compare = (left: Cell, right: Cell) => left.row - right.row || left.column - right.column;
  context.signal.throwIfAborted();
  let ordered = true;
  for (let index = 1; index < cells.length; index++) {
    context.signal.throwIfAborted();
    if (compare(cells[index - 1]!, cells[index]!) > 0) { ordered = false; break; }
  }
  if (ordered || cells.length <= runCells || !context.createWorkingStorage) {
    const source = ordered ? cells : [...cells].sort((left, right) => { context.signal.throwIfAborted(); return compare(left, right); });
    for (const cell of source) { context.signal.throwIfAborted(); yield cell; }
    return;
  }
  let storage: WorkingStorage | undefined, closed = false, closing: Promise<void> | undefined;
  const close = () => {
    closed = true;
    return closing ??= Promise.resolve().then(() => storage?.close());
  };
  const check = () => {
    context.signal.throwIfAborted();
    if (closed) throw new SsconvertError("invalid-request", "ssconvert cell ordering is closed");
  };
  context.own(close);
  let failure: { error: unknown } | undefined;
  try {
    check();
    const store = storage = context.createWorkingStorage();
    const blockBytes = runCells * 8;
    let input = store.allocate(cells.length * 8), output = store.allocate(cells.length * 8);
    const buffer = new Uint8Array(blockBytes), view = new DataView(buffer.buffer);
    const write = async (position: number, length: number) => {
      check(); await store.write(position, buffer.subarray(0, length)); check();
    };
    for (let start = 0; start < cells.length; start += runCells) {
      check();
      const indexes = Array.from({ length: Math.min(runCells, cells.length - start) }, (_, offset) => start + offset);
      indexes.sort((left, right) => compare(cells[left]!, cells[right]!) || left - right);
      for (let index = 0; index < indexes.length; index++) view.setFloat64(index * 8, indexes[index]!, true);
      await write(input + start * 8, indexes.length * 8);
    }
    const readRun = (base: number, start: number, end: number) => {
      let next = start, offset = 0, bytes = new DataView(new ArrayBuffer(0));
      return async (): Promise<number | undefined> => {
        check();
        if (next >= end) return undefined;
        if (offset === bytes.byteLength) {
          const length = Math.min(runCells, end - next) * 8;
          const supplied = await store.read(base + next * 8, length);
          check();
          if (!(supplied instanceof Uint8Array) || supplied.length !== length)
            throw new SsconvertError("io", "Invalid ssconvert cell ordering range");
          // Two merge readers must not retain the backend's borrowed reply.
          bytes = new DataView(new Uint8Array(supplied).buffer); offset = 0;
        }
        const index = bytes.getFloat64(offset, true); offset += 8; next++;
        if (!Number.isSafeInteger(index) || index < 0 || index >= cells.length)
          throw new SsconvertError("io", "Invalid ssconvert cell ordering index");
        return index;
      };
    };
    for (let width = runCells; width < cells.length; width *= 2) {
      for (let start = 0; start < cells.length; start += width * 2) {
        const middle = Math.min(start + width, cells.length), end = Math.min(start + width * 2, cells.length);
        const left = readRun(input, start, middle), right = readRun(input, middle, end);
        let a = await left(), b = await right(), count = 0, written = start;
        while (a !== undefined || b !== undefined) {
          check();
          let index: number;
          if (b === undefined || a !== undefined && (compare(cells[a]!, cells[b]!) || a - b) <= 0) {
            index = a!; a = await left();
          } else { index = b; b = await right(); }
          view.setFloat64(count++ * 8, index, true);
          if (count === runCells) { await write(output + written * 8, count * 8); written += count; count = 0; }
        }
        if (count) await write(output + written * 8, count * 8);
      }
      [input, output] = [output, input];
    }
    const next = readRun(input, 0, cells.length);
    for (let index = await next(); index !== undefined; index = await next()) yield cells[index]!;
  } catch (error) { failure = { error }; throw error; }
  finally {
    await close().catch(error => {
      if (failure) throw new AggregateError([failure.error, error], "ssconvert cell ordering and cleanup failed");
      throw error;
    });
  }
}
