import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { Codec } from "../codecs.js";
import type { CellRange, Sheet, Workbook } from "../workbook.js";
import { writeClipboardGnumeric, clipboardStyleRecords } from "../codecs/gnumeric.js";
import { serializeClipboardObject, clipboardObjectRecords } from "./clipboard-objects.js";
import { clipboardMerges } from "./clipboard-merges.js";

const textTargets = new Set(["UTF8_STRING", "text/plain;charset=utf-8", "STRING", "COMPOUND_TEXT"]);
const emptyTableTargets = new Set([
  'application/x-openoffice;windows_formatname="Star Embed Source (XML)"', "Star Embed Source (XML)",
  'application/x-openoffice-embed-source-xml;windows_formatname="Star Embed Source (XML)"'
]);
const unknownInfoTargets = new Set(["text/uri-list", "x-special/gnome-copied-files", "application/x-kde-cutselection", "SAVE_TARGETS"]);
const tableTargets: Readonly<Record<string, string>> = {
  "text/html": "Gnumeric_html:xhtml_range", "HTML Format": "Gnumeric_html:xhtml_range",
  Biff8: "Gnumeric_Excel:excel_biff8", Biff5: "Gnumeric_Excel:excel_biff8", Biff: "Gnumeric_Excel:excel_biff8",
  _CITRIX_Biff8: "Gnumeric_Excel:excel_biff8",
  'application/x-openoffice-biff-8;windows_formatname="Biff8"': "Gnumeric_Excel:excel_biff8"
};

/** Serializes the testing selection; never acquires a desktop clipboard. */
export async function serializeClipboard(book: Workbook, target: string, range: CellRange,
  context: CapabilityContext, selectSaver: (id: string) => Codec | undefined): Promise<Uint8Array> {
  context.signal.throwIfAborted();
  const sheet = book.sheets.find(s => s.id === range.sheet);
  if (!sheet || ![range.startRow, range.endRow, range.startColumn, range.endColumn].every(value => Number.isSafeInteger(value) && value >= 0) ||
    range.startRow > range.endRow || range.startColumn > range.endColumn)
    throw new SsconvertError("invalid-request", "Invalid range specified.");
  if (target === "application/x-gnumeric") return writeClipboardGnumeric(book, sheet, range, context);
  // GtkSelectionData's target remains unset in gui_clipboard_test. Consequently
  // gtk_selection_data_set_text leaves the initialized empty payload untouched.
  if (textTargets.has(target) || emptyTableTargets.has(target)) return new Uint8Array();
  if (unknownInfoTargets.has(target)) {
    await context.diagnostic?.({ code: "clipboard-info", severity: "warning", message: "Unknown info type" });
    return new Uint8Array();
  }
  const saver = Object.hasOwn(tableTargets, target) ? tableTargets[target] : undefined;
  if (saver) {
    const codec = selectSaver(saver);
    if (!codec?.write) {
      await context.diagnostic?.({ code: "clipboard-saver", severity: "warning", message: `Failed to get saver for ${saver} for clipboard use.` });
      return new Uint8Array();
    }
    const records = [...clipboardStyleRecords(sheet, range, context), ...clipboardObjectRecords(sheet, range, context)];
    const cropped: Sheet = { id: "clipboard", name: "Sheet1", unsupportedRecords: records,
      cells: sheet.cells.filter(cell => cell.row >= range.startRow && cell.row <= range.endRow && cell.column >= range.startColumn && cell.column <= range.endColumn)
        .map(cell => { context.signal.throwIfAborted(); return { row: cell.row - range.startRow, column: cell.column - range.startColumn,
          value: cell.cachedResult ?? cell.value, ...(cell.style ? { style: cell.style } : {}),
          ...(cell.format !== undefined ? { format: cell.format } : {}), ...(cell.richText ? { richText: cell.richText } : {}) }; }),
      // Paste rejects a merge with a negative translated corner, but permits
      // merges extending beyond the selected rectangle in the fresh sheet.
      ...(sheet.merges ? { merges: clipboardMerges(sheet, range, context).filter(merge => merge.startRow >= 0 && merge.startColumn >= 0) } : {}) };
    return codec.write({ activeSheet: cropped.id, sheets: [cropped] }, [], context);
  }
  const objectBytes = await serializeClipboardObject(sheet, target, range, context);
  if (objectBytes !== undefined) return objectBytes;
  throw new SsconvertError("unsupported-feature", "Failed to get clipboard data.");
}
