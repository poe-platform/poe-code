import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { exportRangeForSheet } from "../workbook/expressions.js";
import type { Codec } from "./types.js";
import { exportOptionPairs } from "../cli/export-options.js";

/** Gate unqualified writers before opening a destination. An opaque byte value
 * must never be mistaken for its hex payload or silently exported as blank. */
export function admitByteStringExport(book: Workbook, codec: Codec, context: CapabilityContext,
  selection?: Parameters<NonNullable<Codec["write"]>>[3], options: readonly string[] = []): void {
  let work = 0;
  for (const sheet of book.sheets) {
    if (selection && !selection.sheets.includes(sheet.id)) continue;
    const range = selection?.range && exportRangeForSheet(selection.range, book, sheet.id);
    if (selection?.range && !range) continue;
    for (const cell of sheet.cells) {
      context.signal.throwIfAborted();
      if (++work > (context.limits.workbookWork ?? context.limits.inputBytes))
        throw new SsconvertError("resource-limit", "ssconvert byte-string export work limit exceeded");
      if (range && (cell.row < range.startRow || cell.row > range.endRow || cell.column < range.startColumn || cell.column > range.endColumn)) continue;
      if (cell.value.kind !== "byte-string" && cell.cachedResult?.kind !== "byte-string") continue;
      if (codec.byteStrings === "utf8-text") {
        let charset = "UTF-8", quote = '"', format = "automatic";
        for (const option of options) for (const [key, value] of exportOptionPairs(option)) {
          if (key === "charset") charset = value;
          if (key === "quote") quote = value;
          if (key === "format") format = value;
        }
        if (!["utf-8", "utf8"].includes(charset.toLowerCase()) || quote.length > 1 || quote.charCodeAt(0) >= 128)
          throw new SsconvertError("unsupported-feature", "Native byte-string export requires UTF-8 and an ASCII CSV quote");
        if (format !== "raw" && format !== "GNM_STF_FORMAT_RAW" && cell.format && !["General", "@"].includes(cell.format))
          throw new SsconvertError("unsupported-feature", "Native byte-string export with custom formatting is not qualified");
        continue;
      }
      if (codec.byteStrings === "formula-only" && cell.formula) continue;
      throw new SsconvertError("unsupported-feature", `Native byte-string export is not qualified for ${codec.id}`);
    }
  }
}
