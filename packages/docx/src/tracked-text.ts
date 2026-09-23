import type { DocumentBudget } from "./budget.js";
import type { ArchiveLimits } from "./archive.js";
import { DocumentPackage } from "./package.js";
import { xmlValue } from "./create-content.js";
import { compatibilityContainers } from "./compatibility.js";
import { parseStoredDateTime } from "./stored-date-time.js";
import { storedIntegerIdentity } from "./stored-lexical.js";
import { normalizePropertyDate } from "./property-values.js";
import { activeXmlChildren } from "./xml-active-children.js";
import { assertOutsideFields, parseFields } from "./field-parser.js";
import type { Location } from "./location-token.js";
import type { DocumentArchiveEditor } from "./package-write.js";
import { isXmlContentType, parseDocumentXml, type XmlElement } from "./package-xml.js";
import { assertOutsideRevisionRanges, containsRevision, revisionInfo } from "./revision-markup.js";
import { UnsupportedEditError, replaceSplitTextRunXml, splitNativeTextRunXml, type DocumentXmlEditor } from "./xml-write.js";

export interface TrackedTextEdit {
  readonly paragraph: Location; readonly start: number; readonly end: number; readonly text: string;
  readonly bold?: boolean | undefined; readonly italic?: boolean | undefined;
}
interface Run { node: XmlElement; start: number; end: number; text: string; unsafe?: boolean; synthetic?: boolean; native?: boolean; }
function opening(node: XmlElement): string {
  return `<${node.name}${[...node.namespaces].filter(([prefix]) => prefix !== "xml").map(([prefix, uri]) => ` ${prefix ? "xmlns:" + prefix : "xmlns"}="${xmlValue(uri)}"`).join("")}${node.attributes.filter(a => a.namespace !== "http://www.w3.org/2000/xmlns/").map(a => ` ${a.name}="${xmlValue(a.value)}"`).join("")}>`;
}
function runProperties(node: XmlElement, xml: DocumentXmlEditor, budget: DocumentBudget, formatting?: TrackedTextEdit): string {
  const w = node.namespace;
  const active = activeXmlChildren(xml, budget);
  const props = active(node).find(child => child.namespace === w && child.localName === "rPr");
  let properties = props ? xml.sourceXml(props) : "";
  if (formatting && (formatting.bold !== undefined || formatting.italic !== undefined)) {
    const removed = new Map(props ? active(props).filter(child => child.namespace === w &&
      (child.localName === "b" && formatting.bold !== undefined || child.localName === "i" && formatting.italic !== undefined)).map(child => [child, ""] as const) : []);
    properties = `<rt:rPr xmlns:rt="${xmlValue(w)}">${props ? xml.sourceXml(props, removed, true) : ""}${formatting.bold === undefined ? "" : `<rt:b rt:val="${Number(formatting.bold)}"/>`}${formatting.italic === undefined ? "" : `<rt:i rt:val="${Number(formatting.italic)}"/>`}</rt:rPr>`;
  }
  return properties;
}
function runTextContent(w: string, text: string, deleted: boolean): string {
  let content = "", pending = "";
  const flush = () => { if (pending) content += `<rt:${deleted ? "delText" : "t"} xmlns:rt="${xmlValue(w)}" xml:space="preserve">${xmlValue(pending)}</rt:${deleted ? "delText" : "t"}>`; pending = ""; };
  for (const char of text) {
    if (char === "\t" || char === "\n") { flush(); content += `<rt:${char === "\t" ? "tab" : "br"} xmlns:rt="${xmlValue(w)}"/>`; }
    else pending += char;
  }
  flush();
  return content;
}
function textRun(node: XmlElement, text: string, xml: DocumentXmlEditor, budget: DocumentBudget, deleted: boolean, formatting?: TrackedTextEdit): string {
  return opening(node) + runProperties(node, xml, budget, formatting) + runTextContent(node.namespace, text, deleted) + `</${node.name}>`;
}

