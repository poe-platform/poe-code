import { assertOutsideRevisionRanges, containsRevision, revisionInfo } from "./revision-markup.js";
import { archiveSettings } from "./archive.js";
import { validateDocxInvocation } from "./command.js";
import { xmlValue } from "./create-content.js";
import { openDocumentLocations } from "./locations.js";
import { encodeLocation, SelectionError, type Location } from "./location-token.js";
import { pathContains } from "./location-index.js";
import { resolveDocxSelection } from "./simple-selection.js";
import { stageTrackedText, type TrackedTextEdit } from "./tracked-text.js";
import { DocumentArchiveEditor } from "./package-write.js";
import { type XmlElement } from "./package-xml.js";
import { UnsupportedEditError, type DocumentXmlEditor } from "./xml-write.js";
import { assertDocumentEditable, publishDocumentArchive, type PublicationContext, type PublicationInput } from "./publication.js";
import type { DocxOperationArguments } from "./operation-types.js";

export type TextReplaceOptions = DocxOperationArguments<"text.replace"> & { readonly input?: PublicationInput };
export interface TextMutationData {
  readonly changed: boolean;
  readonly changes: readonly { readonly kind: "replace"; readonly before: Location; readonly after: Location }[];
  readonly output: { readonly path: string | null; readonly bytes: number; readonly sha256: string } | null;
  readonly dryRun: boolean;
}
interface Leaf { node: XmlElement; run: XmlElement; editor: DocumentXmlEditor; text: string; start: number; }
interface Match { paragraph: Location; leaves: { leaf: Leaf; start: number; end: number }[]; unsupported: boolean; }
interface Edit { start: number; end: number; insert: string; }

export function textMarkup(node: XmlElement, text: string): string {
  const prefix = node.name.includes(":") ? node.name.slice(0, node.name.indexOf(":")) + ":" : "";
  const name = node.localName === "delText" ? "delText" : "t";
  const namespace = prefix ? `xmlns:${prefix.slice(0, -1)}` : "xmlns";
  let result = "", pending = "";
  const flush = () => {
    if (pending) result += `<${prefix}${name} ${namespace}="${xmlValue(node.namespace)}" xml:space="preserve">${xmlValue(pending)}</${prefix}${name}>`;
    pending = "";
  };
  for (const char of text) {
    if (char === "\t" || char === "\n" || char === "\r") {
      flush();
      result += `<${prefix}${char === "\t" ? "tab" : "br"} ${namespace}="${xmlValue(node.namespace)}"/>`;
    } else pending += char;
  }
  flush();
  return result;
}

