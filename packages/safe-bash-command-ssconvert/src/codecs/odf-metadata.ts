import type { XmlElement } from "@poe-code/safe-fs/xml";
import { formatA1, type ImportedValue, type UnsupportedRecord } from "../workbook.js";
import { parseExpression } from "../formulas/parser.js";
import { odfGrammar } from "../formulas/conventions.js";
import { SsconvertError } from "../contracts.js";

const urn = "urn:oasis:names:tc:opendocument:xmlns:";
const ns = {
  table: [urn + "table:1.0", "http://openoffice.org/2000/table"],
  office: [urn + "office:1.0", "http://openoffice.org/2000/office"],
  text: [urn + "text:1.0", "http://openoffice.org/2000/text"],
  style: [urn + "style:1.0", "http://openoffice.org/2000/style"],
  fo: [urn + "xsl-fo-compatible:1.0", "http://www.w3.org/1999/XSL/Format"],
  dc: ["http://purl.org/dc/elements/1.1/"], xlink: ["http://www.w3.org/1999/xlink"],
  gnm: ["http://www.gnumeric.org/odf-extension/1.0"]
};
function attr(node: XmlElement | undefined, name: string, namespace: keyof typeof ns): string | undefined {
  return node?.attributes.find(a => a.localName === name && ns[namespace].includes(a.namespace))?.value;
}
function gnode(name: string, attributes: Readonly<Record<string, string | number>> = {}, children: readonly ImportedValue[] = [], text = ""): ImportedValue {
  return { name, namespace: "http://www.gnumeric.org/v10.dtd", attributes: Object.entries(attributes).map(([name, value]) => ({ name, namespace: "", value: String(value) })), children, text };
}
function object(value: ImportedValue | undefined): Readonly<Record<string, ImportedValue>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Readonly<Record<string, ImportedValue>> : undefined;
}
function attributes(value: ImportedValue | undefined): Record<string, string> {
  const source = object(value)?.attributes;
  return Object.fromEntries(Array.isArray(source) ? source.flatMap(a => {
    const v = object(a); return typeof v?.name === "string" && typeof v.value === "string" ? [[v.name, v.value]] : [];
  }) : []);
}
function color(value: string | undefined): string | undefined {
  if (!value?.startsWith("#") || value.length !== 7 || [...value.slice(1)].some(c => !"0123456789abcdefABCDEF".includes(c))) return undefined;
  return [1, 3, 5].map(i => (parseInt(value.slice(i, i + 2), 16) * 257).toString(16).toUpperCase()).join(":");
}
function distance(source: string | undefined): number | undefined {
  if (!source) return undefined;
  const units: Readonly<Record<string, number>> = { cm: 72 / 2.54, mm: 72 / 25.4, in: 72, pt: 1, pc: 12 };
  const unit = units[source.slice(-2)], value = Number(source.slice(0, -2));
  return unit && Number.isFinite(value) && value >= 0 ? value * unit : undefined;
}
function annotationText(node: XmlElement, charge: (n?: number) => void): string {
  if (!node.content.length) return node.text;
  let result = "";
  for (const item of node.content) {
    charge();
    if (item.kind === "text" || item.kind === "cdata") result += item.text;
    else if (item.kind === "element" && ns.text.includes(item.namespace)) {
      if (item.localName === "s") {
        const count = Number(attr(item, "c", "text") ?? "1");
        if (!Number.isSafeInteger(count) || count < 0) throw new SsconvertError("io", "E Invalid OpenDocument: invalid text space count");
        charge(count); result += " ".repeat(count);
      } else if (item.localName === "tab" || item.localName === "tab-stop") result += "\t";
      else if (item.localName === "line-break") result += "\n";
      else if (item.localName === "span" || item.localName === "a") result += annotationText(item, charge);
    }
  }
  return result;
}
/** Exportable style representation; source XML remains independently retained. */
export function odfCellStyle(node: XmlElement, parent: ImportedValue | undefined, charge: (n?: number) => void): ImportedValue {
  const values: Record<string, string | number> = attributes(parent);
  const parentChildren = object(parent)?.children;
  const inheritedFont = Array.isArray(parentChildren) ? parentChildren.find(c => object(c)?.name === "Font") : undefined;
  const font: Record<string, string | number> = attributes(inheritedFont);
  let family = object(inheritedFont)?.text ?? "Sans";
  const inheritedBorders = Array.isArray(parentChildren) ? object(parentChildren.find(c => object(c)?.name === "StyleBorder"))?.children : undefined;
  const borders = new Map<string, ImportedValue>();
  if (Array.isArray(inheritedBorders)) for (const border of inheritedBorders) {
    const name = object(border)?.name;
    if (typeof name === "string") borders.set(name, border);
  }
  for (const p of node.children) {
    charge(); if (!ns.style.includes(p.namespace) || !p.localName.endsWith("properties")) continue;
    const back = color(attr(p, "background-color", "fo")); if (back) { values.Back = back; values.Shade = 1; }
    const extensionBack = color(attr(p, "background-colour", "gnm")); if (extensionBack) values.Back = extensionBack;
    const extensionPattern = color(attr(p, "pattern-colour", "gnm")); if (extensionPattern) values.PatternColor = extensionPattern;
    const pattern = attr(p, "pattern", "gnm"); if (pattern !== undefined && Number.isInteger(Number(pattern)) && Number(pattern) > 0) values.Shade = Number(pattern);
    const wrap = attr(p, "wrap-option", "fo"); if (wrap !== undefined) values.WrapText = wrap === "wrap" ? 1 : 0;
    const protect = attr(p, "cell-protect", "style"); if (protect !== undefined) { values.Locked = protect.includes("protected") && protect !== "unprotected" ? 1 : 0; if (protect.includes("formula-hidden")) values.Hidden = 1; }
    const fore = color(attr(p, "color", "fo")); if (fore) values.Fore = fore;
    const h = attr(p, "text-align", "fo"), align: Readonly<Record<string, string>> = { start: "LEFT", end: "RIGHT", left: "LEFT", right: "RIGHT", center: "CENTER", justify: "JUSTIFY" };
    if (h && align[h]) values.HAlign = "GNM_HALIGN_" + align[h];
    const v = attr(p, "vertical-align", "style"), vertical: Readonly<Record<string, string>> = { top: "TOP", middle: "CENTER", bottom: "BOTTOM", justify: "JUSTIFY" };
    if (v && vertical[v]) values.VAlign = "GNM_VALIGN_" + vertical[v];
    const rotation = attr(p, "rotation-angle", "style"); if (rotation !== undefined && Number.isFinite(Number(rotation))) values.Rotation = Number(rotation);
    const shrink = attr(p, "shrink-to-fit", "style"); if (shrink !== undefined) values.ShrinkToFit = shrink === "true" ? 1 : 0;
    const size = distance(attr(p, "font-size", "fo")); if (size !== undefined) font.Unit = size;
    const weight = attr(p, "font-weight", "fo"); if (weight !== undefined) font.Bold = weight === "bold" || Number(weight) >= 600 ? 1 : 0;
    const italic = attr(p, "font-style", "fo"); if (italic !== undefined) font.Italic = italic === "italic" || italic === "oblique" ? 1 : 0;
    const underline = attr(p, "text-underline-style", "style"); if (underline !== undefined) font.Underline = underline === "none" ? 0 : attr(p, "text-underline-type", "style") === "double" ? 2 : 1;
    const strike = attr(p, "text-line-through-style", "style"); if (strike !== undefined) font.StrikeThrough = strike === "none" ? 0 : 1;
    family = attr(p, "font-family", "fo") ?? attr(p, "font-name", "style") ?? family;
    for (const [side, target] of [["top", "Top"], ["bottom", "Bottom"], ["left", "Left"], ["right", "Right"]] as const) {
      const border = attr(p, "border-" + side, "fo") ?? attr(p, "border", "fo"); if (!border) continue;
      const parts = border.split(" ").filter(Boolean), line = border === "none" ? "none" : parts[1], width = distance(parts[0]), shade = color(parts[2]);
      const type = line === "none" ? 0 : line === "double" ? 6 : line === "dashed" ? 4 : line === "dotted" ? 7 : width !== undefined ? width > 2.5 ? 5 : width > 1 ? 2 : 1 : undefined;
      if (type !== undefined) borders.set(target, gnode(target, { Style: type, Color: shade ?? "0:0:0" }));
    }
  }
  const other = Array.isArray(parentChildren) ? parentChildren.filter(c => !["Font", "StyleBorder"].includes(String(object(c)?.name))) : [];
  return gnode("Style", values, [gnode("Font", font, [], String(family)), ...other,
    ...(borders.size ? [gnode("StyleBorder", {}, [...borders.values()])] : [])]);
}

