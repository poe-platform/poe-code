import { archiveSettings, type ArchiveContext } from "./archive.js";
import { DocxUsageError } from "./argument-json.js";
import { validateDocxInvocation, type DocxInvocation } from "./command.js";
import { xmlValue } from "./create-content.js";
import { dialectForNamespace } from "./dialect.js";
import { fieldAttribute, parseFields, type ParsedField } from "./field-parser.js";
import { addressKey, LocationIndex, type DocumentScope } from "./location-index.js";
import { closedRecord, encodeLocation, type Location } from "./location-token.js";
import { openDocumentLocations } from "./locations.js";
import type { DocxOperationArguments } from "./operation-types.js";
import type { XmlElement } from "./package-xml.js";
import { assertDocumentEditable, publishDocumentArchive, type PublicationContext, type PublicationInput } from "./publication.js";
import { paragraphTextRun } from "./paragraph-content.js";
import { resolveDocxSelection } from "./simple-selection.js";
import { textMarkup } from "./text-replace.js";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";

export interface FieldListData {
  readonly items: readonly { readonly location: Location<"field">; readonly form: "simple" | "complex"; readonly kind: string; readonly instruction: string; readonly result: string; readonly update: boolean; readonly locked: boolean; readonly nested: readonly Location<"field">[] }[];
}
export interface FieldEditRequest { readonly operation: "fields.set"; readonly options: DocxOperationArguments<"fields.set">; readonly input?: PublicationInput }
export interface FieldEditData {
  readonly changed: boolean;
  readonly changes: readonly { readonly kind: "replace"; readonly before: Location; readonly after: Location }[];
  readonly output: { readonly path: string | null; readonly bytes: number; readonly sha256: string } | null;
  readonly dryRun: boolean;
}

async function openFields(input: Uint8Array, invocation: DocxInvocation, context: ArchiveContext) {
  const document = await openDocumentLocations(input, context);
  const selected = resolveDocxSelection(document, invocation);
  const settings = archiveSettings(context), archive = document.snapshot();
  settings.budget.check("matches", selected.length);
  const editors = new Map<string, DocumentXmlEditor>();
  const parsed = new Map<string, { field: ParsedField; editor: DocumentXmlEditor }>();
  const all = document.list("field", { scope: "all-stories" });
  const byAddress = new Map(all.map(l => [addressKey(l.value), l]));
  const storyIds = new Set(selected.map(l => l.value.story));
  const stories = selected.length ? document.list("story", { scope: "all-stories" }).filter(story => storyIds.has(story.value.story)) : document.list("story", { scope: (invocation.options.scope ?? "body") as DocumentScope });
  for (const story of stories) {
    await settings.budget.checkpoint();
    const part = story.value.part;
    let editor = editors.get(part);
    if (!editor) { editor = new DocumentXmlEditor(archive.members.find(m => "/" + m.name === part)!.bytes, {}, undefined, settings.budget); editors.set(part, editor); }
    let node = editor.root;
    for (const i of story.value.path) node = node.children[i]!;
    for (const field of parseFields(node, story.value.path, settings.budget, editor.compatibility.content)) {
      const location = byAddress.get(addressKey({ ...story.value, path: field.path }));
      if (location) parsed.set(location.token, { field, editor });
    }
  }
  const items = selected.map(location => {
    const record = parsed.get(location.token);
    if (!record) throw new UnsupportedEditError("The selected field has no supported story boundary.");
    return { location: location as Location<"field">, ...record };
  });
  return { archive, editors, items, all, main: document.list("story", { scope: "body" })[0]!.value.part };
}

// Scan the admitted element's opening token, preserving quoted instruction bytes.
function opening(editor: DocumentXmlEditor, node: XmlElement): string {
  const source = editor.sourceXml(node);
  let quote = "";
  for (let i = 1; i < source.length; i++) {
    const char = source[i]!;
    if (quote) { if (char === quote) quote = ""; }
    else if (char === '"' || char === "'") quote = char;
    else if (char === ">") return source.slice(0, source[i - 1] === "/" ? i - 1 : i);
  }
  throw new UnsupportedEditError("Field XML opening token is unavailable.");
}

