import { containsRevision } from "./revision-markup.js";
import { xmlValue } from "./create-content.js";
import type { XmlElement } from "./package-xml.js";
import { runElementOpen } from "./run-properties.js";
import { UnsupportedEditError, type DocumentXmlEditor } from "./xml-write.js";

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
export function replaceParagraphContent(xml: DocumentXmlEditor, p: XmlElement, properties: string, text: string): string {
  if (containsRevision(p)) throw new UnsupportedEditError("Whole paragraph text cannot discard review history.");
  const patches = new Map<XmlElement, string>();
  let inserted = false;
  for (const child of p.children) {
    if (child.namespace !== p.namespace) throw new UnsupportedEditError("Whole paragraph text cannot replace opaque content.");
    if (child.localName === "pPr") { patches.set(child, ""); continue; }
    if (markers.has(child.localName)) continue;
    const check = (node: XmlElement): void => {
      if (["footnoteRef", "endnoteRef"].includes(node.localName) && (child.localName !== "r" || !child.children.includes(node)))
        throw new UnsupportedEditError("Whole paragraph text cannot discard nested note markers.");
      if (node.localName !== "rPr" && node.content.some(c => c.kind !== "element" && c.kind !== "text"))
        throw new UnsupportedEditError("Whole paragraph text cannot discard XML annotations.");
      if (node.namespace !== p.namespace || !["r", "rPr", "t", "tab", "br", "cr", "hyperlink", "footnoteRef", "endnoteRef"].includes(node.localName)) {
        throw new UnsupportedEditError("Whole paragraph text cannot replace fields, objects or review content.");
      }
      if (node.localName !== "rPr") for (const c of node.children) check(c);
    };
    check(child);
    const noteMarks = child.children.filter(n => n.namespace === p.namespace && ["footnoteRef", "endnoteRef"].includes(n.localName));
    const preserved = noteMarks.length ? runElementOpen(child) + child.children.filter(n => n.localName === "rPr" || noteMarks.includes(n)).map(n => xml.sourceXml(n)).join("") + `</${child.name}>` : "";
    const hasText = child.children.some(n => !["rPr", "footnoteRef", "endnoteRef"].includes(n.localName));
    patches.set(child, preserved + (inserted || !text || !hasText && noteMarks.length ? "" : paragraphTextRun(p.namespace, text)));
    if (hasText || !noteMarks.length) inserted = true;
  }
  return runElementOpen(p) + properties + xml.sourceXml(p, patches, true) + (!inserted && text ? paragraphTextRun(p.namespace, text) : "") + `</${p.name}>`;
}

/** A scalar caret splits simple runs, copying their formatting to both fragments. */
export function splitParagraphContent(xml: DocumentXmlEditor, p: XmlElement, caret: number): readonly [string, string] {
  const halves = ["", ""];
  let offset = 0;
  if (p.content.some(c => c.kind !== "element" && (c.kind !== "text" || c.text.trim())))
    throw new UnsupportedEditError("Caret insertion requires simple paragraph content.");
  for (const child of p.children) {
    if (child.namespace !== p.namespace) throw new UnsupportedEditError("Caret insertion cannot split opaque content.");
    if (child.localName === "pPr") continue;
    if (markers.has(child.localName)) {
      halves[offset < caret ? 0 : 1] += xml.sourceXml(child); continue;
    }
    if (child.localName !== "r" || child.content.some(c => c.kind !== "element") || child.children.some(c => c.namespace !== p.namespace || !["rPr", "t", "tab", "br", "cr", "noBreakHyphen", "softHyphen"].includes(c.localName) || c.localName !== "rPr" && c.content.some(n => n.kind !== "text")))
      throw new UnsupportedEditError("Caret insertion cannot split fields, objects, links or review content.");
    const fragments = ["", ""];
    const properties = child.children.find(c => c.namespace === p.namespace && c.localName === "rPr");
    for (const leaf of child.children) {
      if (leaf === properties) continue;
      const chars = leaf.localName === "t" ? [...leaf.text] : [" "];
      const count = Math.max(0, Math.min(chars.length, caret - offset));
      for (const [side, from, to] of [[0, 0, count], [1, count, chars.length]] as const) {
        if (from === to) continue;
        if (to - from === chars.length) fragments[side] += xml.sourceXml(leaf);
        else {
          const node = { ...leaf, attributes: leaf.attributes.filter(a => !(a.namespace === "http://www.w3.org/XML/1998/namespace" && a.localName === "space")) };
          fragments[side] += runElementOpen(node).slice(0, -1) + ` xml:space="preserve">${xmlValue(chars.slice(from, to).join(""))}</${leaf.name}>`;
        }
      }
      offset += chars.length;
    }
    for (const side of [0, 1]) if (fragments[side]) halves[side] += runElementOpen(child) + (properties ? xml.sourceXml(properties) : "") + fragments[side] + `</${child.name}>`;
    if (!fragments[0] && !fragments[1]) halves[offset < caret ? 0 : 1] += xml.sourceXml(child);
  }
  if (caret > offset) throw new UnsupportedEditError("Caret exceeds paragraph text.");
  return [halves[0]!, halves[1]!];
}
