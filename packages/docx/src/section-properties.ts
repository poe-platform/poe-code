import { DocxUsageError } from "./argument-json.js";
import { xmlValue } from "./create-content.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { paragraphUnits } from "./paragraph-properties.js";
import type { XmlElement } from "./package-xml.js";
import { runElementOpen } from "./run-properties.js";
import { UnsupportedEditError, type DocumentXmlEditor } from "./xml-write.js";

export const sectionPropertyOrder = "headerReference footerReference footnotePr endnotePr type pgSz pgMar paperSrc pgBorders lnNumType pgNumType cols formProt vAlign noEndnote titlePg textDirection bidi rtlGutter docGrid printerSettings sectPrChange".split(" ");
export const sectionStarts = { CONTINUOUS: "continuous", NEW_COLUMN: "nextColumn", NEW_PAGE: "nextPage", EVEN_PAGE: "evenPage", ODD_PAGE: "oddPage" };
export function sectionAttribute(node: XmlElement | undefined, key: string): string | undefined {
  return node?.attributes.find(a => a.namespace === node.namespace && a.localName === key)?.value;
}
export function sectionChild(node: XmlElement | undefined, key: string): XmlElement | undefined {
  const matches = node?.children.filter(c => c.namespace === node.namespace && c.localName === key) ?? [];
  if (matches.length > 1) throw new UnsupportedEditError("Duplicate section properties cannot be interpreted.");
  return matches[0];
}
function integer(node: XmlElement | undefined, key: string, fallback: number | null = null): number | null {
  const value = sectionAttribute(node, key);
  if (value === undefined) return fallback;
  if (!value || [...value].some(c => !"0123456789-+".includes(c)) || !Number.isSafeInteger(Number(value)))
    throw new UnsupportedEditError("Section properties require valid integer storage.");
  return Number(value);
}
export function sectionBoolean(node: XmlElement | undefined, attribute = "val", absent = false): boolean {
  const value = sectionAttribute(node, attribute);
  if (value !== undefined && !["0", "1", "true", "false", "on", "off"].includes(value)) throw new UnsupportedEditError("Invalid section policy value.");
  return node === undefined ? absent : value === undefined ? attribute === "val" || absent : ["1", "true", "on"].includes(value);
}
export function readSectionProperties(node: XmlElement | undefined) {
  const size = sectionChild(node, "pgSz"), margin = sectionChild(node, "pgMar"), columns = sectionChild(node, "cols"), numbers = sectionChild(node, "pgNumType");
  const equalWidth = sectionBoolean(columns, "equalWidth", true);
  return {
    equalWidth,
    pageWidth: integer(size, "w"), pageHeight: integer(size, "h"), orientation: sectionAttribute(size, "orient") ?? "portrait",
    topMargin: integer(margin, "top"), bottomMargin: integer(margin, "bottom"), leftMargin: integer(margin, "left"), rightMargin: integer(margin, "right"),
    gutter: integer(margin, "gutter", 0), headerDistance: integer(margin, "header"), footerDistance: integer(margin, "footer"),
    startType: sectionAttribute(sectionChild(node, "type"), "val") ?? "nextPage",
    columns: equalWidth ? integer(columns, "num", 1) : columns!.children.filter(c => c.namespace === columns!.namespace && c.localName === "col").length,
    columnGap: equalWidth ? integer(columns, "space", 720) : null, columnSeparator: sectionBoolean(columns, "sep"),
    pageNumberStart: integer(numbers, "start"), pageNumberFormat: sectionAttribute(numbers, "fmt") ?? "decimal",
    differentFirstPage: sectionBoolean(sectionChild(node, "titlePg"))
  };
}
export type SectionDirectProperties = ReturnType<typeof readSectionProperties>;

