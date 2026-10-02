import { documentTypes } from "./admission.js";
import type { DocumentBudget } from "./budget.js";
import { parseMediaType } from "./media-type.js";
import type { DocumentPackage } from "./package.js";
import type { XmlElement } from "./package-xml.js";

/** Exact native Word declarations establish comment domains; inert XML does not. */
export function commentStoryParts(
  graph: DocumentPackage,
  main: string,
  comments: string | undefined,
  word: string,
  relationships: string,
  root: (part: string) => XmlElement,
  budget: DocumentBudget
): ReadonlySet<string> {
  const roles = ["header", "footer", "footnotes", "endnotes", "comments", "glossaryDocument"];
  const contentType = (role: string) =>
    `application/vnd.openxmlformats-officedocument.wordprocessingml.${role === "glossaryDocument" ? "document.glossary" : role}+xml`;
  const rootName = (role: string) => role === "header" ? "hdr" : role === "footer" ? "ftr" : role;
  const nativeRoots = new Map([
    ...Object.values(documentTypes).map(type => [type, "document"] as const),
    ...roles.map(role => [contentType(role), rootName(role)] as const)
  ]);
  const parts = new Set<string>();
  for (const owner of graph.parts) {
    budget.charge("work", 1);
    const expected = nativeRoots.get(parseMediaType(owner.content_type));
    if (expected === undefined) continue;
    const xml = root(owner.partname);
    if (xml.namespace !== word || xml.localName !== expected) continue;
    const edges = graph.relationships(owner.partname);
    if (owner.partname !== main && (comments === undefined || !edges.some(edge =>
      !edge.is_external && edge.reltype === relationships + "/comments" && edge.target_part.partname === comments))) continue;
    budget.charge("retainedBytes", 24);
    parts.add(owner.partname);
    for (const edge of edges) {
      budget.charge("work", 1);
      if (edge.is_external) continue;
      const role = roles.find(role => edge.reltype === relationships + "/" + role);
      if (role === undefined || parseMediaType(edge.target_part.content_type) !== contentType(role)) continue;
      const target = root(edge.target_part.partname);
      if (target.namespace !== word || target.localName !== rootName(role)) continue;
      budget.charge("retainedBytes", 24);
      parts.add(edge.target_part.partname);
    }
  }
  return parts;
}