/** Read stored instructions and cached values only; never evaluate a field. */
export async function inspectDocumentFields(input: Uint8Array, options: DocxOperationArguments<"fields.list">, context: ArchiveContext): Promise<FieldListData> {
  const settings = archiveSettings(context);
  const invocation = validateDocxInvocation({ operation: "fields.list", inputs: ["document"], options }, settings.budget);
  const budget = settings.budget.lower(Object.fromEntries((options.limit ?? []).map(i => [i.name, i.value])));
  const { items, all } = await openFields(input, invocation, { ...settings, budget });
  const data: FieldListData = { items: items.map(({ location, field }) => ({ location, form: field.form, kind: field.kind, instruction: field.instruction, result: field.result, update: field.update, locked: field.locked,
    nested: field.nested.flatMap(f => all.filter(l => l.value.story === location.value.story && JSON.stringify(l.value.path) === JSON.stringify(f.path))) })) };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify({ version: 1, operation: "fields.list", ok: true, data, affected: 0, locations: data.items.map(i => i.location), warnings: [], errors: [] }) + "\n").length);
  return data;
}

/** Replace selected plain cached results, preserving instruction and formatting tokens. */
export async function editDocumentFields(input: Uint8Array, request: FieldEditRequest, context: PublicationContext): Promise<FieldEditData> {
  closedRecord(request, ["operation", "options", "input"]);
  if (request.operation !== "fields.set") throw new DocxUsageError("Expected fields.set.");
  const settings = archiveSettings(context), options = request.options;
  const invocation = validateDocxInvocation({ operation: request.operation, inputs: [request.input?.path ?? "document"], options }, settings.budget);
  const budget = settings.budget.lower(Object.fromEntries((options.limit ?? []).map(i => [i.name, i.value])));
  const { archive, editors, items, all, main } = await openFields(input, invocation, { ...settings, budget });
  assertDocumentEditable(archive, { ...settings, budget });
  for (const { field } of items) {
    if (!["MERGEFIELD", "PAGE", "NUMPAGES", "REF", "PAGEREF", "SEQ", "TOC"].includes(field.kind) || field.unsupported || !field.separated)
      throw new UnsupportedEditError("Selected field result cannot be edited while preserving its structure.");
    if (options.result !== undefined && [...options.result].some(c => "\t\r\n".includes(c)) && field.text.some(node => node.content.some(part => part.kind !== "text" && part.kind !== "cdata")))
      throw new UnsupportedEditError("Structural field text conversion cannot discard embedded XML content.");
  }
  const changed = items.filter(({ field }) => options.result !== undefined && options.result !== field.result || options.update !== undefined && options.update !== field.update);
  for (const { field, editor } of changed) {
    await budget.checkpoint();
    if (options.result !== undefined && options.result !== field.result) {
      if (!field.text.length) {
        if (field.form === "simple") editor.insertChildren(field.node, paragraphTextRun(field.node.namespace, options.result));
        else editor.replaceElement(field.separator!, editor.sourceXml(field.separator!) + textMarkup(field.node, options.result));
      }
      field.text.forEach((node, i) => {
        const value = i === 0 ? options.result! : "";
        if (node.localName !== "t" || [...value].some(c => "\t\r\n".includes(c))) { editor.replaceElement(node, textMarkup(node, value)); return; }
        const space = node.attributes.find(a => a.namespace === "http://www.w3.org/XML/1998/namespace" && a.localName === "space");
        if (value.trim() !== value && space && space.value !== "preserve") editor.setAttribute(node, "xml:space", "preserve");
        const content = node.content.filter(n => n.kind === "text" || n.kind === "cdata");
        if (!content.length) editor.insertChildren(node, xmlValue(value));
        else content.forEach((part, j) => editor.setText(part, j === 0 ? value : ""));
      });
    }
  }
  const staged = { ...archive, members: archive.members.map(member => ({ ...member, bytes: editors.get("/" + member.name)?.serialize() ?? member.bytes })) };
  const mainEditor = editors.get(main) ?? new DocumentXmlEditor(staged.members.find(m => "/" + m.name === main)!.bytes, {}, undefined, budget);
  const index = new LocationIndex(staged, settings.limits, main.slice(1), dialectForNamespace(mainEditor.root.namespace)!, budget);
  const entries = index.entries.filter(e => e.kind === "field");
  const resulting = new Map(items.map(item => {
    const story = item.location.value.story;
    const ordinal = all.filter(l => l.value.story === story).findIndex(l => l.token === item.location.token);
    budget.charge("work", all.length + entries.length);
    const entry = entries.filter(e => e.story === story)[ordinal];
    if (!entry) throw new UnsupportedEditError("Cannot resolve the resulting field location.");
    return [item.location.token, entry];
  }));
  for (const [part, editor] of editors) {
    let current = new DocumentXmlEditor(editor.serialize(), {}, undefined, budget);
    for (const item of changed.filter(item => item.location.value.part === part)) {
      if (options.result !== undefined && options.result !== item.field.result && options.result.trim() !== options.result) {
        const story = index.entries.find(e => e.kind === "story" && e.story === item.location.value.story)!;
        let owner = current.root;
        for (const i of story.path) owner = owner.children[i]!;
        const field = parseFields(owner, story.path, budget, current.compatibility.content).find(f => JSON.stringify(f.path) === JSON.stringify(resulting.get(item.location.token)!.path))!;
        const text = field.text[0];
        if (text?.localName === "t" && !text.attributes.some(a => a.namespace === "http://www.w3.org/XML/1998/namespace" && a.localName === "space")) {
          current.replaceElement(text, opening(current, text) + ` xml:space="preserve">` + current.sourceXml(text, new Map(), true) + `</${text.name}>`);
          current = new DocumentXmlEditor(current.serialize(), {}, undefined, budget);
        }
      }
      if (options.update === undefined || options.update === item.field.update) continue;
      let node: XmlElement = current.root;
      for (const i of resulting.get(item.location.token)!.path) node = node.children[i]!;
      const value = options.update ? "true" : "false";
      if (fieldAttribute(node, "dirty") !== undefined) current.setAttribute(node, { namespace: node.namespace, localName: "dirty" }, value);
      else {
        let prefix = "field"; while (node.namespaces.has(prefix)) prefix += "x";
        current.replaceElement(node, opening(current, node) + ` xmlns:${prefix}="${node.namespace}" ${prefix}:dirty="${value}">` + current.sourceXml(node, new Map(), true) + `</${node.name}>`);
      }
      current = new DocumentXmlEditor(current.serialize(), {}, undefined, budget);
    }
    editors.set(part, current);
  }
  const changes: FieldEditData["changes"] = changed.map(({ location }) => {
    const entry = resulting.get(location.token)!;
    const value = { ...location.value, path: entry.path, generation: 1 };
    return { kind: "replace", before: location, after: { ...location, positions: { ...entry.positions, field: location.positions.field! }, value, token: encodeLocation(value) } };
  });
  const publication = { ...(request.input ? { input: request.input } : {}), ...(options.output === undefined ? {} : { output: options.output }), ...(options.inPlace === undefined ? {} : { inPlace: options.inPlace }), ...(options.force === undefined ? {} : { force: options.force }), ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }), ...(options.json === undefined ? {} : { json: options.json }) };
  const prospective = { changed: changes.length > 0, changes, dryRun: options.dryRun ?? false, output: options.dryRun ? null : { path: options.inPlace ? request.input?.path ?? null : options.output === "-" ? null : options.output ?? null, bytes: settings.limits.maxArchiveBytes, sha256: "0".repeat(64) } };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify({ version: 1, operation: request.operation, ok: true, data: prospective, affected: changes.length, locations: changes.map(c => c.after), warnings: [], errors: [] }) + "\n").length);
  const result = await publishDocumentArchive({ ...archive, members: archive.members.map(member => ({ ...member, bytes: editors.get("/" + member.name)?.serialize() ?? member.bytes })) }, publication, { ...context, budget });
  return { changed: changes.length > 0, changes, dryRun: options.dryRun ?? false, output: result.published.length ? { path: result.published[0]!.path, bytes: result.published[0]!.bytes, sha256: result.archiveSha256! } : null };
}
