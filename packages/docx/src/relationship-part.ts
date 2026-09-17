import type { DocumentBudget } from "./budget.js";
import type { DocumentPackage, PackagePart } from "./package.js";
import { asciiKey, resolvePartTarget } from "./part-uri.js";
import { InvalidPackageError, parseDocumentXml } from "./package-xml.js";
import { relationshipAttribute, relationshipXmlRows } from "./relationship-xml.js";
import { relationshipNamespace } from "./compatibility.js";

/** Resolve the existing relationship member independently of its physical spelling. */
export function findRelationshipPart(graph: DocumentPackage, owner: string, budget: DocumentBudget): PackagePart | undefined {
  const name = owner === "/" ? "/" : graph.getPart(owner).partname;
  const split = name.lastIndexOf("/");
  const key = asciiKey(name === "/" ? "/_rels/.rels" : name.slice(0, split + 1) + "_rels/" + name.slice(split + 1) + ".rels");
  budget.charge("work", key.length);
  for (const part of graph.parts) {
    budget.charge("work", 1 + part.partname.length);
    if (asciiKey(part.partname) === key) return part;
  }
  return undefined;
}

/** Known internal targets in physical storage still own their payloads when inactive. */
export function retainedRelationshipTargets(graph: DocumentPackage, budget: DocumentBudget, excluded: readonly {owner: string; id: string}[] = []): ReadonlySet<string> {
  const targets = new Set<string>();
  for (const owner of ["/", ...graph.parts.filter(part => part.content_type.toLowerCase() !== "application/vnd.openxmlformats-package.relationships+xml").map(part => part.partname)]) {
    const part = findRelationshipPart(graph, owner, budget);
    if (!part) continue;
    const root = parseDocumentXml(part.bytes, {}, budget).root;
    const ids = new Set(excluded.filter(edge => asciiKey(owner) === asciiKey(edge.owner)).map(edge => edge.id));
    budget.charge("work", excluded.length);
    const omitted = new Set(ids.size ? relationshipXmlRows(root, budget).filter(row => ids.has(row.rId)).map(row => row.element) : []);
    const pending = [root];
    while (pending.length) {
      const node = pending.pop()!;
      budget.charge("work", 1 + node.children.length + node.attributes.reduce((sum, attribute) => sum + attribute.value.length, 0));
      pending.push(...node.children);
      if (omitted.has(node) || node.namespace !== relationshipNamespace || node.localName !== "Relationship") continue;
      const target = relationshipAttribute(node, "Target"), mode = relationshipAttribute(node, "TargetMode");
      if (target === undefined || mode !== undefined && mode !== "Internal") continue;
      let name: string;
      try { name = asciiKey(resolvePartTarget(owner, target).partname); }
      catch (error) { if (error instanceof InvalidPackageError) continue; throw error; }
      if (!targets.has(name)) { budget.charge("retainedBytes", 32 + name.length * 2); targets.add(name); }
    }
  }
  return targets;
}
