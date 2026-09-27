import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import type { FormulaDocument, ParsePosition } from "../formulas/ast.js";
import { parseExpression } from "../formulas/parser.js";
import { visitFormula } from "../formulas/rewriting.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";

/** Calc reads formula label results through IsValue/GetString (MaybeInterpret).
 * Capture references before refreshing text, and settle candidate labels together
 * so shared dependencies and output caches belong to one calculation run. */
export function prepareOdfFormulaLabels(book: Workbook, context: CapabilityContext, tick: (work?: number) => void) {
  const documents = new Map<string, FormulaDocument>(), origins: ParsePosition[] = [];
  const hasCandidates = book.sheets.some(sheet => sheet.cells.some(cell => {
    tick();
    return (cell.formula || cell.formulaGroup) && (book.automaticLabelLookup || sheet.labelRanges?.some(pair => {
      tick(); return cell.row >= pair.labels.startRow && cell.row <= pair.labels.endRow &&
        cell.column >= pair.labels.startColumn && cell.column <= pair.labels.endColumn;
    }));
  }));
  if (!hasCandidates) return { book, documents };
  book = { ...book, sheets: book.sheets.map(sheet => ({ ...sheet, cells: sheet.cells.map(cell => {
    tick(); return (cell.formula || cell.formulaGroup) && cell.cachedResult ? { ...cell, value: cell.cachedResult } : cell;
  }) })) };
  function capture(source: string, position: ParsePosition) {
    tick(source.length);
    const parsed = parseExpression(source, { position, workbook: book, signal: context.signal, onWork: tick,
      maximumLength: context.limits.workbookTextBytes ?? context.limits.outputBytes,
      maximumNodes: context.limits.workbookNodes ?? Infinity });
    // The writer diagnoses invalid expressions only if they are actually emitted
    // (covered merge cells and non-anchor array members are not emitted).
    if (!parsed.ok) return;
    let labels = false;
    visitFormula(parsed.document.root, node => {
      tick();
      if (node.kind === "reference" && node.label) labels = true;
    });
    if (labels) {
      documents.set(JSON.stringify([position.sheet, position.row, position.column, source]), parsed.document);
      origins.push(position);
    }
  }
  for (const sheet of book.sheets) for (const cell of sheet.cells) {
    tick();
    if (cell.formula) capture(cell.formula, { sheet: sheet.id, row: cell.row, column: cell.column });
  }
  for (const name of book.names ?? []) {
    tick();
    const sheet = book.sheets.find(sheet => sheet.id === (name.position?.sheet ?? name.sheet) || sheet.name === (name.position?.sheet ?? name.sheet)) ?? book.sheets[0];
    if (sheet) capture(name.expression, { sheet: sheet.id, row: name.position?.row ?? 0, column: name.position?.column ?? 0 });
  }
  if (!origins.length) return { book, documents };
  const targets: ParsePosition[] = [];
  book = { ...book, sheets: book.sheets.map(sheet => ({ ...sheet, cells: sheet.cells.map(cell => {
    tick();
    if (!cell.formula && !cell.formulaGroup) return cell;
    const declared = sheet.labelRanges?.some(pair => {
      tick(); return cell.row >= pair.labels.startRow && cell.row <= pair.labels.endRow &&
        cell.column >= pair.labels.startColumn && cell.column <= pair.labels.endColumn;
    });
    const candidate = origins.some(origin => {
      tick(); return (origin.sheet !== sheet.id || origin.row !== cell.row || origin.column !== cell.column) &&
        (declared || book.automaticLabelLookup && origin.sheet === sheet.id);
    });
    if (!candidate) return cell;
    const matrix = cell.formulaGroup && sheet.formulaGroups?.some(group => {
      tick(); return group.id === cell.formulaGroup && group.kind === "array";
    });
    if (book.calculationMode !== "manual" || matrix) targets.push({ sheet: sheet.id, row: cell.row, column: cell.column });
    return cell;
  }) })) };
  if (targets.length) book = recalculateWorkbook(book, context, { force: false, queueVolatile: false }, undefined, {
    target: targets, tick, onCycle() {
      if (!book.iteration?.enabled) throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: circular formula label in OpenDocument output");
    }
  });
  return { book, documents };
}
