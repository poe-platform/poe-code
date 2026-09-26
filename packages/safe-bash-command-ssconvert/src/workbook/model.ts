import { SsconvertError, type RuntimeLimits } from "../contracts.js";
import type {
  Cell,
  CellUpdate,
  NamedExpression,
  Range,
  Sheet,
  SheetSize,
  UnsupportedRecord,
  Workbook
} from "../workbook.js";
import { foldSheetName } from "./case-fold.js";
import { decodeByteString, byteStringValue } from "../encoding/byte-value.js";

export const DEFAULT_SHEET_SIZE: SheetSize = Object.freeze({ rows: 65536, columns: 256 });
export const MAX_SHEET_SIZE: SheetSize = Object.freeze({ rows: 16777216, columns: 16384 });
function invalid(message: string): never {
  throw new SsconvertError("invalid-request", message);
}
function ownField(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    invalid("Invalid workbook record");
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor && !Object.hasOwn(descriptor, "value")) invalid("Unsupported workbook accessor");
  return descriptor?.value;
}
function boundedArray(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value)) invalid("Invalid workbook array");
  if (value.length > maximum)
    throw new SsconvertError("resource-limit", "ssconvert workbook storage limit exceeded");
  return value;
}
function requiredString(value: unknown, message: string, empty = true) {
  if (typeof value !== "string" || (!empty && !value)) invalid(message);
}
function optionalType(value: unknown, type: string, message: string) {
  if (value !== undefined && typeof value !== type) invalid(message);
}
function checkRecord(
  value: unknown,
  arrays: readonly string[] = [],
  records: readonly string[] = []
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    invalid("Invalid workbook record");
  for (const key of arrays)
    if (Object.hasOwn(value, key) && !Array.isArray((value as Record<string, unknown>)[key]))
      invalid("Invalid workbook array");
  for (const key of records)
    if (Object.hasOwn(value, key)) checkRecord((value as Record<string, unknown>)[key]);
}
function checkImportedRecords(records: readonly UnsupportedRecord[] | undefined) {
  for (const record of records ?? []) {
    checkRecord(record);
    requiredString(record.source, "Invalid imported record source");
    requiredString(record.kind, "Invalid imported record kind");
    if (!["retained", "dropped"].includes(record.disposition))
      invalid("Invalid imported record disposition");
  }
}
function index(value: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= maximum)
    invalid("Invalid cell address");
}
export function validSheetSize(size: SheetSize): boolean {
  return [
    [size.rows, MAX_SHEET_SIZE.rows],
    [size.columns, MAX_SHEET_SIZE.columns]
  ].every(
    ([value, maximum]) =>
      Number.isSafeInteger(value) &&
      value! >= 128 &&
      value! <= maximum! &&
      (value! & (value! - 1)) === 0
  );
}
export function parseA1(
  address: string,
  size: SheetSize = MAX_SHEET_SIZE
): { row: number; column: number } {
  let offset = address.startsWith("$") ? 1 : 0,
    column = 0,
    letters = 0;
  while (offset < address.length) {
    const code = address.charCodeAt(offset);
    const digit = code >= 97 && code <= 122 ? code - 96 : code >= 65 && code <= 90 ? code - 64 : 0;
    if (!digit) break;
    column = column * 26 + digit;
    if (column > size.columns) invalid("Invalid A1 address");
    letters++;
    offset++;
  }
  if (address[offset] === "$") offset++;
  if (!letters || offset === address.length || address[offset] === "0")
    invalid("Invalid A1 address");
  let row = 0;
  for (; offset < address.length; offset++) {
    const code = address.charCodeAt(offset) - 48;
    if (code < 0 || code > 9) invalid("Invalid A1 address");
    row = row * 10 + code;
    if (row > size.rows) invalid("Invalid A1 address");
  }
  index(row - 1, size.rows);
  index(column - 1, size.columns);
  return { row: row - 1, column: column - 1 };
}
export function formatA1(row: number, column: number, size: SheetSize = MAX_SHEET_SIZE): string {
  index(row, size.rows);
  index(column, size.columns);
  let letters = "";
  for (let value = column + 1; value > 0; value = Math.floor((value - 1) / 26))
    letters = String.fromCharCode(65 + ((value - 1) % 26)) + letters;
  return letters + String(row + 1);
}
export function getCell(sheet: Sheet, row: number, column: number): Cell | undefined {
  index(row, (sheet.size ?? DEFAULT_SHEET_SIZE).rows);
  index(column, (sheet.size ?? DEFAULT_SHEET_SIZE).columns);
  return sheet.cells.find((cell) => cell.row === row && cell.column === column);
}
export function resolveName(
  book: Workbook,
  name: string,
  sheet?: string
): NamedExpression | undefined {
  return (
    book.names?.find((entry) => entry.name === name && entry.sheet === sheet) ??
    book.names?.find((entry) => entry.name === name && entry.sheet === undefined)
  );
}
function checkRange(range: Range, size: SheetSize) {
  checkRecord(range);
  index(range.startRow, size.rows);
  index(range.endRow, size.rows);
  index(range.startColumn, size.columns);
  index(range.endColumn, size.columns);
  if (range.endRow < range.startRow || range.endColumn < range.startColumn)
    invalid("Reversed cell range");
}
function ownershipBudgets(limits: RuntimeLimits) {
  const admitted: Record<string, number | undefined> = Object.create(null);
  for (const key of [
    "inputBytes",
    "outputBytes",
    "cells",
    "sheets",
    "operations",
    "workbookNodes",
    "workbookTextBytes",
    "workbookWork"
  ]) {
    const value = ownField(limits, key);
    if (
      value === undefined &&
      (key === "workbookNodes" || key === "workbookTextBytes" || key === "workbookWork")
    )
      continue;
    if (typeof value !== "number" || (value !== Infinity && !Number.isSafeInteger(value)) || value < 0)
      invalid("Invalid workbook limits");
    admitted[key] = value;
  }
  const nodeLimit =
    admitted.workbookNodes ??
    admitted.inputBytes! + admitted.cells! * 32 + admitted.operations! * 32 + admitted.sheets! * 32;
  const textLimit =
    admitted.workbookTextBytes ??
    admitted.inputBytes! + admitted.cells! * 256 + admitted.operations! * 256 + admitted.sheets! * 256;
  if ((nodeLimit !== Infinity && !Number.isSafeInteger(nodeLimit)) || (textLimit !== Infinity && !Number.isSafeInteger(textLimit)))
    invalid("Invalid workbook limits");
  return {
    nodeLimit,
    textLimit,
    workLimit: admitted.workbookWork ?? nodeLimit,
    cells: admitted.cells!,
    sheets: admitted.sheets!,
    operations: admitted.operations!
  };
}
/** Only JSON-like owned data is admitted; no prototypes, accessors or host capabilities. */
export function snapshotRecords<T>(records: T, limits: RuntimeLimits): T {
  let nodes = 0,
    textBytes = 0;
  const { nodeLimit, textLimit } = ownershipBudgets(limits);
  const ancestors = new Set<object>();
  function copy(value: unknown, depth = 0): unknown {
    if (depth > 128)
      throw new SsconvertError("resource-limit", "ssconvert workbook depth limit exceeded");
    if (++nodes > nodeLimit)
      throw new SsconvertError("resource-limit", "ssconvert workbook nodes limit exceeded");
    if (typeof value === "string") {
      for (const character of value) {
        const point = character.codePointAt(0)!;
        textBytes += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
        if (textBytes > textLimit)
          throw new SsconvertError("resource-limit", "ssconvert workbook text limit exceeded");
      }
      return value;
    }
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) invalid("Nonfinite workbook number");
      return value;
    }
    if (typeof value !== "object" || value === undefined) invalid("Unsupported workbook data");
    if (ancestors.has(value)) invalid("Cyclic workbook data");
    if (
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      invalid("Unsupported workbook prototype");
    if (Object.getOwnPropertySymbols(value).length) invalid("Unsupported workbook symbol");
    ancestors.add(value);
    const result: Record<string, unknown> | unknown[] = Array.isArray(value)
      ? []
      : (Object.create(null) as Record<string, unknown>);
    if (Array.isArray(value) && value.length > nodeLimit - nodes)
      throw new SsconvertError("resource-limit", "ssconvert workbook nodes limit exceeded");
    const keys = Object.getOwnPropertyNames(value);
    if (keys.length - (Array.isArray(value) ? 1 : 0) > nodeLimit - nodes)
      throw new SsconvertError("resource-limit", "ssconvert workbook nodes limit exceeded");
    let arrayOffset = 0;
    for (const key of keys) {
      if (Array.isArray(value) && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) continue;
      if (Array.isArray(value) && key !== String(arrayOffset++)) invalid("Invalid workbook array");
      if (!Object.hasOwn(descriptor, "value")) invalid("Unsupported workbook accessor");
      if (Array.isArray(value) && descriptor.value === undefined) invalid("Invalid workbook array");
      copy(key, depth + 1);
      if (descriptor.value !== undefined)
        Object.defineProperty(result, key, {
          value: copy(descriptor.value, depth + 1),
          enumerable: true
        });
    }
    if (Array.isArray(value) && arrayOffset !== value.length) invalid("Invalid workbook array");
    ancestors.delete(value);
    return Object.freeze(result);
  }
  return copy(records) as T;
}
export function snapshotWorkbook(book: Workbook, limits: RuntimeLimits): Workbook {
  const budgets = ownershipBudgets(limits);
  // Count populated storage before copying, never enumerate the sheet grid.
  let sheetCount = 0,
    cellCount = 0;
  for (const field of ["sheets", "detachedSheets"]) {
    const value = ownField(book, field);
    if (field === "detachedSheets" && value === undefined) continue;
    const sheets = boundedArray(value, budgets.sheets - sheetCount);
    sheetCount += sheets.length;
    for (let offset = 0; offset < sheets.length; offset++) {
      const descriptor = Object.getOwnPropertyDescriptor(sheets, String(offset));
      if (!descriptor) invalid("Invalid workbook array");
      if (!Object.hasOwn(descriptor, "value")) invalid("Unsupported workbook accessor");
      const cells = boundedArray(ownField(descriptor.value, "cells"), budgets.cells - cellCount);
      cellCount += cells.length;
    }
  }
  const owned = snapshotRecords(book, limits);
  const { workLimit } = budgets;
  let relationshipWork = 0;
  const tick = () => {
    if (++relationshipWork > workLimit)
      throw new SsconvertError("resource-limit", "ssconvert workbook work limit exceeded");
  };
  checkRecord(
    owned,
    ["names", "dependencies", "unsupportedRecords"],
    ["iteration", "view", "properties"]
  );
  checkImportedRecords(owned.unsupportedRecords);
  const ids = new Map<string, Sheet>();
  const names = new Set<string>();
  const sheetNames = new Set<string>();
  for (const sheet of owned.sheets) {
    requiredString(sheet.name, "Invalid sheet name", false);
    const folded = foldSheetName(sheet.name);
    if (sheetNames.has(folded)) invalid("Conflicting sheet name");
    sheetNames.add(folded);
  }
  for (const sheet of [...owned.sheets, ...(owned.detachedSheets ?? [])]) {
    checkRecord(
      sheet,
      ["rows", "columns", "merges", "formulaGroups", "unsupportedRecords"],
      ["size", "view"]
    );
    checkImportedRecords(sheet.unsupportedRecords);
    requiredString(sheet.id, "Invalid sheet ID", false);
    if (ids.has(sheet.id)) invalid("Duplicate or empty sheet ID");
    ids.set(sheet.id, sheet);
    const size = sheet.size ?? DEFAULT_SHEET_SIZE;
    if (!validSheetSize(size)) invalid("Invalid sheet size");
    requiredString(sheet.name, "Empty sheet name", false);
    if (
      sheet.visibility !== undefined &&
      !["visible", "hidden", "very-hidden"].includes(sheet.visibility)
    )
      invalid("Invalid sheet visibility");
    const addresses = new Set<string>();
    for (const cell of sheet.cells) {
      checkRecord(cell, ["richText"], ["style"]);
      index(cell.row, size.rows);
      index(cell.column, size.columns);
      const key = `${cell.row}:${cell.column}`;
      if (addresses.has(key)) invalid("Duplicate cell address");
      addresses.add(key);
      for (const value of [cell.formula, cell.format, cell.displayedText, cell.formulaGroup])
        optionalType(value, "string", "Invalid cell text");
      optionalType(cell.formulaDirty, "boolean", "Invalid formula dirty state");
      optionalType(cell.arrayStringLiterals, "boolean", "Invalid formula array string semantics");
      for (const value of [
        cell.value,
        ...(cell.cachedResult === undefined ? [] : [cell.cachedResult])
      ]) {
        if (value === null || typeof value !== "object") invalid("Invalid cell value");
        if (!["blank", "string", "byte-string", "number", "boolean", "error"].includes(value.kind))
          invalid("Invalid cell value");
        if (
          value.kind !== "blank" &&
          typeof value.value !==
            { string: "string", "byte-string": "string", number: "number", boolean: "boolean", error: "string" }[value.kind]
        )
          invalid("Invalid cell value");
        if (value.kind === "byte-string" && byteStringValue(decodeByteString(value.value, tick), tick, budgets.textLimit).kind !== "byte-string")
          invalid("Valid UTF-8 must use an ordinary string value");
        if (value.kind === "number") optionalType(value.format, "string", "Invalid number value format");
      }
      const boundaries = new Set<number>();
      for (const run of cell.richText ?? []) {
        checkRecord(run);
        checkRecord(run.attributes);
        if (
          cell.value.kind !== "string" ||
          !Number.isSafeInteger(run.start) ||
          !Number.isSafeInteger(run.end) ||
          run.start < 0 ||
          run.end < run.start
        )
          invalid("Invalid rich text range");
        boundaries.add(run.start);
        boundaries.add(run.end);
      }
      if (cell.value.kind === "string" && boundaries.size) {
        let offset = 0;
        boundaries.delete(0);
        for (const character of cell.value.value) {
          const point = character.codePointAt(0)!;
          offset += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
          boundaries.delete(offset);
          if (!boundaries.size) break;
        }
        if (boundaries.size) invalid("Invalid rich text range");
      }
    }
    for (const [records, maximum] of [
      [sheet.rows ?? [], size.rows],
      [sheet.columns ?? [], size.columns]
    ] as const) {
      const indices = new Set<number>();
      for (const record of records) {
        checkRecord(record, [], ["style"]);
        index(record.index, maximum);
        if (indices.has(record.index)) invalid("Duplicate axis metadata");
        indices.add(record.index);
        optionalType(record.sizePoints, "number", "Invalid axis size");
        if (record.sizePoints !== undefined && record.sizePoints < 0) invalid("Invalid axis size");
        for (const value of [record.hidden, record.collapsed])
          optionalType(value, "boolean", "Invalid axis metadata");
        if (
          record.outlineLevel !== undefined &&
          (!Number.isSafeInteger(record.outlineLevel) || record.outlineLevel < 0)
        )
          invalid("Invalid axis outline");
      }
    }
    const merges = sheet.merges ?? [];
    for (let i = 0; i < merges.length; i++) {
      const range = merges[i]!;
      checkRange(range, size);
      for (let previous = 0; previous < i; previous++) {
        if (++relationshipWork > workLimit)
          throw new SsconvertError("resource-limit", "ssconvert workbook work limit exceeded");
        const other = merges[previous]!;
        if (
          range.startRow <= other.endRow &&
          other.startRow <= range.endRow &&
          range.startColumn <= other.endColumn &&
          other.startColumn <= range.endColumn
        )
          invalid("Overlapping merges");
      }
    }
    const groups = new Map<string, Range>();
    for (const group of sheet.formulaGroups ?? []) {
      checkRecord(group);
      requiredString(group.id, "Invalid formula group", false);
      requiredString(group.expression, "Invalid formula group expression");
      optionalType(group.arrayStringLiterals, "boolean", "Invalid formula array string semantics");
      if (!["shared", "array"].includes(group.kind)) invalid("Invalid formula group kind");
      if (!group.id || groups.has(group.id)) invalid("Duplicate formula group");
      checkRange(group.range, size);
      groups.set(group.id, group.range);
    }
    for (const cell of sheet.cells)
      if (cell.formulaGroup !== undefined) {
        const range = groups.get(cell.formulaGroup);
        if (
          !range ||
          cell.row < range.startRow ||
          cell.row > range.endRow ||
          cell.column < range.startColumn ||
          cell.column > range.endColumn
        )
          invalid("Invalid formula group member");
      }
  }
  for (const name of owned.names ?? []) {
    checkRecord(name, [], ["position"]);
    requiredString(name.name, "Invalid named expression", false);
    requiredString(name.expression, "Invalid named expression");
    optionalType(name.arrayStringLiterals, "boolean", "Invalid formula array string semantics");
    if (!name.name || (name.sheet !== undefined && !ids.has(name.sheet)))
      invalid("Invalid named expression scope");
    const key = JSON.stringify([name.sheet ?? null, name.name]);
    if (names.has(key)) invalid("Conflicting named expression");
    names.add(key);
    if (name.position !== undefined) {
      const sheet = ids.get(name.position.sheet);
      if (!sheet) invalid("Invalid named expression position");
      // Named-expression parse bases survive deletion of their former row/column.
      index(name.position.row, MAX_SHEET_SIZE.rows);
      index(name.position.column, MAX_SHEET_SIZE.columns);
    }
  }
  if (
    owned.activeSheet !== undefined &&
    !owned.sheets.some((sheet) => sheet.id === owned.activeSheet)
  )
    invalid("Invalid active sheet");
  if (owned.dateSystem !== undefined && !["1900", "1904"].includes(owned.dateSystem))
    invalid("Invalid date system");
  if (
    owned.calculationMode !== undefined &&
    !["automatic", "manual"].includes(owned.calculationMode)
  )
    invalid("Invalid calculation mode");
  if (
    owned.iteration &&
    (typeof owned.iteration.enabled !== "boolean" ||
      typeof owned.iteration.tolerance !== "number" ||
      !Number.isSafeInteger(owned.iteration.maximum) ||
      owned.iteration.maximum < 0 ||
      owned.iteration.tolerance < 0)
  )
    invalid("Invalid iteration settings");
  for (const dependency of owned.dependencies ?? []) {
    checkRecord(dependency, [], ["dependent", "precedent"]);
    if (dependency.dynamic !== undefined && typeof dependency.dynamic !== "boolean") invalid("Invalid dynamic dependency");
    for (const range of [dependency.dependent, dependency.precedent]) {
      checkRecord(range);
      const sheet = ids.get(range.sheet);
      if (!sheet) invalid("Invalid dependency sheet");
      checkRange(range, sheet.size ?? DEFAULT_SHEET_SIZE);
    }
  }
  // Gnumeric value_new_float canonicalizes stored zero. Rebuild only affected
  // frozen records; generic metadata and the caller's records stay untouched.
  function normalizeSheets(sheets: readonly Sheet[]): readonly Sheet[] {
    let changed = false;
    const normalized = sheets.map(sheet => {
      let changedCells = false;
      const cells = sheet.cells.map(cell => {
        const value = cell.value.kind === "number" && Object.is(cell.value.value, -0);
        const cached = cell.cachedResult?.kind === "number" && Object.is(cell.cachedResult.value, -0);
        if (!value && !cached) return cell;
        changedCells = true;
        return Object.freeze({ ...cell,
          ...(value ? { value: Object.freeze({ kind: "number" as const, value: 0 }) } : {}),
          ...(cached ? { cachedResult: Object.freeze({ kind: "number" as const, value: 0 }) } : {})
        });
      });
      if (!changedCells) return sheet;
      changed = true;
      return Object.freeze({ ...sheet, cells: Object.freeze(cells) });
    });
    return changed ? Object.freeze(normalized) : sheets;
  }
  const sheets = normalizeSheets(owned.sheets);
  const detachedSheets = owned.detachedSheets && normalizeSheets(owned.detachedSheets);
  if (sheets === owned.sheets && detachedSheets === owned.detachedSheets) return owned;
  return Object.freeze({ ...owned, sheets, ...(detachedSheets ? { detachedSheets } : {}) });
}
export function updateWorkbook(
  book: Workbook,
  updates: readonly CellUpdate[],
  limits: RuntimeLimits
): Workbook {
  const budgets = ownershipBudgets(limits);
  if (!Array.isArray(updates)) invalid("Invalid workbook array");
  if (updates.length > budgets.operations)
    throw new SsconvertError("resource-limit", "ssconvert operations limit exceeded");
  book = snapshotWorkbook(book, limits);
  updates = snapshotRecords(updates, limits);
  const sheets = book.sheets.map((sheet) => ({ ...sheet, cells: [...sheet.cells] }));
  const indexed = new Map(
    sheets.map((sheet) => [
      sheet.id,
      {
        sheet,
        addresses: new Map(
          sheet.cells.map((cell, offset) => [`${cell.row}:${cell.column}`, offset])
        )
      }
    ])
  );
  let total =
    sheets.reduce((count, sheet) => count + sheet.cells.length, 0) +
    (book.detachedSheets ?? []).reduce((count, sheet) => count + sheet.cells.length, 0);
  for (const update of updates) {
    checkRecord(update);
    const { sheet: id, ...cell } = update;
    const entry = indexed.get(id);
    if (!entry) invalid(`Unknown sheet: ${id}`);
    const key = `${cell.row}:${cell.column}`,
      offset = entry.addresses.get(key);
    if (offset === undefined) {
      if (++total > budgets.cells)
        throw new SsconvertError("resource-limit", "ssconvert cells limit exceeded");
      entry.addresses.set(key, entry.sheet.cells.length);
      entry.sheet.cells.push(cell);
    } else entry.sheet.cells[offset] = cell;
  }
  return snapshotWorkbook({ ...book, sheets }, limits);
}
