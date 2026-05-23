import { getTheme, renderTable, withOutputFormat } from "@poe-code/design-system";
import type { AggregatedCell, EvalRunResult, ResultComparison } from "../types.js";
import { comparisonText, matrixRows, runRows, terminalTableOptions } from "./format.js";

export function renderMatrixTable(cells: readonly AggregatedCell[]): string {
  return withOutputFormat("terminal", () =>
    renderTable(terminalTableOptions(matrixRows(cells), getTheme()))
  );
}

export function renderRunsTable(runs: readonly EvalRunResult[]): string {
  return withOutputFormat("terminal", () =>
    renderTable(terminalTableOptions(runRows(runs), getTheme()))
  );
}

export function renderComparisonTable(comparisons: readonly ResultComparison[]): string {
  return comparisonText(comparisons);
}
