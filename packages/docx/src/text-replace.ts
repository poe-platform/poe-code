import { documentDialects, dialectForNamespace } from "./dialect.js";
import { assertOutsideRevisionRanges, revisionInfo } from "./revision-markup.js";
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
import { UnsupportedEditError, replaceSplitTextRunXml, splitNativeTextRunXml, type DocumentXmlEditor } from "./xml-write.js";
import { assertDocumentEditable, publishDocumentArchive, type PublicationContext, type PublicationInput } from "./publication.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { activeControlLocks } from "./protection.js";
import { compatibilityContainers } from "./compatibility.js";
import { activeXmlChildren } from "./xml-active-children.js";
import { formattedRunProperties, runElementOpen } from "./run-properties.js";
import type { DocumentBudget } from "./budget.js";

export type DummyTextOptions = DocxOperationArguments<"lorem.set"> & { readonly input?: PublicationInput };
export type TextReplaceOptions = DocxOperationArguments<"text.replace"> & { readonly input?: PublicationInput };
export interface TextMutationData {
  readonly changed: boolean;
  readonly changes: readonly { readonly kind: "replace"; readonly before: Location; readonly after: Location }[];
  readonly output: { readonly path: string | null; readonly bytes: number; readonly sha256: string } | null;
  readonly dryRun: boolean;
}
interface Leaf { node: XmlElement; run: XmlElement; editor: DocumentXmlEditor; text: string; start: number; }
interface Match { empty?: { node: XmlElement; editor: DocumentXmlEditor }; insert?: string; paragraph: Location; leaves: { leaf: Leaf; start: number; end: number }[]; unsupported: boolean; }
interface Edit { start: number; end: number; insert: string; }

export function textMarkup(node: XmlElement, text: string): string {
  const prefix = node.name.includes(":") ? node.name.slice(0, node.name.indexOf(":")) + ":" : "";
  const name = node.localName === "delText" ? "delText" : "t";
  const attributes = node.attributes.filter(attribute => attribute.namespace !== "http://www.w3.org/XML/1998/namespace" || attribute.localName !== "space")
    .filter(attribute => ["t", "delText"].includes(node.localName) || ["http://www.w3.org/2000/xmlns/", "http://www.w3.org/XML/1998/namespace"].includes(attribute.namespace));
  const open = (localName: string) => runElementOpen({ ...node, name: prefix + localName, localName, attributes });
  let result = "", pending = "";
  const flush = () => {
    if (pending) result += open(name).slice(0, -1) + ` xml:space="preserve">${xmlValue(pending)}</${prefix}${name}>`;
    pending = "";
  };
  for (const char of text) {
    if (char === "\t" || char === "\n" || char === "\r") {
      flush();
      result += open(char === "\t" ? "tab" : "br").slice(0, -1) + "/>";
    } else pending += char;
  }
  flush();
  return result;
}

/** Preserving literal replacement over owned bytes and explicit publication capabilities. */
export async function replaceDocumentText(input: Uint8Array, options: TextReplaceOptions, context: PublicationContext): Promise<TextMutationData> {
  xmlValue(options.find); xmlValue(options.with);
  return mutateDocumentText(input, options, context, "text.replace");
}

/** Seeded placeholder text only; this is not anonymization. */
export async function setDocumentDummyText(input: Uint8Array, options: DummyTextOptions, context: PublicationContext): Promise<TextMutationData> {
  const settings = archiveSettings(context);
  validateDocxInvocation({ operation: "lorem.set", inputs: [options.input?.path ?? "document"], options: Object.fromEntries(Object.entries(options).filter(([key]) => key !== "input")) }, settings.budget);
  return mutateDocumentText(input, options, context, "lorem.set");
}