/** Stage original run slices only after every affected owner and boundary has been checked. */
export function stageTrackedText(editor: DocumentArchiveEditor, edits: readonly TrackedTextEdit[], metadata: { readonly author: string; readonly timestamp: string }, budget: DocumentBudget, limits: ArchiveLimits): void {
  xmlValue(metadata.author);
  const timestamp = normalizePropertyDate(metadata.timestamp);
  parseStoredDateTime(timestamp, "xsd");
  const used = new Set<number>();
  for (const part of new DocumentPackage(editor.snapshot(), limits, budget).parts) {
    if (!isXmlContentType(part.content_type)) continue;
    budget.charge("retainedBytes", 8);
    const pending = [parseDocumentXml(part.bytes, {}, budget).root];
    while (pending.length) {
      const node = pending.pop()!;
      budget.charge("work", 1);
      const info = revisionInfo(node);
      const identity = storedIntegerIdentity(info?.id ?? undefined);
      if (identity !== undefined) {
        const id = Number(identity); if (Number.isSafeInteger(id)) used.add(id);
      }
      budget.charge("retainedBytes", node.children.length * 8);
      for (let index = node.children.length - 1; index >= 0; index--) pending.push(node.children[index]!);
    }
  }
  let next = 1;
  const wrap = (kind: "ins" | "del", run: string, w: string) => {
    while (used.has(next)) { budget.charge("work", 1); next++; }
    budget.check("work", 1); used.add(next);
    return `<rt:${kind} xmlns:rt="${xmlValue(w)}" rt:id="${next++}" rt:author="${xmlValue(metadata.author)}" rt:date="${timestamp}">${run}</rt:${kind}>`;
  };
  const groups = new Map<string, TrackedTextEdit[]>();
  for (const edit of edits) { const group = groups.get(edit.paragraph.token) ?? []; group.push(edit); groups.set(edit.paragraph.token, group); }
  interface NativePatch { fragments: { properties: string; content: ReadonlyMap<XmlElement, string> }[]; wrappers: (string | null)[]; }
  const staged: { xml: DocumentXmlEditor; paragraph: XmlElement; patches: Map<XmlElement, string | NativePatch> }[] = [];
  for (const group of groups.values()) {
    const location = group[0]!.paragraph;
    const xml = editor.xml(location.value.part.slice(1));
    let paragraph = xml.root;
    const ancestors = [paragraph];
    for (const i of location.value.path) { paragraph = paragraph.children[i]!; ancestors.push(paragraph); }
    const w = paragraph.namespace;
    const active = activeXmlChildren(xml, budget);
    if (paragraph.localName !== "p" || ancestors.some(node => revisionInfo(node) || ["sdt", "fldSimple", "hyperlink", "customXml"].includes(node.localName)) ||
      ancestors.some(node => active(node).some(child => child.namespace === w && ["pPr", "trPr", "tblPr", "tcPr", "sectPr"].includes(child.localName) && containsRevision(child, budget))))
      throw new UnsupportedEditError("Tracked text cannot change existing review or controlled content.");
    const paragraphChildren = active(paragraph);
    const targets = new Set(paragraphChildren), containers = new Set(xml.compatibility[compatibilityContainers]);
    const runPaths = new Map<XmlElement, readonly number[]>();
    const path: number[] = [];
    budget.charge("retainedBytes", 32);
    const traversal = [{ node: paragraph, index: 0 }];
    while (traversal.length) {
      const frame = traversal.at(-1)!, index = frame.index++, child = frame.node.children[index];
      budget.charge("work", 1);
      if (!child) { traversal.pop(); if (traversal.length) path.pop(); continue; }
      if (targets.has(child)) {
        budget.charge("retainedBytes", 48 + (location.value.path.length + path.length + 1) * 8);
        runPaths.set(child, [...location.value.path, ...path, index]);
      } else if (containers.has(child)) {
        budget.charge("retainedBytes", 40);
        path.push(index); traversal.push({ node: child, index: 0 });
      }
    }
    const runs: Run[] = []; const barriers: number[] = []; let offset = 0;
    const opaqueLength = (node: XmlElement): number => {
      budget.charge("retainedBytes", 8);
      const pending = [node]; let length = 0;
      while (pending.length) {
        const current = pending.pop()!;
        budget.charge("work", 1);
        const info = revisionInfo(current);
        if (info?.support === "opaque" || info?.type === "delete" || info?.markup.startsWith("moveFrom") || ["rPr", "pPr", "instrText", "delInstrText", "drawing", "pict", "object"].includes(current.localName)) continue;
        if (current.namespace !== w) continue;
        if (current.localName === "t") { length += [...current.text].length; continue; }
        if (["tab", "ptab", "br", "cr", "noBreakHyphen", "softHyphen"].includes(current.localName)) { length++; continue; }
        const children = active(current);
        budget.charge("retainedBytes", children.length * 8);
        for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]!);
      }
      return length;
    };
    for (const node of paragraphChildren) {
      budget.charge("work", 1);
      if (node.namespace === w && node.localName === "pPr") continue;
      if (node.namespace !== w || node.localName !== "r") {
        barriers.push(offset); const length = opaqueLength(node);
        if (length) runs.push({ node, start: offset, end: offset + length, text: "", unsafe: true });
        offset += length; continue;
      }
      let unsafe = containsRevision(node, budget);
      let text = "";
      const runChildren = active(node);
      for (const child of runChildren) {
        if (child.namespace !== w || !["rPr", "t", "tab", "br", "cr"].includes(child.localName) || child.localName === "br" && child.attributes.some(a => a.localName === "type" && !["textWrapping"].includes(a.value))) unsafe = true;
        if (child.localName === "rPr") continue;
        if (child.namespace === w) text += child.localName === "t" ? child.text : ["tab", "ptab"].includes(child.localName) ? "\t" : ["br", "cr"].includes(child.localName) ? "\n" : ["noBreakHyphen", "softHyphen"].includes(child.localName) ? child.localName === "noBreakHyphen" ? "\u2011" : "\u00ad" : "";
      }
      budget.charge("retainedBytes", text.length * 4);
      const length = [...text].length; runs.push({ node, text, start: offset, end: offset + length, unsafe, native: runChildren.some(child => !node.children.includes(child)) }); offset += length;
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
        assertOutsideFields(fields, run.synthetic ? location.value.path : runPaths.get(run.node)!);
        const records = affected.get(run) ?? [];
        records.push({ start: Math.max(edit.start, run.start) - run.start, end: Math.min(edit.end, run.end) - run.start, text: run === selected.at(-1) ? edit.text : "", source, edit });
        affected.set(run, records);
      }
    }
    const patches = new Map<XmlElement, string | NativePatch>();
    for (const [run, records] of affected) {
      if (run.native) {
        const patch: NativePatch = { fragments: [], wrappers: [] };
        const leaves = active(run.node).filter(child => child.namespace === w && child.localName !== "rPr");
        const append = (start: number, end: number, kind?: "ins" | "del", inserted?: string, source = run.node, formatting?: TrackedTextEdit) => {
          const content = new Map<XmlElement, string>();
          if (inserted !== undefined) content.set(leaves[0]!, runTextContent(w, inserted, false));
          else {
            let offset = 0;
            for (const leaf of leaves) {
              const scalars = leaf.localName === "t" ? [...leaf.text] : [""];
              const from = Math.max(0, start - offset), to = Math.min(scalars.length, end - offset);
              offset += scalars.length;
              if (from >= to) continue;
              if (leaf.localName !== "t" || kind !== "del" && from === 0 && to === scalars.length) content.set(leaf, xml.sourceXml(leaf));
              else {
                const prefix = leaf.name.includes(":") ? leaf.name.slice(0, leaf.name.indexOf(":") + 1) : "";
                const name = kind === "del" ? prefix + "delText" : leaf.name;
                const attributes = leaf.attributes.filter(attribute => !(attribute.namespace === "http://www.w3.org/XML/1998/namespace" && attribute.localName === "space"));
                content.set(leaf, opening({ ...leaf, name, attributes }).slice(0, -1) + ` xml:space="preserve">${xmlValue(scalars.slice(from, to).join(""))}</${name}>`);
              }
            }
          }
          patch.fragments.push({ properties: runProperties(source, xml, budget, formatting), content });
          patch.wrappers.push(kind ? wrap(kind, "", w) : null);
        };
        let position = 0;
        for (const record of records) {
          if (position < record.start) append(position, record.start);
          if (record.start < record.end) append(record.start, record.end, "del");
          if (record.text) append(0, 0, "ins", record.text, record.source.node, record.edit);
          position = record.end;
        }
        if (position < [...run.text].length) append(position, [...run.text].length);
        patches.set(run.node, patch); continue;
      }
      const scalars = [...run.text]; let position = 0, markup = "";
      for (const record of records) {
        if (position < record.start) markup += textRun(run.node, scalars.slice(position, record.start).join(""), xml, budget, false);
        if (record.start < record.end) markup += wrap("del", textRun(run.node, scalars.slice(record.start, record.end).join(""), xml, budget, true), w);
        if (record.text) markup += wrap("ins", textRun(record.source.node, record.text, xml, budget, false, record.edit), w);
        position = record.end;
      }
      if (position < scalars.length) markup += textRun(run.node, scalars.slice(position).join(""), xml, budget, false);
      if (!run.synthetic) patches.set(run.node, markup);
      else patches.set(paragraph, xml.sourceXml(paragraph, new Map(), true) + markup);
    }
    staged.push({ xml, paragraph, patches });
  }
  for (const { xml, paragraph, patches } of staged) {
    const paragraphPatch = patches.get(paragraph);
    if (typeof paragraphPatch === "string") xml.replaceElement(paragraph, opening(paragraph) + paragraphPatch + `</${paragraph.name}>`);
    else for (const [run, patch] of patches) {
      if (typeof patch === "string") xml[replaceSplitTextRunXml](run, patch);
      else xml[splitNativeTextRunXml](run, patch.fragments, true, (markup, index) => {
        const wrapper = patch.wrappers[index];
        if (!wrapper) return markup;
        const openingEnd = wrapper.indexOf(">") + 1;
        return wrapper.slice(0, openingEnd) + markup + wrapper.slice(openingEnd);
      });
    }
  }
}
