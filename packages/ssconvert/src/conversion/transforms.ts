import { SsconvertError, type CapabilityContext, type ConversionRequest, type EngineConfig } from "../contracts.js";
import { snapshotWorkbook, formatA1, validSheetSize, type Workbook, type CellRange } from "../workbook.js";
import { parseRangeExpression } from "../workbook/expressions.js";
import { parseResize } from "./resize.js";
import { recalculateWithDiagnostics } from "../formulas/diagnostics.js";
import { resizeWorkbookReferences } from "../workbook/resize.js";
import { runSolverValidation } from "../solver/run.js";
import { runAnalysisTool } from "../analysis/run.js";
import { prepareToolTest } from "../analysis/protocol.js";
import { goalSeekRange, type GoalSeekState } from "../solver/goal-seek.js";

function unavailable(feature: string): never {
  throw new SsconvertError("unsupported-feature", `Unsupported ssconvert feature: ${feature}`);
}

/** ssconvert.c: goal seeks, solve, tool-test, resize, explicit/automatic recalc, range. */
export async function runConversionTransforms(book: Workbook, request: ConversionRequest,
  config: EngineConfig, context: CapabilityContext, checkpoint: () => void, sourceUri?: string): Promise<{ book: Workbook; range?: CellRange }> {
  const own = (value: Workbook) => {
    checkpoint();
    return snapshotWorkbook(value, context.limits);
  };
  const goalSeekState: GoalSeekState = {};
  for (const expression of request.goalSeekExpressions ?? []) {
    const range = parseRangeExpression(expression, book, false, sourceUri);
    book = own(await (config.solver?.goalSeekRange
      ? config.solver.goalSeekRange(book, range, context)
      : goalSeekRange(book, range, context, goalSeekState)));
  }
  if (request.goalSeek?.length) {
    if (!config.solver) unavailable("goal seek");
    book = own(await config.solver.goalSeek(book, request.goalSeek, context));
  }
  checkpoint();
  if (request.solve) {
    book = own(await (config.solver ? config.solver.solve(book, context) : runSolverValidation(book, context)));
  }
  checkpoint();
  if (request.analysis) {
    if (!config.analysis) unavailable("analysis");
    book = own(await config.analysis.analyze(book, request.analysis, context));
  }
  if (request.toolTest?.[0] !== undefined) {
    const analysis = await prepareToolTest(book, request.toolTest, context, sourceUri);
    try { book = own(await (config.analysis ? config.analysis.analyze(book, analysis, context) : runAnalysisTool(book, analysis, context))); }
    catch (error) {
      context.signal.throwIfAborted();
      if (!(error instanceof SsconvertError) || error.code !== "invalid-request") throw error;
      if (error.message !== "Analysis tool failed") await context.diagnostic?.({ code: "analysis", severity: "error", message: error.message });
      throw new SsconvertError("invalid-request", "Analysis tool failed");
    }
  }
  checkpoint();
  const size = request.resizeExpression === undefined ? request.resize : parseResize(request.resizeExpression);
  if (size) {
    if (request.verbose) await context.diagnostic?.({ code: "resize", severity: "warning",
      message: `Resizing to ${size.rows}x${size.columns}` });
    for (const sheet of [...book.sheets].reverse()) {
      checkpoint();
      if (!validSheetSize(size)) {
        await context.diagnostic?.({ code: "resize-invalid", severity: "warning", message: "gnm_sheet_resize: assertion 'gnm_sheet_valid_size (cols, rows)' failed" });
        continue;
      }
      let resized: Workbook | undefined;
      try {
        resized = config.resize ? await config.resize.resizeSheet(book, sheet.id, size, context) : resizeWorkbookReferences(book, sheet.id, size, context);
      } catch (error) {
        if (!(error instanceof SsconvertError) || error.code !== "unsupported-feature") throw error;
        if (error.message === "Unsupported ssconvert feature: resize splits merge") resized = undefined;
        else if (error.message === "Unsupported ssconvert feature: resize formula group") resized = book;
        else throw error;
      }
      if (resized === undefined) await context.diagnostic?.({ code: "resize-failed", severity: "warning",
        message: `Resizing of sheet ${sheet.name} failed` });
      else book = own(resized);
    }
  }
  if (request.recalc) {
    book = own(config.formulas ? await config.formulas.recalculate(book, context, { force: true }) : await recalculateWithDiagnostics(book, context, true));
  }
  // An injected evaluator receives the unconditional gnm_app_recalc stage too.
  if (book.calculationMode !== "manual") {
    const options = { force: false, queueVolatile: false };
    book = own(config.formulas ? await config.formulas.recalculate(book, context, options) : await recalculateWithDiagnostics(book, context, options));
  }
  checkpoint();
  let range = request.exportRange;
  if (request.exportRangeExpression !== undefined)
    range = parseRangeExpression(request.exportRangeExpression, book, true, sourceUri);
  if (range) {
    const sheet = book.sheets.find((sheet) => sheet.id === range!.sheet);
    if (!sheet) throw new SsconvertError("invalid-request", "Invalid range specified.");
    if (range.endSheet !== undefined && !book.sheets.some(sheet => sheet.id === range!.endSheet))
      throw new SsconvertError("invalid-request", "Invalid range specified.");
    if (request.exportRangeExpression === undefined) {
      formatA1(range.startRow, range.startColumn, sheet.size);
      formatA1(range.endRow, range.endColumn, sheet.size);
    }
    if (range.endRow < range.startRow || range.endColumn < range.startColumn)
      throw new SsconvertError("invalid-request", "Invalid range specified.");
  }
  return { book, ...(range === undefined ? {} : { range: Object.freeze({ ...range }) }) };
}
