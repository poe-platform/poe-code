import { archiveSettings, InvalidValueError } from "./archive.js";
import { DocxUsageError } from "./argument-json.js";
import { validateDocxInvocation } from "./command.js";
import { closedRecord, encodeLocation, type Location } from "./location-token.js";
import { openDocumentLocations } from "./locations.js";
import { dialectForNamespace } from "./dialect.js";
import { addressKey, LocationIndex, pathContains } from "./location-index.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { DocumentArchiveEditor } from "./package-write.js";
import type { XmlElement } from "./package-xml.js";
import { assertDocumentEditable, publishDocumentArchive, type PublicationContext, type PublicationInput } from "./publication.js";
import { assertOutsideRevisionRanges, containsRevision } from "./revision-markup.js";
import { runElementOpen } from "./run-properties.js";
import { resolveDocxSelection } from "./simple-selection.js";
import { textMarkup } from "./text-replace.js";
import { UnsupportedEditError, type DocumentXmlEditor } from "./xml-write.js";

export type ContentRemovalOperation = "paragraphs.remove" | "runs.remove" | "tables.remove";
export type ContentRemovalRequest = { [K in ContentRemovalOperation]: { readonly operation: K; readonly options: DocxOperationArguments<K>; readonly input?: PublicationInput } }[ContentRemovalOperation];
export interface ContentRemovalData {
  readonly changed: boolean;
  readonly changes: readonly { readonly kind: "remove"; readonly before: Location; readonly after: Location | null }[];
  readonly output: { readonly path: string | null; readonly bytes: number; readonly sha256: string } | null;
  readonly dryRun: boolean;
}
const annotationNames = new Set(["bookmarkStart", "bookmarkEnd", "commentRangeStart", "commentRangeEnd", "commentReference", "permStart", "permEnd"]);
const blockContainers = new Set(["body", "tc", "hdr", "ftr", "footnote", "endnote", "comment", "txbxContent", "sdtContent"]);