/** Merge the selected owner only; absence of geometry is not a previous-section default. */
export function formatSectionProperties(xml: DocumentXmlEditor, node: XmlElement | undefined, options: DocxOperationArguments<"sections.set">, omitReferences = false, gutterAtTop = false): string {
  const w = xml.root.namespace;
  if (sectionChild(node, "sectPrChange")) throw new UnsupportedEditError("Revised section properties require a revision operation.");
  const direct = readSectionProperties(node);
  const replacements = new Map<XmlElement, string>();
  const additions = new Map<string, string>();
  const set = (name: string, attrs: Record<string, string>, removeColumns = false) => {
    const old = sectionChild(node, name);
    if (old && (!removeColumns || !old.children.some(c => c.namespace === w && c.localName === "col")) && Object.entries(attrs).every(([k, v]) => sectionAttribute(old, k) === v)) return;
    const prefix = old?.name.includes(":") ? old.name.split(":")[0]! : "sp";
    const namespaces = new Map(old?.namespaces ?? node?.namespaces); namespaces.set(prefix, w);
    const bindings = [...namespaces].filter(([p]) => p !== "xml").map(([p, uri]) => ` ${p ? "xmlns:" + p : "xmlns"}="${xmlValue(uri)}"`).join("");
    const retained = old?.attributes.filter(a => a.namespace !== "http://www.w3.org/2000/xmlns/" && !(a.namespace === w && Object.hasOwn(attrs, a.localName))).map(a => ` ${a.name}="${xmlValue(a.value)}"`).join("") ?? "";
    const inner = old ? xml.sourceXml(old, new Map(removeColumns ? old.children.filter(c => c.namespace === w && c.localName === "col").map(c => [c, ""] as const) : []), true) : "";
    const value = `<${prefix}:${name}${bindings}${retained}${Object.entries(attrs).map(([k, v]) => ` ${prefix}:${k}="${xmlValue(v)}"`).join("")}>${inner}</${prefix}:${name}>`;
    if (old) replacements.set(old, value); else additions.set(name, value);
  };
  const sizes: Record<string, string> = {}, margins: Record<string, string> = {};
  for (const [field, name] of [["pageWidth", "w"], ["pageHeight", "h"]] as const) {
    const value = options[field]; if (value === undefined) continue;
    const count = paragraphUnits(value);
    if (count < 1) throw new DocxUsageError("Page dimensions must round to positive twips.");
    sizes[name] = String(count); direct[field] = count;
  }
  if (options.orientation !== undefined) sizes.orient = options.orientation.name === "LANDSCAPE" ? "landscape" : "portrait";
  for (const [field, name] of [["topMargin", "top"], ["bottomMargin", "bottom"], ["leftMargin", "left"], ["rightMargin", "right"], ["gutter", "gutter"], ["headerDistance", "header"], ["footerDistance", "footer"]] as const) {
    const value = options[field]; if (value === undefined) continue;
    const count = paragraphUnits(value);
    if (value.value < 0 || count < 0) throw new DocxUsageError("Section margins and distances must be nonnegative.");
    margins[name] = String(count); direct[field] = count;
  }
  const geometryEdit = Object.keys(sizes).some(k => k !== "orient") || Object.keys(margins).some(k => !["header", "footer"].includes(k)) || options.columns !== undefined || options.columnGap !== undefined;
  if (geometryEdit && !direct.equalWidth && options.columns === undefined) throw new UnsupportedEditError("Geometry edits over custom columns require explicit conversion with a column count.");
  if (geometryEdit) {
    const { pageWidth, pageHeight, leftMargin, rightMargin, topMargin, bottomMargin, gutter } = direct;
    if ([pageWidth, pageHeight, leftMargin, rightMargin, topMargin, bottomMargin].some(n => n === null)) throw new UnsupportedEditError("Geometry edits require explicit dimensions and margins; unresolved layout inheritance cannot be inferred.");
    const horizontalGutter = gutterAtTop ? 0 : gutter!;
    const verticalGutter = gutterAtTop ? gutter! : 0;
    if (pageWidth! - leftMargin! - rightMargin! - horizontalGutter <= 0 || pageHeight! - topMargin! - bottomMargin! - verticalGutter <= 0)
      throw new DocxUsageError("Margins and gutter must leave positive content extent.");
    const count = options.columns ?? direct.columns!;
    const gap = options.columnGap ? paragraphUnits(options.columnGap) : (direct.columnGap ?? 720);
    if (gap < 0 || options.columnGap && options.columnGap.value < 0 || pageWidth! - leftMargin! - rightMargin! - horizontalGutter - (count - 1) * gap < count)
      throw new DocxUsageError("Columns must leave positive content widths.");
  }
  if (Object.keys(sizes).length) set("pgSz", sizes);
  if (Object.keys(margins).length) set("pgMar", margins);
  if (options.startType) set("type", { val: sectionStarts[options.startType.name] });
  const numbers: Record<string, string> = {};
  if (options.pageNumberStart !== undefined) numbers.start = String(options.pageNumberStart);
  if (options.pageNumberFormat !== undefined) numbers.fmt = options.pageNumberFormat;
  if (Object.keys(numbers).length) set("pgNumType", numbers);
  if (options.columns !== undefined || options.columnGap !== undefined || options.columnSeparator !== undefined) {
    const attrs: Record<string, string> = {};
    if (options.columns !== undefined) Object.assign(attrs, { num: String(options.columns), equalWidth: "1", space: String(options.columnGap ? paragraphUnits(options.columnGap) : (direct.columnGap ?? 720)) });
    else if (options.columnGap !== undefined) attrs.space = String(paragraphUnits(options.columnGap));
    if (options.columnSeparator !== undefined) attrs.sep = String(Number(options.columnSeparator));
    set("cols", attrs, options.columns !== undefined);
  }
  if (options.differentFirstPage !== undefined && options.differentFirstPage !== direct.differentFirstPage) set("titlePg", { val: String(Number(options.differentFirstPage)) });
  if (omitReferences) for (const child of node?.children ?? []) if (child.namespace === w && ["headerReference", "footerReference"].includes(child.localName)) replacements.set(child, "");
  let tail = "";
  const prefixes = new Map<XmlElement, string>();
  for (const name of sectionPropertyOrder) {
    const markup = additions.get(name); if (markup === undefined) continue;
    const next = node?.children.find(c => c.namespace === w && sectionPropertyOrder.indexOf(c.localName) > sectionPropertyOrder.indexOf(name));
    if (next) prefixes.set(next, (prefixes.get(next) ?? "") + markup); else tail += markup;
  }
  for (const [next, prefix] of prefixes) replacements.set(next, prefix + (replacements.get(next) ?? xml.sourceXml(next)));
  if (!replacements.size && !tail) return node ? xml.sourceXml(node) : "";
  return (node ? runElementOpen(node) : `<sp:sectPr xmlns:sp="${w}">`) + (node ? xml.sourceXml(node, replacements, true) : "") + tail + `</${node?.name ?? "sp:sectPr"}>`;
}
