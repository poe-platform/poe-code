import type { DocumentBudget } from "./budget.js";
import type { CompatibilityContent } from "./compatibility.js";
import type { XmlElement } from "./package-xml.js";
import type { DocumentXmlEditor } from "./xml-write.js";

const projections = new WeakMap<DocumentXmlEditor, ReadonlyMap<XmlElement, readonly XmlElement[]>>();

/** Internal read projection retains physical nodes and their original compatibility scope. */
export function activeXmlChildren(xml: DocumentXmlEditor, budget: DocumentBudget): (node: XmlElement) => readonly XmlElement[] {
  let children = projections.get(xml);
  if (!children) {
    const projected = new Map<XmlElement, readonly XmlElement[]>();
    const collect = (content: readonly CompatibilityContent[]) => {
      for (const item of content) if ("source" in item) {
        budget.charge("retainedBytes", 96 + item.content.length * 8);
        projected.set(item.source, item.content.filter(node => "source" in node).map(node => node.source));
        collect(item.content);
      }
    };
    collect(xml.compatibility.content);
    children = projected;
    projections.set(xml, children);
  }
  return node => { budget.charge("work", 1); return children.get(node) ?? []; };
}
