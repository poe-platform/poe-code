import type { DocumentBudget } from "./budget.js";
import type { DocumentPackage, PackagePart } from "./package.js";
import { asciiKey } from "./part-uri.js";

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
