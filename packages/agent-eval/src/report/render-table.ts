import { getTheme, renderTable, withOutputFormat } from "@poe-code/design-system";
import type { AggregatedCell, EvalRunResult } from "../types.js";
import { matrixRows, runRows, tableOptions } from "./format.js";

export function renderMatrixTable(cells: readonly AggregatedCell[]): string {
  return withOutputFormat("terminal", () =>
    renderTable(tableOptions(matrixRows(cells), getTheme()))
  );
}

export function renderRunsTable(runs: readonly EvalRunResult[]): string {
  return withOutputFormat("terminal", () =>
    renderTable(tableOptions(runRows(runs), getTheme()))
  );
}