/** Exact scoped deletion; outgoing relationships and resources are conservatively retained. */
export async function removeDocumentContent(input: Uint8Array, request: ContentRemovalRequest, context: PublicationContext): Promise<ContentRemovalData> {
  closedRecord(request, ["operation", "options", "input"]);
  if (!["paragraphs.remove", "runs.remove", "tables.remove"].includes(request.operation)) throw new DocxUsageError("Expected a content removal operation.");
  const settings = archiveSettings(context);
  const invocation = validateDocxInvocation({ operation: request.operation, inputs: [request.input?.path ?? "document"], options: request.options }, settings.budget);
  const opts = invocation.options as DocxOperationArguments<"paragraphs.remove">;
  const budget = settings.budget.lower(Object.fromEntries((opts.limit ?? []).map(item => [item.name, item.value])));
  const document = await openDocumentLocations(input, { ...settings, budget });
  const selected = resolveDocxSelection(document, invocation);
  const archive = document.snapshot();
  assertDocumentEditable(archive, { ...settings, budget }, archive);
  const editor = new DocumentArchiveEditor(archive, {}, undefined, budget);
  const plans: { before: Location; xml: DocumentXmlEditor; node: XmlElement; parent: XmlElement; markup: string; retained: boolean }[] = [];
  for (const before of selected) {
    budget.charge("work", before.value.path.length + selected.length);
    if (selected.some(other => other !== before && other.value.part === before.value.part && pathContains(other.value.path, before.value.path)))
      throw new InvalidValueError("Overlapping structure selections cannot be removed together.");
    const range = before.value.range;
    if (range && !opts.markers) throw new DocxUsageError("Range removal requires explicit markers exclude or include.");
    if (!range && opts.markers !== undefined) throw new DocxUsageError("Marker inclusion requires a scalar range.");
    if (range && range.start === range.end && !opts.allowEmpty) throw new InvalidValueError("Removal requires a nonempty scalar range.");
    const xml = editor.xml(before.value.part.slice(1));
    let node = xml.root, parent = node;
    const ancestors = [node];
    for (const i of before.value.path) { parent = node; node = node.children[i]!; ancestors.push(node); }
    if (ancestors.some(n => ["ins", "del", "moveFrom", "moveTo", "fldSimple"].includes(n.localName) && n.namespace === node.namespace) || containsRevision(node))
      throw new UnsupportedEditError("Removal cannot discard or cross fields or review history.");
    assertOutsideRevisionRanges(xml.root, node, budget, xml.compatibility.branches);
    xml.assertShapeEditAllowed(node);
    // Physical story order detects annotations and complex fields spanning paragraphs or cells.
    const active = new Set<string>();
    let fieldDepth = 0;
    const scan = (current: XmlElement): void => {
      budget.charge("work", 1);
      if (current === node && (active.size || fieldDepth)) throw new UnsupportedEditError("Removal crosses an annotation or field boundary.");
      if (current.namespace === node.namespace) {
        const id = current.attributes.find(a => a.namespace === node.namespace && a.localName === "id")?.value ?? "";
        const key = current.localName.replace("Start", "").replace("End", "") + ":" + id;
        if (["bookmarkStart", "commentRangeStart", "permStart"].includes(current.localName)) active.add(key);
        if (["bookmarkEnd", "commentRangeEnd", "permEnd"].includes(current.localName)) active.delete(key);
        if (current.localName === "fldChar") {
          const type = current.attributes.find(a => a.localName === "fldCharType")?.value;
          if (type === "begin") fieldDepth++; else if (type === "end") fieldDepth--;
        }
      }
      for (const child of current.children) scan(child);
    };
    const story = ancestors.find(n => n !== node && blockContainers.has(n.localName) && n.localName !== "tc" && n.localName !== "sdtContent") ?? xml.root;
    scan(story);
    const check = (current: XmlElement): void => {
      budget.charge("work", 1);
      if (annotationNames.has(current.localName) && current.namespace === node.namespace)
        throw new UnsupportedEditError("Affected bookmarks, comments and permission ranges require their explicit resource operations.");
      if (current.namespace !== node.namespace || !["p", "pPr", "r", "rPr", "t", "tab", "br", "cr", "noBreakHyphen", "softHyphen", "proofErr", "lastRenderedPageBreak", "hyperlink", "tbl", "tblPr", "tblGrid", "gridCol", "tr", "trPr", "tc", "tcPr"].includes(current.localName))
        throw new UnsupportedEditError("Removal includes unsupported fields, notes, objects or opaque structures.");
      if (current.content.some(c => c.kind !== "element" && (c.kind !== "text" || !["t"].includes(current.localName) && c.text.trim())))
        throw new UnsupportedEditError("Removal cannot discard XML annotations.");
      if (["pPr", "rPr", "tblPr", "trPr", "tcPr", "tblGrid"].includes(current.localName)) return;
      for (const child of current.children) check(child);
    };
    check(node);
    if (!range && request.operation === "tables.remove" && before.kind !== "table") throw new InvalidValueError("Table removal requires a whole table.");
    if (range) {
      if (before.kind !== "paragraph" && before.kind !== "run") throw new InvalidValueError("Removal endpoints require a paragraph or run.");
      if (range.start === range.end) continue;
      let offset = 0;
      const patches = new Map<XmlElement, string>();
      const visit = (current: XmlElement): void => {
        budget.charge("work", 1);
        if (["pPr", "rPr"].includes(current.localName)) return;
        if (["proofErr", "lastRenderedPageBreak"].includes(current.localName)) {
          if (opts.markers === "include" && range.start <= offset && offset <= range.end) patches.set(current, "");
          return;
        }
        const text = current.localName === "t" ? current.text : current.localName === "tab" ? "\t" : ["br", "cr"].includes(current.localName) ? "\n" : undefined;
        if (text !== undefined) {
          const chars = [...text];
          budget.charge("retainedBytes", chars.length * 8);
          const start = Math.max(0, range.start - offset), end = Math.min(chars.length, range.end - offset);
          if (start < end) patches.set(current, current.localName === "t" ? textMarkup(current, chars.slice(0, start).concat(chars.slice(end)).join("")) : "");
          offset += chars.length;
        } else for (const child of current.children) visit(child);
      };
      visit(node);
      const render = (current: XmlElement): string => {
        if (patches.has(current)) return patches.get(current)!;
        return xml.sourceXml(current, new Map(current.children.map(child => [child, render(child)])));
      };
      plans.push({ before, xml, node, parent, markup: render(node), retained: true });
    } else {
      if (before.kind !== "run" && (!blockContainers.has(parent.localName) || parent.namespace !== node.namespace))
        throw new UnsupportedEditError("Structure removal requires an admitted block container.");
      const props = node.children.find(c => c.namespace === node.namespace && c.localName === "pPr");
      const section = props?.children.some(c => c.namespace === node.namespace && c.localName === "sectPr");
      if (before.kind === "table" && containsSection(node)) throw new UnsupportedEditError("A table containing section breaks cannot be removed.");
      plans.push({ before, xml, node, parent, markup: section ? runElementOpen(node) + xml.sourceXml(props!) + `</${node.name}>` : "", retained: !!section });
    }
  }
  // Keep one paragraph in an emptied story, and a terminal paragraph in every cell.
  for (const plan of plans.filter(p => !p.before.value.range && p.before.kind !== "run")) {
    const siblings = plans.filter(p => p.parent === plan.parent && !p.before.value.range);
    const surviving = plan.parent.children.filter(n => ["p", "tbl"].includes(n.localName) && !siblings.some(p => p.node === n && !p.retained));
    const needsParagraph = !surviving.length || plan.parent.localName === "tc" && surviving.at(-1)?.localName !== "p";
    if (needsParagraph && siblings.at(-1) === plan) {
      const props = plan.node.children.find(n => n.namespace === plan.node.namespace && n.localName === "pPr");
      plan.markup = plan.before.kind === "paragraph" ? plan.node.children.every(n => n === props) ? plan.xml.sourceXml(plan.node)
        : runElementOpen(plan.node) + (props ? plan.xml.sourceXml(props) : "") + `</${plan.node.name}>`
        : `<w:p xmlns:w="${plan.node.namespace}"/>`;
      plan.retained = plan.before.kind === "paragraph";
    }
  }
  // Every refusal above happens before any staged deletion or external publication.
  const changedPlans = plans.filter(plan => plan.markup !== plan.xml.sourceXml(plan.node));
  for (const plan of changedPlans) plan.xml.replaceElement(plan.node, plan.markup);
  const candidate = editor.snapshot();
  const mainPart = document.list("story", { scope: "body" })[0]!.value.part.slice(1);
  const index = new LocationIndex(candidate, settings.limits, mainPart, dialectForNamespace(editor.xml(mainPart).root.namespace)!, budget);
  const changes = changedPlans.map(plan => {
    const value = { ...plan.before.value, generation: 1, range: plan.before.value.range ? { start: plan.before.value.range.start, end: plan.before.value.range.start } : null };
    const shift = plans.filter(p => p.parent === plan.parent && !p.markup && p.node !== plan.node && p.before.value.path.at(-1)! < plan.before.value.path.at(-1)!).length;
    const path = [...value.path]; path[path.length - 1] = path.at(-1)! - shift;
    const entry = plan.retained ? index.byAddress.get(addressKey({ ...value, path }))?.find(e => e.kind === plan.before.kind) : undefined;
    if (plan.retained && (!entry || value.range && !index.validRange(entry, value.range.start, value.range.end)))
      throw new UnsupportedEditError("Removal could not resolve its surviving location.");
    const after = plan.retained ? { ...plan.before, positions: entry!.positions, value: { ...value, path }, token: encodeLocation({ ...value, path }) } : null;
    return { kind: "remove" as const, before: plan.before, after };
  });
  const publication = { ...(request.input ? { input: request.input } : {}), ...(opts.output === undefined ? {} : { output: opts.output }), ...(opts.inPlace === undefined ? {} : { inPlace: opts.inPlace }), ...(opts.force === undefined ? {} : { force: opts.force }), ...(opts.dryRun === undefined ? {} : { dryRun: opts.dryRun }), ...(opts.json === undefined ? {} : { json: opts.json }) };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify({ version: 1, operation: request.operation, ok: true, data: { changed: !!changes.length, changes, dryRun: opts.dryRun ?? false, output: opts.dryRun ? null : { path: opts.output ?? null, bytes: settings.limits.maxArchiveBytes, sha256: "0".repeat(64) } }, affected: changes.length, locations: changes.flatMap(c => c.after ? [c.after] : []), warnings: [], errors: [] }) + "\n").length);
  const result = await publishDocumentArchive(candidate, publication, { ...context, budget }, archive);
  return { changed: !!changes.length, changes, dryRun: opts.dryRun ?? false, output: result.published.length ? { path: result.published[0]!.path, bytes: result.published[0]!.bytes, sha256: result.archiveSha256! } : null };
}
function containsSection(node: XmlElement): boolean {
  return node.localName === "sectPr" || node.children.some(containsSection);
}
