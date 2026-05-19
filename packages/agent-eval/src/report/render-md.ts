import { getTheme, renderTable, withOutputFormat } from "@poe-code/design-system";
import type { AggregatedCell, EvalRunResult } from "../types.js";
import { matrixRows, runRows, tableOptions } from "./format.js";

export function renderMatrixMarkdown(cells: readonly AggregatedCell[]): string {
  return withOutputFormat("markdown", () =>
    renderTable(tableOptions(matrixRows(cells), getTheme()))
  );
}

export function renderRunsMarkdown(runs: readonly EvalRunResult[]): string {
  return withOutputFormat("markdown", () =>
    renderTable(tableOptions(runRows(runs), getTheme()))
  );
}
