import { IntegerTable } from "@poe-code/safe-fs/storage";
import { SsconvertError, type CapabilityContext, type WorkingStorage } from "@poe-code/spreadsheet-engine/contracts";
import type { AxisMetadata, Cell } from "@poe-code/spreadsheet-ast";
import { createBiffSharedStrings } from "./biff-shared-strings.js";

export type BiffRow = AxisMetadata & { hardSize?: boolean };

export interface BiffScalarCell { cell: Cell; xf: number; revision: number; codepage: number; }

/** One coordinate index and text table across all sheets, independent of cell count. */
export function createBiffCellSource(context: CapabilityContext) {
  let storage: WorkingStorage | undefined = undefined, closed = false, closing: Promise<void> | undefined;
  const check = () => { context.signal.throwIfAborted(); if (closed) throw new SsconvertError("invalid-request", "BIFF cells are closed"); };
  context.own(() => { closed = true; return closing ??= storage?.close() ?? Promise.resolve(); }); check();
  if (!context.createWorkingStorage) throw new SsconvertError("capability-denied", "BIFF cells require caller working storage");
  storage = context.createWorkingStorage(); check();
  const index = new IntegerTable(storage, 128), values = createBiffSharedStrings(context);
  return {
    columns() {
      let head: number | undefined, tail: number | undefined;
      const links = 1n << 61n;
      return {
        async push(axis: AxisMetadata) {
          check(); const ordinal = await values.append({ text: JSON.stringify(axis) }); check();
          if (tail !== undefined) { await index.set(links | BigInt(tail), BigInt(ordinal)); check(); }
          else head = ordinal;
          tail = ordinal;
        },
        async *values(): AsyncGenerator<AxisMetadata> {
          check(); let ordinal = head;
          while (ordinal !== undefined) {
            const value = await values.get(ordinal); check();
            if (!value) throw new SsconvertError("io", "Missing staged BIFF column");
            yield JSON.parse(value.text) as AxisMetadata;
            check(); const next = await index.get(links | BigInt(ordinal)); check();
            ordinal = next === undefined ? undefined : Number(next);
          }
        }
      };
    },
    rows(sheet: number) {
      const base = (1n << 62n) | BigInt(sheet) << 24n, order = (1n << 63n) | BigInt(sheet) << 24n;
      let count = 0;
      return {
        async has(row: number) { check(); const found = await index.get(base | BigInt(row)); check(); return found !== undefined; },
        async get(row: number): Promise<BiffRow | undefined> {
          check(); const ordinal = await index.get(base | BigInt(row)); check();
          if (ordinal === undefined) return undefined;
          const value = await values.get(Number(ordinal)); check();
          if (!value) throw new SsconvertError("io", "Missing staged BIFF row");
          return JSON.parse(value.text) as BiffRow;
        },
        async set(row: number, value: BiffRow) {
          check(); const key = base | BigInt(row), previous = await index.get(key); check();
          const ordinal = await values.append({ text: JSON.stringify(value) }); check();
          await index.set(key, BigInt(ordinal)); check();
          if (previous === undefined) { await index.set(order | BigInt(count++), BigInt(row)); check(); }
        },
        async *values(): AsyncGenerator<BiffRow> {
          check();
          // A second namespace preserves Map insertion order even when ROW
          // records update coordinates encountered earlier in cell records.
          for await (const [, row] of index.entries(order, order + BigInt(count))) {
            const value = await this.get(Number(row));
            if (!value) throw new SsconvertError("io", "Missing staged BIFF row");
            yield value;
          }
          check();
        }
      };
    },
    async append(sheet: number, pending: BiffScalarCell) {
      check();
      const key = BigInt(sheet) << 24n | BigInt(pending.cell.row * 256 + pending.cell.column);
      if (await index.get(key) !== undefined) throw new SsconvertError("invalid-request", "Duplicate BIFF cell address");
      check();
      // BIFF scalar cells contain JSON values; preserve the sole finite-number
      // case JSON normalizes. Formula tokens never enter the scalar source.
      const negativeZero = pending.cell.value?.kind === "number" && Object.is(pending.cell.value.value, -0);
      const ordinal = await values.append({ text: JSON.stringify([pending, negativeZero]) }); check();
      await index.set(key, BigInt(ordinal)); check();
    },
    async *cells(sheet: number): AsyncGenerator<BiffScalarCell> {
      check();
      for await (const [, ordinal] of index.entries(BigInt(sheet) << 24n, BigInt(sheet + 1) << 24n)) {
        check(); const value = await values.get(Number(ordinal)); check();
        if (!value) throw new SsconvertError("io", "Missing staged BIFF cell");
        const [pending, negativeZero] = JSON.parse(value.text) as [BiffScalarCell, boolean];
        if (negativeZero) pending.cell = { ...pending.cell, value: { kind: "number", value: -0 } };
        yield pending;
      }
      check();
    }
  };
}
