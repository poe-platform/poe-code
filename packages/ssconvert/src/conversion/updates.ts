import { SsconvertError, type CapabilityContext, type ConversionRequest, type EngineConfig } from "../contracts.js";
import { snapshotWorkbook, updateWorkbook, type Workbook } from "../workbook.js";
import { parseRangePrefix } from "../workbook/expressions.js";
import { setCellText } from "../workbook/updates/index.js";
import { dirtyWorkbook } from "../workbook/updates/recalculation.js";
import { recalculateWithDiagnostics } from "../formulas/diagnostics.js";

/** apply_updates runs only for ordinary/clipboard loads, before exporter options. */
export async function applyConversionUpdates(book: Workbook, request: ConversionRequest, config: EngineConfig,
  context: CapabilityContext, checkpoint: () => void, sourceUri?: string): Promise<Workbook> {
  book = updateWorkbook(book, (request.updates ?? []).map(update => update.formula === undefined ? update : { ...update, formulaDirty: true }), context.limits);
  book = dirtyWorkbook(book, (request.updates ?? []).map(update => ({ sheet: update.sheet,
    startRow: update.row, endRow: update.row, startColumn: update.column, endColumn: update.column })), context);
  for (const expression of request.updateExpressions ?? []) {
    checkpoint();
    let equal: number;
    let range;
    try {
      const parsed = parseRangePrefix(expression, book, sourceUri, true);
      equal = parsed.end;
      if (expression[equal] !== "=") throw new SsconvertError("invalid-request", "Invalid range specified.");
      // apply_updates normalizes the coordinates, then writes through the active view.
      range = { sheet: book.activeSheet ?? book.sheets[0]!.id,
        startRow: parsed.range.startRow, endRow: parsed.range.endRow,
        startColumn: parsed.range.startColumn, endColumn: parsed.range.endColumn };
    } catch (error) {
      if (!(error instanceof SsconvertError) || error.code !== "invalid-request") throw error;
      throw new SsconvertError("invalid-request", `Failed to set cell ${expression}`);
    }
    book = config.cellText ? await config.cellText.setText(book, range, expression.slice(equal + 1), context)
      : setCellText(book, range, expression.slice(equal + 1), context);
    checkpoint();
    book = snapshotWorkbook(book, context.limits);
  }
  if (request.updateExpressions !== undefined && book.calculationMode !== "manual") {
    book = config.formulas ? await config.formulas.recalculate(book, context, { force: false }) : await recalculateWithDiagnostics(book, context);
    checkpoint();
    book = snapshotWorkbook(book, context.limits);
  }
  return book;
}
