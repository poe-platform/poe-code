import type { DocumentBudget } from "./budget.js";
import { documentPartRole } from "./document-part-roles.js";
import type { DocumentPackage } from "./package.js";
import { parseDocumentXml, type XmlElement } from "./package-xml.js";

export interface BindingDeclaration { readonly part: string; readonly path: readonly number[]; readonly storeItemId: string | null; readonly xpath: string | null; readonly prefixMappings: string | null; readonly supportedStory: boolean }
export interface BindingStore { readonly item: string; readonly properties: string; readonly storeItemId: string | null }
const office = ["http://schemas.openxmlformats.org/officeDocument/2006/relationships/", "http://purl.oclc.org/ooxml/officeDocument/relationships/"];
const datastore = "http://schemas.openxmlformats.org/officeDocument/2006/customXml";
export function readDocumentBindingOwnership(graph: DocumentPackage, budget: DocumentBudget): { readonly declarations: readonly BindingDeclaration[]; readonly stores: readonly BindingStore[] } {
  budget.charge("work", 1); const declarations: BindingDeclaration[] = [], stores: BindingStore[] = [], roots = new Map<string, XmlElement>();
  for (const part of graph.parts) {
    budget.charge("work", 1); const type = part.content_type.toLowerCase(); if (type === "application/vnd.openxmlformats-package.relationships+xml" || !type.endsWith("+xml") && !["application/xml", "text/xml"].includes(type)) continue;
    const root = parseDocumentXml(part.bytes, {}, budget).root; roots.set(part.partname, root);
    const role = documentPartRole(type, root); if (role !== "story" && role !== "glossary" && role !== "settings") continue;
    const visit = (node: XmlElement, path: readonly number[], parent?: XmlElement, grandparent?: XmlElement): void => {
      budget.charge("work", node.children.length + node.attributes.length + 1);
      if (node.namespace === root.namespace && node.localName === "dataBinding" && parent?.namespace === root.namespace && parent.localName === "sdtPr" && grandparent?.namespace === root.namespace && grandparent.localName === "sdt") {
        budget.charge("retainedBytes", 64 + path.length * 8); const attr = (name: string) => node.attributes.find(attribute => attribute.namespace === node.namespace && attribute.localName === name)?.value ?? null;
        declarations.push({ part: part.partname, path, storeItemId: attr("storeItemID"), xpath: attr("xpath"), prefixMappings: attr("prefixMappings"), supportedStory: role === "story" });
      }
      for (let index = 0; index < node.children.length; index++) { budget.charge("retainedBytes", (path.length + 1) * 8); visit(node.children[index]!, [...path, index], node, parent); }
    }; visit(root, []);
  }
  for (const part of graph.parts.filter(part => part.content_type.toLowerCase() !== "application/vnd.openxmlformats-package.relationships+xml")) for (const edge of graph.relationships(part.partname)) {
    budget.charge("work", 1); if (!office.some(namespace => edge.reltype === namespace + "customXmlProps") || edge.is_external) continue;
    const root = roots.get(edge.target_part.partname); if (!root || root.namespace !== datastore || root.localName !== "datastoreItem") continue;
    budget.charge("retainedBytes", 64); stores.push({ item: part.partname, properties: edge.target_part.partname, storeItemId: root.attributes.find(attribute => attribute.namespace === datastore && attribute.localName === "itemID")?.value ?? null });
  }
  return { declarations, stores };
}
