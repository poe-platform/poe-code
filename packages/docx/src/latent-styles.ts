import { runElementOpen } from "./run-properties.js";
import { xmlValue } from "./create-content.js";
import { SelectionError } from "./location-token.js";
import type { XmlElement } from "./package-xml.js";
import { mergeStyleChildren, styleInteger, styleAttribute as attr, styleChild as child } from "./style-properties.js";
import { styleDisplayName, styleStoredName } from "./style-names.js";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";

const overrides = { hidden: "semiHidden", locked: "locked", quickStyle: "qFormat", unhideWhenUsed: "unhideWhenUsed", priority: "uiPriority" } as const;
const defaults = { defaultToHidden: "defSemiHidden", defaultToLocked: "defLockedState", defaultToQuickStyle: "defQFormat", defaultToUnhideWhenUsed: "defUnhideWhenUsed", defaultPriority: "defUIPriority", loadCount: "count" } as const;
export interface LatentStyleInfo {
  readonly name: string; readonly hidden: boolean | null; readonly locked: boolean | null;
  readonly quickStyle: boolean | null; readonly unhideWhenUsed: boolean | null; readonly priority: number | null;
}
export interface LatentStylesInfo {
  readonly defaults: { readonly defaultToHidden: boolean; readonly defaultToLocked: boolean; readonly defaultToQuickStyle: boolean; readonly defaultToUnhideWhenUsed: boolean; readonly defaultPriority: number | null; readonly loadCount: number | null };
  readonly entries: readonly LatentStyleInfo[];
}
export function readLatentStyles(root: XmlElement, name?: string): LatentStylesInfo | null {
  const containers = root.children.filter(n => n.namespace === root.namespace && n.localName === "latentStyles");
  if (containers.length > 1) throw new UnsupportedEditError("Duplicate latent style containers are ambiguous.");
  const node = containers[0];
  if (!node) { if (name !== undefined) throw new SelectionError("missing-selection"); return null; }
  const value = (element: XmlElement, key: string, numeric: boolean): boolean | number | null => {
    const raw = attr(element, key);
    if (raw === undefined) return null;
    if (numeric) return styleInteger(raw);
    if (["1", "true", "on"].includes(raw)) return true;
    if (["0", "false", "off"].includes(raw)) return false;
    throw new TypeError("Invalid latent style boolean.");
  };
  const entries = node.children.filter(n => n.namespace === root.namespace && n.localName === "lsdException");
  const selected = name === undefined ? entries : entries.filter(n => styleStoredName(attr(n, "name") ?? "") === styleStoredName(name));
  if (name !== undefined && selected.length !== 1) throw new SelectionError(selected.length ? "ambiguous-selection" : "missing-selection");
  return { defaults: Object.fromEntries(Object.entries(defaults).map(([key, tag]) => [key, value(node, tag, key === "defaultPriority" || key === "loadCount") ?? (key === "defaultPriority" || key === "loadCount" ? null : false)])) as unknown as LatentStylesInfo["defaults"],
    entries: selected.map(n => ({ name: styleDisplayName(attr(n, "name") ?? ""), ...Object.fromEntries(Object.entries(overrides).map(([key, tag]) => [key, value(n, tag, key === "priority")])) } as unknown as LatentStyleInfo)) };
}

/** Mutate only latent settings; preserve opaque attributes, comments and siblings. */
export function editLatentStyles(xml: DocumentXmlEditor, operation: string, options: Readonly<Record<string, unknown>>): string | null {
  readLatentStyles(xml.root);
  const existing = child(xml.root, "latentStyles");
  const fragment = existing ? xml : new DocumentXmlEditor(new TextEncoder().encode(`<st:latentStyles xmlns:st="${xml.root.namespace}"/>`));
  const node = existing ?? fragment.root;
  let markup: string;
  const attributes: Record<string, string | null> = {};
  const mapping = operation === "styles.latent.defaults.set" ? defaults : overrides;
  for (const [key, tag] of Object.entries(mapping)) {
    const value = options[key];
    if (value !== undefined) attributes[tag] = value === null ? null : typeof value === "boolean" ? String(Number(value)) : String(value);
  }
  if (operation === "styles.latent.defaults.set") {
    if (Object.entries(attributes).every(([key, value]) => value === null ? attr(node, key) === undefined : attr(node, key) === value)) return null;
    markup = mergeStyleChildren(fragment, node, new Map(), [], attributes);
  } else {
    const name = options.name as string;
    const entries = node.children.filter(n => n.namespace === node.namespace && n.localName === "lsdException" && styleStoredName(attr(n, "name") ?? "") === styleStoredName(name));
    if (entries.length > 1) throw new SelectionError("ambiguous-selection");
    if (operation === "styles.latent.add") {
      if (entries.length) throw new SelectionError("ambiguous-selection");
      const inner = `<st:lsdException xmlns:st="${node.namespace}" st:name="${xmlValue(styleStoredName(name))}"${Object.entries(attributes).filter(([,value]) => value !== null).map(([key,value]) => ` st:${key}="${xmlValue(value!)}"`).join("")}/>`;
      if (existing) { xml.insertChildren(existing, inner); return name; }
      markup = runElementOpen(node) + fragment.sourceXml(node, new Map(), true) + inner + `</${node.name}>`;
    } else {
      const entry = entries[0];
      if (!entry) throw new SelectionError("missing-selection");
      if (operation !== "styles.latent.remove" && Object.entries(attributes).every(([key, value]) => value === null ? attr(entry, key) === undefined : attr(entry, key) === value)) return null;
      markup = fragment.sourceXml(node, new Map([[entry, operation === "styles.latent.remove" ? "" : mergeStyleChildren(fragment, entry, new Map(), [], attributes)]]));
    }
  }
  if (existing) xml.replaceElement(existing, markup);
  else xml.insertChildren(xml.root, markup, xml.root.children.find(n => n.namespace === xml.root.namespace && n.localName === "style"));
  return operation === "styles.latent.defaults.set" ? "latentStyles" : options.name as string;
}
