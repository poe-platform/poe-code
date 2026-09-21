import { SsconvertError, type CapabilityContext } from "../../contracts.js";
import { DEFAULT_SHEET_SIZE, snapshotWorkbook, type Cell, type CellRange, type Workbook } from "../../workbook.js";
import { parseFormula, relocateFormula } from "./formula.js";
import { inferText } from "./inference.js";
import { dirtyWorkbook } from "./recalculation.js";

export function setCellText(book: Workbook, range: CellRange, text: string, context: CapabilityContext): Workbook {
  context.signal.throwIfAborted();
  const sheet = book.sheets.find(sheet => sheet.id === range.sheet)!;
  const size = sheet.size ?? DEFAULT_SHEET_SIZE;
  range = { ...range, endRow: Math.min(range.endRow, size.rows - 1), endColumn: Math.min(range.endColumn, size.columns - 1) };
  const area = Math.max(0, range.endRow - range.startRow + 1) * Math.max(0, range.endColumn - range.startColumn + 1);
  // Admit before allocating or iterating over a whole row/column range.
  if (!Number.isSafeInteger(area) || area > context.limits.cells)
    throw new SsconvertError("resource-limit", "ssconvert cells limit exceeded");
  let projected = area;
  for (const existing of book.sheets) projected += existing.cells.length;
  for (const existing of book.detachedSheets ?? []) projected += existing.cells.length;
  for (const cell of sheet.cells)
    if (cell.row >= range.startRow && cell.row <= range.endRow && cell.column >= range.startColumn && cell.column <= range.endColumn) projected--;
  if (!Number.isSafeInteger(projected) || projected > context.limits.cells)
    throw new SsconvertError("resource-limit", "ssconvert workbook storage limit exceeded");
  const terminator = text.indexOf("\0");
  if (terminator >= 0) text = text.slice(0, terminator);
  const textFormat = sheet.cells.find(cell => cell.row === range.startRow && cell.column === range.startColumn)?.format === "@";
  const inferred = inferText(text, book, textFormat ? "@" : undefined);
  const singleIntroducer = text[0] === "@" || (text[0] === "+" || text[0] === "-") && text[1] !== text[0];
  const formulaText = textFormat ? undefined : text.startsWith("=") ? text : inferred.value.kind === "string" && singleIntroducer
    ? "=" + (text[0] === "-" ? text : text.slice(1)) : undefined;
  const names = [...book.names ?? []];
  const knownNames = new Set(names.map(name => `${name.sheet ?? ""}\0${name.name.toUpperCase()}`));
  const node = formulaText && formulaText.length > 1 ? parseFormula(formulaText, book, sheet.id, (name, scope) => {
    context.signal.throwIfAborted();
    const target = scope ?? sheet.id;
    if (!knownNames.has(`\0${name.toUpperCase()}`) && !knownNames.has(`${target}\0${name.toUpperCase()}`)) {
      knownNames.add(`${scope ?? ""}\0${name.toUpperCase()}`); names.push({ name, expression: "#NAME?", ...(scope === undefined ? {} : { sheet: scope }) });
    }
  }, { sheet: sheet.id, row: range.startRow, column: range.startColumn }) : undefined;
  const cells = [...sheet.cells], positions = new Map(cells.map((cell, index) => [`${cell.row}:${cell.column}`, index]));
  for (let row = range.startRow; row <= range.endRow; row++) {
    context.signal.throwIfAborted();
    for (let column = range.startColumn; column <= range.endColumn; column++) {
      const key = `${row}:${column}`, index = positions.get(key);
      const previous = index === undefined ? undefined : cells[index];
      const cell: Cell = { row, column,
        ...(previous?.style === undefined ? {} : { style: previous.style }),
        ...(previous?.format === undefined ? {} : { format: previous.format }),
        ...(node ? { value: { kind: "blank" }, formula: relocateFormula(formulaText!, node, row - range.startRow, column - range.startColumn), formulaDirty: true }
          : inferred!) };
      if (index === undefined) { positions.set(key, cells.length); cells.push(cell); }
      else cells[index] = cell;
    }
  }
  // A range entry clears non-corner cells of every overlapping merge.
  for (const merge of sheet.merges ?? []) {
    if (merge.startRow > range.endRow || merge.endRow < range.startRow || merge.startColumn > range.endColumn || merge.endColumn < range.startColumn) continue;
    for (let index = 0; index < cells.length; index++) {
      const cell = cells[index]!;
      if (cell.row >= merge.startRow && cell.row <= merge.endRow && cell.column >= merge.startColumn && cell.column <= merge.endColumn &&
        (cell.row !== merge.startRow || cell.column !== merge.startColumn)) {
        const { formula: ignoredFormula, cachedResult: ignoredCachedResult, formulaDirty: ignoredFormulaDirty,
          formulaGroup: ignoredFormulaGroup, displayedText: ignoredDisplayedText, richText: ignoredRichText, ...retained } = cell;
        cells[index] = { ...retained, value: { kind: "blank" } };
      }
    }
  }
  const updated = snapshotWorkbook({ ...book, ...(names.length ? { names } : {}), sheets: book.sheets.map(s => s.id === sheet.id ? { ...s, cells } : s) }, context.limits);
  return dirtyWorkbook(updated, [range], context);
}
