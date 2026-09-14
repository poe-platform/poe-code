import { archiveSettings, type ArchiveContext, type DocumentArchive } from "./archive.js";
import { DocxUsageError } from "./argument-json.js";
import { writeArchive } from "./archive-write.js";
import { validateDocxInvocation } from "./command.js";
import { commentAttribute, openComments } from "./comments-state.js";
import { xmlValue } from "./create-content.js";
import { assertOutsideFields, parseFields } from "./field-parser.js";
import { closedRecord, encodeLocation, SelectionError, type Location } from "./location-token.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { paragraphTextRun, replaceParagraphContent } from "./paragraph-content.js";
import { relativePartTarget } from "./part-uri.js";
import { assertDocumentEditable, publishDocumentArchive, type PublicationContext, type PublicationInput } from "./publication.js";
import { resolveDocxSelection } from "./simple-selection.js";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";

export type CommentReadRequest = { [K in "comments.list" | "comments.get"]: { readonly operation: K; readonly options: DocxOperationArguments<K> } }["comments.list" | "comments.get"];
export type CommentEditRequest = { [K in "comments.add" | "comments.set" | "comments.remove"]: { readonly operation: K; readonly options: DocxOperationArguments<K>; readonly input?: PublicationInput } }["comments.add" | "comments.set" | "comments.remove"];
export interface CommentInfo {
  readonly comment_id: number; readonly author: string; readonly initials: string | null; readonly timestamp: string | null;
  readonly text: string; readonly location: Location;
  readonly range: { readonly start: CommentAnchor; readonly end: CommentAnchor; readonly reference: CommentAnchor } | null;
  readonly issues: readonly string[];
}
export interface CommentAnchor { readonly part: string; readonly path: readonly number[] }
export interface CommentReadData { readonly items: readonly CommentInfo[]; readonly issues: readonly string[]; readonly modern: "preserve" | null }
export interface CommentEditData {
  readonly changed: boolean;
  readonly changes: readonly { readonly kind: "insert" | "replace" | "remove"; readonly before: Location; readonly after: Location | null }[];
  readonly output: { readonly path: string | null; readonly bytes: number; readonly sha256: string } | null;
  readonly dryRun: boolean;
}
type State = Awaited<ReturnType<typeof openComments>>;
type Options = DocxOperationArguments<"comments.set"> & DocxOperationArguments<"comments.add"> & DocxOperationArguments<"comments.remove">;

function selectedComments(state: State, operation: string, options: Options) {
  let records = [...state.records].sort((a, b) => a.id - b.id);
  if (options.select) {
    const location = state.document.resolve(options.select);
    if (location.value.range) throw new DocxUsageError("Comment body operations require a whole comment token.");
    records = records.filter(n => n.location?.token === location.token);
    if (!records.length) throw new SelectionError("missing-selection");
  } else if (options.comment !== undefined) records = records.slice(options.comment - 1, options.comment);
  if (!records.length && operation !== "comments.list" && !options.allowEmpty) throw new SelectionError("missing-selection");
  if (records.length > 1 && operation !== "comments.list" && !options.all) throw new SelectionError("ambiguous-selection");
  state.budget.check("matches", records.length);
  return records;
}

export async function inspectDocumentComments(input: Uint8Array, request: CommentReadRequest, context: ArchiveContext): Promise<CommentReadData> {
  closedRecord(request, ["operation", "options"]);
  if (!["comments.list", "comments.get"].includes(request.operation)) throw new DocxUsageError("Expected a comment read operation.");
  const settings = archiveSettings(context);
  const invocation = validateDocxInvocation({ operation: request.operation, inputs: ["document"], options: request.options }, settings.budget);
  const options = invocation.options as Options;
  const budget = settings.budget.lower(Object.fromEntries((options.limit ?? []).map(i => [i.name, i.value])));
  const state = await openComments(input, { ...settings, budget });
  const data: CommentReadData = { items: selectedComments(state, request.operation, options).map(n => {
    if (!n.location) throw new UnsupportedEditError("Comment body is outside admitted stories.");
    const anchor = (m: NonNullable<typeof n.start>) => ({ part: m.part, path: m.path });
    return { comment_id: n.id, author: commentAttribute(n.node, "author") ?? "", initials: commentAttribute(n.node, "initials") ?? null,
      timestamp: commentAttribute(n.node, "date") ?? null, text: state.document.text({ select: n.location.token }).text, location: n.location,
      range: n.start && n.end && n.reference ? { start: anchor(n.start), end: anchor(n.end), reference: anchor(n.reference) } : null, issues: n.issues };
  }), issues: state.issues, modern: state.modern ? "preserve" : null };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify({ version: 1, operation: request.operation, ok: true, data, affected: 0, locations: data.items.map(n => n.location), warnings: [], errors: [] }) + "\n").length);
  return data;
}

