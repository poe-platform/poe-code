import type { XmlElement } from "./package-xml.js";
import type { DocumentBudget } from "./budget.js";
import { MarkupCompatibility, compatibilityContainers, type CompatibilityProfile } from "./compatibility.js";
import { displayXml } from "./xml-display.js";
import { documentDialects } from "./dialect.js";

/** Fingerprint protected XML with its physical carrier and inherited context. */
export function opaqueXmlContent(root: XmlElement, budget: DocumentBudget, profile: CompatibilityProfile): string {
  const view = new MarkupCompatibility(root, profile, budget);
  const containers = new Set(view[compatibilityContainers]);
  const records: unknown[] = [];
  const nativeProperties = (node: XmlElement) =>
    (node.namespace === documentDialects.strict.w || node.namespace === documentDialects.transitional.w)
    && ["pPr", "rPr", "sectPr"].includes(node.localName);
  const visit = (node: XmlElement, path: (number | string)[], inherited: ReadonlyMap<string, readonly string[]>, propertyContext = false) => {
    budget.charge("work", 1 + node.attributes.length + inherited.size);
    budget.charge("retainedBytes", (inherited.size + 1) * 48);
    const context = new Map(inherited);
    for (const attribute of node.attributes) {
      if (attribute.namespace !== "http://www.w3.org/XML/1998/namespace" || !["lang", "space", "base"].includes(attribute.localName)) continue;
      budget.charge("retainedBytes", attribute.localName === "base" ? ((context.get("base")?.length ?? 0) + 1) * 8 : 8);
      context.set(attribute.localName, attribute.localName === "base" ? [...context.get("base") ?? [], attribute.value] : [attribute.value]);
    }
    // Native properties are named fields. Inserting/removing another field
    // does not move retained extension data to a different semantic owner.
    // Transparent active MCE carriers keep their enclosing property context.
    // Property containers also occupy named slots outside the content sequence.
    const namedStyleFields = (node.namespace === documentDialects.strict.w || node.namespace === documentDialects.transitional.w) && node.localName === "style";
    const namedProperties = nativeProperties(node) || namedStyleFields || containers.has(node) && propertyContext;
    const visitChildren = () => {
      const ordinals = new Map<string, number>();
      let contentIndex = 0;
      node.children.forEach(child => {
        let slot: number | string;
        if (namedProperties || nativeProperties(child)) {
          const name = JSON.stringify([child.namespace, child.localName]);
          const ordinal = ordinals.get(name) ?? 0;
          ordinals.set(name, ordinal + 1);
          budget.charge("work", name.length);
          budget.charge("retainedBytes", name.length * 4 + 48);
          slot = name + ":" + ordinal;
        } else slot = contentIndex++;
        visit(child, [...path, slot], context, namedProperties);
      });
    };
    if (containers.has(node)) {
      records.push([path, node.namespace, node.localName, [...node.namespaces], [...context], node.attributes, node.content.filter(item => item.kind !== "element")]);
      visitChildren();
      return;
    }
    if (!view.canEdit(node)) {
      // Validated XML 1.0 encoding declarations describe the byte stream, not
      // the opaque subtree. Keep prolog/epilog content in the comparison.
      const {declaration: ignoredDeclaration, ...content} = node;
      budget.charge("retainedBytes", 192);
      records.push([path, [...node.namespaces], [...context], displayXml(content, budget, false)]);
      return;
    }
    const attributes = node.attributes.filter(attribute => attribute.namespace !== "http://www.w3.org/2000/xmlns/" && !view.canEdit(attribute));
    if (attributes.length) records.push([path, [...node.namespaces], [...context], attributes]);
    visitChildren();
  };
  visit(root, [], new Map());
  return JSON.stringify(records);
}
