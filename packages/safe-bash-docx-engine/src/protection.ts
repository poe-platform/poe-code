import type { DocumentBudget } from "./budget.js";
import type { MarkupCompatibility, CompatibilityContent } from "./compatibility.js";
import type { XmlElement } from "./package-xml.js";

/** Settings declarations belong to the active root after compatibility processing. */
export function activeSettingsProtection(root: XmlElement, view: MarkupCompatibility, budget: DocumentBudget): ReadonlySet<XmlElement> {
  const result = new Set<XmlElement>();
  for (const item of view.content) {
    budget.charge("work", 1);
    if (!("source" in item) || item.source !== root || item.disposition !== "understood") continue;
    for (const child of item.content) {
      budget.charge("work", 1);
      if ("source" in child && child.disposition === "understood" && child.source.namespace === root.namespace && ["documentProtection", "writeProtection"].includes(child.source.localName)) {
        budget.charge("retainedBytes", 16);
        result.add(child.source);
      }
    }
  }
  return result;
}

/** Lock ownership follows the projected SDT/property parents, not physical MCE wrappers. */
export function activeControlLocks(root: XmlElement, view: MarkupCompatibility, budget: DocumentBudget): ReadonlyMap<XmlElement, { readonly owner: XmlElement; readonly properties: XmlElement }> {
  const result = new Map<XmlElement, { owner: XmlElement; properties: XmlElement }>();
  const stack: { item: CompatibilityContent; parent: XmlElement | undefined; grandparent: XmlElement | undefined }[] = view.content.map(item => ({ item, parent: undefined, grandparent: undefined }));
  while (stack.length) {
    budget.charge("work", 1);
    const { item, parent, grandparent } = stack.pop()!;
    if (!("source" in item) || item.disposition !== "understood") continue;
    const node = item.source;
    if (node.namespace === root.namespace && node.localName === "lock" && parent?.namespace === root.namespace && parent.localName === "sdtPr" && grandparent?.namespace === root.namespace && grandparent.localName === "sdt") {
      budget.charge("retainedBytes", 64);
      result.set(node, { owner: grandparent, properties: parent });
    }
    budget.charge("retainedBytes", item.content.length * 24);
    for (const child of item.content) stack.push({ item: child, parent: node, grandparent: parent });
  }
  return result;
}
