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
    && ["pPr", "rPr", "sectPr", "tabs"].includes(node.localName);
  interface Frame {
    node: XmlElement;
    inherited: ReadonlyMap<string, readonly string[]>;
    propertyContext: boolean;
    context?: ReadonlyMap<string, readonly string[]>;
    namedProperties?: boolean;
    ordinals: Map<string, number>;
    contentIndex: number;
    index: number;
  }
  const path: (number | string)[] = [];
  budget.charge("retainedBytes", 128);
  const pending: Frame[] = [{ node: root, inherited: new Map(), propertyContext: false, ordinals: new Map(), contentIndex: 0, index: -1 }];
  while (pending.length) {
    const frame = pending.at(-1)!;
    const node = frame.node;
    if (frame.index === -1) {
      const inherited = frame.inherited;
      budget.charge("work", 1 + node.attributes.length + inherited.size);
      budget.charge("retainedBytes", (inherited.size + 1) * 48);
      const context = new Map(inherited);
      for (const attribute of node.attributes) {
        if (attribute.namespace !== "http://www.w3.org/XML/1998/namespace" || !["lang", "space", "base"].includes(attribute.localName)) continue;
        budget.charge("retainedBytes", attribute.localName === "base" ? ((context.get("base")?.length ?? 0) + 1) * 8 : 8);
        context.set(attribute.localName, attribute.localName === "base" ? [...context.get("base") ?? [], attribute.value] : [attribute.value]);
      }
      frame.context = context;
      // Property fields occupy named slots; transparent MCE carriers keep that context.
      const namedStyleFields = (node.namespace === documentDialects.strict.w || node.namespace === documentDialects.transitional.w) && node.localName === "style";
      frame.namedProperties = nativeProperties(node) || namedStyleFields || containers.has(node) && frame.propertyContext;
      const retainPath = () => { budget.charge("retainedBytes", path.length * 8); return path.slice(); };
      if (containers.has(node)) {
        records.push([retainPath(), node.namespace, node.localName, [...node.namespaces], [...context], node.attributes, node.content.filter(item => item.kind !== "element")]);
      } else if (!view.canEdit(node)) {
        // Encoding declarations describe the byte stream; retain prolog and epilog content.
        const {declaration: ignoredDeclaration, ...content} = node;
        budget.charge("retainedBytes", 192);
        records.push([retainPath(), [...node.namespaces], [...context], displayXml(content, budget, false)]);
        pending.pop(); path.pop(); continue;
      } else {
        const attributes = node.attributes.filter(attribute => attribute.namespace !== "http://www.w3.org/2000/xmlns/" && !view.canEdit(attribute));
        if (attributes.length) records.push([retainPath(), [...node.namespaces], [...context], attributes]);
      }
      frame.index = 0;
    }
    const child = node.children[frame.index++];
    if (!child) { pending.pop(); path.pop(); continue; }
    let slot: number | string;
    if (frame.namedProperties || nativeProperties(child)) {
      const name = JSON.stringify([child.namespace, child.localName]);
      const ordinal = frame.ordinals.get(name) ?? 0;
      frame.ordinals.set(name, ordinal + 1);
      budget.charge("work", name.length);
      budget.charge("retainedBytes", name.length * 4 + 48);
      slot = name + ":" + ordinal;
    } else slot = frame.contentIndex++;
    budget.charge("retainedBytes", 136);
    path.push(slot);
    pending.push({ node: child, inherited: frame.context!, propertyContext: frame.namedProperties!, ordinals: new Map(), contentIndex: 0, index: -1 });
  }
  return JSON.stringify(records);
}
