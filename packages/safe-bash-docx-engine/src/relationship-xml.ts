import { DocumentBudget } from "./budget.js";
import { isXmlLocalName, MarkupCompatibility, relationshipNamespace, relationshipCompatibilityProfile, type CompatibilityElement } from "./compatibility.js";
import { InvalidPackageError, UnsupportedProfileError, type XmlElement } from "./package-xml.js";
import { isAbsoluteRelationshipType, isRelationshipTargetReference } from "./relationship-type.js";

export interface RelationshipXmlRow {
  readonly element: XmlElement;
  readonly rId: string;
  readonly reltype: string;
  readonly target_ref: string;
  readonly is_external: boolean;
}

/** XML Schema ID/anyURI values collapse XML whitespace; TargetMode is a string. */
export function relationshipAttribute(element: XmlElement, name: string): string | undefined {
  const value = element.attributes.find(attribute => !attribute.namespace && attribute.localName === name)?.value;
  if (value === undefined || name === "TargetMode") return value;
  return collapseRelationshipScalar(value);
}

export function collapseRelationshipScalar(value: string): string {
  let result = "", space = false;
  for (const char of value) {
    if (" \t\r\n".includes(char)) space = result.length > 0;
    else { if (space) result += " "; result += char; space = false; }
  }
  return result;
}

/** Allocators also reserve native IDs in retained, unselected storage. */
export function relationshipXmlIds(root: XmlElement, budget: DocumentBudget): Set<string> {
  budget.charge("retainedBytes", 8);
  const ids = new Set<string>(), pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    budget.charge("work", 1 + node.children.length + node.attributes.reduce((sum, attribute) => sum + attribute.value.length, 0));
    if (node.namespace === relationshipNamespace && node.localName === "Relationship") {
      const id = relationshipAttribute(node, "Id");
      if (id !== undefined && !ids.has(id)) { budget.charge("retainedBytes", 32 + id.length * 2); ids.add(id); }
    }
    if (node.children.length) budget.charge("retainedBytes", node.children.length * 8);
    for (const child of node.children) pending.push(child);
  }
  return ids;
}

/** Validate the native projected schema while retaining each physical declaration. */
export function relationshipXmlRows(root: XmlElement, budget = new DocumentBudget(), part?: string): readonly RelationshipXmlRow[] {
  const view = new MarkupCompatibility(root, relationshipCompatibilityProfile, budget);
  budget.charge("work", view.branches.length);
  if (view.branches.some(branch => branch.selected === undefined))
    throw new UnsupportedProfileError("Active alternate content has no eligible choice or fallback.");
  const invalid = (index: number): never => {
    throw new InvalidPackageError("Invalid relationship metadata.", part, index ? `/Relationship[${index}]` : "/Relationships[1]");
  };
  const roots = view.content.filter(node => "source" in node);
  if (roots.length !== 1 || roots[0]!.source !== root || root.namespace !== relationshipNamespace || root.localName !== "Relationships") invalid(0);
  const attributes = (node: CompatibilityElement, allowed: readonly string[], index: number): void => {
    budget.charge("work", node.attributes.length);
    for (const attribute of node.attributes) {
      if (attribute.namespace === "http://www.w3.org/2000/xmlns/") continue;
      if (attribute.namespace || !allowed.includes(attribute.localName)) invalid(index);
    }
  };
  const document = roots[0]!;
  attributes(document, [], 0);
  const rows: RelationshipXmlRow[] = [], ids = new Set<string>();
  for (const node of document.content) {
    budget.charge("work", 1);
    if (!("source" in node)) {
      if (node.kind === "text" || node.kind === "cdata") budget.charge("work", node.text.length);
      if ((node.kind === "text" || node.kind === "cdata") && [...node.text].some(char => !" \t\r\n".includes(char))) invalid(0);
      continue;
    }
    const index = rows.length + 1, element = node.source;
    budget.charge("work", node.content.length + element.attributes.reduce((sum, attribute) => sum + attribute.value.length, 0));
    if (element.namespace !== relationshipNamespace || element.localName !== "Relationship" || node.content.some(child => "source" in child)) invalid(index);
    attributes(node, ["Id", "Type", "Target", "TargetMode"], index);
    const rId = relationshipAttribute(element, "Id"), reltype = relationshipAttribute(element, "Type"), target_ref = relationshipAttribute(element, "Target");
    const mode = relationshipAttribute(element, "TargetMode") ?? "Internal";
    if (rId === undefined || !isXmlLocalName(rId) || ids.has(rId) || reltype === undefined || !isAbsoluteRelationshipType(reltype) || target_ref === undefined || !["External", "Internal"].includes(mode) || mode === "External" && !isRelationshipTargetReference(target_ref)) invalid(index);
    ids.add(rId!);
    budget.charge("retainedBytes", 160 + (rId!.length + reltype!.length + target_ref!.length) * 2);
    rows.push(Object.freeze({element, rId: rId!, reltype: reltype!, target_ref: target_ref!, is_external: mode === "External"}));
  }
  return Object.freeze(rows);
}
