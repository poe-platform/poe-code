import type { Workbook, CellRange } from "./workbook.js";
import type { CapabilityContext } from "./contracts.js";
import type { CellValue } from "./workbook.js";
import type { ParsePosition, ReferenceEndpoint } from "./formulas/ast.js";
export type ExternalFormulaRequest =
  | { readonly kind: "reference"; readonly first: ReferenceEndpoint; readonly last?: ReferenceEndpoint; readonly position: ParsePosition }
  | { readonly kind: "name"; readonly workbook: string; readonly name: string; readonly sheet?: string; readonly position: ParsePosition };
export type FormulaResult = CellValue | { readonly kind: "array"; readonly rows: readonly (readonly CellValue[])[] };
export interface ExternalReferencesCapability {
  /** Synchronous trusted host binding. Absence/unresolved returns #REF!; no implicit I/O.
   * Result data is copied/admitted to the workbook ownership and calculation budgets. */
  resolve(request: ExternalFormulaRequest, signal: AbortSignal): FormulaResult | undefined;
}
export interface FormulaRecalculationOptions {
  readonly force: boolean;
  /** Initial workbook loading evaluates dirty formulas even in manual mode. */
  readonly ignoreCalculationMode?: boolean;
  /** False settles existing dirty formulas without scheduling clean volatile formulas. */
  readonly queueVolatile?: boolean;
}
export interface FormulaCapability {
  /** Ordinary stages calculate dirty formulas; force marks/evaluates the whole workbook,
   * including manual mode, at ssconvert's post-transform --recalc stage. */
  recalculate(book: Workbook, context: CapabilityContext, options?: FormulaRecalculationOptions): Promise<Workbook>;
}
export interface GoalSeekRequest {
  readonly target: CellRange;
  readonly variable: CellRange;
  readonly value: number;
  readonly minimum?: number;
  readonly maximum?: number;
}
