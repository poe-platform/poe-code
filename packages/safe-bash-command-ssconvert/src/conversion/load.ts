import type { CapabilityContext, EngineConfig } from "../contracts.js";
import { snapshotWorkbook, type Workbook } from "../workbook.js";
import { recalculateWithDiagnostics } from "../formulas/diagnostics.js";

/** workbook_view_new_from_input settles dirty/volatile formulas before conversion options. */
export async function prepareWorkbookLoad(book: Workbook, config: EngineConfig, context: CapabilityContext): Promise<Workbook> {
  context.signal.throwIfAborted();
  const options = { force: false, ignoreCalculationMode: true };
  const calculated = config.formulas ? await config.formulas.recalculate(book, context, options)
    : await recalculateWithDiagnostics(book, context, options);
  context.signal.throwIfAborted();
  return snapshotWorkbook(calculated, context.limits);
}
