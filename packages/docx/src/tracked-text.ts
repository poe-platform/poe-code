import type { DocumentBudget } from "./budget.js";
import type { ArchiveLimits } from "./archive.js";
import { DocumentPackage } from "./package.js";
import { xmlValue } from "./create-content.js";
import { assertOutsideFields, parseFields } from "./field-parser.js";
import type { Location } from "./location-token.js";
import type { DocumentArchiveEditor } from "./package-write.js";
import { parseDocumentXml, type XmlElement } from "./package-xml.js";
import { assertOutsideRevisionRanges, containsRevision, revisionInfo } from "./revision-markup.js";
import { UnsupportedEditError, type DocumentXmlEditor } from "./xml-write.js";

export interface TrackedTextEdit {
  readonly paragraph: Location; readonly start: number; readonly end: number; readonly text: string;
  readonly bold?: boolean | undefined; readonly italic?: boolean | undefined;
}
interface Run { node: XmlElement; start: number; end: number; text: string; unsafe?: boolean; synthetic?: boolean; }
function opening(node: XmlElement): string {
  return `<${node.name}${[...node.namespaces].filter(([prefix]) => prefix !== "xml").map(([prefix, uri]) => ` ${prefix ? "xmlns:" + prefix : "xmlns"}="${xmlValue(uri)}"`).join("")}${node.attributes.filter(a => a.namespace !== "http://www.w3.org/2000/xmlns/").map(a => ` ${a.name}="${xmlValue(a.value)}"`).join("")}>`;
}
function textRun(node: XmlElement, text: string, xml: DocumentXmlEditor, deleted: boolean, formatting?: TrackedTextEdit): string {
  const w = node.namespace;
  const props = node.children.find(child => child.namespace === w && child.localName === "rPr");
  let properties = props ? xml.sourceXml(props) : "";
  if (formatting && (formatting.bold !== undefined || formatting.italic !== undefined)) {
    const removed = new Map(props?.children.filter(child => child.namespace === w &&
      (child.localName === "b" && formatting.bold !== undefined || child.localName === "i" && formatting.italic !== undefined)).map(child => [child, ""] as const));
    properties = `<rt:rPr xmlns:rt="${xmlValue(w)}">${props ? xml.sourceXml(props, removed, true) : ""}${formatting.bold === undefined ? "" : `<rt:b rt:val="${Number(formatting.bold)}"/>`}${formatting.italic === undefined ? "" : `<rt:i rt:val="${Number(formatting.italic)}"/>`}</rt:rPr>`;
  }
  let content = "", pending = "";
  const flush = () => { if (pending) content += `<rt:${deleted ? "delText" : "t"} xmlns:rt="${xmlValue(w)}" xml:space="preserve">${xmlValue(pending)}</rt:${deleted ? "delText" : "t"}>`; pending = ""; };
  for (const char of text) {
    if (char === "\t" || char === "\n") { flush(); content += `<rt:${char === "\t" ? "tab" : "br"} xmlns:rt="${xmlValue(w)}"/>`; }
    else pending += char;
  }
  flush();
  return opening(node) + properties + content + `</${node.name}>`;
}

