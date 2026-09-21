import { activeXmlChildren } from "./xml-active-children.js";
import type { CompatibilityBranch } from "./compatibility.js";
import type { DocumentBudget } from "./budget.js";
import { UnsupportedEditError } from "./xml-write.js";
import type { XmlElement } from "./package-xml.js";
import { documentDialects } from "./dialect.js";
import { storedBooleanValue } from "./stored-lexical.js";

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
  if (name === "clrChange" && (node.namespace === documentDialects.transitional.a || node.namespace === documentDialects.strict.a)) return undefined;
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
      if (["b", "i", "rtl", "vanish", "bidi"].includes(field)) return val === undefined || storedBooleanValue(val) !== null;
      return !["rStyle", "pStyle"].includes(field) || val !== undefined;
    });
  return { id: attr("id"), author: attr("author"), timestamp: attr("date"), markup: name, namespace: node.namespace, name: attr("name"), type, support: supported ? "supported" : "opaque" };
}

export function containsRevision(node: XmlElement, budget?: DocumentBudget): boolean {
  budget?.charge("retainedBytes", 8);
  const pending = [node];
  while (pending.length) {
    const current = pending.pop()!;
    budget?.charge("work", 1);
    if (revisionInfo(current) !== undefined) return true;
    budget?.charge("retainedBytes", current.children.length * 8);
    for (let index = current.children.length - 1; index >= 0; index--) pending.push(current.children[index]!);
  }
  return false;
}

/** A range can start before the selected paragraph, so subtree checks alone are insufficient. */
export function assertOutsideRevisionRanges(root: XmlElement, target: XmlElement, budget: DocumentBudget, branches: readonly CompatibilityBranch[], children = activeXmlChildren(root, budget)): void {
  const selected = new Map(branches.map(branch => [branch.alternateContent, branch.selected]));
  const active = new Set<string>();
  const pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    budget.charge("work", 1);
    if (node === target) {
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
      if (branch) pending.push(branch);
    } else {
      const activeChildren = children(node);
      for (let index = activeChildren.length - 1; index >= 0; index--) pending.push(activeChildren[index]!);
    }
  }
}

/** Native table history belongs to its property owner and affects contained edits. */
export function containsActiveTableHistory(node: XmlElement, children: (node: XmlElement) => readonly XmlElement[], budget: DocumentBudget): boolean {
  if (node.namespace !== documentDialects.transitional.w && node.namespace !== documentDialects.strict.w ||
    !["tbl", "tr", "tc"].includes(node.localName)) return false;
  const pending = children(node).filter(property => property.namespace === node.namespace &&
    (property.localName === node.localName + "Pr" || node.localName === "tbl" && property.localName === "tblGrid"));
  budget.charge("retainedBytes", pending.length * 8);
  while (pending.length) {
    const current = pending.pop()!;
    budget.charge("work", 1);
    if (revisionInfo(current) !== undefined) return true;
    const active = children(current);
    budget.charge("retainedBytes", active.length * 8);
    for (let index = active.length - 1; index >= 0; index--) pending.push(active[index]!);
  }
  return false;
}

/** A model property patch cannot reconcile opaque owner or ancestor history. */
export function assertFormattingHistoryEditable(root: XmlElement, target: XmlElement, children: (node: XmlElement) => readonly XmlElement[], budget: DocumentBudget): void {
  assertOutsideRevisionRanges(root, target, budget, [], children);
  const pending = [{ node: root, blocked: false }];
  while (pending.length) {
    const { node, blocked } = pending.pop()!;
    budget.charge("work", 1);
    const active = children(node);
    const history = containsActiveTableHistory(node, children, budget) || node.namespace === target.namespace && (["p", "r"].includes(node.localName) || node === target) &&
      active.filter(property => property.namespace === target.namespace && ["pPr", "rPr"].includes(property.localName)).some(property =>
        children(property).some(change => {
          const revision = revisionInfo(change);
          return revision?.type === "format" && revision.support === "opaque";
        }));
    if (node === target) {
      if (blocked || history) throw new UnsupportedEditError("Formatting cannot reconcile complex property history.");
      return;
    }
    for (let index = active.length - 1; index >= 0; index--) pending.push({ node: active[index]!, blocked: blocked || history });
  }
  throw new UnsupportedEditError("Formatting requires an active owned element.");
}

export interface ParagraphTextHistory {
  readonly root: XmlElement;
  readonly paragraphs: ReadonlySet<XmlElement>;
}

/** Validate native cell paragraph owners together without repeated story scans. */
export function paragraphTextHistory(root: XmlElement, paragraphs: readonly XmlElement[], children: (node: XmlElement) => readonly XmlElement[], budget: DocumentBudget): ParagraphTextHistory {
  budget.charge("retainedBytes", paragraphs.length * 112);
  const targets = new Set(paragraphs), activeRanges = new Set<string>();
  if (!targets.size) return { root, paragraphs: targets };
  const namespace = paragraphs[0]!.namespace;
  const pending = [{ node: root, blocked: false }];
  const startWork = budget.usage.work;
  let ordinal = 0, formatWork = 0, proofWork = 0, remaining = targets.size;
  while (pending.length) {
    const { node, blocked } = pending.pop()!;
    budget.charge("work", 1);
    ordinal++;
    const target = targets.has(node), outsideWork = ordinal * 2 - 1;
    if (target) {
      // The projection charges one work unit per child lookup. Reserve the
      // original first prefix scan before its semantic range check.
      budget.charge("work", Math.max(0, proofWork + outsideWork - (budget.usage.work - startWork)));
      if (activeRanges.size) throw new UnsupportedEditError("Text removal cannot cross a review range.");
    }
    const active = children(node);
    formatWork += 2;
    const history = node.namespace === namespace && ["p", "r"].includes(node.localName) &&
      active.filter(property => property.namespace === namespace && ["pPr", "rPr"].includes(property.localName)).some(property => {
        formatWork++;
        return children(property).some(change => {
          const revision = revisionInfo(change);
          return revision?.type === "format" && revision.support === "opaque";
        });
      });
    if (target) {
      if (node.namespace !== namespace || node.localName !== "p") throw new UnsupportedEditError("Cell text requires native paragraph owners.");
      // Retain the second range scan and full ancestor-history scan charges,
      // even though their immutable exposure state is shared by this walk.
      proofWork += outsideWork * 2 + formatWork;
      budget.charge("work", proofWork - (budget.usage.work - startWork));
      if (blocked || history) throw new UnsupportedEditError("Formatting cannot reconcile complex property history.");
      if (--remaining === 0) return { root, paragraphs: targets };
    }
    const info = revisionInfo(node);
    if (info && (info.markup.endsWith("RangeStart") || info.markup.endsWith("RangeEnd"))) {
      const key = info.namespace + ":" + info.markup.slice(0, info.markup.lastIndexOf("Range")) + ":" + info.id;
      if (info.markup.endsWith("RangeStart")) activeRanges.add(key); else activeRanges.delete(key);
    }
    for (let index = active.length - 1; index >= 0; index--) pending.push({ node: active[index]!, blocked: blocked || history });
  }
  throw new UnsupportedEditError("Formatting requires an active owned element.");
}
