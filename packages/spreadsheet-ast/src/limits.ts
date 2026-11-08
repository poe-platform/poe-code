/** Ownership budgets for a workbook, independent of its file representation. */
export interface WorkbookLimits {
  readonly inputBytes: number;
  readonly outputBytes: number;
  readonly cells: number;
  readonly sheets: number;
  readonly operations: number;
  readonly workbookNodes?: number;
  readonly workbookTextBytes?: number;
  readonly workbookWork?: number;
  readonly workbookDepth?: number;
}
