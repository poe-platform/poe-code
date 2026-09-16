import { archiveSettings, type DocumentArchive } from "./archive.js";
import { DocxUsageError } from "./argument-json.js";
import { validateDocxInvocation } from "./command.js";
import { xmlValue } from "./create-content.js";
import { dialectForNamespace, documentDialects } from "./dialect.js";
import { addressKey, LocationIndex } from "./location-index.js";
import { closedRecord, encodeLocation, type Location } from "./location-token.js";
import { openDocumentLocations } from "./locations.js";
import { NumberingGraph, numberingChild as child, numberingAttribute as attr } from "./numbering.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { DocumentPackage } from "./package.js";
import { parseDocumentXml, type XmlElement } from "./package-xml.js";
import { paragraphTextRun } from "./paragraph-content.js";
import type { ParagraphEditData } from "./paragraph-edit.js";
import { relativePartTarget } from "./part-uri.js";
import { assertDocumentEditable, publishDocumentArchive, type PublicationContext, type PublicationInput } from "./publication.js";
import { runElementOpen } from "./run-properties.js";
import { resolveDocxSelection } from "./simple-selection.js";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";

export type ListEditOperation = "lists.add" | "lists.set";
export type ListEditRequest = { [K in ListEditOperation]: { readonly operation: K; readonly options: DocxOperationArguments<K>; readonly input?: PublicationInput } }[ListEditOperation];
export type ListEditData = ParagraphEditData;

