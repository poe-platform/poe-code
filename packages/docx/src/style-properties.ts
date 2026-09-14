import { Length } from "./formatting-values.js";
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
  if (!node) return null;
  const value = styleAttribute(node, "val") ?? "1";
  if (["1", "true", "on"].includes(value)) return true;
  if (["0", "false", "off"].includes(value)) return false;
  throw new TypeError("Invalid style boolean value.");
}
export const styleFontFlags = {
  bold: "b", italic: "i", allCaps: "caps", complexScriptEnabled: "cs", csBold: "bCs", csItalic: "iCs",
  doubleStrike: "dstrike", emboss: "emboss", imprint: "imprint", math: "oMath", noProof: "noProof",
  outline: "outline", shadow: "shadow", smallCaps: "smallCaps", snapToGrid: "snapToGrid",
  specVanish: "specVanish", webHidden: "webHidden", strike: "strike", fontHidden: "vanish", rtl: "rtl"
} as const;
export const styleToggleFlags: readonly (keyof typeof styleFontFlags)[] = ["bold", "italic", "csBold", "csItalic", "allCaps", "smallCaps", "strike", "doubleStrike", "outline", "shadow", "emboss", "imprint", "fontHidden"];
export function styleInteger(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const text = raw.trim(), digits = text[0] === "+" || text[0] === "-" ? text.slice(1) : text;
  if (!digits.length || [...digits].some(char => char < "0" || char > "9") || !Number.isSafeInteger(Number(text))) throw new TypeError("Invalid integer style property.");
  return Number(text);
}
export interface StyleTabStop { readonly position: number; readonly alignment: string; readonly leader: string }
export type StyleProperties = Readonly<Record<keyof typeof styleFontFlags, boolean | null>> & {
  readonly font: string | null; readonly size: number | null; readonly color: string | null;
  readonly themeColor: string | null; readonly underline: string | null; readonly highlight: string | null;
  readonly baseline: string | null; readonly language: string | null;
  readonly outlineLevel: number | null; readonly keepWithNext: boolean | null;
  readonly keepTogether: boolean | null; readonly widowControl: boolean | null; readonly pageBreakBefore: boolean | null;
  readonly spaceBefore: number | null; readonly spaceAfter: number | null;
  readonly leftIndent: number | null; readonly rightIndent: number | null; readonly firstLineIndent: number | null;
  readonly lineSpacing: number | null; readonly lineSpacingRule: string | null; readonly alignment: string | null;
  readonly tabStops: readonly StyleTabStop[] | null;
  readonly numbering: { readonly id: string | null; readonly level: number | null } | null;
};
export function readStyleProperties(run: XmlElement | undefined, paragraph: XmlElement | undefined): StyleProperties {
  const numeric = (node: XmlElement | undefined, attribute = "val", divisor = 1): number | null => {
    const raw = styleAttribute(node, attribute);
    if (raw === undefined) return null;
    const multiplier = ({ in: 914400, cm: 360000, mm: 36000, pt: 12700, pc: 152400, pi: 152400 } as Readonly<Record<string, number>>)[raw.slice(-2)];
    if (multiplier !== undefined && divisor !== 1) return Length(Number(raw.slice(0, -2)) * multiplier).pt;
    return styleInteger(raw)! / divisor;
  };
  const num = styleChild(paragraph, "numPr"), spacing = styleChild(paragraph, "spacing"), ind = styleChild(paragraph, "ind");
  const tabs = styleChild(paragraph, "tabs");
  const lineRule = styleAttribute(spacing, "lineRule") ?? null;
  const hanging = numeric(ind, "hanging", 20);
  return { ...Object.fromEntries(Object.entries(styleFontFlags).map(([key, tag]) => [key, styleToggle(styleChild(run, tag))])) as Record<keyof typeof styleFontFlags, boolean | null>,
    font: styleAttribute(styleChild(run, "rFonts"), "ascii") ?? null, size: numeric(styleChild(run, "sz"), "val", 2),
    color: styleAttribute(styleChild(run, "color"), "val") ?? null,
    themeColor: styleAttribute(styleChild(run, "color"), "themeColor") ?? null,
    underline: styleAttribute(styleChild(run, "u"), "val") ?? null,
    highlight: styleAttribute(styleChild(run, "highlight"), "val") ?? null,
    baseline: styleAttribute(styleChild(run, "vertAlign"), "val") ?? null,
    language: styleAttribute(styleChild(run, "lang"), "val") ?? null,
    outlineLevel: numeric(styleChild(paragraph, "outlineLvl")), keepWithNext: styleToggle(styleChild(paragraph, "keepNext")),
    keepTogether: styleToggle(styleChild(paragraph, "keepLines")), widowControl: styleToggle(styleChild(paragraph, "widowControl")),
    pageBreakBefore: styleToggle(styleChild(paragraph, "pageBreakBefore")),
    leftIndent: numeric(ind, "start", 20) ?? numeric(ind, "left", 20), rightIndent: numeric(ind, "end", 20) ?? numeric(ind, "right", 20),
    firstLineIndent: hanging === null ? numeric(ind, "firstLine", 20) : -hanging,
    lineSpacing: numeric(spacing, "line", lineRule === "auto" || lineRule === null ? 240 : 20), lineSpacingRule: lineRule,
    alignment: styleAttribute(styleChild(paragraph, "jc"), "val") ?? null,
    spaceBefore: numeric(spacing, "before", 20), spaceAfter: numeric(spacing, "after", 20),
    tabStops: tabs ? tabs.children.filter(n => n.namespace === tabs.namespace && n.localName === "tab").map(n => ({ position: numeric(n, "pos", 20) ?? 0, alignment: styleAttribute(n, "val") ?? "left", leader: styleAttribute(n, "leader") ?? "none" })) : null,
    numbering: num ? { id: styleAttribute(styleChild(num, "numId"), "val") ?? null, level: numeric(styleChild(num, "ilvl")) } : null };
}

export function inheritStyleProperties(inherited: StyleProperties, direct: StyleProperties): StyleProperties {
  const value = Object.fromEntries(Object.entries(direct).map(([key, item]) => [key, item === null ? inherited[key as keyof StyleProperties] : item])) as unknown as StyleProperties;
  const toggles = Object.fromEntries(styleToggleFlags.map(key => [key, direct[key] === null || direct[key] === false ? inherited[key] : !inherited[key]]));
  const tabs = new Map(inherited.tabStops?.map(tab => [tab.position, tab]));
  for (const tab of direct.tabStops ?? []) {
    if (tab.alignment === "clear") tabs.delete(tab.position); else tabs.set(tab.position, tab);
  }
  return { ...value, ...toggles,
    tabStops: direct.tabStops === null ? inherited.tabStops : [...tabs.values()].sort((a, b) => a.position - b.position),
    numbering: direct.numbering === null ? inherited.numbering : { id: direct.numbering.id ?? inherited.numbering?.id ?? null, level: direct.numbering.level ?? inherited.numbering?.level ?? null } };
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
