import type { DocumentBudget } from "./budget.js";
import { customXmlDataNamespaces, customXmlRelationshipNamespaces } from "./custom-xml-namespaces.js";
import { documentPartRole } from "./document-part-roles.js";
import type { DocumentPackage } from "./package.js";
import { isXmlContentType, parseDocumentXml, type XmlElement } from "./package-xml.js";
import { activeXmlChildren } from "./xml-active-children.js";

export interface BindingDeclaration { readonly part: string; readonly path: readonly number[]; readonly controlPath: readonly number[]; readonly storeItemId: string | null; readonly xpath: string | null; readonly prefixMappings: string | null; readonly supportedStory: boolean }
export interface BindingStore { readonly item: string; readonly properties: string; readonly storeItemId: string | null }
export function readDocumentBindingOwnership(graph: DocumentPackage, budget: DocumentBudget): { readonly declarations: readonly BindingDeclaration[]; readonly stores: readonly BindingStore[] } {
  budget.charge("work", 1); const declarations: BindingDeclaration[] = [], stores: BindingStore[] = [], roots = new Map<string, XmlElement>();
  for (const part of graph.parts) {
    budget.charge("work", 1); const type = part.content_type.toLowerCase(); if (type === "application/vnd.openxmlformats-package.relationships+xml" || !isXmlContentType(type)) continue;
    const root = parseDocumentXml(part.bytes, {}, budget).root; roots.set(part.partname, root);
    const role = documentPartRole(type, root); if (role !== "story" && role !== "glossary" && role !== "settings") continue;
    const active = activeXmlChildren(root, budget);
    const logicalParents = new Map<XmlElement, XmlElement>(), physicalParents = new Map<XmlElement, XmlElement>();
    const paths = new Map<XmlElement, readonly number[]>(), pending = [{ node: root, path: [] as readonly number[] }];
    budget.charge("retainedBytes", 64);
    while (pending.length) {
      const { node, path } = pending.pop()!;
      budget.charge("work", node.children.length + node.attributes.length + 1);
      budget.charge("retainedBytes", 64 + node.children.length * (128 + (path.length + 1) * 8));
      paths.set(node, path);
      for (const child of active(node)) logicalParents.set(child, node);
      for (const [index, child] of node.children.entries()) {
        physicalParents.set(child, node); pending.push({ node: child, path: [...path, index] });
      }
    }
    for (const [node, path] of paths) {
      if (node.namespace !== root.namespace || node.localName !== "dataBinding") continue;
      const owner = (parents: ReadonlyMap<XmlElement, XmlElement>) => {
        const parent = parents.get(node), grandparent = parent && parents.get(parent);
        return parent?.namespace === root.namespace && parent.localName === "sdtPr" && grandparent?.namespace === root.namespace && grandparent.localName === "sdt" ? grandparent : undefined;
      };
      // Retain the conservative census of physically declared inactive owners too.
      const control = owner(logicalParents) ?? owner(physicalParents);
      if (!control) continue;
      budget.charge("retainedBytes", 64 + path.length * 8);
      const attr = (name: string) => node.attributes.find(attribute => attribute.namespace === node.namespace && attribute.localName === name)?.value ?? null;
      declarations.push({ part: part.partname, path, controlPath: paths.get(control)!, storeItemId: attr("storeItemID"), xpath: attr("xpath"), prefixMappings: attr("prefixMappings"), supportedStory: role === "story" });
    }
  }
  for (const part of graph.parts.filter(part => part.content_type.toLowerCase() !== "application/vnd.openxmlformats-package.relationships+xml")) for (const edge of graph.relationships(part.partname)) {
    budget.charge("work", 1); if (!customXmlRelationshipNamespaces.some(namespace => edge.reltype === namespace + "customXmlProps") || edge.is_external) continue;
    const root = roots.get(edge.target_part.partname); if (!root || !customXmlDataNamespaces.includes(root.namespace) || root.localName !== "datastoreItem") continue;
    budget.charge("retainedBytes", 64); stores.push({ item: part.partname, properties: edge.target_part.partname, storeItemId: root.attributes.find(attribute => attribute.namespace === root.namespace && attribute.localName === "itemID")?.value ?? null });
  }
  return { declarations, stores };
}
