import type { CellValue } from "@poe-code/spreadsheet-ast";
import type { CapabilityContext } from "./contracts.js";
export interface FormatOptions {
  readonly dateSystem?: "1900" | "1904";
  readonly unicodeMinus?: boolean;
  /** Available display width and font measurement for General numeric layout. */
  readonly generalLayout?: { readonly width: number; readonly measure: (text: string) => number };
}
export type TextFormatMode = "automatic" | "raw" | "preserve";
export interface FormattingCapability {
  format(value: CellValue, pattern: string, context: CapabilityContext, options?: FormatOptions): Promise<string>;
}
export { createFormattingCapability, renderCellText } from "./formatting/cell-text.js";