/** Preserving literal replacement over owned bytes and explicit publication capabilities. */
export async function replaceDocumentText(input: Uint8Array, options: TextReplaceOptions, context: PublicationContext): Promise<TextMutationData> {
  const settings = archiveSettings(context);
  const { input: identity, ...operationOptions } = options;
  const invocation = validateDocxInvocation({ operation: "text.replace", inputs: [identity?.path ?? "document"], options: operationOptions }, settings.budget);
  const opts = invocation.options as DocxOperationArguments<"text.replace">;
  const budget = settings.budget.lower(Object.fromEntries((opts.limit ?? []).map(item => [item.name, item.value])));
  xmlValue(opts.find); xmlValue(opts.with);
  const document = await openDocumentLocations(input, { ...settings, budget });
  const selected = resolveDocxSelection(document, invocation);
  const archive = document.snapshot();
  assertDocumentEditable(archive, { ...settings, budget });
  const editor = new DocumentArchiveEditor(archive, {}, undefined, budget);
  const matches: Match[] = [];
  const fields = new Map<string, boolean[]>();
  const reviewRanges = new Map<string, Set<string>>();
  for (const paragraph of document.list("paragraph", { scope: "all-stories" })) {
    budget.charge("work", selected.length + paragraph.value.path.length);
    const targets = selected.filter(target => target.value.story === paragraph.value.story &&
      (pathContains(target.value.path, paragraph.value.path) || pathContains(paragraph.value.path, target.value.path)));
    const xml = editor.xml(paragraph.value.part.slice(1));
    let node = xml.root;
    const ancestors: XmlElement[] = [node];
    for (const index of paragraph.value.path) { node = node.children[index]!; ancestors.push(node); }
    const w = node.namespace;
    const attr = (element: XmlElement, name: string) => element.attributes.find(a => a.namespace === w && a.localName === name)?.value;
    const visible = (name: string) => !(opts.view === "original" && ["ins", "moveTo"].includes(name) ||
      (opts.view ?? "final") === "final" && ["del", "moveFrom"].includes(name));
    const field = fields.get(paragraph.value.story) ?? [];
    fields.set(paragraph.value.story, field);
    let pieces: Leaf[] = [], logicalOffset = 0;
    const ranges = reviewRanges.get(paragraph.value.story) ?? new Set<string>();
    reviewRanges.set(paragraph.value.story, ranges);
    let unsupported = ancestors.some(n => !!revisionInfo(n) && !["ins", "del"].includes(n.localName));
    const flush = () => {
      const text = pieces.map(piece => piece.text).join("");
      budget.charge("work", text.length + 1);
      budget.charge("retainedBytes", text.length * 2);
      for (let offset = 0; offset <= text.length - opts.find.length;) {
        budget.charge("work", text.length - offset + opts.find.length);
        const start = text.indexOf(opts.find, offset);
        if (start < 0) break;
        const end = start + opts.find.length;
        let position = 0;
        const leaves: Match["leaves"] = [];
        for (const leaf of pieces) {
          budget.charge("work", 1);
          const from = Math.max(start, position), to = Math.min(end, position + leaf.text.length);
          if (from < to) leaves.push({ leaf, start: leaf.start + from - position, end: leaf.start + to - position });
          position += leaf.text.length;
        }
        budget.check("matches", matches.length + 1);
        budget.charge("retainedBytes", 256 + leaves.length * 64);
        matches.push({ paragraph, leaves, unsupported: unsupported || ranges.size > 0 });
        offset = end;
      }
      pieces = [];
    };
    if (ancestors.some(n => !visible(n.localName) || n.localName === "tr" && n.children.some(p => p.localName === "trPr" && p.children.some(c => !visible(c.localName))))) continue;
    const visit = (current: XmlElement, path: readonly number[], run?: XmlElement, runOffset = { value: 0 }): void => {
      budget.charge("work", targets.length + 1);
      if (current.namespace !== w) { flush(); return; }
      const name = current.localName;
      const review = revisionInfo(current);
      if (review && (name.endsWith("RangeStart") || name.endsWith("RangeEnd"))) {
        flush();
        const key = name.slice(0, name.lastIndexOf("Range")) + ":" + (review.id ?? "");
        if (name.endsWith("RangeStart")) ranges.add(key); else ranges.delete(key);
        return;
      }
      if (["rPr", "pPr", "sdtPr", "sdtEndPr", "lastRenderedPageBreak"].includes(name)) return;
      if (name === "fldChar") {
        flush();
        const type = attr(current, "fldCharType");
        if (type === "begin") field.push(false);
        else if (type === "separate" && field.length) field[field.length - 1] = true;
        else if (type === "end") field.pop();
        return;
      }
      const text = name === "t" || name === "delText" ? current.text : name === "tab" ? "\t" : name === "cr" ? "\n"
        : name === "br" ? attr(current, "type") === "page" ? "\f" : attr(current, "type") === "column" ? "\v" : "\n"
        : name === "noBreakHyphen" ? "\u2011" : name === "softHyphen" ? "\u00ad" : undefined;
      if (text !== undefined && run) {
        if (field.includes(false) || name === "delText" && (opts.view ?? "final") === "final") { flush(); return; }
        const scalars = [...text];
        budget.charge("work", text.length);
        budget.charge("retainedBytes", scalars.length * 8);
        const target = targets.find(target => pathContains(target.value.path, path));
        const offset = target?.kind === "run" ? runOffset.value : logicalOffset;
        const range = target?.value.range;
        const from = range ? Math.max(0, Math.min(scalars.length, range.start - offset)) : 0;
        const to = range ? Math.max(from, Math.min(scalars.length, range.end - offset)) : scalars.length;
        if (!target || from === to) flush();
        else {
          if (from) flush();
          pieces.push({ node: current, run, editor: xml, text: scalars.slice(from, to).join(""), start: scalars.slice(0, from).join("").length });
          if (to < scalars.length) flush();
        }
        logicalOffset += scalars.length; runOffset.value += scalars.length;
        return;
      }
      const container = ["hyperlink", "sdt", "sdtContent", "fldSimple", "ins", "del", "moveTo", "moveFrom"].includes(name);
      const changedProperties = ["p", "r"].includes(name) && current.children.some(props => props.namespace === w &&
        props.localName === name + "Pr" && containsRevision(props));
      if (container || changedProperties) flush();
      if (!visible(name)) return;
      if (!["p", "r"].includes(name) && !container) { flush(); return; }
      const previous = unsupported;
      unsupported ||= changedProperties || ["moveTo", "moveFrom"].includes(name);
      const childOffset = name === "r" ? { value: 0 } : runOffset;
      current.children.forEach((child, i) => visit(child, [...path, i], name === "r" ? current : run, childOffset));
      if (container || changedProperties) flush();
      unsupported = previous;
    };
    visit(node, paragraph.value.path);
    flush();
  }
  const chosen = opts.first ? matches.slice(0, 1) : opts.occurrence === undefined ? matches : matches.slice(opts.occurrence - 1, opts.occurrence);
  if (!chosen.length && !opts.allowEmpty) throw new SelectionError("missing-selection");
  if (chosen.some(match => match.unsupported)) throw new UnsupportedEditError("Complex revision text cannot be edited.");
  for (const match of chosen) for (const { leaf } of match.leaves)
    assertOutsideRevisionRanges(leaf.editor.root, leaf.run, budget, leaf.editor.compatibility.branches);
  if (chosen.some(match => document.references(match.paragraph.token).length > 1)) throw new SelectionError("ambiguous-selection");
  const explicit = opts.bold !== undefined || opts.italic !== undefined;
  const changedMatches = chosen.filter(match => opts.find !== opts.with || explicit || match.leaves.some(item => item.leaf.run !== match.leaves[0]!.leaf.run));
  const edits = new Map<Leaf["node"], { leaf: Leaf; edits: Edit[] }>();
  for (const match of changedMatches) match.leaves.forEach(({ leaf, start, end }, i) => {
    const record = edits.get(leaf.node) ?? { leaf, edits: [] };
    record.edits.push({ start, end, insert: i ? "" : opts.with });
    edits.set(leaf.node, record);
  });
  if (opts.trackChanges) {
    const tracked: TrackedTextEdit[] = [];
    for (const match of changedMatches) {
      const first = match.leaves[0]!, last = match.leaves.at(-1)!;
      const xml = first.leaf.editor;
      let paragraph = xml.root;
      for (const i of match.paragraph.value.path) paragraph = paragraph.children[i]!;
      let position = 0, start = -1, end = -1;
      const visit = (node: XmlElement) => {
        budget.charge("work", 1);
        const info = revisionInfo(node);
        if (node.namespace !== paragraph.namespace || info?.support === "opaque" || info?.type === "delete" || info?.markup.startsWith("moveFrom") ||
          ["rPr", "pPr", "instrText", "delInstrText", "drawing", "pict", "object"].includes(node.localName)) return;
        const text = node.localName === "t" ? node.text : ["tab", "br", "cr"].includes(node.localName) ? "\n" : undefined;
        if (text !== undefined) {
          if (node === first.leaf.node) start = position + [...text.slice(0, first.start)].length;
          if (node === last.leaf.node) end = position + [...text.slice(0, last.end)].length;
          position += [...text].length;
        } else for (const child of node.children) visit(child);
      };
      visit(paragraph);
      tracked.push({ paragraph: match.paragraph, start, end, text: opts.with, ...(opts.bold === undefined ? {} : { bold: opts.bold }), ...(opts.italic === undefined ? {} : { italic: opts.italic }) });
    }
    stageTrackedText(editor, tracked, { author: opts.author!, timestamp: opts.timestamp! }, budget, settings.limits);
  }
  const runs = new Map<XmlElement, { editor: DocumentXmlEditor; patches: Map<XmlElement, string> }>();
  for (const { leaf, edits: changes } of opts.trackChanges ? [] : edits.values()) {
    const original = leaf.node.localName === "t" || leaf.node.localName === "delText" ? leaf.node.text : leaf.text;
    let offset = 0, text = "", markup = "";
    for (const change of changes) {
      text += original.slice(offset, change.start) + change.insert;
      if (explicit) {
        markup += textMarkup(leaf.node, original.slice(offset, change.start));
        if (change.insert) markup += `</${leaf.run.name}>` + formattedRun(leaf, change.insert, opts) + runOpen(leaf.run) + runProperties(leaf);
      }
      offset = change.end;
    }
    text += original.slice(offset);
    if (!explicit) leaf.editor.replaceElement(leaf.node, textMarkup(leaf.node, text));
    else {
      markup += textMarkup(leaf.node, original.slice(offset));
      const run = runs.get(leaf.run) ?? { editor: leaf.editor, patches: new Map() };
      run.patches.set(leaf.node, markup); runs.set(leaf.run, run);
    }
  }
  for (const [run, { editor: xml, patches }] of runs) {
    xml.replaceElement(run, xml.sourceXml(run, patches));
  }
  const changed = edits.size > 0;
  const changes = changedMatches.map(match => {
    const before = match.paragraph;
    const value = { ...before.value, generation: 1 };
    return { kind: "replace" as const, before, after: { ...before, value, token: encodeLocation(value) } };
  });
  const publication = { ...(identity ? { input: identity } : {}), ...(opts.output === undefined ? {} : { output: opts.output }),
    ...(opts.inPlace === undefined ? {} : { inPlace: opts.inPlace }), ...(opts.force === undefined ? {} : { force: opts.force }),
    ...(opts.dryRun === undefined ? {} : { dryRun: opts.dryRun }), ...(opts.json === undefined ? {} : { json: opts.json }) };
  const prospective: TextMutationData = { changed, changes, dryRun: opts.dryRun ?? false, output: opts.dryRun ? null : {
    path: opts.inPlace ? identity?.path ?? null : opts.output === "-" ? null : opts.output ?? null, bytes: settings.limits.maxArchiveBytes, sha256: "0".repeat(64) } };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify({ version: 1, operation: "text.replace", ok: true,
    data: prospective, affected: changes.length, locations: changes.map(c => c.after), warnings: [], errors: [] }) + "\n").length);
  const result = await publishDocumentArchive(editor.snapshot(), publication, { ...context, budget });
  return { changed, changes, dryRun: opts.dryRun ?? false, output: result.published.length ? {
    path: result.published[0]!.path, bytes: result.published[0]!.bytes, sha256: result.archiveSha256! } : null };
}

