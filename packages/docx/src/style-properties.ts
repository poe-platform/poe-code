import type { XmlElement } from "./package-xml.js";
import { xmlValue } from "./create-content.js";
import { runElementOpen } from "./run-properties.js";
import { UnsupportedEditError, type DocumentXmlEditor } from "./xml-write.js";

export function styleChild(node: XmlElement | undefined, name: string): XmlElement | undefined {
  return node?.children.find(c => c.namespace === node.namespace && c.localName === name);
}
export function styleAttribute(node: XmlElement | undefined, name: string): string | undefined {
  return node?.attributes.find(a => a.namespace === node.namespace && a.localName === name)?.value;
}
export function styleToggle(node: XmlElement | undefined): boolean | null {
  return node ? !["0", "false", "off"].includes(styleAttribute(node, "val") ?? "1") : null;
}
export interface StyleProperties {
  readonly bold: boolean | null; readonly italic: boolean | null;
  readonly font: string | null; readonly size: number | null; readonly color: string | null;
  readonly outlineLevel: number | null; readonly keepWithNext: boolean | null;
  readonly spaceBefore: number | null; readonly spaceAfter: number | null;
  readonly numbering: { readonly id: string | null; readonly level: number | null } | null;
}
export function readStyleProperties(run: XmlElement | undefined, paragraph: XmlElement | undefined): StyleProperties {
  const numeric = (node: XmlElement | undefined, attribute = "val", divisor = 1): number | null => {
    const raw = styleAttribute(node, attribute);
    return raw === undefined || !Number.isFinite(Number(raw)) ? null : Number(raw) / divisor;
  };
  const num = styleChild(paragraph, "numPr");
  return { bold: styleToggle(styleChild(run, "b")), italic: styleToggle(styleChild(run, "i")),
    font: styleAttribute(styleChild(run, "rFonts"), "ascii") ?? null, size: numeric(styleChild(run, "sz"), "val", 2),
    color: styleAttribute(styleChild(run, "color"), "val") ?? null,
    outlineLevel: numeric(styleChild(paragraph, "outlineLvl")), keepWithNext: styleToggle(styleChild(paragraph, "keepNext")),
    spaceBefore: numeric(styleChild(paragraph, "spacing"), "before", 20), spaceAfter: numeric(styleChild(paragraph, "spacing"), "after", 20),
    numbering: num ? { id: styleAttribute(styleChild(num, "numId"), "val") ?? null, level: numeric(styleChild(num, "ilvl")) } : null };
}

/** Retain source children, including comments and unknown metadata, in schema order. */
export function mergeStyleChildren(xml: DocumentXmlEditor, parent: XmlElement, updates: ReadonlyMap<string, string>, order: readonly string[], attributes: Readonly<Record<string, string | null>> = {}): string {
  const replacements = new Map<XmlElement, string>();
  const prefixes = new Map<XmlElement, string>();
  let tail = "";
  for (const [name, markup] of [...updates].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))) {
    const matches = parent.children.filter(c => c.namespace === parent.namespace && c.localName === name);
    if (matches.length > 1) throw new UnsupportedEditError("Duplicate style properties cannot be edited.");
    if (matches[0]) { replacements.set(matches[0], markup); continue; }
    if (!markup) continue;
    const next = parent.children.find(c => c.namespace === parent.namespace && order.indexOf(c.localName) > order.indexOf(name));
    if (next) prefixes.set(next, (prefixes.get(next) ?? "") + markup); else tail += markup;
  }
  for (const [node, prefix] of prefixes) replacements.set(node, prefix + (replacements.get(node) ?? xml.sourceXml(node)));
  const content = xml.sourceXml(parent, replacements, true) + tail;
  if (!Object.keys(attributes).length && !tail && !prefixes.size) return xml.sourceXml(parent, replacements);
  const retained = parent.attributes.filter(a => a.namespace !== parent.namespace || !Object.hasOwn(attributes, a.localName));
  const namespaces = new Map(parent.namespaces);
  let prefix = "st";
  for (let n = 1; namespaces.has(prefix) && namespaces.get(prefix) !== parent.namespace; n++) prefix = `st${n}`;
  namespaces.set(prefix, parent.namespace);
  const open = runElementOpen({ ...parent, attributes: retained, namespaces });
  const added = Object.entries(attributes).filter(([,v]) => v !== null).map(([key, value]) => ` ${prefix}:${key}="${xmlValue(value!)}"`).join("");
  return open.slice(0, -1) + added + ">" + content + `</${parent.name}>`;
}
