import { IntegerTable } from "@poe-code/safe-fs/storage";
import { snapshotWorkbook, type Cell, type AxisMetadata } from "@poe-code/spreadsheet-ast";
import { createRecordSnapshot, createCellValidator, validateAxis, type RecordSnapshot, DEFAULT_SHEET_SIZE } from "@poe-code/spreadsheet-ast/model";
import { SsconvertError, type RuntimeLimits, type CapabilityContext } from "../contracts.js";
import type { WorkbookSource } from "../codecs/types.js";

/** Admit replayable scalar cells with the same aggregate ownership budget as an
 * array workbook. Metadata owns the empty arrays; each index and cell is depth 4.
 * Iteration order replaces the full duplicate-address set for these sources.
 */
export async function ownWorkbookSource(source: WorkbookSource, limits: RuntimeLimits,
  check: () => void, createStorage?: CapabilityContext["createWorkingStorage"]): Promise<WorkbookSource> {
  check();
  let metadataWork = 0;
  const metadata = snapshotWorkbook(source.metadata, limits, amount => { metadataWork += amount; });
  const validation = createCellValidator(limits); validation.charge(metadataWork);
  const readCells = source.cells.bind(source);
  const readAxes = source.axes?.bind(source);
  if (metadata.detachedSheets?.length || metadata.sheets.some(sheet => sheet.cells.length))
    throw new SsconvertError("invalid-request", "Workbook source metadata must have empty cell arrays");
  if (readAxes && metadata.sheets.some(sheet => !sheet.rows || !sheet.columns || sheet.rows.length || sheet.columns.length))
    throw new SsconvertError("invalid-request", "Workbook source axes require empty metadata rows and columns");
  const metadataSnapshot = createRecordSnapshot(limits);
  metadataSnapshot(metadata);
  const copy = metadataSnapshot.fork();
  let count = 0;
  function validate(cell: Cell, sheet: (typeof metadata.sheets)[number], validation: ReturnType<typeof createCellValidator>, previous?: Cell) {
    check();
    if (cell.formula !== undefined || cell.formulaGroup !== undefined)
      throw new SsconvertError("invalid-request", "Workbook source requires evaluated scalar cells");
    if (previous && (previous.row > cell.row || previous.row === cell.row && previous.column >= cell.column))
      throw new SsconvertError("invalid-request", "Workbook source cells must have unique row-major addresses");
    validation.validate(cell, sheet.size ?? DEFAULT_SHEET_SIZE);
  }
  async function* axes(sheet: (typeof metadata.sheets)[number], kind: "rows" | "columns", copy: RecordSnapshot): AsyncGenerator<AxisMetadata> {
    const storage = createStorage?.();
    const seen = storage ? new IntegerTable(storage, 128) : new Set<bigint>();
    let ordinal = 0, failed = false, failure: unknown;
    async function close() {
      try { await storage?.close(); }
      catch (error) {
        if (failed) throw new AggregateError([failure, error], "Workbook axis validation and cleanup failed");
        throw error;
      }
    }
    try {
      for await (const supplied of readAxes!(sheet.id, kind)) {
        check(); copy(String(ordinal++), 4);
        const axis = copy(supplied, 4);
        validateAxis(axis, (sheet.size ?? DEFAULT_SHEET_SIZE)[kind]);
        const key = BigInt(axis.index);
        const duplicate = seen instanceof Set ? seen.has(key) : (await seen.get(key)) !== undefined;
        check();
        if (duplicate) throw new SsconvertError("invalid-request", "Duplicate axis metadata");
        if (seen instanceof Set) seen.add(key); else await seen.set(key, 1n);
        check(); yield axis;
      }
      check();
    } catch (error) { failed = true; failure = error; throw error; }
    finally { await close(); }
  }
  for (const sheet of metadata.sheets) {
    if (readAxes) for (const kind of ["rows", "columns"] as const)
      for await (const axis of axes(sheet, kind, copy)) { void axis; }
  }
  const cellsSnapshot = copy.fork();
  for (const sheet of metadata.sheets) {
    let previous: Cell | undefined, index = 0;
    for await (const supplied of readCells(sheet.id)) {
      check();
      if (++count > limits.cells) throw new SsconvertError("resource-limit", "ssconvert workbook storage limit exceeded");
      copy(String(index++), 4);
      const cell = copy(supplied, 4);
      validate(cell, sheet, validation, previous); previous = cell;
    }
  }
  check();
  return Object.freeze({ metadata,
    ...(readAxes ? { async *axes(id: string, kind: "rows" | "columns") {
      check();
      const sheet = metadata.sheets.find(sheet => sheet.id === id);
      if (!sheet || kind !== "rows" && kind !== "columns") throw new SsconvertError("invalid-request", "Unknown workbook source axis");
      yield* axes(sheet, kind, metadataSnapshot.fork());
    } } : {}),
    async *cells(id: string) {
      const sheet = metadata.sheets.find(sheet => sheet.id === id);
      if (!sheet) throw new SsconvertError("invalid-request", "Unknown workbook source sheet");
      const copy = cellsSnapshot.fork();
      const validation = createCellValidator(limits); validation.charge(metadataWork);
      let previous: Cell | undefined, index = 0;
      for await (const supplied of readCells(id)) {
        check();
        if (index >= limits.cells) throw new SsconvertError("resource-limit", "ssconvert workbook storage limit exceeded");
        copy(String(index++), 4);
        const cell = copy(supplied, 4);
        validate(cell, sheet, validation, previous); previous = cell;
        yield cell;
      }
      check();
    }
  });
}

/** Explicit compatibility for exporters that still consume resident axis arrays. */
export async function materializeSourceAxes(source: WorkbookSource, limits: RuntimeLimits, check: () => void): Promise<WorkbookSource> {
  if (!source.axes) return source;
  check();
  const copy = createRecordSnapshot(limits);
  copy(source.metadata);
  const sheets = [];
  for (const sheet of source.metadata.sheets) {
    const rows: AxisMetadata[] = [], columns: AxisMetadata[] = [];
    for (const [kind, records] of [["rows", rows], ["columns", columns]] as const) {
      for await (const axis of source.axes(sheet.id, kind)) {
        check(); copy(String(records.length), 4); records.push(copy(axis, 4));
      }
    }
    sheets.push(Object.freeze({ ...sheet, rows: Object.freeze(rows), columns: Object.freeze(columns) }));
  }
  check();
  return Object.freeze({ metadata: Object.freeze({ ...source.metadata, sheets: Object.freeze(sheets) }), cells: source.cells.bind(source) });
}
