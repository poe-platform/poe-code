import { archiveSettings, type ArchiveContext, type DocumentArchive } from "./archive.js";
import { DocxUsageError } from "./argument-json.js";
import { validateDocxInvocation } from "./command.js";
import { xmlValue } from "./create-content.js";
import { assertOutsideFields, parseFields } from "./field-parser.js";
import { LocationIndex } from "./location-index.js";
import { closedRecord, encodeLocation, SelectionError, type Location } from "./location-token.js";
import { openNotes, noteAttribute, type NoteKind, type NoteRecord, type NoteReference } from "./notes-state.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { paragraphTextRun, replaceParagraphContent } from "./paragraph-content.js";
import { relativePartTarget } from "./part-uri.js";
import { assertDocumentEditable, publishDocumentArchive, type PublicationContext, type PublicationInput } from "./publication.js";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";
import { resolveDocxSelection } from "./simple-selection.js";

export type NoteReadRequest = { [K in "notes.list" | "notes.get"]: { readonly operation: K; readonly options: DocxOperationArguments<K> } }["notes.list" | "notes.get"];
export type NoteEditRequest = { [K in "notes.add" | "notes.set" | "notes.remove"]: { readonly operation: K; readonly options: DocxOperationArguments<K>; readonly input?: PublicationInput } }["notes.add" | "notes.set" | "notes.remove"];
export interface NoteInfo {
  readonly kind: NoteKind; readonly id: number; readonly type: string; readonly text: string;
  readonly location: Location; readonly references: readonly Location[];
}
export interface NoteReadData {
  readonly items: readonly NoteInfo[];
  readonly separators: readonly { readonly kind: NoteKind; readonly id: number; readonly type: string }[];
  readonly numbering: Awaited<ReturnType<typeof openNotes>>["numbering"];
}
export interface NoteEditData {
  readonly changed: boolean;
  readonly changes: readonly { readonly kind: "insert" | "replace" | "remove"; readonly before: Location; readonly after: Location | null }[];
  readonly output: { readonly path: string | null; readonly bytes: number; readonly sha256: string } | null;
  readonly dryRun: boolean;
}
type State = Awaited<ReturnType<typeof openNotes>>;
type NoteOptions = DocxOperationArguments<"notes.set"> & DocxOperationArguments<"notes.remove">;

function selectedNotes(state: State, operation: string, options: NoteOptions): { notes: NoteRecord[]; reference?: NoteReference } {
  let notes = state.records.filter(n => n.type === "normal").sort((a, b) => (a.kind === b.kind ? a.id - b.id : a.kind === "footnote" ? -1 : 1));
  if (options.select) {
    const location = state.document.resolve(options.select);
    if (location.value.range !== null) throw new DocxUsageError("Note operations require whole note or reference locations.");
    const reference = state.references.find(ref => ref.location?.token === location.token);
    notes = notes.filter(n => n.location?.token === location.token || reference?.kind === n.kind && reference.id === n.id);
    if (options.kind) notes = notes.filter(n => n.kind === options.kind);
    if (!notes.length) throw new SelectionError("missing-selection");
    if (reference && state.references.filter(ref => ref.location?.token === location.token).length !== 1) throw new SelectionError("ambiguous-selection");
    return { notes, ...(reference ? { reference } : {}) };
  }
  const kind = options.kind ?? (options.scope === "endnotes" ? "endnote" : options.scope === "footnotes" || operation !== "notes.list" && options.scope !== "all-stories" ? "footnote" : undefined);
  if (kind) notes = notes.filter(n => n.kind === kind);
  if (options.note !== undefined) notes = notes.slice(options.note - 1, options.note);
  if (!notes.length && operation !== "notes.list" && !options.allowEmpty) throw new SelectionError("missing-selection");
  if (notes.length > 1 && operation !== "notes.list" && !options.all) throw new SelectionError("ambiguous-selection");
  return { notes };
}

