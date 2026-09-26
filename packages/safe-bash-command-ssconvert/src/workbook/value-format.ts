import type { Cell } from "../workbook.js";

/** Value metadata is a fallback for General, independent of explicit cell styles. */
export function cellValueFormat(cell: Partial<Pick<Cell, "value" | "cachedResult" | "style">>): string | undefined {
  const value = cell.cachedResult ?? cell.value;
  return value?.kind === "number" && value.format !== undefined ? value.format :
    typeof cell.style?.gnumericValueFormat === "string" ? cell.style.gnumericValueFormat : undefined;
}
