import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { CellValue, RuntimeValue } from "./runtime-values.js";

/** Exact cell_contents getter after descriptor/argument validation. */
export function readRuntimeCell(cell: CellValue, meter: ExecutionMeter): RuntimeValue {
  meter.checkpoint();
  const content = cell.value.content;
  if (content === undefined) throw new PythonRuntimeError("ValueError", "Cell is empty");
  return content.value;
}

/** Preserve shared closure storage. Deleting an already empty cell succeeds;
 * deleting an unbound lexical variable is a distinct frame operation. */
export function mutateRuntimeCell(cell: CellValue, change: { readonly kind: "set"; readonly value: RuntimeValue } | { readonly kind: "delete" }, meter: ExecutionMeter): void {
  meter.checkpoint(1, change.kind === "set" ? 16 : 0);
  if (change.kind === "delete") cell.value.content = undefined;
  else cell.value.content = { value: change.value };
}
