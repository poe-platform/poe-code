import { archiveSettings } from "./archive.js";
import { DocxUsageError } from "./argument-json.js";
import type { DocxInvocation } from "./command.js";
import { xmlValue } from "./create-content.js";
import { dialectForNamespace } from "./dialect.js";
import { fieldInstruction, fieldInstructionTokens } from "./field-instruction.js";
import { assertOutsideFields, parseFields } from "./field-parser.js";
import type { FieldEditData, FieldEditRequest } from "./fields.js";
import { addressKey, LocationIndex } from "./location-index.js";
import { encodeLocation, type Location } from "./location-token.js";
import { openDocumentLocations } from "./locations.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { paragraphTextRun } from "./paragraph-content.js";
import { assertDocumentEditable, publishDocumentArchive, type PublicationContext } from "./publication.js";
import { resolveDocxSelection } from "./simple-selection.js";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";

/** Append a bounded structure to one explicitly selected paragraph. */
export async function addDocumentFields(input: Uint8Array, request: FieldEditRequest, invocation: DocxInvocation, context: PublicationContext): Promise<FieldEditData> {
  const settings = archiveSettings(context);
  const options = request.options as DocxOperationArguments<"fields.add"> & DocxOperationArguments<"toc.add"> & DocxOperationArguments<"captions.add">;
  const budget = settings.budget.lower(Object.fromEntries((options.limit ?? []).map(i => [i.name, i.value])));
  const document = await openDocumentLocations(input, { ...settings, budget });
  const selected = resolveDocxSelection(document, invocation);
  budget.check("matches", selected.length);
  const archive = document.snapshot();
  assertDocumentEditable(archive, { ...settings, budget });
  const editors = new Map<string, DocumentXmlEditor>();
  const updates: { before: Location; path: readonly number[]; kind: "field" | "paragraph" }[] = [];
  for (const before of selected) {
    await budget.checkpoint();
    let editor = editors.get(before.value.part);
    if (!editor) { editor = new DocumentXmlEditor(archive.members.find(m => "/" + m.name === before.value.part)!.bytes, {}, undefined, budget); editors.set(before.value.part, editor); }
    let node = editor.root;
    const ancestors = [node];
    for (const i of before.value.path) { node = node.children[i]!; ancestors.push(node); }
    if (node.localName !== "p" || !dialectForNamespace(node.namespace) || ancestors.some(n => ["fldSimple", "sdt", "ins", "del", "moveFrom", "moveTo"].includes(n.localName))) throw new UnsupportedEditError("Field insertion requires an uncontrolled paragraph.");
    // Insertion at a paragraph end cannot become part of an enclosing complex field.
    const story = document.list("story", { scope: "all-stories" }).find(s => s.value.story === before.value.story)!;
    let owner = editor.root;
    for (const i of story.value.path) owner = owner.children[i]!;
    const fields = parseFields(owner, story.value.path, budget, editor.compatibility.content);
    const caret = [...before.value.path, node.children.length];
    assertOutsideFields(fields, caret);
    const caption = request.operation === "captions.add", toc = request.operation === "toc.add";
    if (options.static && (options.sequence !== undefined || options.result !== undefined || options.update !== undefined)) throw new DocxUsageError("Static captions do not accept field options.");
    let instruction = "";
    if (!options.static) {
      const target = caption ? options.sequence ?? options.label : options.target;
      instruction = fieldInstruction(caption ? "SEQ" : toc ? "TOC" : options.kind, target, options.levels ?? (toc ? { start: 1, end: 3 } : undefined));
      if (caption && options.sequence === undefined) {
        for (const candidate of archive.members.filter(m => m.name.endsWith(".xml"))) {
          const xml = new DocumentXmlEditor(candidate.bytes, {}, undefined, budget);
          const visit = (current: typeof xml.root): boolean => {
            budget.charge("work", 1);
            if (dialectForNamespace(current.namespace) && ["body", "hdr", "ftr", "footnote", "endnote", "comment", "txbxContent"].includes(current.localName)) {
              if (parseFields(current, [], budget, xml.compatibility.content).some(f => f.kind === "SEQ" && (f.unsupported || fieldInstructionTokens(f.instruction)[1]?.value === target))) return true;
            }
            return current.children.some(visit);
          };
          if (visit(xml.root)) throw new UnsupportedEditError("Caption sequence already exists; supply sequence explicitly to reuse it.");
        }
      }
    }
    const w = node.namespace;
    const leading = caption ? options.label + " " : options.title ?? "";
    const prefix = leading ? paragraphTextRun(w, leading) : "";
    const field = options.static ? "" : `<df:fldSimple xmlns:df="${w}" df:instr="${xmlValue(instruction)}" df:dirty="${options.update ?? (caption || toc)}">${paragraphTextRun(w, options.result ?? "")}</df:fldSimple>`;
    const suffix = caption ? paragraphTextRun(w, (options.static ? "" : " ") + options.text) : "";
    editor.insertChildren(node, prefix + field + suffix);
    updates.push({ before, path: options.static ? before.value.path : [...before.value.path, node.children.length + (prefix ? 1 : 0)], kind: options.static ? "paragraph" : "field" });
  }
  const staged = { ...archive, members: archive.members.map(m => ({ ...m, bytes: editors.get("/" + m.name)?.serialize() ?? m.bytes })) };
  const main = document.list("story", { scope: "body" })[0]!.value.part.slice(1);
  const dialect = dialectForNamespace(new DocumentXmlEditor(staged.members.find(m => m.name === main)!.bytes, {}, undefined, budget).root.namespace)!;
  const index = new LocationIndex(staged, settings.limits, main, dialect, budget);
  const changes = updates.map(({ before, path, kind }) => {
    const entry = index.byAddress.get(addressKey({ ...before.value, path }))?.find(e => e.kind === kind);
    if (!entry) throw new UnsupportedEditError("Cannot resolve inserted field location.");
    const value = { ...before.value, path, range: null, generation: 1 };
    const after = { kind, value, token: encodeLocation(value), positions: entry.positions } as Location;
    return { kind: "insert" as const, before, after };
  });
  const publication = { ...(request.input ? { input: request.input } : {}), ...(options.output === undefined ? {} : { output: options.output }), ...(options.inPlace === undefined ? {} : { inPlace: options.inPlace }), ...(options.force === undefined ? {} : { force: options.force }), ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }), ...(options.json === undefined ? {} : { json: options.json }) };
  const prospective = { changed: changes.length > 0, changes, dryRun: options.dryRun ?? false, output: options.dryRun ? null : { path: options.inPlace ? request.input?.path ?? null : options.output === "-" ? null : options.output ?? null, bytes: settings.limits.maxArchiveBytes, sha256: "0".repeat(64) } };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify({ version: 1, operation: request.operation, ok: true, data: prospective, affected: changes.length, locations: changes.map(c => c.after), warnings: [], errors: [] }) + "\n").length);
  const result = await publishDocumentArchive(staged, publication, { ...context, budget });
  return { changed: changes.length > 0, changes, dryRun: options.dryRun ?? false, output: result.published.length ? { path: result.published[0]!.path, bytes: result.published[0]!.bytes, sha256: result.archiveSha256! } : null };
}