/** Bounded list creation and paragraph-local edits share the command publication engine. */
export async function editDocumentLists(input: Uint8Array, request: ListEditRequest, context: PublicationContext): Promise<ListEditData> {
  closedRecord(request, ["operation", "options", "input"]);
  if (!["lists.add", "lists.set"].includes(request.operation)) throw new DocxUsageError("Expected a list editing operation.");
  const settings = archiveSettings(context);
  const invocation = validateDocxInvocation({ operation: request.operation, inputs: [request.input?.path ?? "document"], options: request.options }, settings.budget);
  const options = invocation.options as DocxOperationArguments<"lists.add"> & DocxOperationArguments<"lists.set">;
  const budget = settings.budget.lower(Object.fromEntries((options.limit ?? []).map(item => [item.name, item.value])));
  const document = await openDocumentLocations(input, { ...settings, budget });
  const selected = resolveDocxSelection(document, invocation);
  budget.check("matches", selected.length);
  let archive = document.snapshot();
  assertDocumentEditable(archive, { ...settings, budget });
  const main = document.list("story", { scope: "body" })[0]!.value.part.slice(1);
  const dialect = dialectForNamespace(parseDocumentXml(archive.members.find(m => m.name === main)!.bytes, {}, budget).root.namespace)!;
  const { w, r } = documentDialects[dialect];
  const packageGraph = new DocumentPackage(archive, settings.limits, budget);
  const edges = packageGraph.relationships("/" + main);
  const numberingEdges = edges.filter(e => e.reltype === r + "/numbering");
  const stylesEdges = edges.filter(e => e.reltype === r + "/styles");
  if (numberingEdges.length > 1 || stylesEdges.length > 1 || numberingEdges[0]?.is_external || stylesEdges[0]?.is_external)
    throw new UnsupportedEditError("Numbering and style ownership must be unambiguous and internal.");
  let numberingName = numberingEdges[0]?.target_part.name;
  const numbering = new DocumentXmlEditor(numberingEdges[0]?.target_part.bytes ?? new TextEncoder().encode(`<nl:numbering xmlns:nl="${w}"/>`), {}, undefined, budget);
  if (numbering.root.namespace !== w) throw new UnsupportedEditError("Numbering dialect does not match its owner.");
  const styles = stylesEdges[0] ? parseDocumentXml(stylesEdges[0].target_part.bytes, {}, budget).root : undefined;
  const graph = new NumberingGraph(numbering, styles, budget);
  // Reserve references as well as definitions so new lists never repair unrelated dangling IDs.
  for (const member of archive.members) if (member.name.endsWith(".xml")) graph.reserve(parseDocumentXml(member.bytes, {}, budget).root);
  const editors = new Map<string, DocumentXmlEditor>();
  const updates: { before: Location; path: readonly number[]; kind: "insert" | "format" }[] = [];
  for (const before of selected) {
    await budget.checkpoint();
    budget.charge("work", 1);
    const part = before.value.part.slice(1);
    let xml = editors.get(part);
    if (!xml) { xml = new DocumentXmlEditor(archive.members.find(m => m.name === part)!.bytes, {}, undefined, budget); editors.set(part, xml); }
    let node = xml.root, parent = node;
    const ancestors = [node];
    for (const position of before.value.path) { parent = node; node = node.children[position]!; ancestors.push(node); }
    if (ancestors.some(n => n.namespace === w && (["ins", "del", "moveFrom", "moveTo"].includes(n.localName) || child(child(n, "pPr"), "pPrChange"))))
      throw new UnsupportedEditError("Tracked list paragraphs require revision operations.");
    if (node.namespace !== w || !["p", "body", "tc", "hdr", "ftr", "footnote", "endnote", "comment", "txbxContent"].includes(node.localName)) throw new UnsupportedEditError("Expected a supported list paragraph or block container.");
    let previous = node.localName === "p" ? node : node.children.filter(n => n.namespace === w && n.localName === "p").at(-1);
    if (request.operation === "lists.set") previous = node;
    const existing = previous ? graph.paragraph(previous) : undefined;
    const level = options.level ?? (request.operation === "lists.set" ? existing?.level ?? 0 : 0);
    let id: number;
    if (request.operation === "lists.set") {
      if (node.localName !== "p" || !existing) throw new UnsupportedEditError("List set requires an existing list paragraph.");
      const resolved = graph.resolve(existing.id);
      if (!resolved.levels.has(level) || !resolved.levels.has(existing.level)) throw new UnsupportedEditError("The selected numbering level has no definition.");
      id = existing.id;
      if (options.restart) {
        const start = options.start ?? Number(attr(child(resolved.levels.get(level), "start")) ?? 1);
        id = graph.restart(resolved, level, start);
      }
      if (id === existing.id && level === existing.level) continue;
      const props = child(node, "pPr");
      const markup = listProperties(xml, props, id, level, w);
      if (props) xml.replaceElement(props, markup);
      else xml.insertChildren(node, markup, node.children[0]);
      updates.push({ before, path: before.value.path, kind: "format" });
    } else {
      id = 0;
      if (existing && options.start === undefined) {
        const resolved = graph.resolve(existing.id);
        if (!resolved.levels.has(existing.level)) throw new UnsupportedEditError("The preceding numbering level has no definition.");
        if (attr(child(resolved.levels.get(level), "numFmt")) === options.kind || graph.mixUnusedLevel(resolved, level, options.kind)) id = existing.id;
      }
      if (!id) id = graph.create(options.kind, options.start ?? 1, level);
      const markup = `<nl:p xmlns:nl="${w}">${listProperties(undefined, undefined, id, level, w)}${paragraphTextRun(w, options.text ?? "")}</nl:p>`;
      if (node.localName === "p") {
        if (parent.namespace !== w || !["body", "tc", "hdr", "ftr", "footnote", "endnote", "comment", "txbxContent", "sdtContent"].includes(parent.localName)) throw new UnsupportedEditError("List insertion requires a supported block container.");
        if (child(child(node, "pPr"), "sectPr")) throw new UnsupportedEditError("Insert lists at a block container when the anchor ends a section.");
        xml.insertChildren(parent, markup, parent.children[parent.children.indexOf(node) + 1]);
        updates.push({ before, path: [...before.value.path.slice(0, -1), before.value.path.at(-1)! + 1], kind: "insert" });
      } else {
        const section = child(node, "sectPr");
        xml.insertChildren(node, markup, section);
        updates.push({ before, path: [...before.value.path, section ? node.children.indexOf(section) : node.children.length], kind: "insert" });
      }
    }
  }
  archive = { ...archive, members: archive.members.map(m => editors.has(m.name) ? { ...m, bytes: editors.get(m.name)!.serialize() } : m) };
  if (graph.newAbstracts.length || graph.newInstances.length || graph.rebindings.size) {
    const bytes = graph.flush();
    if (!numberingName) {
      const name = packageGraph.allocatePartName("/word/numbering", ".xml");
      numberingName = name.slice(1);
      const types = archive.members.find(m => m.name === "[Content_Types].xml")!;
      const typesXml = new DocumentXmlEditor(types.bytes, {}, undefined, budget);
      typesXml.insertChildren(typesXml.root, `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="${xmlValue(name)}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>`);
      const split = main.lastIndexOf("/");
      const relName = main.slice(0, split + 1) + "_rels/" + main.slice(split + 1) + ".rels";
      const member = archive.members.find(m => m.name === relName);
      const ns = "http://schemas.openxmlformats.org/package/2006/relationships";
      const relXml = new DocumentXmlEditor(member?.bytes ?? new TextEncoder().encode(`<Relationships xmlns="${ns}"/>`), {}, undefined, budget);
      relXml.insertChildren(relXml.root, `<Relationship xmlns="${ns}" Id="${packageGraph.allocateRelationshipId('/' + main)}" Type="${r}/numbering" Target="${xmlValue(relativePartTarget('/' + main, name))}"/>`);
      const members: DocumentArchive["members"][number][] = archive.members.map(m => m === types ? { ...m, bytes: typesXml.serialize() } : m === member ? { ...m, bytes: relXml.serialize() } : m);
      if (!member) members.push({ name: relName, bytes: relXml.serialize(), directory: false, modified: new Date("1980-01-01T00:00:00Z") });
      members.push({ name: numberingName, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") });
      archive = { ...archive, members };
    } else archive = { ...archive, members: archive.members.map(m => m.name === numberingName ? { ...m, bytes } : m) };
  }
  const index = new LocationIndex(archive, settings.limits, main, dialect, budget);
  const changes = updates.map(({ before, path, kind }) => {
    const entry = index.byAddress.get(addressKey({ ...before.value, path }))?.find(e => e.kind === "paragraph");
    if (!entry) throw new UnsupportedEditError("List edit could not resolve its resulting paragraph.");
    const value = { ...before.value, generation: 1, path, range: null };
    const after: Location = { kind: "paragraph", value, token: encodeLocation(value), positions: entry.positions };
    return { kind, before, after };
  });
  const publication = { ...(request.input ? { input: request.input } : {}), ...(options.output === undefined ? {} : { output: options.output }), ...(options.inPlace === undefined ? {} : { inPlace: options.inPlace }), ...(options.force === undefined ? {} : { force: options.force }), ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }), ...(options.json === undefined ? {} : { json: options.json }) };
  const prospective = { changed: changes.length > 0, changes, dryRun: options.dryRun ?? false, output: options.dryRun ? null : { path: options.inPlace ? request.input?.path ?? null : options.output === "-" ? null : options.output ?? null, bytes: settings.limits.maxArchiveBytes, sha256: "0".repeat(64) } };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify({ version: 1, operation: request.operation, ok: true, data: prospective, affected: changes.length, locations: changes.map(c => c.after), warnings: [], errors: [] }) + "\n").length);
  const result = await publishDocumentArchive(archive, publication, { ...context, budget });
  return { changed: changes.length > 0, changes, dryRun: options.dryRun ?? false, output: result.published.length ? { path: result.published[0]!.path, bytes: result.published[0]!.bytes, sha256: result.archiveSha256! } : null };
}

