import type { Cell } from "../workbook.js";

/** Value metadata is a fallback for General, independent of explicit cell styles. */
export function cellValueFormat(cell: Partial<Pick<Cell, "value" | "cachedResult" | "style" | "richText">>): string | undefined {
  const value = cell.cachedResult ?? cell.value;
  if (value?.kind === "number" && value.format !== undefined) return value.format;
  const format = cell.style?.gnumericValueFormat;
  // GOffice dispatches parsed @[...] markup separately from number formats.
  if (typeof format !== "string" || (cell.richText && format.startsWith("@["))) return undefined;
  return format;
}
