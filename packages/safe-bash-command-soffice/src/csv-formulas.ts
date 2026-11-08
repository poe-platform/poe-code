import { defaultSsconvertLimits, SsconvertError, type Cell } from "@poe-code/spreadsheet-engine";
import { recalculateWorkbookSteps } from "@poe-code/spreadsheet-engine/formulas/evaluator";
import { xlsxDateSerial } from "./xlsx-dates.js";

export function csvFormulaCell(row: number, column: number, text: string, numeric: boolean): Cell {
  const number = xlsxDateSerial(text) ?? (numeric ? Number(text) : undefined);
  return { row, column, ...(text.startsWith("=") ? { formula: text, formulaDirty: true } : {}),
    value: text.startsWith("=") ? { kind: "blank" } : number !== undefined ? { kind: "number", value: number }
      : { kind: "string", value: text } };
}

/** Use the engine's dependency ordering and typed results, without any external I/O. */
export function* calculateCsvFormulas(cells: Cell[], signal: AbortSignal): Generator<void, Map<string, string>> {
  let calculated: readonly Cell[] = cells;
  try {
    const book = yield* recalculateWorkbookSteps({ sheets: [{ id: "s1", name: "Sheet1", cells }] }, {
      signal, limits: defaultSsconvertLimits, environment: { env: {}, locale: "C", timezone: "UTC" }, own() {}
    });
    calculated = book.sheets[0]!.cells;
  } catch (error) {
    // Preserve expressions the engine cannot evaluate so Excel can calculate them.
    if (!(error instanceof SsconvertError) || error.code !== "unsupported-feature") throw error;
  }
  const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const formulas = new Map<string, string>();
  for (const cell of calculated) {
    if (!cell.formula) continue;
    const value = cell.value;
    const type = value.kind === "string" ? "str" : value.kind === "boolean" ? "b" : value.kind === "error" ? "e" : "n";
    const cached = value.kind === "blank" ? "" : `<v>${escape(String(value.kind === "boolean" ? Number(value.value) : value.value))}</v>`;
    formulas.set(`${cell.row}:${cell.column}`, `t="${type}"><f>${escape(cell.formula.slice(1))}</f>${cached}</c>`);
  }
  return formulas;
}
