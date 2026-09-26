import type { XmlElement } from "@poe-code/safe-fs/xml";
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { formatA1, type ImportedValue, type Range, type UnsupportedRecord } from "../workbook.js";
import { parseExpression } from "../formulas/parser.js";
import { excelGrammar } from "../formulas/conventions.js";

const xl = "urn:schemas-microsoft-com:office:excel";
const gnumeric = "http://www.gnumeric.org/v10.dtd";
function node(name: string, attributes: Record<string, string | number> = {}, children: readonly ImportedValue[] = []): ImportedValue {
  return { name, namespace: gnumeric, attributes: Object.entries(attributes).map(([name, value]) => ({ name, namespace: "", value: String(value) })), text: "", children };
}
/** Source-supported selections and unconditioned filters, using the existing
 * workbook representation consumed by all supported exporters. */
export function readSpreadsheetMLMetadata(worksheet: XmlElement, sheet: string, context: CapabilityContext, chargeWorkbookWork?: () => void): readonly UnsupportedRecord[] {
  const result: UnsupportedRecord[] = [];
  let work = 0;
  function charge() {
    context.signal.throwIfAborted();
    chargeWorkbookWork?.();
    if (++work > (context.limits.workbookWork ?? Infinity)) throw new SsconvertError("resource-limit", "ssconvert SpreadsheetML metadata work limit exceeded");
  }
  function range(source: string): Range | undefined {
    charge(); const parsed = parseExpression("=" + source, { grammar: { ...excelGrammar, address: "r1c1" }, position: { sheet, row: 0, column: 0 }, signal: context.signal,
      maximumLength: context.limits.workbookTextBytes ?? context.limits.inputBytes, maximumNodes: context.limits.workbookNodes ?? Infinity });
    if (!parsed.ok || parsed.document.root.kind !== "reference") return undefined;
    const first = parsed.document.root.first, last = parsed.document.root.last ?? first;
    const value = { startRow: first.row?.value ?? 0, startColumn: first.column?.value ?? 0,
      endRow: last.row?.value ?? 1048575, endColumn: last.column?.value ?? 16383 };
    if (value.startRow >= 1048576 || value.endRow >= 1048576 || value.startColumn >= 16384 || value.endColumn >= 16384) throw new SsconvertError("resource-limit", "ssconvert SpreadsheetML metadata coordinates limit exceeded");
    if (value.startRow < 0 || value.startColumn < 0 || value.endRow < 0 || value.endColumn < 0) return undefined;
    return { startRow: Math.min(value.startRow, value.endRow), startColumn: Math.min(value.startColumn, value.endColumn),
      endRow: Math.max(value.startRow, value.endRow), endColumn: Math.max(value.startColumn, value.endColumn) };
  }
  const options = worksheet.children.find(n => n.namespace === xl && n.localName === "WorksheetOptions");
  const panes = options?.children.find(n => n.namespace === xl && n.localName === "Panes");
  let selection: ImportedValue | undefined;
  for (const pane of panes?.children ?? []) {
    charge(); if (pane.namespace !== xl || pane.localName !== "Pane") continue;
    let row = 0, column = 0;
    for (const child of pane.children) {
      charge(); if (child.namespace !== xl) continue;
      if (["ActiveRow", "ActiveCol"].includes(child.localName)) {
        const value = Number(child.text);
        if (value >= (child.localName === "ActiveRow" ? 1048576 : 16384)) throw new SsconvertError("resource-limit", "ssconvert SpreadsheetML selection cursor coordinates limit exceeded");
        if (Number.isSafeInteger(value) && value >= 0) { if (child.localName === "ActiveRow") row = value; else column = value; }
      }
      if (child.localName === "RangeSelection") {
        const ranges: ImportedValue[] = [];
        for (const part of child.text.split(",")) {
          const r = range(part); if (!r) break;
          ranges.push(node("Selection", { startCol: r.startColumn, startRow: r.startRow, endCol: r.endColumn, endRow: r.endRow }));
        }
        selection = node("Selections", { CursorCol: column, CursorRow: row }, ranges);
      }
    }
  }
  if (selection) result.push({ source: "Gnumeric_XmlIO:sax", kind: "Selections", disposition: "retained", data: selection });
  const filters: ImportedValue[] = [];
  for (const filter of worksheet.children) {
    charge(); if (filter.namespace !== xl || filter.localName !== "AutoFilter") continue;
    const source = filter.attributes.find(a => a.namespace === xl && a.localName === "Range")?.value;
    if (source === undefined) continue;
    const r = range(source); if (!r) continue;
    filters.push(node("Filter", { Area: formatA1(r.startRow, r.startColumn) + ":" + formatA1(r.endRow, r.endColumn) }));
  }
  if (filters.length) result.push({ source: "Gnumeric_XmlIO:sax", kind: "Filters", disposition: "retained", data: node("Filters", {}, filters) });
  return result;
}