/** Metadata effects use the same retained-record path as the other importers. */
export function odfSheetMetadata(sheet: XmlElement, charge: (n?: number) => void, roots: readonly XmlElement[] = []): UnsupportedRecord[] {
  const objects: ImportedValue[] = [], regions: ImportedValue[] = [], print: ImportedValue[] = []; let row = 0, column = 0;
  const repeat = (n: XmlElement, name: string) => Number(attr(n, name, "table") ?? "1");
  function rows(parent: XmlElement) {
    for (const n of parent.children) {
      charge(); if (!ns.table.includes(n.namespace)) continue;
      if (["table-row-group", "table-rows", "table-header-rows"].includes(n.localName)) {
        const start = row; rows(n);
        if (n.localName === "table-header-rows" && row > start) print.push(gnode("repeat_top", { value: `$${start + 1}:$${row}` }));
        continue;
      }
      if (n.localName !== "table-row") continue;
      column = 0;
      for (const c of n.children) {
        charge(); if (!ns.table.includes(c.namespace) || !["table-cell", "covered-table-cell"].includes(c.localName)) continue;
        const address = formatA1(row, column);
        for (const annotation of c.children.filter(n => n.localName === "annotation" && ns.office.includes(n.namespace))) {
          const author = annotation.children.find(n => n.localName === "creator" && ns.dc.includes(n.namespace))?.text;
          const text = annotation.children.filter(n => n.localName === "p" && ns.text.includes(n.namespace)).map(n => annotationText(n, charge)).join("\n");
          objects.push(gnode("CellComment", { ObjectBound: address, ObjectOffset: "1 0 1 0", Direction: 17, Print: 1,
            ...(author ? { Author: author } : {}), Text: text }));
        }
        function links(n: XmlElement) {
          for (const child of n.children) {
            charge(); if (!ns.text.includes(child.namespace)) continue;
            if (child.localName === "a") {
              const href = attr(child, "href", "xlink"); if (!href) continue;
              const type = href.startsWith("http") ? "GnmHLinkURL" : href.startsWith("mail") ? "GnmHLinkEMail" : href.startsWith("file") ? "GnmHLinkExternal" : "GnmHLinkCurWB";
              let target = type === "GnmHLinkCurWB" && href.startsWith("#") ? href.slice(1) : href;
              if (type === "GnmHLinkCurWB") {
                const dot = target.indexOf(".");
                if (dot >= 0) target = target.slice(0, dot) + "!" + target.slice(dot + 1);
              }
              regions.push(gnode("StyleRegion", { startRow: row, endRow: row, startCol: column, endCol: column }, [
                gnode("Style", { Fore: "0:0:FFFF" }, [gnode("Font", { Underline: 1 }),
                  gnode("HyperLink", { type, target, ...(attr(child, "title", "office") ? { tip: attr(child, "title", "office")! } : {}) })])
              ]));
            }
            links(child);
          }
        }
        links(c); column += repeat(c, "number-columns-repeated");
      }
      row += repeat(n, "number-rows-repeated");
    }
  }
  rows(sheet);
  const styleName = attr(sheet, "style-name", "table");
  const containers = roots.flatMap(r => r.children);
  const styles = containers.flatMap(c => c.children).filter(n => ns.style.includes(n.namespace));
  const tableStyle = styles.find(n => n.localName === "style" && attr(n, "name", "style") === styleName);
  const master = styles.find(n => n.localName === "master-page" && attr(n, "name", "style") === attr(tableStyle, "master-page-name", "style"));
  const layout = styles.find(n => ["page-layout", "page-master"].includes(n.localName) && attr(n, "name", "style") === attr(master, "page-layout-name", "style"));
  for (const p of layout?.children ?? []) {
    charge();
    const orientation = attr(p, "print-orientation", "style"); if (orientation === "portrait" || orientation === "landscape") print.push(gnode("orientation", {}, [], orientation));
    const margins: Record<string, number> = {};
    for (const side of ["top", "bottom", "left", "right"]) {
      const points = distance(attr(p, "margin-" + side, "fo") ?? attr(p, "margin", "fo")); if (points !== undefined) margins[side] = points;
    }
    if (Object.keys(margins).length) print.push(gnode("Margins", {}, Object.entries(margins).map(([name, Points]) => gnode(name, { Points, PrefUnit: "cm" }))));
    const pages = attr(p, "scale-to-pages", "style");
    const x = attr(p, "scale-to-X", "style") ?? attr(p, "scale-to-X", "gnm") ?? pages,
      y = attr(p, "scale-to-Y", "style") ?? attr(p, "scale-to-Y", "gnm") ?? pages, scale = attr(p, "scale-to", "style");
    if (x || y) print.push(gnode("Scale", { type: "fit", cols: x ?? "0", rows: y ?? "0" }));
    else if (scale?.endsWith("%")) print.push(gnode("Scale", { type: "percentage", percentage: scale.slice(0, -1) }));
  }
  const records: UnsupportedRecord[] = [];
  for (const [kind, items] of [["Objects", objects], ["Styles", regions], ["PrintInformation", print]] as const) if (items.length)
    records.push({ source: "Gnumeric_XmlIO:sax", kind, disposition: "retained", data: gnode(kind, {}, items) });
  return records;
}

