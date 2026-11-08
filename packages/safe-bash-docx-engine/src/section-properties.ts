import { DocxUsageError } from "./argument-json.js";
import { storedBooleanValue, trimXmlWhitespace } from "./stored-lexical.js";
import { InvalidDocumentError } from "./document-error.js";
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
export function sectionChild(node: XmlElement | undefined, key: string, children: (node: XmlElement) => readonly XmlElement[] = node => node.children): XmlElement | undefined {
  const matches = node ? children(node).filter(c => c.namespace === node.namespace && c.localName === key) : [];
  if (matches.length > 1) throw new UnsupportedEditError("Duplicate section properties cannot be interpreted.");
  return matches[0];
}
export function sectionInteger(node: XmlElement | undefined, key: string, fallback: number | null = null, scale = 1): number | null {
  const raw = sectionAttribute(node, key);
  if (raw === undefined) return fallback;
  const value = trimXmlWhitespace(raw);
  const digits = value.startsWith("-") || value.startsWith("+") ? value.slice(1) : value;
  if (!digits || [...digits].some(c => c < "0" || c > "9") || !Number.isSafeInteger(Number(value)) || !Number.isSafeInteger(Number(value) * scale))
    throw new InvalidDocumentError("Section properties require valid integer storage.");
  return Number(value);
}
export function sectionOrientation(node: XmlElement | undefined): "portrait" | "landscape" {
  const value = sectionAttribute(node, "orient") ?? "portrait";
  if (value !== "portrait" && value !== "landscape")
    throw new InvalidDocumentError("Invalid stored section orientation.");
  return value;
}
export function sectionBoolean(node: XmlElement | undefined, attribute = "val", absent = false): boolean {
  if (node === undefined) return absent;
  const value = sectionAttribute(node, attribute);
  if (value === undefined) return attribute === "val" || absent;
  const decoded = storedBooleanValue(value);
  if (decoded === null) throw new UnsupportedEditError("Invalid section policy value.");
  return decoded;
}
export function readSectionProperties(node: XmlElement | undefined, children: (node: XmlElement) => readonly XmlElement[] = node => node.children) {
  const size = sectionChild(node, "pgSz", children), margin = sectionChild(node, "pgMar", children), columns = sectionChild(node, "cols", children), numbers = sectionChild(node, "pgNumType", children);
  const equalWidth = sectionBoolean(columns, "equalWidth", true);
  return {
    equalWidth,
    pageWidth: sectionInteger(size, "w", null, 635), pageHeight: sectionInteger(size, "h", null, 635), orientation: sectionAttribute(size, "orient") ?? "portrait",
    topMargin: sectionInteger(margin, "top", null, 635), bottomMargin: sectionInteger(margin, "bottom", null, 635), leftMargin: sectionInteger(margin, "left", null, 635), rightMargin: sectionInteger(margin, "right", null, 635),
    gutter: sectionInteger(margin, "gutter", 0, 635), headerDistance: sectionInteger(margin, "header", null, 635), footerDistance: sectionInteger(margin, "footer", null, 635),
    startType: sectionAttribute(sectionChild(node, "type", children), "val") ?? "nextPage",
    columns: equalWidth ? sectionInteger(columns, "num", 1) : children(columns!).filter(c => c.namespace === columns!.namespace && c.localName === "col").length,
    columnGap: equalWidth ? sectionInteger(columns, "space", 720, 635) : null, columnSeparator: sectionBoolean(columns, "sep"),
    pageNumberStart: sectionInteger(numbers, "start"), pageNumberFormat: sectionAttribute(numbers, "fmt") ?? "decimal",
    differentFirstPage: sectionBoolean(sectionChild(node, "titlePg", children))
  };
}
export type SectionDirectProperties = ReturnType<typeof readSectionProperties>;

/** Merge the selected owner only; absence of geometry is not a previous-section default. */
export function formatSectionProperties(xml: DocumentXmlEditor, node: XmlElement | undefined, options: DocxOperationArguments<"sections.set">, omitReferences = false, gutterAtTop = false, children: (node: XmlElement) => readonly XmlElement[] = node => node.children): string {
  const w = xml.root.namespace;
  if (sectionChild(node, "sectPrChange", children)) throw new UnsupportedEditError("Revised section properties require a revision operation.");
  const direct = readSectionProperties(node, children);
  const replacements = new Map<XmlElement, string>();
  const additions = new Map<string, string>();
  const set = (name: string, attrs: Record<string, string>, removeColumns = false) => {
    const old = sectionChild(node, name, children);
    if (old && (!removeColumns || !children(old).some(c => c.namespace === w && c.localName === "col")) && Object.entries(attrs).every(([k, v]) => sectionAttribute(old, k) === v)) return;
    const prefix = old?.name.includes(":") ? old.name.split(":")[0]! : "sp";
    const namespaces = new Map(old?.namespaces ?? node?.namespaces); namespaces.set(prefix, w);
    const bindings = [...namespaces].filter(([p]) => p !== "xml").map(([p, uri]) => ` ${p ? "xmlns:" + p : "xmlns"}="${xmlValue(uri)}"`).join("");
    const retained = old?.attributes.filter(a => a.namespace !== "http://www.w3.org/2000/xmlns/" && !(a.namespace === w && Object.hasOwn(attrs, a.localName))).map(a => ` ${a.name}="${xmlValue(a.value)}"`).join("") ?? "";
    const inner = old ? xml.sourceXml(old, new Map(removeColumns ? children(old).filter(c => c.namespace === w && c.localName === "col").map(c => [c, ""] as const) : []), true) : "";
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
  if (omitReferences) for (const child of node ? children(node) : []) if (child.namespace === w && ["headerReference", "footerReference"].includes(child.localName)) replacements.set(child, "");
  let tail = "";
  const prefixes = new Map<XmlElement, string>();
  for (const name of sectionPropertyOrder) {
    const markup = additions.get(name); if (markup === undefined) continue;
    const next = (node ? children(node) : []).find(c => c.namespace === w && sectionPropertyOrder.indexOf(c.localName) > sectionPropertyOrder.indexOf(name));
    if (next) prefixes.set(next, (prefixes.get(next) ?? "") + markup); else tail += markup;
  }
  for (const [next, prefix] of prefixes) replacements.set(next, prefix + (replacements.get(next) ?? xml.sourceXml(next)));
  if (!replacements.size && !tail) return node ? xml.sourceXml(node) : "";
  return (node ? runElementOpen(node) : `<sp:sectPr xmlns:sp="${w}">`) + (node ? xml.sourceXml(node, replacements, true) : "") + tail + `</${node?.name ?? "sp:sectPr"}>`;
}