/** Noncreating note queries separate special bodies from ordinary numbered stories. */
export async function inspectDocumentNotes(input: Uint8Array, request: NoteReadRequest, context: ArchiveContext): Promise<NoteReadData> {
  closedRecord(request, ["operation", "options"]);
  if (!["notes.list", "notes.get"].includes(request.operation)) throw new DocxUsageError("Expected a note read operation.");
  const settings = archiveSettings(context);
  const invocation = validateDocxInvocation({ operation: request.operation, inputs: ["document"], options: request.options }, settings.budget);
  request = { operation: request.operation, options: invocation.options } as NoteReadRequest;
  const budget = settings.budget.lower(Object.fromEntries((request.options.limit ?? []).map(i => [i.name, i.value])));
  const state = await openNotes(input, { ...settings, budget });
  const options = request.options as NoteOptions;
  const { notes } = selectedNotes(state, request.operation, options);
  budget.check("matches", notes.length);
  const data: NoteReadData = {
    items: notes.map(n => {
      if (!n.location) throw new UnsupportedEditError("Note body is outside the supported story profile.");
      return { kind: n.kind, id: n.id, type: n.type, text: state.document.text({ select: n.location.token }).text, location: n.location, references: n.references.flatMap(ref => ref.location ? [ref.location] : []) };
    }),
    separators: state.records.filter(n => n.type !== "normal" && (!options.kind || n.kind === options.kind) && (options.scope !== "footnotes" || n.kind === "footnote") && (options.scope !== "endnotes" || n.kind === "endnote")).map(n => ({ kind: n.kind, id: n.id, type: n.type })),
    numbering: state.numbering
  };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify({ version: 1, operation: request.operation, ok: true, data, affected: 0, locations: data.items.map(n => n.location), warnings: [], errors: [] }) + "\n").length);
  return data;
}