export function odfDatabaseRanges(spreadsheet: XmlElement, sheetName: string, charge: (n?: number) => void): UnsupportedRecord[] {
  const filters: ImportedValue[] = [];
  for (const container of spreadsheet.children.filter(n => n.localName === "database-ranges" && ns.table.includes(n.namespace))) for (const range of container.children) {
    charge(); const address = attr(range, "target-range-address", "table"); if (!address) continue;
    charge(address.length);
    const parsed = parseExpression("=[" + address + "]", { grammar: odfGrammar, position: { sheet: sheetName, row: 0, column: 0 } });
    if (!parsed.ok || parsed.document.root.kind !== "reference") continue;
    const ref = parsed.document.root, first = ref.first, last = ref.last ?? first;
    if (first.workbook || last.workbook || (first.sheet ?? sheetName) !== sheetName || (last.sheet ?? first.sheet ?? sheetName) !== sheetName
      || !first.row || !first.column || !last.row || !last.column) continue;
    const fields: ImportedValue[] = [];
    function conditions(node: XmlElement) {
      for (const c of node.children) {
        charge(); if (!ns.table.includes(c.namespace)) continue;
        if (c.localName === "filter-condition") {
          const operators: Readonly<Record<string, string>> = { "=": "eq", "!=": "ne", "<": "lt", ">": "gt", "<=": "lte", ">=": "gte" };
          const op = operators[attr(c, "operator", "table") ?? "="], value = attr(c, "value", "table") ?? "";
          if (op) fields.push(gnode("Field", { Index: attr(c, "field-number", "table") ?? "0", Type: "expr", Op0: op,
            Value0: attr(c, "data-type", "table") === "number" ? 40 : 60, ValueType0: value }));
        } else if (["filter", "filter-and"].includes(c.localName)) conditions(c);
      }
    }
    conditions(range);
    if (fields.length || attr(range, "display-filter-buttons", "table") === "true") filters.push(gnode("Filter", { Area: formatA1(first.row.value, first.column.value) + ":" + formatA1(last.row.value, last.column.value) }, fields));
  }
  return filters.length ? [{ source: "Gnumeric_XmlIO:sax", kind: "Filters", disposition: "retained", data: gnode("Filters", {}, filters) }] : [];
}