function listProperties(xml: DocumentXmlEditor | undefined, props: XmlElement | undefined, id: number, level: number, w: string): string {
  const old = child(props, "numPr");
  if (old?.children.some(c => c.namespace !== w || !["ilvl", "numId"].includes(c.localName))) throw new UnsupportedEditError("Tracked or extended list references cannot be edited.");
  const ilvl = `<nl:ilvl xmlns:nl="${w}" nl:val="${level}"/>`, numId = `<nl:numId xmlns:nl="${w}" nl:val="${id}"/>`;
  let numbering = `<nl:numPr xmlns:nl="${w}">${ilvl}${numId}</nl:numPr>`;
  if (old && xml) {
    const priorLevel = child(old, "ilvl"), priorId = child(old, "numId");
    const patches = new Map<XmlElement, string>();
    if (priorLevel) patches.set(priorLevel, ilvl);
    if (priorId) patches.set(priorId, (priorLevel ? "" : ilvl) + numId);
    numbering = runElementOpen(old) + xml.sourceXml(old, patches, true) + (priorId ? "" : (priorLevel ? "" : ilvl) + numId) + `</${old.name}>`;
  }
  if (!props || !xml) return `<nl:pPr xmlns:nl="${w}">${numbering}</nl:pPr>`;
  if (old) return xml.sourceXml(props, new Map([[old, numbering]]));
  const preceding = ["pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl"];
  const next = props.children.find(c => c.namespace === w && !preceding.includes(c.localName));
  const content = xml.sourceXml(props, next ? new Map([[next, numbering + xml.sourceXml(next)]]) : new Map(), true) + (next ? "" : numbering);
  return runElementOpen(props) + content + `</${props.name}>`;
}