export async function editDocumentComments(input: Uint8Array, request: CommentEditRequest, context: PublicationContext): Promise<CommentEditData> {
  closedRecord(request, ["operation", "options", "input"]);
  if (!["comments.add", "comments.set", "comments.remove"].includes(request.operation)) throw new DocxUsageError("Expected a comment editing operation.");
  const settings = archiveSettings(context);
  const invocation = validateDocxInvocation({ operation: request.operation, inputs: [request.input?.path ?? "document"], options: request.options }, settings.budget);
  const options = invocation.options as Options;
  const budget = settings.budget.lower(Object.fromEntries((options.limit ?? []).map(i => [i.name, i.value])));
  const state = await openComments(input, { ...settings, budget });
  const { archive, graph, editors, main, w, r } = state;
  assertDocumentEditable(archive, { ...settings, budget });
  const updates: { before: Location; id: number; kind: "insert" | "replace" | "remove" }[] = [];
  let part = state.part;
  const editPart = (name: string, initial: string) => {
    const existing = editors.get(name);
    if (existing) return existing;
    const editor = new DocumentXmlEditor(archive.members.find(m => "/" + m.name === name)?.bytes ?? new TextEncoder().encode(initial), {}, undefined, budget);
    editors.set(name, editor); return editor;
  };
  if (request.operation === "comments.add") {
    if (state.issues.some(i => i !== "deleted-anchor")) throw new UnsupportedEditError("Comment ranges must be consistent before insertion.");
    const selected = resolveDocxSelection(state.document, invocation);
    if (selected.length !== 1) throw new SelectionError("missing-selection");
    const before = selected[0]!, range = before.value.range;
    if (!range || range.start >= range.end || before.value.story !== main + "#body") throw new UnsupportedEditError("Comment creation requires a nonempty body paragraph range at run boundaries.");
    const editor = editors.get(before.value.part)!;
    let p = editor.root;
    const ancestors = [p];
    for (const i of before.value.path) { p = p.children[i]!; ancestors.push(p); }
    if (p.localName !== "p" || ancestors.some(n => n.namespace !== w || ["sdt", "ins", "del", "moveFrom", "moveTo", "fldSimple", "hyperlink", "customXml"].includes(n.localName))) throw new UnsupportedEditError("Comment anchors cannot cross controlled content.");
    const owner = state.document.list("story", { scope: "body" })[0]!;
    const fields = parseFields(ancestors[owner.value.path.length]!, owner.value.path, budget, editor.compatibility.content);
    let offset = 0;
    let first: typeof p | undefined, last: typeof p | undefined;
    const runs = state.document.list("run", { scope: "body" }).filter(l => l.value.part === before.value.part && l.value.path.length > before.value.path.length && before.value.path.every((v, i) => l.value.path[i] === v));
    const lengths = new Map<number, number>();
    for (const run of runs) {
      const child = run.value.path[before.value.path.length]!;
      lengths.set(child, (lengths.get(child) ?? 0) + [...state.document.text({ select: run.token }).text].length);
    }
    for (const node of p.children) {
      budget.charge("work", 1);
      if (node.namespace === w && ["pPr", "bookmarkStart", "bookmarkEnd", "commentRangeStart", "commentRangeEnd", "proofErr", "permStart", "permEnd"].includes(node.localName)) continue;
      const count = lengths.get(p.children.indexOf(node)) ?? 0;
      if (offset === range.start && count) first = node;
      if (offset + count === range.end && count) last = node;
      if (offset < range.end && offset + count > range.start) {
        if (node.namespace !== w || node.localName !== "r" || node.children.some(n => n.namespace !== w || !["rPr", "t", "tab", "br", "cr", "noBreakHyphen", "softHyphen"].includes(n.localName))) throw new UnsupportedEditError("Comment range crosses unsupported run content.");
        assertOutsideFields(fields, [...before.value.path, p.children.indexOf(node)]);
      }
      offset += count;
    }
    if (!first || !last) throw new UnsupportedEditError("Comment endpoints must coincide with existing run boundaries.");
    const firstPath = [...before.value.path, p.children.indexOf(first)];
    const lastPath = [...before.value.path, p.children.indexOf(last)];
    const compare = (a: readonly number[], b: readonly number[]) => { for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!; return a.length - b.length; };
    if (state.records.some(n => n.start?.part === before.value.part && n.end && compare(n.start.path, lastPath) < 0 && compare(firstPath, n.end.path) < 0)) throw new UnsupportedEditError("Comment ranges cannot overlap existing comments.");
    const used = new Set(state.records.map(n => n.id));
    let id = 0; while (used.has(id)) { budget.charge("work", 1); id++; }
    const patches = new Map([[first, `<cm:commentRangeStart xmlns:cm="${w}" cm:id="${id}"/>` + editor.sourceXml(first)]]);
    patches.set(last, (patches.get(last) ?? editor.sourceXml(last)) + `<cm:commentRangeEnd xmlns:cm="${w}" cm:id="${id}"/><cm:r xmlns:cm="${w}"><cm:commentReference cm:id="${id}"/></cm:r>`);
    editor.replaceElement(p, editor.sourceXml(p, patches));
    if (!part) {
      part = graph.allocatePartName(main.slice(0, main.lastIndexOf("/") + 1) + "comments", ".xml");
      const relName = main.slice(0, main.lastIndexOf("/") + 1) + "_rels/" + main.slice(main.lastIndexOf("/") + 1) + ".rels";
      const ns = "http://schemas.openxmlformats.org/package/2006/relationships";
      const rels = editPart(relName, `<Relationships xmlns="${ns}"/>`);
      rels.insertChildren(rels.root, `<Relationship xmlns="${ns}" Id="${graph.allocateRelationshipId(main)}" Type="${r}/comments" Target="${xmlValue(relativePartTarget(main, part))}"/>`);
      const types = editPart("/[Content_Types].xml", "");
      types.insertChildren(types.root, `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="${xmlValue(part)}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>`);
    }
    const comments = editPart(part, `<w:comments xmlns:w="${w}"/>`);
    comments.insertChildren(comments.root, `<cm:comment xmlns:cm="${w}" cm:id="${id}" cm:author="${xmlValue(options.author)}" cm:date="${xmlValue(options.timestamp)}"${options.initials === null ? "" : ` cm:initials="${xmlValue(options.initials ?? "")}"`}><cm:p>${paragraphTextRun(w, options.text ?? "")}</cm:p></cm:comment>`);
    updates.push({ before, id, kind: "insert" });
  } else {
    const records = selectedComments(state, request.operation, options);
    if (state.modern && records.length) throw new UnsupportedEditError("Modern comment metadata is preserve-only.");
    for (const record of records) {
      await budget.checkpoint();
      if (!record.location || record.issues.some(i => i !== "deleted-anchor")) throw new UnsupportedEditError("Selected comment anchors are unsafe.");
      if (request.operation === "comments.set") {
        const paragraphs = record.node.children;
        if (paragraphs.some(p => p.namespace !== w || p.localName !== "p")) throw new UnsupportedEditError("Comment text assignment cannot discard rich blocks.");
        if (paragraphs.length === 1 && state.document.text({ select: record.location.token }).text === options.text) continue;
        const replacements = paragraphs.map((p, i) => {
          if (i && (p.content.some(c => c.kind !== "element" && (c.kind !== "text" || c.text.trim())) || p.children.some(n => !["pPr", "r", "hyperlink"].includes(n.localName))))
            throw new UnsupportedEditError("Comment text assignment cannot discard annotated paragraphs.");
          const properties = p.children.find(n => n.namespace === w && n.localName === "pPr");
          const replacement = replaceParagraphContent(record.editor, p, properties ? record.editor.sourceXml(properties) : "", i ? "" : options.text);
          return i ? "" : replacement;
        });
        paragraphs.forEach((p, i) => record.editor.replaceElement(p, replacements[i]!));
        if (!paragraphs.length) record.editor.insertChildren(record.node, `<cm:p xmlns:cm="${w}">${paragraphTextRun(w, options.text)}</cm:p>`);
      } else {
        const annotation = (node: typeof record.node): boolean => { budget.charge("work", 1); return node.namespace === w && ["bookmarkStart", "bookmarkEnd", "commentRangeStart", "commentRangeEnd", "commentReference", "permStart", "permEnd"].includes(node.localName) || node.children.some(annotation); };
        if (annotation(record.node)) throw new UnsupportedEditError("Comment removal cannot discard independently owned annotations.");
        record.editor.replaceElement(record.node, "");
        for (const marker of record.markers) {
          const parent = marker.parent;
          const emptyReferenceRun = marker.node.localName === "commentReference" && parent.children.every(n => n === marker.node || n.namespace === w && n.localName === "rPr") && parent.content.every(c => c.kind === "element" || c.kind === "text" && !c.text.trim());
          marker.editor.replaceElement(emptyReferenceRun ? parent : marker.node, "");
        }
      }
      updates.push({ before: record.location, id: record.id, kind: request.operation === "comments.set" ? "replace" : "remove" });
    }
  }
  const staged = new Map([...editors].filter(([name, editor]) => editor.dirtyNodes.length || !archive.members.some(m => "/" + m.name === name)).map(([name, editor]) => [name.slice(1), editor.serialize()]));
  const finalArchive: DocumentArchive = { ...archive, members: [
    ...archive.members.map(m => ({ ...m, bytes: staged.get(m.name) ?? m.bytes })),
    ...[...staged].filter(([name]) => !archive.members.some(m => m.name === name)).map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") }))
  ] };
  const publication = { ...(request.input ? { input: request.input } : {}), ...(options.output === undefined ? {} : { output: options.output }), ...(options.inPlace === undefined ? {} : { inPlace: options.inPlace }), ...(options.force === undefined ? {} : { force: options.force }), ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }), ...(options.json === undefined ? {} : { json: options.json }) };
  // Reopen the actual serialized candidate before publishing or issuing fresh selections.
  const chunks: Uint8Array[] = [];
  await writeArchive(finalArchive, { async write(bytes) { budget.charge("retainedBytes", bytes.length); chunks.push(bytes.slice()); } }, { order: "input", compression: "store" }, { ...settings, budget });
  const encoded = new Uint8Array(chunks.reduce((sum, bytes) => sum + bytes.length, 0));
  let cursor = 0;
  for (const chunk of chunks) { encoded.set(chunk, cursor); cursor += chunk.length; }
  const finalState = await openComments(encoded, { ...settings, budget });
  const changes = updates.map(update => {
    const record = finalState.records.find(n => n.id === update.id);
    if (update.kind !== "remove" && (!record || record.issues.some(i => i !== "deleted-anchor"))) throw new UnsupportedEditError("Comment edit produced inconsistent anchors.");
    const value = record?.location && { ...record.location.value, sourceSha256: update.before.value.sourceSha256, generation: update.before.value.generation + 1 };
    const after = update.kind === "remove" ? null : { ...record!.location!, value: value!, token: encodeLocation(value!) };
    return { kind: update.kind, before: update.before, after };
  });
  const prospective = { changed: changes.length > 0, changes, dryRun: options.dryRun ?? false, output: options.dryRun ? null : { path: options.output ?? request.input?.path ?? null, bytes: settings.limits.maxArchiveBytes, sha256: "0".repeat(64) } };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify({ version: 1, operation: request.operation, ok: true, data: prospective, affected: changes.length, locations: changes.flatMap(c => c.after ? [c.after] : []), warnings: [], errors: [] }) + "\n").length);
  const result = await publishDocumentArchive(finalArchive, publication, { ...context, budget });
  return { changed: changes.length > 0, changes, dryRun: options.dryRun ?? false, output: result.published.length ? { path: result.published[0]!.path, bytes: result.published[0]!.bytes, sha256: result.archiveSha256! } : null };
}
