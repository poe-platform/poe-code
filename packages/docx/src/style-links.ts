import { InvalidValueError } from "./archive.js";
import { type DocumentBudget } from "./budget.js";
import { SelectionError } from "./location-token.js";
import type { DocxOperationArguments } from "./operation-types.js";
import type { XmlElement } from "./package-xml.js";
import { selectNamedStyles } from "./style-names.js";
import { styleAttribute as attr, styleChild as child } from "./style-properties.js";
import { UnsupportedEditError } from "./xml-write.js";

export interface StyleLinkPatch { link?: string | null; default?: string | null }

/** Plan one reciprocal rebind and a type-scoped default change before mutating XML. */
export function styleLinkPatches(nodes: readonly XmlElement[], selected: XmlElement, options: DocxOperationArguments<"styles.links.set">, children: (node: XmlElement) => readonly XmlElement[], budget: DocumentBudget): Map<XmlElement, StyleLinkPatch> {
  const patches = new Map<XmlElement, StyleLinkPatch>();
  if (options.linkedStyle === undefined && options.defaultForType === undefined) return patches;
  const ids = new Map<string, XmlElement>();
  for (const node of nodes) {
    budget.charge("work", 1);
    const id = attr(node, "styleId");
    if (!id || ids.has(id)) throw new UnsupportedEditError("Style links require unique nonempty style IDs.");
    ids.set(id, node);
  }
  const type = attr(selected, "type") ?? "paragraph";
  const update = (node: XmlElement, key: keyof StyleLinkPatch, value: string | null) => {
    const current = patches.get(node) ?? {};
    const old = key === "link" ? attr(child(node, "link", children), "val") : attr(node, "default");
    if (value === null ? old === undefined : old === value) delete current[key];
    else current[key] = value;
    patches.set(node, current);
  };
  const link = (node: XmlElement) => {
    const matches = children(node).filter(c => c.namespace === node.namespace && c.localName === "link");
    if (matches.length > 1) throw new UnsupportedEditError("Duplicate style links cannot be edited.");
    return attr(matches[0], "val");
  };
  if (options.linkedStyle !== undefined) {
    const matches = options.linkedStyle === null ? [] : selectNamedStyles(nodes, options.linkedStyle, children, budget);
    if (options.linkedStyle !== null && matches.length !== 1) throw new SelectionError(matches.length ? "ambiguous-selection" : "missing-selection");
    const target = matches[0], targetType = target && (attr(target, "type") ?? "paragraph");
    if (target && !(type === "paragraph" && targetType === "character" || type === "character" && targetType === "paragraph")) throw new InvalidValueError("Linked styles require paragraph and character types.");
    const unlink = (node: XmlElement) => {
      const old = ids.get(link(node) ?? "");
      if (old && link(old) === attr(node, "styleId")) update(old, "link", null);
    };
    unlink(selected); if (target) unlink(target);
    update(selected, "link", target ? attr(target, "styleId")! : null);
    if (target) update(target, "link", attr(selected, "styleId")!);
  }
  if (options.defaultForType !== undefined) {
    if (options.defaultForType !== ["1", "true", "on"].includes(attr(selected, "default") ?? "0")) update(selected, "default", options.defaultForType ? "1" : null);
    if (options.defaultForType) for (const node of nodes) if (node !== selected && (attr(node, "type") ?? "paragraph") === type && attr(node, "default") !== undefined) update(node, "default", null);
  }
  return patches;
}
