import type { DocumentBudget } from "./budget.js";
import { MarkupCompatibility, type CompatibilityContent } from "./compatibility.js";
import type { XmlElement } from "./package-xml.js";
import type { DocumentXmlEditor } from "./xml-write.js";

const projections = new WeakMap<DocumentXmlEditor | XmlElement, ReadonlyMap<XmlElement, readonly XmlElement[]>>();

/** Internal read projection retains physical nodes and their original compatibility scope. */
export function activeXmlChildren(xml: DocumentXmlEditor | XmlElement, budget: DocumentBudget): (node: XmlElement) => readonly XmlElement[] {
  let children = projections.get(xml);
  if (!children) {
    const projected = new Map<XmlElement, readonly XmlElement[]>();
    const content: readonly CompatibilityContent[] = "kind" in xml ? new MarkupCompatibility(xml, undefined, budget).content : xml.compatibility.content;
    const pending = [{ content, index: 0 }];
    while (pending.length) {
      const frame = pending.at(-1)!;
      if (frame.index >= frame.content.length) { pending.pop(); continue; }
      const item = frame.content[frame.index++]!;
      if (!("source" in item)) continue;
      budget.charge("retainedBytes", 96 + item.content.length * 8);
      projected.set(item.source, item.content.filter(node => "source" in node).map(node => node.source));
      pending.push({ content: item.content, index: 0 });
    }
    children = projected;
    projections.set(xml, children);
  }
  return node => { budget.charge("work", 1); return children.get(node) ?? []; };
}