/** Stage original run slices only after every affected owner and boundary has been checked. */
export function stageTrackedText(editor: DocumentArchiveEditor, edits: readonly TrackedTextEdit[], metadata: { readonly author: string; readonly timestamp: string }, budget: DocumentBudget, limits: ArchiveLimits): void {
  xmlValue(metadata.author); xmlValue(metadata.timestamp);
  const used = new Set<number>();
  for (const part of new DocumentPackage(editor.snapshot(), limits, budget).parts) {
    const type = part.content_type.toLowerCase();
    if (!type.endsWith("+xml") && !["application/xml", "text/xml"].includes(type)) continue;
    const visit = (node: XmlElement): void => {
      budget.charge("work", 1);
      const info = revisionInfo(node);
      const digits = info?.id?.[0] === "+" || info?.id?.[0] === "-" ? info.id.slice(1) : info?.id;
      if (digits !== undefined && digits !== null && digits.length && [...digits].every(c => c >= "0" && c <= "9")) {
        const id = Number(info?.id); if (Number.isSafeInteger(id)) used.add(id);
      }
      for (const child of node.children) visit(child);
    };
    visit(parseDocumentXml(part.bytes, {}, budget).root);
  }
  let next = 1;
  const wrap = (kind: "ins" | "del", run: string, w: string) => {
    while (used.has(next)) { budget.charge("work", 1); next++; }
    budget.check("work", 1); used.add(next);
    return `<rt:${kind} xmlns:rt="${xmlValue(w)}" rt:id="${next++}" rt:author="${xmlValue(metadata.author)}" rt:date="${xmlValue(metadata.timestamp)}">${run}</rt:${kind}>`;
  };
  const groups = new Map<string, TrackedTextEdit[]>();
  for (const edit of edits) { const group = groups.get(edit.paragraph.token) ?? []; group.push(edit); groups.set(edit.paragraph.token, group); }
  const staged: { xml: DocumentXmlEditor; paragraph: XmlElement; patches: Map<XmlElement, string> }[] = [];
  for (const group of groups.values()) {
    const location = group[0]!.paragraph;
    const xml = editor.xml(location.value.part.slice(1));
    let paragraph = xml.root;
    const ancestors = [paragraph];
    for (const i of location.value.path) { paragraph = paragraph.children[i]!; ancestors.push(paragraph); }
    const w = paragraph.namespace;
    if (paragraph.localName !== "p" || ancestors.some(node => revisionInfo(node) || ["sdt", "fldSimple", "hyperlink", "customXml"].includes(node.localName)) ||
      ancestors.some(node => node.children.some(child => child.namespace === w && ["pPr", "trPr", "tblPr", "tcPr", "sectPr"].includes(child.localName) && containsRevision(child))))
      throw new UnsupportedEditError("Tracked text cannot change existing review or controlled content.");
    const runs: Run[] = []; const barriers: number[] = []; let offset = 0;
    const opaqueLength = (node: XmlElement): number => {
      budget.charge("work", 1);
      const info = revisionInfo(node);
      if (info?.support === "opaque" || info?.type === "delete" || info?.markup.startsWith("moveFrom") || ["rPr", "pPr", "instrText", "delInstrText", "drawing", "pict", "object"].includes(node.localName)) return 0;
      if (node.namespace !== w) return 0;
      if (node.localName === "t") return [...node.text].length;
      if (["tab", "br", "cr", "noBreakHyphen", "softHyphen"].includes(node.localName)) return 1;
      return node.children.reduce((sum, child) => sum + opaqueLength(child), 0);
    };
    for (const node of paragraph.children) {
      budget.charge("work", 1);
      if (node.namespace === w && node.localName === "pPr") continue;
      if (node.namespace !== w || node.localName !== "r") {
        barriers.push(offset); const length = opaqueLength(node);
        if (length) runs.push({ node, start: offset, end: offset + length, text: "", unsafe: true });
        offset += length; continue;
      }
      let unsafe = containsRevision(node);
      let text = "";
      for (const child of node.children) {
        if (child.namespace !== w || !["rPr", "t", "tab", "br", "cr"].includes(child.localName) || child.localName === "br" && child.attributes.some(a => a.localName === "type" && !["textWrapping"].includes(a.value))) unsafe = true;
        if (child.localName === "rPr") continue;
        if (child.namespace === w) text += child.localName === "t" ? child.text : child.localName === "tab" ? "\t" : ["br", "cr"].includes(child.localName) ? "\n" : ["noBreakHyphen", "softHyphen"].includes(child.localName) ? child.localName === "noBreakHyphen" ? "\u2011" : "\u00ad" : "";
      }
      budget.charge("retainedBytes", text.length * 4);
      const length = [...text].length; runs.push({ node, text, start: offset, end: offset + length, unsafe }); offset += length;
    }
    const story = ancestors.map((node, depth) => ({ node, path: location.value.path.slice(0, depth) })).reverse().find(owner => owner.node.namespace === w &&
      ["body", "hdr", "ftr", "footnote", "endnote", "comment", "txbxContent"].includes(owner.node.localName));
    if (!story) throw new UnsupportedEditError("Tracked text requires an admitted story owner.");
    const fields = parseFields(story.node, story.path, budget, xml.compatibility.content);
    group.sort((a, b) => a.start - b.start);
    let last = -1;
    const affected = new Map<Run, { start: number; end: number; text: string; source: Run; edit: TrackedTextEdit }[]>();
    for (const edit of group) {
      if (!Number.isSafeInteger(edit.start) || !Number.isSafeInteger(edit.end) || edit.start < 0 || edit.end < edit.start || edit.end > offset || edit.start < last) throw new UnsupportedEditError("Tracked text ranges are unavailable or overlap.");
      last = edit.end;
      if (barriers.some(position => edit.start < position && position < edit.end)) throw new UnsupportedEditError("Tracked text cannot cross annotation or opaque boundaries.");
      const selected = runs.filter(run => edit.start === edit.end ? run.start <= edit.start && edit.start <= run.end : run.start < edit.end && run.end > edit.start);
      if (!selected.length) {
        if (!offset && !runs.length && edit.start === 0) {
          const synthetic = parseDocumentXml(new TextEncoder().encode(`<r xmlns="${xmlValue(w)}"/>`), {}, budget).root;
          const run = { node: synthetic, text: "", start: 0, end: 0, synthetic: true }; selected.push(run); runs.push(run);
        } else throw new UnsupportedEditError("Tracked insertion has no ordinary run owner.");
      }
      if (edit.start === edit.end) selected.splice(1);
      if (selected.some(run => run.unsafe)) throw new UnsupportedEditError("Tracked text cannot change existing review or compound run content.");
      const source = selected[0]!;
      for (const run of selected) {
        assertOutsideRevisionRanges(xml.root, run.synthetic ? paragraph : run.node, budget, xml.compatibility.branches);
        assertOutsideFields(fields, [...location.value.path, Math.max(0, paragraph.children.indexOf(run.node))]);
        const records = affected.get(run) ?? [];
        records.push({ start: Math.max(edit.start, run.start) - run.start, end: Math.min(edit.end, run.end) - run.start, text: run === selected.at(-1) ? edit.text : "", source, edit });
        affected.set(run, records);
      }
    }
    const patches = new Map<XmlElement, string>();
    for (const [run, records] of affected) {
      const scalars = [...run.text]; let position = 0, markup = "";
      for (const record of records) {
        if (position < record.start) markup += textRun(run.node, scalars.slice(position, record.start).join(""), xml, false);
        if (record.start < record.end) markup += wrap("del", textRun(run.node, scalars.slice(record.start, record.end).join(""), xml, true), w);
        if (record.text) markup += wrap("ins", textRun(record.source.node, record.text, xml, false, record.edit), w);
        position = record.end;
      }
      if (position < scalars.length) markup += textRun(run.node, scalars.slice(position).join(""), xml, false);
      if (paragraph.children.includes(run.node)) patches.set(run.node, markup);
      else patches.set(paragraph, xml.sourceXml(paragraph, new Map(), true) + markup);
    }
    staged.push({ xml, paragraph, patches });
  }
  for (const { xml, paragraph, patches } of staged) {
    if (patches.has(paragraph)) xml.replaceElement(paragraph, opening(paragraph) + patches.get(paragraph)! + `</${paragraph.name}>`);
    else xml.replaceElement(paragraph, xml.sourceXml(paragraph, patches));
  }
}
