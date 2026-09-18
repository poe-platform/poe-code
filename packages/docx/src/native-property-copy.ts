import type { DocumentBudget } from "./budget.js";
import { MarkupCompatibility, compatibilityContainers, type CompatibilityProfile, type CompatibilityContent } from "./compatibility.js";
import { xmlValue } from "./create-content.js";
import { parseDocumentXml, type XmlElement } from "./package-xml.js";
import { runElementOpen } from "./run-properties.js";

/** Additional split owners copy active properties; inert data stays with the original owner. */
export function copiedNativeProperties(markup: string, owner: XmlElement, root: XmlElement, profile: CompatibilityProfile, budget: DocumentBudget): string {
  if (!markup) return "";
  const chain: XmlElement[] = [];
  const find = (node: XmlElement): boolean => {
    budget.charge("work", 1); chain.push(node);
    if (node === owner || node.children.some(find)) return true;
    chain.pop(); return false;
  };
  if (!find(root)) throw new TypeError("Native properties have no original owner.");
  const source = chain.map(node => runElementOpen(node)).join("") + markup + chain.slice().reverse().map(node => `</${node.name}>`).join("");
  const parsed = parseDocumentXml(new TextEncoder().encode(source), {}, budget).root;
  const view = new MarkupCompatibility(parsed, profile, budget), active = new Set<XmlElement>(), containers = new Set(view[compatibilityContainers]);
  const collect = (content: readonly CompatibilityContent[]): void => {
    for (const item of content) if ("source" in item && item.disposition === "understood") { active.add(item.source); collect(item.content); }
  };
  collect(view.content);
  let parent = parsed; for (let i = 1; i < chain.length; i++) parent = parent.children[0]!;
  const render = (node: XmlElement): string => {
    budget.charge("work", 1 + node.content.length);
    const branch = node.namespace === "http://schemas.openxmlformats.org/markup-compatibility/2006" && ["Choice", "Fallback"].includes(node.localName);
    if (!active.has(node) && !containers.has(node)) {
      if (!branch) return "";
      const attributes = node.attributes.filter(attribute => ["http://www.w3.org/2000/xmlns/", "http://www.w3.org/XML/1998/namespace", "http://schemas.openxmlformats.org/markup-compatibility/2006"].includes(attribute.namespace) || attribute.namespace === "" && node.localName === "Choice" && attribute.localName === "Requires");
      return runElementOpen({ ...node, attributes }) + `</${node.name}>`;
    }
    const attributes = node.attributes.filter(attribute => ["http://www.w3.org/2000/xmlns/", "http://www.w3.org/XML/1998/namespace", "http://schemas.openxmlformats.org/markup-compatibility/2006"].includes(attribute.namespace) || view.canEdit(attribute) || branch && attribute.namespace === "" && node.localName === "Choice" && attribute.localName === "Requires");
    return runElementOpen({ ...node, attributes }) + node.content.map(item => item.kind === "element" ? render(item) : item.kind === "text" || item.kind === "cdata" ? xmlValue(item.text) : "").join("") + `</${node.name}>`;
  };
  const result = parent.children.map(render).join(""); budget.charge("retainedBytes", result.length * 2); return result;
}