function runOpen(run: XmlElement): string {
  return `<${run.name}${[...run.namespaces].filter(([prefix]) => prefix !== "xml").map(([prefix, value]) => ` ${prefix ? "xmlns:" + prefix : "xmlns"}="${xmlValue(value)}"`).join("")}${run.attributes.filter(a => a.namespace !== "http://www.w3.org/2000/xmlns/").map(a => ` ${a.name}="${xmlValue(a.value)}"`).join("")}>`;
}
function runProperties(leaf: Leaf): string {
  const props = leaf.run.children.find(child => child.namespace === leaf.run.namespace && child.localName === "rPr");
  return props ? leaf.editor.sourceXml(props) : "";
}
function formattedRun(leaf: Leaf, text: string, opts: DocxOperationArguments<"text.replace">): string {
  const w = leaf.run.namespace;
  const props = leaf.run.children.find(child => child.namespace === w && child.localName === "rPr");
  const removed = new Map(props?.children.filter(child => child.namespace === w &&
    (child.localName === "b" && opts.bold !== undefined || child.localName === "i" && opts.italic !== undefined)).map(child => [child, ""] as const));
  const retained = props ? leaf.editor.sourceXml(props, removed, true) : "";
  const overrides = (opts.bold === undefined ? "" : `<w:b xmlns:w="${xmlValue(w)}" w:val="${Number(opts.bold)}"/>`) + (opts.italic === undefined ? "" : `<w:i xmlns:w="${xmlValue(w)}" w:val="${Number(opts.italic)}"/>`);
  const properties = props ? runOpen(props) + retained + overrides + `</${props.name}>` : `<w:rPr xmlns:w="${xmlValue(w)}">${overrides}</w:rPr>`;
  return runOpen(leaf.run) + properties + textMarkup(leaf.node, text) + `</${leaf.run.name}>`;
}