/** Stage reference and story mutations together, preserving all still-owned content. */
export async function editDocumentNotes(input: Uint8Array, request: NoteEditRequest, context: PublicationContext): Promise<NoteEditData> {
  closedRecord(request, ["operation", "options", "input"]);
  if (!["notes.add", "notes.set", "notes.remove"].includes(request.operation)) throw new DocxUsageError("Expected a note edit operation.");
  const settings = archiveSettings(context);
  const invocation = validateDocxInvocation({ operation: request.operation, inputs: [request.input?.path ?? "document"], options: request.options }, settings.budget);
  request = { operation: request.operation, options: invocation.options, ...(request.input ? { input: { ...request.input, stat: { ...request.input.stat } } } : {}) } as NoteEditRequest;
  const budget = settings.budget.lower(Object.fromEntries((request.options.limit ?? []).map(i => [i.name, i.value])));
  const state = await openNotes(input, { ...settings, budget });
  const { archive, graph, editors, main, w, r } = state;
  assertDocumentEditable(archive, { ...settings, budget });
  const options = request.options as NoteOptions & DocxOperationArguments<"notes.add">;
  const staged = new Map<string, Uint8Array>();
  const updates: { before: Location; kind: "insert" | "replace" | "remove"; noteKind: NoteKind; id: number; removed?: boolean }[] = [];
  const removedRefs = new Set<NoteReference>();
  const touched = new Set<NoteKind>();
  let added: { kind: NoteKind; id: number; part: string } | undefined;
  const editPart = (part: string, initial: string): DocumentXmlEditor => {
    const existing = editors.get(part); if (existing) return existing;
    const editor = new DocumentXmlEditor(archive.members.find(m => "/" + m.name === part)?.bytes ?? new TextEncoder().encode(initial), {}, undefined, budget);
    editors.set(part, editor); return editor;
  };
  if (request.operation === "notes.add") {
    const { kind, text = "" } = request.options;
    const { paragraph, table, cell, section, select, scope } = request.options;
    const locations = resolveDocxSelection(state.document, { operation: "fields.add", inputs: ["document"], options: { kind: "PAGE", dryRun: true, paragraph, table, cell, section, select, scope } });
    if (locations.length !== 1) throw new SelectionError("missing-selection");
    const before = locations[0]!;
    if (before.value.story !== main + "#body" || before.value.range !== null) throw new UnsupportedEditError("Note references require a whole body paragraph.");
    let parent = editors.get(main)!.root;
    const ancestors = [parent];
    for (const i of before.value.path) { parent = parent.children[i]!; ancestors.push(parent); }
    if (parent.localName !== "p" || ancestors.some(n => n.namespace !== w || ["sdt", "ins", "del", "moveFrom", "moveTo", "fldSimple"].includes(n.localName))) throw new UnsupportedEditError("Note insertion requires an uncontrolled body paragraph.");
    const owner = state.document.list("story", { scope: "body" })[0]!;
    const body = ancestors[owner.value.path.length]!;
    assertOutsideFields(parseFields(body, owner.value.path, budget, editors.get(main)!.compatibility.content), [...before.value.path, parent.children.length]);
    const used = new Set(state.records.filter(n => n.kind === kind).map(n => n.id));
    let id = 1; while (used.has(id)) { id++; budget.charge("work", 1); }
    let part = state.parts.get(kind);
    if (!part) {
      part = graph.allocatePartName(main.slice(0, main.lastIndexOf("/") + 1) + kind + "s", ".xml");
      state.parts.set(kind, part);
      const relationshipPart = main.slice(0, main.lastIndexOf("/") + 1) + "_rels/" + main.slice(main.lastIndexOf("/") + 1) + ".rels";
      const relNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
      const rels = editPart(relationshipPart, `<Relationships xmlns="${relNamespace}"/>`);
      rels.insertChildren(rels.root, `<Relationship xmlns="${relNamespace}" Id="${graph.allocateRelationshipId(main)}" Type="${r}/${kind}s" Target="${xmlValue(relativePartTarget(main, part))}"/>`);
      const types = editPart("/[Content_Types].xml", "");
      types.insertChildren(types.root, `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="${xmlValue(part)}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}s+xml"/>`);
    }
    const editor = editPart(part, `<w:${kind}s xmlns:w="${w}"/>`);
    editor.insertChildren(editor.root, `<nt:${kind} xmlns:nt="${w}" nt:id="${id}"><nt:p><nt:r><nt:${kind}Ref/></nt:r>${paragraphTextRun(w, text)}</nt:p></nt:${kind}>`);
    editors.get(main)!.insertChildren(parent, `<nt:r xmlns:nt="${w}"><nt:${kind}Reference nt:id="${id}"/></nt:r>`);
    added = { kind, id, part }; touched.add(kind);
    updates.push({ before, kind: "insert", noteKind: kind, id });
  } else {
    const { notes, reference } = selectedNotes(state, request.operation, options);
    budget.check("matches", notes.length);
    for (const note of notes) {
      await budget.checkpoint();
      if (!note.location) throw new UnsupportedEditError("Selected note is outside the editable story profile.");
      if (request.operation === "notes.set") {
        if (note.references.length > 1 && !options.shared) throw new SelectionError("ambiguous-selection");
        const children = note.node.children;
        if (children.some(n => n.namespace !== w || n.localName !== "p")) throw new UnsupportedEditError("Note text assignment cannot discard tables or opaque blocks; use scoped story editing.");
        const replacements = children.map((p, i) => {
          const props = p.children.find(n => n.namespace === w && n.localName === "pPr");
          const replacement = replaceParagraphContent(note.editor, p, props ? note.editor.sourceXml(props) : "", i === 0 ? options.text : "");
          if (i && p.children.some(n => !["pPr", "r", "hyperlink"].includes(n.localName) || n.children.some(c => ["footnoteRef", "endnoteRef"].includes(c.localName))))
            throw new UnsupportedEditError("Note text assignment cannot remove annotation-bearing paragraphs.");
          return i ? "" : replacement;
        });
        if (state.document.text({ select: note.location.token }).text === options.text && children.length === 1) continue;
        children.forEach((p, i) => note.editor.replaceElement(p, replacements[i]!));
        if (!children.length) note.editor.insertChildren(note.node, `<nt:p xmlns:nt="${w}"><nt:r><nt:${note.kind}Ref/></nt:r>${paragraphTextRun(w, options.text)}</nt:p>`);
        touched.add(note.kind); updates.push({ before: note.location, kind: "replace", noteKind: note.kind, id: note.id });
      } else {
        let refs = reference ? [reference] : note.references;
        if (options.reference !== undefined) refs = refs.slice(options.reference - 1, options.reference);
        if (options.reference !== undefined && !refs.length) throw new SelectionError("missing-selection");
        if (refs.length > 1 && options.references !== "all" && (options.references === "single" || !options.all)) throw new SelectionError("ambiguous-selection");
        if (refs.some(ref => !ref.safe)) throw new UnsupportedEditError("Selected note references include unsupported or inactive content.");
        for (const ref of refs) { ref.editor.replaceElement(ref.node, ""); removedRefs.add(ref); }
        // Annotation-bearing content is retained for independent bookmark/review ownership.
        const annotation = (node: typeof note.node): boolean => { budget.charge("work", 1); return node.namespace === w && ["bookmarkStart", "commentRangeStart", "commentReference", "permStart"].includes(node.localName) || node.children.some(annotation); };
        const removeBody = note.references.every(ref => removedRefs.has(ref)) && !annotation(note.node);
        if (removeBody) note.editor.replaceElement(note.node, "");
        if (!refs.length && !removeBody) { if (!options.allowEmpty) throw new SelectionError("missing-selection"); continue; }
        touched.add(note.kind);
        updates.push({ before: reference?.location ?? note.location, kind: "remove", noteKind: note.kind, id: note.id, removed: removeBody });
      }
    }
  }
  // Special entries are identified by type, not by conventional numeric IDs.
  for (const kind of touched) {
    const part = state.parts.get(kind)!, editor = new DocumentXmlEditor(editors.get(part)!.serialize(), {}, undefined, budget);
    editors.set(part, editor);
    const used = new Set(state.records.filter(n => n.kind === kind).map(n => n.id));
    if (added?.kind === kind) used.add(added.id);
    const missing: string[] = [];
    for (const [type, preferred] of [["separator", -1], ["continuationSeparator", 0]] as const) {
      if (state.records.some(n => n.kind === kind && n.type === type)) continue;
      let id: number = preferred;
      if (used.has(id)) { id = 1; while (used.has(id)) { id++; budget.charge("work", 1); } }
      used.add(id);
      missing.push(`<nt:${kind} xmlns:nt="${w}" nt:id="${id}" nt:type="${type}"><nt:p><nt:r><nt:${type}/></nt:r></nt:p></nt:${kind}>`);
    }
    if (missing.length) editor.insertChildren(editor.root, missing.join(""), editor.root.children[0]);
    staged.set(part.slice(1), editor.serialize());
  }
  for (const [part, editor] of editors) if (editor.dirtyNodes.length || !archive.members.some(m => "/" + m.name === part)) staged.set(part.slice(1), editor.serialize());
  const snapshot = (): DocumentArchive => ({ ...archive, members: [
    ...archive.members.map(m => ({ ...m, bytes: staged.get(m.name) ?? m.bytes })),
    ...[...staged].filter(([name]) => !archive.members.some(m => m.name === name)).map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") }))
  ] });
  const remapping = new Map<string, number>();
  if (options.renumber === "document-order") {
    const referenceOrder = new Map<NoteKind, number[]>();
    const orderedParts = [...new Set(state.document.list("story", { scope: "all-stories" }).map(story => story.value.part))];
    for (const part of orderedParts) {
      const editor = new DocumentXmlEditor(staged.get(part.slice(1)) ?? graph.getPart(part).bytes, {}, undefined, budget);
      const visit = (node: typeof editor.root) => {
        budget.charge("work", 1);
        if (node.namespace === w && ["footnoteReference", "endnoteReference"].includes(node.localName)) {
          const kind = node.localName === "footnoteReference" ? "footnote" : "endnote";
          const order = referenceOrder.get(kind) ?? [];
          const id = Number(noteAttribute(node, "id"));
          if (!order.includes(id)) order.push(id);
          referenceOrder.set(kind, order);
        }
        node.children.forEach(visit);
      };
      visit(editor.root);
    }
    for (const kind of touched) {
      if (state.references.some(ref => ref.kind === kind && !removedRefs.has(ref) && !ref.safe)) throw new UnsupportedEditError("ID renumbering requires every reference to be editable.");
      const part = state.parts.get(kind)!, noteEditor = new DocumentXmlEditor(staged.get(part.slice(1)) ?? graph.getPart(part).bytes, {}, undefined, budget);
      const nodes = noteEditor.root.children.filter(n => n.namespace === w && n.localName === kind);
      const used = new Set(nodes.filter(n => (noteAttribute(n, "type") ?? "normal") !== "normal").map(n => Number(noteAttribute(n, "id"))));
      const order = referenceOrder.get(kind) ?? [];
      for (const n of nodes) if ((noteAttribute(n, "type") ?? "normal") === "normal" && !order.includes(Number(noteAttribute(n, "id")))) order.push(Number(noteAttribute(n, "id")));
      let next = 1;
      for (const id of order) { while (used.has(next)) next++; remapping.set(kind + ":" + id, next); used.add(next++); budget.charge("work", 1); }
      for (const n of nodes) if ((noteAttribute(n, "type") ?? "normal") === "normal") noteEditor.setAttribute(n, { namespace: w, localName: "id" }, String(remapping.get(kind + ":" + Number(noteAttribute(n, "id")))));
      staged.set(part.slice(1), noteEditor.serialize());
    }
    for (const member of snapshot().members) {
      if (!editors.has("/" + member.name) || member.name.endsWith(".rels") || member.name === "[Content_Types].xml") continue;
      const editor = new DocumentXmlEditor(member.bytes, {}, undefined, budget);
      const visit = (node: typeof editor.root) => {
        budget.charge("work", 1);
        if (node.namespace === w && ["footnoteReference", "endnoteReference"].includes(node.localName)) {
          const kind = node.localName === "footnoteReference" ? "footnote" : "endnote";
          const id = remapping.get(kind + ":" + Number(noteAttribute(node, "id")));
          if (id !== undefined) editor.setAttribute(node, { namespace: w, localName: "id" }, String(id));
        }
        node.children.forEach(visit);
      };
      visit(editor.root); if (editor.dirtyNodes.length) staged.set(member.name, editor.serialize());
    }
  }
  const finalArchive = snapshot();
  const index = new LocationIndex(finalArchive, settings.limits, main.slice(1), state.dialect, budget);
  const changes = updates.map(update => {
    const id = remapping.get(update.noteKind + ":" + update.id) ?? update.id;
    const entry = index.entries.find(e => e.kind === "story" && e.part === state.parts.get(update.noteKind) && e.node?.localName === update.noteKind && Number(noteAttribute(e.node, "id")) === id);
    const value = entry && { ...update.before.value, generation: 1, part: entry.part, story: entry.story, path: entry.path, range: null };
    const after = update.removed || !entry || !value ? null : { kind: entry.kind, value, token: encodeLocation(value), positions: entry.positions } as Location;
    return { kind: update.kind, before: update.before, after };
  });
  const publication = { ...(request.input ? { input: request.input } : {}), ...(options.output === undefined ? {} : { output: options.output }), ...(options.inPlace === undefined ? {} : { inPlace: options.inPlace }), ...(options.force === undefined ? {} : { force: options.force }), ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }), ...(options.json === undefined ? {} : { json: options.json }) };
  const prospective = { changed: changes.length > 0, changes, dryRun: options.dryRun ?? false, output: options.dryRun ? null : { path: options.output ?? request.input?.path ?? null, bytes: settings.limits.maxArchiveBytes, sha256: "0".repeat(64) } };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify({ version: 1, operation: request.operation, ok: true, data: prospective, affected: changes.length, locations: changes.flatMap(c => c.after ? [c.after] : []), warnings: [], errors: [] }) + "\n").length);
  const result = await publishDocumentArchive(finalArchive, publication, { ...context, budget });
  return { changed: changes.length > 0, changes, dryRun: options.dryRun ?? false, output: result.published.length ? { path: result.published[0]!.path, bytes: result.published[0]!.bytes, sha256: result.archiveSha256! } : null };
}
