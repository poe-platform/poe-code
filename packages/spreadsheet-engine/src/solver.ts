import type { Workbook } from "@poe-code/spreadsheet-ast";
import type { GoalSeekRequest } from "./formulas.js";
import type { CapabilityContext } from "./contracts.js";
/** Missing GenericB inputs are #REF!; supplied malformed ranges are null. */
export type ToolTestRange = import("@poe-code/spreadsheet-ast").CellRange | { readonly kind: "error"; readonly value: "#REF!" } | null;
export interface ToolTestOptions {
  readonly sheet: string;
  readonly data?: import("@poe-code/spreadsheet-ast").CellRange;
  readonly x?: ToolTestRange;
  readonly y?: ToolTestRange;
  readonly putFormulas: boolean;
  readonly outputSheetName: string;
  readonly properties: Readonly<Record<string, string | number | boolean | null>>;
}
export interface AnalysisRequest {
  /** Interpreted hidden CLI protocol; absent for direct legacy analysis requests. */
  readonly toolOptions?: ToolTestOptions;
  readonly tool: string;
  readonly properties: readonly { readonly name: string; readonly value: string }[];
}
export interface SolverCapability {
  solve(book: Workbook, context: CapabilityContext): Promise<Workbook>;
  goalSeek(
    book: Workbook,
    requests: readonly GoalSeekRequest[],
    context: CapabilityContext
  ): Promise<Workbook>;
  /** Native --goal-seek range setup; dialog/evaluation semantics belong to this capability. */
  goalSeekRange?(book: Workbook, range: import("@poe-code/spreadsheet-ast").CellRange, context: CapabilityContext): Promise<Workbook>;
}
export interface AnalysisCapability {
  analyze(book: Workbook, request: AnalysisRequest, context: CapabilityContext): Promise<Workbook>;
}
