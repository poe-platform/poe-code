import { compatibilityContainers } from "./compatibility.js";
import { revisionInfo, assertFormattingHistoryEditable, assertOutsideRevisionRanges } from "./revision-markup.js";
import { activeXmlChildren } from "./xml-active-children.js";
import { xmlValue } from "./create-content.js";
import type { DocumentBudget } from "./budget.js";
import { parseDocumentXml, type XmlElement } from "./package-xml.js";
import { runElementOpen } from "./run-properties.js";
import { splitNativeTextRunXml, UnsupportedEditError, type DocumentXmlEditor } from "./xml-write.js";

export function paragraphTextRun(w: string, text: string, style?: string, kind?: "line" | "page" | "column"): string {
  let pending = "", content = "";
  const flush = () => { if (pending) { content += `<pi:t xml:space="preserve">${xmlValue(pending)}</pi:t>`; pending = ""; } };
  for (const char of text) {
    if (["\t", "\r", "\n"].includes(char)) { flush(); content += char === "\t" ? "<pi:tab/>" : "<pi:br/>"; }
    else pending += char;
  }
  flush();
  if (kind) content += `<pi:br pi:type="${kind === "line" ? "textWrapping" : kind}"/>`;
  return `<pi:r xmlns:pi="${w}">${style === undefined ? "" : `<pi:rPr><pi:rStyle pi:val="${xmlValue(style)}"/></pi:rPr>`}${content}</pi:r>`;
}

const markers = new Set(["bookmarkStart", "bookmarkEnd", "commentRangeStart", "commentRangeEnd", "proofErr", "permStart", "permEnd"]);

/** Text assignment intentionally removes runs; annotations and paragraph ownership survive. */
export function replaceParagraphContent(xml: DocumentXmlEditor, p: XmlElement, properties: string, text: string, budget: DocumentBudget): string {
  const children = activeXmlChildren(xml, budget);
  const containsActiveRevision = (node: XmlElement): boolean => revisionInfo(node) !== undefined || children(node).some(containsActiveRevision);
  assertOutsideRevisionRanges(xml.root, p, budget, xml.compatibility.branches, children);
  if (containsActiveRevision(p)) throw new UnsupportedEditError("Whole paragraph text cannot discard review history.");
  const patches = new Map<XmlElement, string>();
  const containers = children(p).filter(child => child.namespace === p.namespace && child.localName === "pPr");
  if (containers.length > 1) throw new UnsupportedEditError("Paragraph text requires one owning property container.");
  const props = containers[0];
  let inserted = false;
  for (const child of children(p)) {
    if (child.namespace !== p.namespace) throw new UnsupportedEditError("Whole paragraph text cannot replace opaque content.");
    if (child === props) { patches.set(child, properties); continue; }
    if (markers.has(child.localName)) continue;
    const check = (node: XmlElement): void => {
      if (["footnoteRef", "endnoteRef"].includes(node.localName) && (child.localName !== "r" || !child.children.includes(node)))
        throw new UnsupportedEditError("Whole paragraph text cannot discard nested note markers.");
      if (node.localName !== "rPr" && node.content.some(c => c.kind !== "element" && c.kind !== "text"))
        throw new UnsupportedEditError("Whole paragraph text cannot discard XML annotations.");
      if (node.namespace !== p.namespace || !["r", "rPr", "t", "tab", "ptab", "noBreakHyphen", "softHyphen", "br", "cr", "lastRenderedPageBreak", "hyperlink", "footnoteRef", "endnoteRef"].includes(node.localName)) {
        throw new UnsupportedEditError("Whole paragraph text cannot replace fields, objects or review content.");
      }
      if (node.localName !== "rPr") for (const c of children(node)) check(c);
    };
    check(child);
    if (child.localName === "r" && child.children.some(node => node.namespace !== p.namespace)) {
      // The retained run owns inactive compatibility payload. Remove its active
      // formatting/content without discarding that physical owner or carrier.
      patches.set(child, replaceRunContent(xml, child, "", inserted ? "" : text, budget));
      inserted = true;
      continue;
    }
    const noteMarks = child.children.filter(n => n.namespace === p.namespace && ["footnoteRef", "endnoteRef"].includes(n.localName));
    const preserved = noteMarks.length ? runElementOpen(child) + child.children.filter(n => n.localName === "rPr" || noteMarks.includes(n)).map(n => xml.sourceXml(n)).join("") + `</${child.name}>` : "";
    const hasText = child.children.some(n => !["rPr", "footnoteRef", "endnoteRef"].includes(n.localName));
    patches.set(child, preserved + (inserted || !text || !hasText && noteMarks.length ? "" : paragraphTextRun(p.namespace, text)));
    if (hasText || !noteMarks.length) inserted = true;
  }
  return runElementOpen(p) + (props ? "" : properties) + xml.sourceXml(p, patches, true) + (!inserted && text ? paragraphTextRun(p.namespace, text) : "") + `</${p.name}>`;
}

