import type { CompatibilityBranch } from "./compatibility.js";
import type { DocumentBudget } from "./budget.js";
import { UnsupportedEditError } from "./xml-write.js";
import type { XmlElement } from "./package-xml.js";
import { documentDialects } from "./dialect.js";

export interface RevisionInfo {
  readonly id: string | null;
  readonly author: string | null;
  readonly timestamp: string | null;
  readonly markup: string;
  readonly namespace: string;
  readonly name: string | null;
  readonly type: "insert" | "delete" | "format" | "move" | "table" | "section" | "unsupported";
  readonly support: "supported" | "opaque";
}

/** Support describes read interpretation, never permission to accept or reject a change. */
export function revisionInfo(node: XmlElement): RevisionInfo | undefined {
  const name = node.localName;
  const attr = (name: string) => node.attributes.find(a => a.localName === name && (a.namespace === node.namespace || a.namespace === documentDialects.transitional.w || a.namespace === documentDialects.strict.w))?.value ?? null;
  const word = node.namespace === documentDialects.transitional.w || node.namespace === documentDialects.strict.w;
  const type: RevisionInfo["type"] = !word ? "unsupported" : name === "ins" ? "insert" : name === "del" ? "delete"
    : ["moveFrom", "moveTo", "moveFromRangeStart", "moveFromRangeEnd", "moveToRangeStart", "moveToRangeEnd"].includes(name) ? "move"
    : ["rPrChange", "pPrChange"].includes(name) ? "format" : name === "sectPrChange" ? "section"
    : ["tblPrChange", "tblGridChange", "trPrChange", "tcPrChange", "cellIns", "cellDel", "cellMerge"].includes(name) ? "table" : "unsupported";
  if (type === "unsupported" && !name.endsWith("Change") && !name.startsWith("conflict") && !(name.startsWith("customXml") && (name.endsWith("RangeStart") || name.endsWith("RangeEnd"))) && !(attr("author") !== null && attr("id") !== null && name !== "comment")) return undefined;
  const snapshot = type === "format" ? node.children.filter(n => n.namespace === node.namespace && n.localName === name.slice(0, -6)) : [];
  const seen = new Set<string>();
  const supported = type === "insert" || type === "delete" || type === "move" || type === "format" && snapshot.length === 1 && node.children.length === 1 &&
    [node, snapshot[0]!, ...snapshot[0]!.children].every(element => {
      for (const char of element.text) if (char !== " " && char !== "\t" && char !== "\r" && char !== "\n") return false;
      return true;
    }) && snapshot[0]!.attributes.every(attribute => attribute.namespace === "http://www.w3.org/2000/xmlns/") &&
    snapshot[0]!.children.every(property => {
      const field = property.localName;
      if (property.namespace !== node.namespace || property.children.length || seen.has(field) ||
        !(name === "rPrChange" ? ["b", "i", "rtl", "vanish", "rStyle", "lang", "rFonts"] : ["pStyle", "bidi"]).includes(field)) return false;
      seen.add(field);
      const allowed = field === "lang" ? ["val", "eastAsia", "bidi"] : field === "rFonts"
        ? ["ascii", "hAnsi", "eastAsia", "cs", "asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme", "hint"] : ["val"];
      if (property.attributes.some(attribute => attribute.namespace !== "http://www.w3.org/2000/xmlns/" &&
        (attribute.namespace !== node.namespace || !allowed.includes(attribute.localName)))) return false;
      const val = property.attributes.find(attribute => attribute.namespace === node.namespace && attribute.localName === "val")?.value;
      if (["b", "i", "rtl", "vanish", "bidi"].includes(field)) return val === undefined || ["true", "false", "on", "off", "1", "0"].includes(val);
      return !["rStyle", "pStyle"].includes(field) || val !== undefined;
    });
  return { id: attr("id"), author: attr("author"), timestamp: attr("date"), markup: name, namespace: node.namespace, name: attr("name"), type, support: supported ? "supported" : "opaque" };
}

export function containsRevision(node: XmlElement): boolean {
  return revisionInfo(node) !== undefined || node.children.some(containsRevision);
}

/** A range can start before the selected paragraph, so subtree checks alone are insufficient. */
export function assertOutsideRevisionRanges(root: XmlElement, target: XmlElement, budget: DocumentBudget, branches: readonly CompatibilityBranch[]): void {
  const selected = new Map(branches.map(branch => [branch.alternateContent, branch.selected]));
  const active = new Set<string>();
  let found = false;
  const visit = (node: XmlElement): void => {
    if (found) return;
    budget.charge("work", 1);
    if (node === target) {
      found = true;
      if (active.size) throw new UnsupportedEditError("Text removal cannot cross a review range.");
      return;
    }
    const info = revisionInfo(node);
    if (info && (info.markup.endsWith("RangeStart") || info.markup.endsWith("RangeEnd"))) {
      const key = info.namespace + ":" + info.markup.slice(0, info.markup.lastIndexOf("Range")) + ":" + info.id;
      if (info.markup.endsWith("RangeStart")) active.add(key); else active.delete(key);
    }
    if (selected.has(node)) {
      const branch = selected.get(node);
      if (branch) visit(branch);
    } else for (const child of node.children) visit(child);
  };
  visit(root);
}
