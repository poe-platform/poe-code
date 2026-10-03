import { IntegerTable } from "@poe-code/safe-fs/storage";
import { SsconvertError, type CapabilityContext, type WorkingStorage } from "@poe-code/spreadsheet-engine/contracts";
import type { Cell } from "@poe-code/spreadsheet-ast";
import { createBiffSharedStrings } from "./biff-shared-strings.js";

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