/** Split active scalar content while retaining each physical inactive owner once. */
export function splitParagraphContent(xml: DocumentXmlEditor, p: XmlElement, caret: number, budget: DocumentBudget, properties: readonly [string, string]): readonly [string, string] {
  if (p.content.some(c => !["element", "comment", "processing-instruction"].includes(c.kind) && (c.kind !== "text" || c.text.trim())))
    throw new UnsupportedEditError("Caret insertion requires simple paragraph content.");
  const children = activeXmlChildren(xml, budget), active = children(p);
  if (active.filter(node => node.namespace === p.namespace && node.localName === "pPr").length > 1) throw new UnsupportedEditError("Caret insertion requires one paragraph-property owner.");
  const selected = new Set(active), paths = new Set<XmlElement>(), containers = new Set(xml.compatibility[compatibilityContainers]);
  const patches = [new Map<XmlElement, string>(), new Map<XmlElement, string>()];
  let offset = 0;
  for (const node of active) {
    budget.charge("work", 1); assertFormattingHistoryEditable(xml.root, node, children, budget);
    if (node.namespace !== p.namespace) throw new UnsupportedEditError("Caret insertion cannot split opaque content.");
    if (node.localName === "pPr") { patches[0]!.set(node, properties[0]); patches[1]!.set(node, properties[1]); continue; }
    if (["bookmarkStart", "bookmarkEnd", "commentRangeStart", "commentRangeEnd", "proofErr", "permStart", "permEnd"].includes(node.localName)) {
      for (const side of [0, 1]) patches[side]!.set(node, side === (offset < caret ? 0 : 1) ? xml.sourceXml(node) : ""); continue;
    }
    const props = children(node).filter(child => child.namespace === p.namespace && child.localName === "rPr"), leaves = children(node).filter(child => !props.includes(child));
    if (node.localName !== "r" || props.length > 1 || leaves.some(leaf => leaf.namespace !== p.namespace || !["t", "tab", "ptab", "br", "cr", "noBreakHyphen", "softHyphen", "lastRenderedPageBreak"].includes(leaf.localName) || leaf.content.some(item => item.kind !== "text"))) throw new UnsupportedEditError("Caret insertion cannot split fields, objects, links or review content.");
    const fragments = [new Map<XmlElement, string>(), new Map<XmlElement, string>()];
    for (const leaf of leaves) {
      budget.charge("work", 1);
      if (leaf.localName === "lastRenderedPageBreak") { fragments[offset < caret ? 0 : 1]!.set(leaf, xml.sourceXml(leaf)); continue; }
      const scalars = leaf.localName === "t" ? [...leaf.text] : [" "], count = Math.max(0, Math.min(scalars.length, caret - offset));
      for (const [side, from, to] of [[0, 0, count], [1, count, scalars.length]] as const) {
        if (from === to) continue;
        const markup = to - from === scalars.length ? xml.sourceXml(leaf) : runElementOpen({ ...leaf, attributes: leaf.attributes.filter(attribute => !(attribute.namespace === "http://www.w3.org/XML/1998/namespace" && attribute.localName === "space")) }).slice(0, -1) + ` xml:space="preserve">${xmlValue(scalars.slice(from, to).join(""))}</${leaf.name}>`;
        fragments[side]!.set(leaf, markup);
      }
      offset += scalars.length;
    }
    const sides = [0, 1].filter(side => fragments[side]!.size);
    if (sides.length < 2) { const side = sides[0] ?? (offset < caret ? 0 : 1); for (const index of [0, 1]) patches[index]!.set(node, index === side ? xml.sourceXml(node) : ""); }
    else { const rendered = xml[splitNativeTextRunXml](node, sides.map(side => ({ properties: props[0] ? xml.sourceXml(props[0]) : "", content: fragments[side]! })), false); sides.forEach((side, index) => patches[side]!.set(node, rendered[index]!)); }
  }
  if (caret > offset) throw new UnsupportedEditError("Caret exceeds paragraph text.");
  const collect = (node: XmlElement): boolean => {
    budget.charge("work", 1); if (selected.has(node)) { paths.add(node); return true; }
    const found = node.children.map(collect).some(Boolean);
    if (found) {
      if (node !== p && (!containers.has(node) || node.attributes.some(attribute => !["http://www.w3.org/2000/xmlns/", "http://www.w3.org/XML/1998/namespace", "http://schemas.openxmlformats.org/markup-compatibility/2006"].includes(attribute.namespace) && !(attribute.namespace === "" && node.localName === "Choice" && attribute.localName === "Requires")))) throw new UnsupportedEditError("Caret insertion cannot duplicate opaque carrier attributes.");
      paths.add(node);
    }
    return found;
  };
  collect(p);
  const render = (node: XmlElement, side: number): string => {
    budget.charge("work", 1);
    const replacement = patches[side]!.get(node); if (replacement !== undefined) return replacement;
    if (side && !paths.has(node)) {
      if (node.namespace === "http://schemas.openxmlformats.org/markup-compatibility/2006" && ["Choice", "Fallback"].includes(node.localName)) return runElementOpen({ ...node, attributes: node.attributes.filter(attribute => ["http://www.w3.org/2000/xmlns/", "http://www.w3.org/XML/1998/namespace", "http://schemas.openxmlformats.org/markup-compatibility/2006"].includes(attribute.namespace) || attribute.namespace === "" && node.localName === "Choice" && attribute.localName === "Requires") }) + `</${node.name}>`;
      return "";
    }
    if (!paths.has(node)) return xml.sourceXml(node);
    if (node !== p && !containers.has(node)) throw new UnsupportedEditError("Caret insertion cannot reconstruct an unsupported physical owner.");
    const direct = new Map(node.children.map(child => [child, render(child, side)]));
    if (side) return runElementOpen(node) + node.content.map(item => item.kind === "element" ? direct.get(item) : item.kind === "text" || item.kind === "cdata" ? xmlValue(item.text) : "").join("") + `</${node.name}>`;
    return xml.sourceXml(node, direct);
  };
  return [xml.sourceXml(p, new Map(p.children.map(child => [child, render(child, 0)])), true),
    p.content.map(item => item.kind === "element" ? render(item, 1) : item.kind === "text" ? xmlValue(item.text) : "").join("")];
}

