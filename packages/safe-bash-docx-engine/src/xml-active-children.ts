import { documentXmlCache, type DocumentBudget } from "./budget.js";
import { MarkupCompatibility, type CompatibilityContent } from "./compatibility.js";
import type { XmlElement } from "./package-xml.js";
import type { DocumentXmlEditor } from "./xml-write.js";

const projections = new WeakMap<DocumentXmlEditor | XmlElement, ReadonlyMap<XmlElement, readonly XmlElement[]>>();
const immutableProjections = new WeakMap<readonly CompatibilityContent[], ReadonlyMap<XmlElement, readonly XmlElement[]>>();

/** Internal read projection retains physical nodes and their original compatibility scope. */
export function activeXmlChildren(xml: DocumentXmlEditor | XmlElement, budget: DocumentBudget): (node: XmlElement) => readonly XmlElement[] {
  let children = projections.get(xml);
  if (!children) {
    const content: readonly CompatibilityContent[] = "kind" in xml ? new MarkupCompatibility(xml, undefined, budget).content : xml.compatibility.content;
    const root = "kind" in xml ? xml : xml.root;
    const cache = budget[documentXmlCache], profiles = cache.compatibility?.get(root);
    let immutable = false;
    if (cache.immutableRoots?.has(root) && profiles)
      for (const profile of profiles.values()) if (profile.content === content) { immutable = true; break; }
    const shared = immutable ? immutableProjections.get(content) : undefined;
    const constructed = shared ? undefined : new Map<XmlElement, readonly XmlElement[]>();
    const pending = [{ content, index: 0 }];
    while (pending.length) {
      const frame = pending.at(-1)!;
      if (frame.index >= frame.content.length) { pending.pop(); continue; }
      const item = frame.content[frame.index++]!;
      if (!("source" in item)) continue;
      // A fresh editor reserves the complete projection even when its admitted
      // immutable compatibility view already owns the same frozen child arrays.
      budget.charge("retainedBytes", 96 + item.content.length * 8);
      constructed?.set(item.source,
        Object.freeze(item.content.filter(node => "source" in node).map(node => node.source)));
      pending.push({ content: item.content, index: 0 });
    }
    children = shared ?? constructed!;
    if (immutable && !shared) immutableProjections.set(content, children);
    projections.set(xml, children);
  }
  return node => { budget.charge("work", 1); return children.get(node) ?? []; };
}
