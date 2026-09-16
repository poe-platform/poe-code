import { MarkupCompatibility, documentCompatibilityProfile, type CompatibilityContent } from "./compatibility.js";
import type { ModelStore } from "./model-store.js";
import type { XmlElement } from "./package-xml.js";

/** Projects only selected compatibility content without changing stored markup. */
export function activeModelChildren(store: ModelStore, part: string): (node: XmlElement) => readonly XmlElement[] {
  const children = new Map<XmlElement, readonly XmlElement[]>();
  const collect = (items: readonly CompatibilityContent[]) => {
    for (const item of items) {
      if (!("source" in item)) continue;
      store.context.budget.charge("retainedBytes", 96 + item.content.length * 8);
      children.set(item.source, item.content.filter((child) => "source" in child).map((child) => child.source));
      collect(item.content);
    }
  };
  collect(new MarkupCompatibility(store.xml(part).root, documentCompatibilityProfile, store.context.budget).content);
  return (node) => {
    store.context.budget.charge("work", 1);
    return children.get(node) ?? [];
  };
}