async function mutateDocumentText(input: Uint8Array, options: TextReplaceOptions | DummyTextOptions, context: PublicationContext,
  operation: "text.replace" | "lorem.set"): Promise<TextMutationData> {
  const settings = archiveSettings(context);
  const dummy = operation === "lorem.set";
  const { input: identity, ...operationOptions } = options;
  const invocation = validateDocxInvocation({ operation, inputs: [identity?.path ?? "document"], options: operationOptions }, settings.budget);
  const opts = invocation.options as DocxOperationArguments<"text.replace"> & Partial<DocxOperationArguments<"lorem.set">>;
  const budget = settings.budget.lower(Object.fromEntries((opts.limit ?? []).map(item => [item.name, item.value])));
  const document = await openDocumentLocations(input, { ...settings, budget });
  const selected = resolveDocxSelection(document, invocation);
  const archive = document.snapshot();
  assertDocumentEditable(archive, { ...settings, budget }, archive);
  const editor = new DocumentArchiveEditor(archive, {}, undefined, budget);
  const matches: Match[] = [];
  const fields = new Map<string, boolean[]>();
  const reviewRanges = new Map<string, Set<string>>();
  const partLocks = new Map<XmlElement, ReadonlySet<XmlElement>>();
  for (const paragraph of document.list("paragraph", { scope: "all-stories" })) {
    budget.charge("work", selected.length + paragraph.value.path.length);
    const targets = selected.filter(target => target.value.story === paragraph.value.story &&
      (pathContains(target.value.path, paragraph.value.path) || pathContains(paragraph.value.path, target.value.path)));
    const xml = editor.xml(paragraph.value.part.slice(1));
    const containers = new Set(xml.compatibility[compatibilityContainers]);
    const branches = new Map(xml.compatibility.branches.map(branch => [branch.alternateContent, branch.selected]));
    const activeChildren = activeXmlChildren(xml, budget);
    const containsActiveRevision = (element: XmlElement): boolean =>
      revisionInfo(element) !== undefined || activeChildren(element).some(containsActiveRevision);
    let node = xml.root;
    const ancestors: XmlElement[] = [node];
    for (const index of paragraph.value.path) { node = node.children[index]!; ancestors.push(node); }
    const w = node.namespace;
    const wordDrawingNamespace = documentDialects[dialectForNamespace(w)!].wp;
    let storyOwner: XmlElement | undefined;
    for (const owner of ancestors) if (owner.namespace === w && ["body", "hdr", "ftr", "comment", "footnote", "endnote", "txbxContent"].includes(owner.localName) || owner.namespace === wordDrawingNamespace && owner.localName === "txbxContent") storyOwner = owner;
    const attr = (element: XmlElement, name: string) => element.attributes.find(a => a.namespace === w && a.localName === name)?.value;
    const visible = (name: string) => !(opts.view === "original" && ["ins", "moveTo"].includes(name) ||
      (opts.view ?? "final") === "final" && ["del", "moveFrom"].includes(name));
    const field = fields.get(paragraph.value.story) ?? [];
    fields.set(paragraph.value.story, field);
    let pieces: Leaf[] = [], logicalOffset = 0;
    const paragraphPieces: Leaf[] = [];
    let paragraphUnsafe = false;
    const ranges = reviewRanges.get(paragraph.value.story) ?? new Set<string>();
    reviewRanges.set(paragraph.value.story, ranges);
    let lockedOwners = partLocks.get(xml.root);
    if (!lockedOwners) {
      lockedOwners = new Set([...activeControlLocks(xml.root, xml.compatibility, budget)].filter(([lock]) => attr(lock, "val") !== "unlocked").map(([, binding]) => binding.owner));
      partLocks.set(xml.root, lockedOwners);
    }
    let unsupported = ancestors.some(n => lockedOwners.has(n) || !!revisionInfo(n) && !["ins", "del"].includes(n.localName));
    const flush = () => {
      if (dummy) {
        paragraphPieces.push(...pieces);
        paragraphUnsafe ||= pieces.length > 0 && (unsupported || ranges.size > 0);
        pieces = [];
        return;
      }
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
    type TraversalRequest = { current: XmlElement; path: readonly number[]; run: XmlElement | undefined; runOffset: { value: number } };
    const visit = function* (current: XmlElement, path: readonly number[], run?: XmlElement, runOffset = { value: 0 }): Generator<TraversalRequest, void, void> {
      budget.charge("work", targets.length + 1);
      if (current.namespace !== w) {
        if (branches.has(current)) {
          const selectedBranch = branches.get(current);
          if (selectedBranch) {
            budget.charge("work", path.length + 1); budget.charge("retainedBytes", 128 + (path.length + 1) * 8);
            yield { current: selectedBranch, path: [...path, current.children.indexOf(selectedBranch)], run, runOffset };
          }
        } else if (containers.has(current)) {
          for (let index = 0; index < current.children.length; index++) {
            budget.charge("work", path.length + 1); budget.charge("retainedBytes", 128 + (path.length + 1) * 8);
            yield { current: current.children[index]!, path: [...path, index], run, runOffset };
          }
        } else flush();
        return;
      }
      const name = current.localName;
      const review = revisionInfo(current);
      if (review && (name.endsWith("RangeStart") || name.endsWith("RangeEnd"))) {
        flush();
        const key = name.slice(0, name.lastIndexOf("Range")) + ":" + (review.id ?? "");
        if (name.endsWith("RangeStart")) ranges.add(key); else ranges.delete(key);
        return;
      }
      if (["rPr", "pPr", "sdtPr", "sdtEndPr", "lastRenderedPageBreak"].includes(name)) return;
      if ((name === "annotationRef" && storyOwner?.localName === "comment" ||
        name === "footnoteRef" && storyOwner?.localName === "footnote" ||
        name === "endnoteRef" && storyOwner?.localName === "endnote") && !current.children.length && !current.text.trim()) return;
      if (name === "fldChar") {
        flush();
        const type = attr(current, "fldCharType");
        if (type === "begin") field.push(false);
        else if (type === "separate" && field.length) field[field.length - 1] = true;
        else if (type === "end") field.pop();
        return;
      }
      const text = name === "t" || name === "delText" ? current.text : name === "tab" || name === "ptab" ? "\t" : name === "cr" ? "\n"
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
      const changedProperties = ["p", "r"].includes(name) && activeChildren(current).some(props => props.namespace === w &&
        props.localName === name + "Pr" && containsActiveRevision(props));
      if (container || changedProperties) flush();
      if (!visible(name)) return;
      if (!["p", "r"].includes(name) && !container) { flush(); return; }
      const previous = unsupported;
      unsupported ||= lockedOwners.has(current) || changedProperties || ["moveTo", "moveFrom"].includes(name);
      const childOffset = name === "r" ? { value: 0 } : runOffset;
      for (let i = 0; i < current.children.length; i++) {
        budget.charge("work", path.length + 1); budget.charge("retainedBytes", 128 + (path.length + 1) * 8);
        yield { current: current.children[i]!, path: [...path, i], run: name === "r" ? current : run, runOffset: childOffset };
      }
      if (container || changedProperties) flush();
      unsupported = previous;
    };
    budget.charge("retainedBytes", 128);
    const pending = [visit(node, paragraph.value.path)];
    while (pending.length) {
      const step = pending[pending.length - 1]!.next();
      if (step.done) pending.pop();
      else {
        const request = step.value;
        pending.push(visit(request.current, request.path, request.run, request.runOffset));
      }
    }
    flush();
    if (dummy && targets.length) {
      const text = paragraphPieces.map(piece => piece.text).join("");
      budget.charge("work", text.length + 1);
      let count = 0, inside = false;
      for (const scalar of text) {
        if (scalar.trim() === "") inside = false;
        else if (!inside) { count++; inside = true; }
      }
      count = opts.words ?? count;
      if (count === 0) continue;
      const leaves = paragraphPieces.filter(leaf => leaf.node.localName === "t").map(leaf => ({ leaf, start: leaf.start, end: leaf.start + leaf.text.length }));
      const empty = !leaves.length && targets.some(target => target.kind === "paragraph" && target.value.range === null && target.token === paragraph.token) && node.children.every(child => child.namespace === w && child.localName === "pPr") ? { node, editor: xml } : undefined;
      if (!leaves.length && !empty) throw new UnsupportedEditError("Explicit word insertion requires an editable empty paragraph or existing text leaf.");
      budget.check("matches", matches.length + 1);
      budget.charge("work", count);
      budget.charge("retainedBytes", count * 12 + leaves.length * 64 + 256);
      budget.check("xmlPartBytes", count * 6);
      const vocabulary = ["amber", "birch", "cedar", "delta", "elm", "fern", "grove", "heath"];
      const seed = ((opts.seed! % 4294967296) + 4294967296) % 4294967296;
      const words: string[] = [];
      for (let i = 0; i < count; i++) { await budget.checkpoint(1); words.push(vocabulary[(seed + i) % 8]!); }
      matches.push({ paragraph, leaves, unsupported: paragraphUnsafe || !!empty && unsupported, insert: words.join(" "), ...(empty ? { empty } : {}) });
    }
  }
  const chosen = opts.first ? matches.slice(0, 1) : opts.occurrence === undefined ? matches : matches.slice(opts.occurrence - 1, opts.occurrence);
  if (!chosen.length && !opts.allowEmpty && (!dummy || opts.words !== undefined)) throw new SelectionError("missing-selection");
  if (chosen.some(match => match.unsupported)) throw new UnsupportedEditError("Affected text includes protected or unsupported structures.");
  for (const match of chosen) {
    if (match.empty) {
      match.empty.editor.assertShapeEditAllowed(match.empty.node);
      assertOutsideRevisionRanges(match.empty.editor.root, match.empty.node, budget, match.empty.editor.compatibility.branches);
    }
    for (const { leaf } of match.leaves) {
      leaf.editor.assertShapeEditAllowed(leaf.node);
      assertOutsideRevisionRanges(leaf.editor.root, leaf.run, budget, leaf.editor.compatibility.branches);
    }
  }
  if (chosen.some(match => document.references(match.paragraph.token).length > 1)) throw new SelectionError("ambiguous-selection");
  const explicit = opts.bold !== undefined || opts.italic !== undefined;
  const changedMatches = chosen.filter(match => {
    if (dummy) return match.insert !== match.leaves.map(item => item.leaf.text).join("");
    if (opts.find !== opts.with || match.leaves.some(item => item.leaf.run !== match.leaves[0]!.leaf.run)) return true;
    if (!explicit) return false;
    const first = match.leaves[0]!.leaf, children = activeXmlChildren(first.editor, budget);
    const props = children(first.run).find(child => child.namespace === first.run.namespace && child.localName === "rPr");
    return formattedRunProperties(first.editor, first.run, { ...(opts.bold === undefined ? {} : { bold: opts.bold }), ...(opts.italic === undefined ? {} : { italic: opts.italic }) }, children) !== (props ? first.editor.sourceXml(props) : "");
  });
  const edits = new Map<Leaf["node"], { leaf: Leaf; edits: Edit[] }>();
  for (const match of changedMatches) {
    if (match.empty) match.empty.editor.insertChildren(match.empty.node, `<w:r xmlns:w="${xmlValue(match.empty.node.namespace)}"><w:t xml:space="preserve">${xmlValue(match.insert!)}</w:t></w:r>`);
    let offset = 0;
    match.leaves.forEach(({ leaf, start, end }, i) => {
      const record = edits.get(leaf.node) ?? { leaf, edits: [] };
      const length = i === match.leaves.length - 1 ? match.insert?.length ?? 0 : end - start;
      const insert = dummy ? match.insert!.slice(offset, offset + length) : i ? "" : opts.with;
      offset += length;
      record.edits.push({ start, end, insert });
      edits.set(leaf.node, record);
    });
  }
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
  const nativeSplits = new Map<XmlElement, DocumentXmlEditor>();
  const runs = new Map<XmlElement, { editor: DocumentXmlEditor; patches: Map<XmlElement, string>; whole?: { properties: string; props?: XmlElement } }>();
  for (const { leaf, edits: changes } of opts.trackChanges ? [] : edits.values()) {
    const original = leaf.node.localName === "t" || leaf.node.localName === "delText" ? leaf.node.text : leaf.text;
    let offset = 0, text = "", markup = "";
    for (const change of changes) {
      text += original.slice(offset, change.start) + change.insert;
      if (explicit) {
        markup += textMarkup(leaf.node, original.slice(offset, change.start));
        if (change.insert) markup += `</${leaf.run.name}>` + formattedRun(leaf, change.insert, opts, budget) + runOpen(leaf.run) + runProperties(leaf);
      }
      offset = change.end;
    }
    text += original.slice(offset);
    if (!explicit) leaf.editor.replaceElement(leaf.node, textMarkup(leaf.node, text));
    else {
      const children = activeXmlChildren(leaf.editor, budget);
      const content = children(leaf.run).filter(child => child.namespace !== leaf.run.namespace || child.localName !== "rPr");
      const complete = content.length > 0 && content.every(child => {
        budget.charge("work", 1);
        const item = edits.get(child);
        const original = child.namespace === leaf.run.namespace && ["t", "delText"].includes(child.localName) ? child.text : item?.leaf.text;
        return original === "" || original !== undefined && item?.leaf.run === leaf.run && item.edits[0]!.start === 0 && item.edits.at(-1)!.end === original.length &&
          item.edits.every((change, index) => index === 0 || item.edits[index - 1]!.end === change.start);
      });
      if (complete) {
        const run = runs.get(leaf.run) ?? { editor: leaf.editor, patches: new Map<XmlElement, string>() };
        if (!run.whole) {
          const props = children(leaf.run).find(child => child.namespace === leaf.run.namespace && child.localName === "rPr");
          const properties = formattedRunProperties(leaf.editor, leaf.run,
            { ...(opts.bold === undefined ? {} : { bold: opts.bold }), ...(opts.italic === undefined ? {} : { italic: opts.italic }) }, children);
          run.whole = { properties, ...(props ? { props } : {}) };
          if (props) run.patches.set(props, properties);
        }
        run.patches.set(leaf.node, textMarkup(leaf.node, text));
        runs.set(leaf.run, run);
        continue;
      }
      if (leaf.run.children.some(child => child.namespace !== leaf.run.namespace || child.localName === "rPr" && child.children.some(property => property.namespace !== leaf.run.namespace))) { nativeSplits.set(leaf.run, leaf.editor); continue; }
      markup += textMarkup(leaf.node, original.slice(offset));
      const run = runs.get(leaf.run) ?? { editor: leaf.editor, patches: new Map() };
      run.patches.set(leaf.node, markup); runs.set(leaf.run, run);
    }
  }
  for (const [run, xml] of nativeSplits) {
    const children = activeXmlChildren(xml, budget), props = children(run).find(child => child.namespace === run.namespace && child.localName === "rPr");
    const originalProperties = props ? xml.sourceXml(props) : "";
    const changedProperties = formattedRunProperties(xml, run, { ...(opts.bold === undefined ? {} : { bold: opts.bold }), ...(opts.italic === undefined ? {} : { italic: opts.italic }) }, children);
    const fragments: { formatted: boolean; properties: string; content: Map<XmlElement, string> }[] = [];
    const append = (leaf: XmlElement, markup: string, formatted: boolean) => {
      if (!markup) return;
      let fragment = fragments.at(-1);
      if (!fragment || fragment.formatted !== formatted) { fragment = { formatted, properties: formatted ? changedProperties : originalProperties, content: new Map() }; fragments.push(fragment); }
      fragment.content.set(leaf, (fragment.content.get(leaf) ?? "") + markup);
    };
    for (const leaf of children(run)) {
      if (leaf === props) continue;
      const item = edits.get(leaf);
      if (!item) { append(leaf, xml.sourceXml(leaf), false); continue; }
      const original = ["t", "delText"].includes(leaf.localName) ? leaf.text : item.leaf.text;
      let offset = 0;
      for (const change of item.edits) {
        append(leaf, textMarkup(leaf, original.slice(offset, change.start)), false);
        append(leaf, textMarkup(leaf, change.insert), true);
        offset = change.end;
      }
      append(leaf, textMarkup(leaf, original.slice(offset)), false);
    }
    if (!fragments.length) fragments.push({ formatted: false, properties: originalProperties, content: new Map() });
    xml[splitNativeTextRunXml](run, fragments);
  }
  for (const [run, { editor: xml, patches, whole }] of runs) {
    const markup = whole && !whole.props ? runOpen(run) + whole.properties + xml.sourceXml(run, patches, true) + `</${run.name}>` : xml.sourceXml(run, patches);
    xml[replaceSplitTextRunXml](run, markup);
  }
  const changed = changedMatches.length > 0;
  const changes = changedMatches.map(match => {
    const before = match.paragraph;
    const value = { ...before.value, generation: 1 };
    return { kind: "replace" as const, before, after: { ...before, value, token: encodeLocation(value) } };
  });
  const publication = { ...(identity ? { input: identity } : {}), ...(opts.output === undefined ? {} : { output: opts.output }),
    ...(opts.inPlace === undefined ? {} : { inPlace: opts.inPlace }), ...(opts.force === undefined ? {} : { force: opts.force }),
    ...(opts.dryRun === undefined ? {} : { dryRun: opts.dryRun }), ...(opts.json === undefined ? {} : { json: opts.json }) };
  const prospective: TextMutationData = { changed, changes, dryRun: opts.dryRun ?? false, output: opts.dryRun ? null : {
    path: opts.inPlace ? identity?.path ?? null : opts.output === "-" ? null : opts.output ?? null, bytes: Math.min(settings.limits.maxArchiveBytes, Number.MAX_SAFE_INTEGER), sha256: "0".repeat(64) } };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify({ version: 1, operation, ok: true,
    data: prospective, affected: changes.length, locations: changes.map(c => c.after), warnings: [], errors: [] }) + "\n").length);
  const result = await publishDocumentArchive(editor.snapshot(), publication, { ...context, budget }, archive);
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
function formattedRun(leaf: Leaf, text: string, opts: DocxOperationArguments<"text.replace">, budget: DocumentBudget): string {
  const properties = formattedRunProperties(leaf.editor, leaf.run,
    { ...(opts.bold === undefined ? {} : { bold: opts.bold }), ...(opts.italic === undefined ? {} : { italic: opts.italic }) },
    activeXmlChildren(leaf.editor, budget));
  return runOpen(leaf.run) + properties + textMarkup(leaf.node, text) + `</${leaf.run.name}>`;
}
