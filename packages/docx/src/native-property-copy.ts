import type { DocumentBudget } from "./budget.js";
import { MarkupCompatibility, compatibilityContainers, type CompatibilityProfile, type CompatibilityContent } from "./compatibility.js";
import { xmlValue } from "./create-content.js";
import type { XmlElement } from "./package-xml.js";
import { DocumentXmlEditor } from "./xml-write.js";
import { runElementOpen } from "./run-properties.js";

/** Additional split owners copy active properties; inert data stays with the original owner. */
export function copiedNativeProperties(markup: string, property: XmlElement, root: XmlElement, profile: CompatibilityProfile, budget: DocumentBudget): string {
  if (!markup) return "";
  const chain: XmlElement[] = [];
  const find = (node: XmlElement): boolean => {
    budget.charge("work", 1); chain.push(node);
    if (node === property || node.children.some(find)) return true;
    chain.pop(); return false;
  };
  if (!find(root)) throw new TypeError("Native properties have no original owner.");
  let source = markup;
  const childIndexes: number[] = [];
  for (let i = chain.length - 2; i >= 0; i--) {
    const node = chain[i]!, next = chain[i + 1]!;
    const siblings = node.namespace === "http://schemas.openxmlformats.org/markup-compatibility/2006" && node.localName === "AlternateContent"
      ? node.children.filter(child => child.namespace === node.namespace && ["Choice", "Fallback"].includes(child.localName)) : [next];
    childIndexes.unshift(siblings.indexOf(next));
    source = runElementOpen(node) + siblings.map(child => child === next ? source : runElementOpen(child) + `</${child.name}>`).join("") + `</${node.name}>`;
  }
  const editor = new DocumentXmlEditor(new TextEncoder().encode(source), {}, profile, budget), parsed = editor.root;
  const view = new MarkupCompatibility(parsed, profile, budget), active = new Set<XmlElement>(), containers = new Set(view[compatibilityContainers]);
  const collect = (content: readonly CompatibilityContent[]): void => {
    for (const item of content) if ("source" in item && item.disposition === "understood") { active.add(item.source); collect(item.content); }
  };
  collect(view.content);
  let parent = parsed; for (const index of childIndexes) parent = parent.children[index]!;
  const render = (node: XmlElement): string => {
    budget.charge("work", 1 + node.content.length);
    const branch = node.namespace === "http://schemas.openxmlformats.org/markup-compatibility/2006" && ["Choice", "Fallback"].includes(node.localName);
    if (!active.has(node) && !containers.has(node)) {
      if (!branch) return "";
      const attributes = node.attributes.filter(attribute => ["http://www.w3.org/2000/xmlns/", "http://www.w3.org/XML/1998/namespace", "http://schemas.openxmlformats.org/markup-compatibility/2006"].includes(attribute.namespace) || attribute.namespace === "" && node.localName === "Choice" && attribute.localName === "Requires");
      return runElementOpen({ ...node, attributes }) + `</${node.name}>`;
    }
    const attributes = node.attributes.filter(attribute => ["http://www.w3.org/2000/xmlns/", "http://www.w3.org/XML/1998/namespace", "http://schemas.openxmlformats.org/markup-compatibility/2006"].includes(attribute.namespace) || view.canEdit(attribute) || branch && attribute.namespace === "" && node.localName === "Choice" && attribute.localName === "Requires");
    const replacements = new Map(node.children.map(child => [child, render(child)]));
    if (attributes.length === node.attributes.length && node.content.every(item => ["element", "text", "cdata"].includes(item.kind))) return editor.sourceXml(node, replacements);
    return runElementOpen({ ...node, attributes }) + node.content.map(item => item.kind === "element" ? replacements.get(item) : item.kind === "text" || item.kind === "cdata" ? xmlValue(item.text) : "").join("") + `</${node.name}>`;
  };
  const result = render(parent); budget.charge("retainedBytes", result.length * 2); return result;
}
