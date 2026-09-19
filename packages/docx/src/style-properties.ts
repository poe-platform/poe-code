import { styleFontFlags } from "./style-font-flags.js";
export { styleFontFlags } from "./style-font-flags.js";
import { Length } from "./formatting-values.js";
import type { DocumentBudget } from "./budget.js";
import type { XmlElement } from "./package-xml.js";
import { xmlValue } from "./create-content.js";
import { runElementOpen } from "./run-properties.js";
import { UnsupportedEditError, type DocumentXmlEditor } from "./xml-write.js";

export function styleChild(node: XmlElement | undefined, name: string, children: (node: XmlElement) => readonly XmlElement[] = node => node.children): XmlElement | undefined {
  return node && children(node).find(c => c.namespace === node.namespace && c.localName === name);
}
export function styleAttribute(node: XmlElement | undefined, name: string): string | undefined {
  return node?.attributes.find(a => a.namespace === node.namespace && a.localName === name)?.value;
}
/** Reserve native storage identities without activating inert definitions. */
export function styleIds(root: XmlElement, budget: DocumentBudget): Set<string> {
  const ids = new Set<string>(), stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    budget.charge("work", 1 + node.children.length);
    if (node.namespace === root.namespace && node.localName === "style") {
      const id = styleAttribute(node, "styleId");
      if (id !== undefined) ids.add(id);
    }
    stack.push(...node.children);
  }
  return ids;
}

export function styleToggle(node: XmlElement | undefined): boolean | null {
  if (!node) return null;
  const value = styleAttribute(node, "val") ?? "1";
  if (["1", "true", "on"].includes(value)) return true;
  if (["0", "false", "off"].includes(value)) return false;
  throw new TypeError("Invalid style boolean value.");
}

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
export function readStyleProperties(run: XmlElement | undefined, paragraph: XmlElement | undefined, children: (node: XmlElement) => readonly XmlElement[] = node => node.children): StyleProperties {
  const child = (node: XmlElement | undefined, name: string) => styleChild(node, name, children);
  const numeric = (node: XmlElement | undefined, attribute = "val", divisor = 1): number | null => {
    const raw = styleAttribute(node, attribute);
    if (raw === undefined) return null;
    const multiplier = ({ in: 914400, cm: 360000, mm: 36000, pt: 12700, pc: 152400, pi: 152400 } as Readonly<Record<string, number>>)[raw.slice(-2)];
    if (multiplier !== undefined && divisor !== 1) return Length(Number(raw.slice(0, -2)) * multiplier).pt;
    return styleInteger(raw)! / divisor;
  };
  const num = child(paragraph, "numPr"), spacing = child(paragraph, "spacing"), ind = child(paragraph, "ind");
  const tabs = child(paragraph, "tabs");
  const lineRule = styleAttribute(spacing, "lineRule") ?? null;
  const hanging = numeric(ind, "hanging", 20);
  return { ...Object.fromEntries(Object.entries(styleFontFlags).map(([key, tag]) => [key, styleToggle(child(run, tag))])) as Record<keyof typeof styleFontFlags, boolean | null>,
    font: styleAttribute(child(run, "rFonts"), "ascii") ?? null, size: numeric(child(run, "sz"), "val", 2),
    color: styleAttribute(child(run, "color"), "val") ?? null,
    themeColor: styleAttribute(child(run, "color"), "themeColor") ?? null,
    underline: styleAttribute(child(run, "u"), "val") ?? null,
    highlight: styleAttribute(child(run, "highlight"), "val") ?? null,
    baseline: styleAttribute(child(run, "vertAlign"), "val") ?? null,
    language: styleAttribute(child(run, "lang"), "val") ?? null,
    outlineLevel: numeric(child(paragraph, "outlineLvl")), keepWithNext: styleToggle(child(paragraph, "keepNext")),
    keepTogether: styleToggle(child(paragraph, "keepLines")), widowControl: styleToggle(child(paragraph, "widowControl")),
    pageBreakBefore: styleToggle(child(paragraph, "pageBreakBefore")),
    leftIndent: numeric(ind, "start", 20) ?? numeric(ind, "left", 20), rightIndent: numeric(ind, "end", 20) ?? numeric(ind, "right", 20),
    firstLineIndent: hanging === null ? numeric(ind, "firstLine", 20) : -hanging,
    lineSpacing: numeric(spacing, "line", lineRule === "auto" || lineRule === null ? 240 : 20), lineSpacingRule: lineRule,
    alignment: styleAttribute(child(paragraph, "jc"), "val") ?? null,
    spaceBefore: numeric(spacing, "before", 20), spaceAfter: numeric(spacing, "after", 20),
    tabStops: tabs ? children(tabs).filter(n => n.namespace === tabs.namespace && n.localName === "tab").map(n => ({ position: numeric(n, "pos", 20) ?? 0, alignment: styleAttribute(n, "val") ?? "left", leader: styleAttribute(n, "leader") ?? "none" })) : null,
    numbering: num ? { id: styleAttribute(child(num, "numId"), "val") ?? null, level: numeric(child(num, "ilvl")) } : null };
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
export function mergeStyleChildren(xml: DocumentXmlEditor, parent: XmlElement, updates: ReadonlyMap<string, string>, order: readonly string[], attributes: Readonly<Record<string, string | null>> = {}, children: (node: XmlElement) => readonly XmlElement[] = node => node.children): string {
  const replacements = new Map<XmlElement, string>();
  const prefixes = new Map<XmlElement, string>();
  let tail = "";
  for (const [name, markup] of [...updates].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))) {
    const matches = children(parent).filter(c => c.namespace === parent.namespace && c.localName === name);
    if (matches.length > 1) throw new UnsupportedEditError("Duplicate style properties cannot be edited.");
    if (matches[0]) { replacements.set(matches[0], markup); continue; }
    if (!markup) continue;
    const next = children(parent).find(c => c.namespace === parent.namespace && order.indexOf(c.localName) > order.indexOf(name));
    if (next) prefixes.set(next, (prefixes.get(next) ?? "") + markup); else tail += markup;
  }
  for (const [node, prefix] of prefixes) replacements.set(node, prefix + (replacements.get(node) ?? xml.sourceXml(node)));
  const content = xml.sourceXml(parent, replacements, true) + tail;
  if (!Object.keys(attributes).length && !tail && !prefixes.size) return xml.sourceXml(parent, replacements);
  const retained = parent.attributes.filter(a => a.namespace !== parent.namespace || !Object.hasOwn(attributes, a.localName));
  const namespaces = new Map(parent.namespaces);
  let prefix = [...namespaces].find(([name, namespace]) => name && namespace === parent.namespace)?.[0] ?? "st";
  for (let n = 1; namespaces.has(prefix) && namespaces.get(prefix) !== parent.namespace; n++) prefix = `st${n}`;
  namespaces.set(prefix, parent.namespace);
  const open = runElementOpen({ ...parent, attributes: retained, namespaces });
  const added = Object.entries(attributes).filter(([,v]) => v !== null).map(([key, value]) => ` ${prefix}:${key}="${xmlValue(value!)}"`).join("");
  return open.slice(0, -1) + added + ">" + content + `</${parent.name}>`;
}
