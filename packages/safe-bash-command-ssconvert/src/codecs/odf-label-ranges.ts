import type { XmlElement } from "@poe-code/safe-fs/xml";
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { DEFAULT_SHEET_SIZE, MAX_SHEET_SIZE, type LabelRange, type Range, type Sheet } from "../workbook.js";
import { parseExpression } from "../formulas/parser.js";
import { odfGrammar } from "../formulas/conventions.js";

const tableNamespaces = ["urn:oasis:names:tc:opendocument:xmlns:table:1.0", "http://openoffice.org/2000/table"];

/** Native table:label-ranges declarations, resolved after all sheets are read.
 * See Calc xmllabri.cxx and ScXMLExport::WriteLabelRanges. */
export function readOdfLabelRanges(parent: XmlElement, sheets: readonly Sheet[], context: CapabilityContext,
  charge: (amount?: number) => void): readonly Sheet[] {
  const byName = new Map(sheets.map(sheet => { charge(); return [sheet.name, sheet] as const; }));
  const ranges = new Map<string, LabelRange[]>();
  function invalid(): never { throw new SsconvertError("io", "E Invalid OpenDocument: invalid label range"); }
  function attribute(node: XmlElement, name: string) {
    return node.attributes.find(a => a.localName === name && tableNamespaces.includes(a.namespace))?.value;
  }
  function address(source: string | undefined): { sheet: Sheet; range: Range } {
    if (!source) return invalid();
    charge(source.length);
    const parsed = parseExpression("=[" + source + "]", { grammar: odfGrammar,
      position: { sheet: sheets[0]?.id ?? "", row: 0, column: 0 }, signal: context.signal,
      maximumLength: context.limits.workbookTextBytes ?? context.limits.inputBytes,
      maximumNodes: context.limits.workbookNodes ?? Infinity });
    if (!parsed.ok || parsed.document.root.kind !== "reference") return invalid();
    const first = parsed.document.root.first, last = parsed.document.root.last ?? first;
    const sheet = first.sheet === undefined ? undefined : byName.get(first.sheet);
    if (!sheet || first.workbook !== undefined || last.workbook !== undefined || last.sheet && last.sheet !== first.sheet ||
      !first.row || !first.column || !last.row || !last.column) return invalid();
    const range = { startRow: first.row.value, endRow: last.row.value, startColumn: first.column.value, endColumn: last.column.value };
    if (Object.values(range).some(value => !Number.isSafeInteger(value) || value < 0) ||
      range.startRow > range.endRow || range.startColumn > range.endColumn ||
      range.endRow >= MAX_SHEET_SIZE.rows || range.endColumn >= MAX_SHEET_SIZE.columns) return invalid();
    return { sheet, range };
  }
  for (const container of parent.children) {
    charge(); if (container.localName !== "label-ranges" || !tableNamespaces.includes(container.namespace)) continue;
    for (const node of container.children) {
      charge(); if (node.localName !== "label-range" || !tableNamespaces.includes(node.namespace)) continue;
      const axis = attribute(node, "orientation");
      if (axis !== "row" && axis !== "column") invalid();
      const labels = address(attribute(node, "label-cell-range-address"));
      const data = address(attribute(node, "data-cell-range-address"));
      if (labels.sheet !== data.sheet) throw new SsconvertError("unsupported-feature",
        "Unsupported ssconvert feature: OpenDocument label and data ranges on different sheets");
      let pairs = ranges.get(labels.sheet.id);
      if (!pairs) { pairs = []; ranges.set(labels.sheet.id, pairs); }
      pairs.push({ axis, labels: labels.range, data: data.range });
    }
  }
  return sheets.map(sheet => {
    charge(); const pairs = ranges.get(sheet.id); if (!pairs) return sheet;
    let { rows, columns } = sheet.size ?? DEFAULT_SHEET_SIZE;
    for (const pair of pairs) {
      charge();
      while (rows <= Math.max(pair.labels.endRow, pair.data.endRow)) rows *= 2;
      while (columns <= Math.max(pair.labels.endColumn, pair.data.endColumn)) columns *= 2;
    }
    return { ...sheet, size: { rows, columns }, labelRanges: pairs };
  });
}
