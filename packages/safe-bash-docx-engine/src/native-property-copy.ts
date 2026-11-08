import type { DocumentBudget } from "./budget.js";
import { MarkupCompatibility, compatibilityContainers, type CompatibilityProfile, type CompatibilityContent } from "./compatibility.js";
import { xmlValue } from "./create-content.js";
import type { XmlElement } from "./package-xml.js";
import { DocumentXmlEditor, nativeElementSourceTokens } from "./xml-write.js";
import { runElementOpen } from "./run-properties.js";

/** Additional split owners copy active properties; inert data stays with the original owner. */
export function copiedNativeProperties(markup: string, property: XmlElement, root: XmlElement, profile: CompatibilityProfile, budget: DocumentBudget, moveSection = false): string {
  if (!markup) return "";
  const chain: XmlElement[] = [];
  budget.charge("retainedBytes", 48);
  const ancestry = [{ node: root, index: -1 }];
  let found = false;
  while (ancestry.length) {
    const frame = ancestry.at(-1)!;
    if (frame.index === -1) {
      budget.charge("work", 1); chain.push(frame.node);
      if (frame.node === property) { found = true; break; }
      frame.index = 0;
    }
    const child = frame.node.children[frame.index++];
    if (!child) { ancestry.pop(); chain.pop(); continue; }
    budget.charge("retainedBytes", 48); ancestry.push({ node: child, index: -1 });
  }
  if (!found) throw new TypeError("Native properties have no original owner.");
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
  const chunks: string[] = [];
  const pending: { node: XmlElement; index: number; closing: string }[] = [];
  const enter = (node: XmlElement): void => {
    budget.charge("work", 1 + node.content.length);
    // A section is transferred to the suffix, retaining its complete stored subtree.
    if (moveSection && node.namespace === property.namespace && node.localName === "sectPr") { chunks.push(editor.sourceXml(node)); return; }
    const branch = node.namespace === "http://schemas.openxmlformats.org/markup-compatibility/2006" && ["Choice", "Fallback"].includes(node.localName);
    if (!active.has(node) && !containers.has(node)) {
      if (!branch) return;
      const attributes = node.attributes.filter(attribute => ["http://www.w3.org/2000/xmlns/", "http://www.w3.org/XML/1998/namespace", "http://schemas.openxmlformats.org/markup-compatibility/2006"].includes(attribute.namespace) || attribute.namespace === "" && node.localName === "Choice" && attribute.localName === "Requires");
      chunks.push(runElementOpen({ ...node, attributes }) + `</${node.name}>`); return;
    }
    const attributes = node.attributes.filter(attribute => ["http://www.w3.org/2000/xmlns/", "http://www.w3.org/XML/1998/namespace", "http://schemas.openxmlformats.org/markup-compatibility/2006"].includes(attribute.namespace) || view.canEdit(attribute) || branch && attribute.namespace === "" && node.localName === "Choice" && attribute.localName === "Requires");
    const retainedTokens = attributes.length === node.attributes.length && node.content.every(item => ["element", "text", "cdata"].includes(item.kind));
    const [opening, closing] = retainedTokens ? editor[nativeElementSourceTokens](node) : [runElementOpen({ ...node, attributes }), `</${node.name}>`];
    budget.charge("retainedBytes", 64 + (retainedTokens ? 0 : (opening.length + closing.length) * 2));
    chunks.push(opening); pending.push({ node, index: 0, closing });
  };
  enter(parent);
  while (pending.length) {
    const frame = pending.at(-1)!, item = frame.node.content[frame.index++];
    budget.charge("work", 1);
    if (!item) { chunks.push(frame.closing); pending.pop(); continue; }
    if (item.kind === "element") enter(item);
    else if (item.kind === "text" || item.kind === "cdata") {
      budget.charge("work", item.text.length);
      budget.charge("retainedBytes", item.text.length * 12 + 8);
      chunks.push(xmlValue(item.text));
    }
  }
  const result = chunks.join(""); budget.charge("retainedBytes", result.length * 2); return result;
}