/** Whole run assignment removes native content and retains its owning properties. */
export function replaceRunContent(xml: DocumentXmlEditor, run: XmlElement, properties: string, text: string, budget: DocumentBudget): string {
  const children = activeXmlChildren(xml, budget);
  assertFormattingHistoryEditable(xml.root, run, children, budget);
  const active = children(run);
  const containers = active.filter(child => child.namespace === run.namespace && child.localName === "rPr");
  if (containers.length > 1 || active.some(child => child.namespace !== run.namespace ||
    !["rPr", "t", "tab", "ptab", "br", "cr", "noBreakHyphen", "softHyphen", "lastRenderedPageBreak"].includes(child.localName) ||
    child.localName !== "rPr" && child.content.some(content => content.kind !== "text" || child.localName !== "t" && content.text.trim())))
    throw new UnsupportedEditError("Whole run text cannot discard owned resources or unsupported content.");
  const props = containers[0];
  const patches = new Map(active.filter(child => child !== props).map(child => [child, ""]));
  if (props && properties !== xml.sourceXml(props)) patches.set(props, properties);
  const fragment = parseDocumentXml(new TextEncoder().encode(paragraphTextRun(run.namespace, text)), {}, budget).root;
  // Namespace bindings belong to newly written leaves, never to retained opaque
  // properties whose inherited namespace context must stay unchanged.
  const content = fragment.children.map(child => runElementOpen(child) + xmlValue(child.text) + `</${child.name}>`).join("");
  return runElementOpen(run) + (props ? "" : properties) + xml.sourceXml(run, patches, true) + content + `</${run.name}>`;
}
