import { MarkupCompatibility, documentCompatibilityProfile, type CompatibilityContent } from "./compatibility.js";
import type { ModelStore } from "./model-store.js";
import type { XmlElement } from "./package-xml.js";

const projections = new WeakMap<ModelStore, WeakMap<XmlElement, (node: XmlElement) => readonly XmlElement[]>>();

/** Projects only selected compatibility content without changing stored markup. */
export function activeModelChildren(store: ModelStore, part: string): (node: XmlElement) => readonly XmlElement[] {
  const root = store.xml(part).root;
  let versions = projections.get(store);
  const existing = versions?.get(root);
  if (existing) return existing;
  const children = new Map<XmlElement, readonly XmlElement[]>();
  const content: readonly CompatibilityContent[] = new MarkupCompatibility(root, documentCompatibilityProfile, store.context.budget).content;
  const pending = [{ content, index: 0 }];
  while (pending.length) {
    const frame = pending.at(-1)!;
    if (frame.index >= frame.content.length) { pending.pop(); continue; }
    const item = frame.content[frame.index++]!;
    if (!("source" in item)) continue;
    store.context.budget.charge("retainedBytes", 96 + item.content.length * 8);
    children.set(item.source, item.content.filter((child) => "source" in child).map((child) => child.source));
    pending.push({ content: item.content, index: 0 });
  }
  const lookup = (node: XmlElement): readonly XmlElement[] => {
    store.context.budget.charge("work", 1);
    return children.get(node) ?? [];
  };
  if (!versions) {
    versions = new WeakMap();
    projections.set(store, versions);
  }
  versions.set(root, lookup);
  return lookup;
}
