import type { CellValue } from "./workbook.js";
import type { CapabilityContext } from "./contracts.js";
export interface FormatOptions {
  readonly dateSystem?: "1900" | "1904";
  readonly unicodeMinus?: boolean;
}
export type TextFormatMode = "automatic" | "raw" | "preserve";
export interface FormattingCapability {
  format(value: CellValue, pattern: string, context: CapabilityContext, options?: FormatOptions): Promise<string>;
}
export { createFormattingCapability, renderCellText } from "./formatting/cell-text.js";
