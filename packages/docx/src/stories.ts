import { archiveSettings, type ArchiveContext, type DocumentArchive } from "./archive.js";
import { DocxUsageError } from "./argument-json.js";
import { validateDocxInvocation } from "./command.js";
import { xmlValue } from "./create-content.js";
import { documentDialects } from "./dialect.js";
import { closedRecord, encodeLocation, SelectionError, type Location } from "./location-token.js";
import { openDocumentLocations, type DocumentLocations } from "./locations.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { DocumentPackage } from "./package.js";
import { parseDocumentXml, type XmlElement } from "./package-xml.js";
import { paragraphTextRun, replaceParagraphContent } from "./paragraph-content.js";
import { relativePartTarget } from "./part-uri.js";
import { assertDocumentEditable, publishDocumentArchive, type PublicationContext, type PublicationInput } from "./publication.js";
import { sectionAttribute } from "./section-properties.js";
import { sectionState, type SectionInfo } from "./sections.js";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";

type StoryKind = "headers" | "footers";
type StoryVariant = "default" | "first" | "even";
type ReadOperation = `${StoryKind}.list` | `${StoryKind}.get`;
type EditOperation = `${StoryKind}.set` | `${StoryKind}.remove`;
export type StoryReadRequest = { [K in ReadOperation]: { readonly operation: K; readonly options: DocxOperationArguments<K> } }[ReadOperation];
export type StoryEditRequest = { [K in EditOperation]: { readonly operation: K; readonly options: DocxOperationArguments<K>; readonly input?: PublicationInput } }[EditOperation];
export interface StoryInfo {
  readonly kind: StoryKind;
  readonly section: number;
  readonly variant: StoryVariant;
  readonly part: string | null;
  readonly linked: boolean;
  readonly sourceSection: number | null;
  readonly owners: readonly number[];
  readonly text: string;
  readonly location: Location;
}
export interface StoryReadData { readonly items: readonly StoryInfo[] }
export interface StoryEditData {
  readonly changed: boolean;
  readonly affectedSections: readonly number[];
  readonly changes: readonly { readonly kind: "replace" | "remove" | "bind"; readonly before: Location; readonly after: Location }[];
  readonly output: { readonly path: string | null; readonly bytes: number; readonly sha256: string } | null;
  readonly dryRun: boolean;
}
const variants = ["default", "first", "even"] as const;
const relNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
const typeNamespace = "http://schemas.openxmlformats.org/package/2006/content-types";
function relationshipName(part: string): string {
  const split = part.lastIndexOf("/");
  return part.slice(0, split + 1) + "_rels/" + part.slice(split + 1) + ".rels";
}
function selectedSections(document: DocumentLocations, items: readonly SectionInfo[], options: DocxOperationArguments<"headers.get">, kind: StoryKind): readonly SectionInfo[] {
  if (options.select !== undefined) {
    const location = document.resolve(options.select);
    if (location.kind === "section") return items.filter(item => item.location.token === location.token);
    if (location.kind !== "story" || !document.list("story", { scope: kind }).some(s => s.token === location.token)) throw new SelectionError("missing-selection");
    const found = items.filter(item => item[kind][options.variant ?? "default"].part === location.value.part);
    if (!found.length) throw new SelectionError("missing-selection");
    if (found.length !== 1) throw new SelectionError("ambiguous-selection");
    return found;
  }
  return options.section === undefined ? items : items.filter(item => item.position === options.section);
}
function partOwners(items: readonly SectionInfo[], part: string | null): number[] {
  return part === null ? [] : items.filter(item => (["headers", "footers"] as const).some(kind => variants.some(variant => item[kind][variant].part === part))).map(item => item.position);
}

/** Noncreating queries include absent bindings and cached field results, never evaluated instructions. */
export async function inspectDocumentStories(input: Uint8Array, request: StoryReadRequest, context: ArchiveContext): Promise<StoryReadData> {
  closedRecord(request, ["operation", "options"]);
  if (!["headers.list", "headers.get", "footers.list", "footers.get"].includes(request.operation)) throw new DocxUsageError("Expected a story read operation.");
  const settings = archiveSettings(context);
  const invocation = validateDocxInvocation({ operation: request.operation, inputs: ["document"], options: request.options }, settings.budget);
  const opts = invocation.options as DocxOperationArguments<"headers.get">;
  const budget = settings.budget.lower(Object.fromEntries((opts.limit ?? []).map(item => [item.name, item.value])));
  const document = await openDocumentLocations(input, { ...settings, budget });
  const current = sectionState(document, document.snapshot(), { ...settings, budget });
  const kind = request.operation.split(".")[0] as StoryKind;
  const selected = selectedSections(document, current.items, opts, kind);
  if (!selected.length && request.operation.endsWith(".get")) throw new SelectionError("missing-selection");
  const stories = document.list("story", { scope: kind });
  const text = new Map<string, string>();
  const items: StoryInfo[] = [];
  for (const item of selected) for (const variant of request.operation.endsWith(".list") ? variants : [opts.variant ?? "default"] as const) {
    budget.charge("work", 1 + stories.length + current.items.length * 6);
    budget.check("matches", items.length + 1);
    const binding = item[kind][variant];
    const location = stories.find(story => story.value.part === binding.part) ?? item.location;
    if (binding.part && !text.has(binding.part)) text.set(binding.part, document.text({ select: location.token }).text);
    items.push({ kind, section: item.position, variant, part: binding.part, linked: binding.linkedToPrevious, sourceSection: binding.sourceSection,
      owners: partOwners(current.items, binding.part), location, text: binding.part ? text.get(binding.part)! : "" });
  }
  const data = { items };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify(data)).length);
  return data;
}

/** Stage binding changes, isolated copies and shared edits before any publication. */
export async function editDocumentStories(input: Uint8Array, request: StoryEditRequest, context: PublicationContext): Promise<StoryEditData> {
  closedRecord(request, ["operation", "options", "input"]);
  if (!["headers.set", "headers.remove", "footers.set", "footers.remove"].includes(request.operation)) throw new DocxUsageError("Expected a story editing operation.");
  const settings = archiveSettings(context);
  const invocation = validateDocxInvocation({ operation: request.operation, inputs: [request.input?.path ?? "document"], options: request.options }, settings.budget);
  const opts = invocation.options as DocxOperationArguments<"headers.set">;
  if (opts.shared && opts.linkToPrevious !== undefined) throw new DocxUsageError("Shared editing and binding changes conflict.");
  const budget = settings.budget.lower(Object.fromEntries((opts.limit ?? []).map(item => [item.name, item.value])));
  const document = await openDocumentLocations(input, { ...settings, budget });
  const archive = document.snapshot();
  assertDocumentEditable(archive, { ...settings, budget });
  const current = sectionState(document, archive, { ...settings, budget });
  const { xml, main, graph, owners, items } = current;
  const kind = request.operation.split(".")[0] as StoryKind, variant = opts.variant ?? "default";
  const selected = selectedSections(document, items, opts, kind);
  if (!selected.length) throw new SelectionError("missing-selection");
  if (selected.length !== 1) throw new SelectionError("ambiguous-selection");
  const item = selected[0]!, binding = item[kind][variant], name = kind === "headers" ? "header" : "footer";
  const remove = request.operation.endsWith(".remove"), link = opts.linkToPrevious === true;
  if (link && item.position === 1) throw new DocxUsageError("The initial section cannot link to a previous section.");
  budget.charge("work", items.length * 6);
  const slots = items.flatMap(section => variants.filter(v => section[kind][v].part === binding.part));
  if (!remove && !link && opts.linkToPrevious !== false && !opts.shared && (binding.linkedToPrevious || slots.length > 1)) throw new SelectionError("ambiguous-selection");
  if (opts.shared && !binding.part) throw new SelectionError("missing-selection");
  if (remove && binding.linkedToPrevious && !opts.allowEmpty) throw new SelectionError("missing-selection");
  const w = xml.root.namespace, r = documentDialects[current.dialect].r;
  const staged = new Map<string, Uint8Array>();
  const deleted = new Set<string>();
  const relName = relationshipName(main);
  const relMember = archive.members.find(member => member.name === relName);
  const relXml = new DocumentXmlEditor(relMember?.bytes ?? new TextEncoder().encode(`<Relationships xmlns="${relNamespace}"/>`), {}, undefined, budget);
  const types = new DocumentXmlEditor(archive.members.find(member => member.name === "[Content_Types].xml")!.bytes, {}, undefined, budget);
  const refs = new Map<number, string | null>();
  const newTypes: string[] = [], newRelationships: string[] = [];
  const edgeFor = (part: string) => graph.relationships("/" + main).find(edge => !edge.is_external && edge.reltype === r + "/" + name && edge.target_part.partname === part)!;
  const clone = (source: string | null): { part: string; id: string } => {
    const directory = source ? source.slice(0, source.lastIndexOf("/") + 1) : "/" + main.slice(0, main.lastIndexOf("/") + 1);
    const part = graph.allocatePartName(directory + name, ".xml"), id = graph.allocateRelationshipId("/" + main);
    const bytes = source ? graph.getPart(source).bytes : new TextEncoder().encode(`<w:${name === "header" ? "hdr" : "ftr"} xmlns:w="${w}"><w:p/></w:${name === "header" ? "hdr" : "ftr"}>`);
    staged.set(part.slice(1), bytes);
    const relationships = source && archive.members.find(member => member.name === relationshipName(source.slice(1)));
    if (relationships) staged.set(relationshipName(part.slice(1)), relationships.bytes);
    newTypes.push(`<Override xmlns="${typeNamespace}" PartName="${xmlValue(part)}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${name}+xml"/>`);
    newRelationships.push(`<Relationship xmlns="${relNamespace}" Id="${id}" Type="${r}/${name}" Target="${xmlValue(relativePartTarget("/" + main, part))}"/>`);
    return { part, id };
  };
  let target = binding.part;
  let changed = remove ? !binding.linkedToPrevious : link ? !binding.linkedToPrevious : opts.linkToPrevious === false || opts.text !== undefined;
  if (changed && !opts.shared && (remove || link || opts.linkToPrevious === false)) {
    // Preserve the next section's effective story before altering the inheritance chain.
    const next = items[item.position];
    if (next?.[kind][variant].linkedToPrevious) refs.set(next.position, binding.part ? edgeFor(binding.part).rId : clone(null).id);
    if (remove || link) { refs.set(item.position, null); target = null; }
    else { const copied = clone(binding.part); refs.set(item.position, copied.id); target = copied.part; }
  }
  if (opts.text !== undefined && target) {
    const story = new DocumentXmlEditor(staged.get(target.slice(1)) ?? graph.getPart(target).bytes, {}, undefined, budget);
    // Whole-story assignment is intentionally destructive for simple text, but does not discard fields or opaque blocks.
    const patches = new Map<XmlElement, string>();
    for (const [index, child] of story.root.children.entries()) {
      if (child.namespace !== w || child.localName !== "p") throw new UnsupportedEditError("Story text assignment cannot discard tables or opaque blocks; use scoped content operations.");
      if (index && (child.children.some(c => !["pPr", "r", "hyperlink"].includes(c.localName)) || child.content.some(c => c.kind !== "element" && (c.kind !== "text" || c.text.trim()))))
        throw new UnsupportedEditError("Story text assignment cannot remove paragraph annotations.");
      const props = child.children.find(c => c.namespace === w && c.localName === "pPr");
      const replacement = replaceParagraphContent(story, child, props ? story.sourceXml(props) : "", index ? "" : opts.text);
      patches.set(child, index ? "" : replacement);
    }
    const plain = (node: XmlElement): boolean => node.namespace === w && ["p", "r", "t"].includes(node.localName) &&
      node.attributes.every(a => a.namespace === "http://www.w3.org/XML/1998/namespace" && a.localName === "space") && node.children.every(plain);
    const plainText = (node: XmlElement): string => node.localName === "t" ? node.text : node.children.map(plainText).join("");
    const same = story.root.children.length === 1 && plain(story.root.children[0]!) && plainText(story.root.children[0]!) === opts.text;
    if (same) { if (!refs.size) changed = false; }
    else {
      if (patches.size) for (const [child, replacement] of patches) story.replaceElement(child, replacement);
      else story.insertChildren(story.root, `<pi:p xmlns:pi="${w}">${paragraphTextRun(w, opts.text)}</pi:p>`);
      staged.set(target.slice(1), story.serialize());
    }
  }
  const removedIds = new Set<string>();
  for (const [position, id] of refs) {
    const owner = owners[position - 1]!;
    const old = owner.node?.children.find(node => node.namespace === w && node.localName === name + "Reference" && sectionAttribute(node, "type") === variant);
    const oldId = old?.attributes.find(a => a.namespace === r && a.localName === "id")?.value;
    if (oldId) removedIds.add(oldId);
    const markup = id === null ? "" : `<sb:${name}Reference xmlns:sb="${w}" xmlns:sr="${r}" sb:type="${variant}" sr:id="${xmlValue(id)}"/>`;
    if (old) xml.replaceElement(old, markup);
    else if (markup && owner.node) xml.insertChildren(owner.node, markup, owner.node.children.find(n => name === "header" ? n.localName !== "headerReference" : !["headerReference", "footerReference"].includes(n.localName)));
    else if (markup) xml.insertChildren(current.body, `<sb:sectPr xmlns:sb="${w}">${markup}</sb:sectPr>`);
  }
  staged.set(main, xml.serialize());
  const used = new Set<string>();
  const visit = (node: XmlElement) => { budget.charge("work", 1); for (const a of node.attributes) if (a.namespace === r) used.add(a.value); for (const child of node.children) visit(child); };
  visit(parseDocumentXml(staged.get(main)!, {}, budget).root);
  const candidates = new Set<string>();
  for (const node of relXml.root.children) {
    const id = node.attributes.find(a => a.localName === "Id")?.value;
    if (!id || !removedIds.has(id) || used.has(id)) continue;
    const edge = graph.relationships("/" + main).find(edge => edge.rId === id)!;
    if (!edge.is_external) candidates.add(edge.target_part.partname);
    relXml.replaceElement(node, "");
  }
  if (newRelationships.length) relXml.insertChildren(relXml.root, newRelationships.join(""));
  if (newTypes.length) types.insertChildren(types.root, newTypes.join(""));
  staged.set(relName, relXml.serialize());
  staged.set("[Content_Types].xml", types.serialize());
  const snapshot = (): DocumentArchive => ({ ...archive, members: [
    ...archive.members.filter(m => !deleted.has(m.name)).map(m => ({ ...m, bytes: staged.get(m.name) ?? m.bytes })),
    ...[...staged].filter(([name]) => !deleted.has(name) && !archive.members.some(m => m.name === name)).map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") }))
  ] });
  const candidateGraph = new DocumentPackage(snapshot(), settings.limits, budget);
  for (const part of candidates) {
    const incoming = ["/", ...snapshot().members.filter(m => !m.directory && !m.name.endsWith(".rels") && m.name !== "[Content_Types].xml").map(m => "/" + m.name)]
      .some(owner => candidateGraph.relationships(owner).some(edge => !edge.is_external && edge.target_part.partname === part));
    if (incoming) continue;
    deleted.add(part.slice(1)); deleted.add(relationshipName(part.slice(1)));
    for (const node of types.root.children) if (node.localName === "Override" && node.attributes.some(a => a.localName === "PartName" && a.value === part)) types.replaceElement(node, "");
  }
  staged.set("[Content_Types].xml", types.serialize());
  const affectedSections = changed ? opts.shared ? partOwners(items, binding.part) : [item.position] : [];
  const changes = affectedSections.map(position => {
    const before = items[position - 1]!.location;
    const owner = owners[position - 1]!;
    const value = { ...before.value, generation: 1, path: owner.node || !refs.get(position) ? before.value.path : [...before.value.path, current.body.children.length] };
    return { kind: remove ? "remove" as const : opts.text === undefined ? "bind" as const : "replace" as const, before, after: { ...before, value, token: encodeLocation(value) } };
  });
  const publication = { ...(request.input ? { input: request.input } : {}), ...(opts.output === undefined ? {} : { output: opts.output }), ...(opts.inPlace === undefined ? {} : { inPlace: opts.inPlace }), ...(opts.force === undefined ? {} : { force: opts.force }), ...(opts.dryRun === undefined ? {} : { dryRun: opts.dryRun }), ...(opts.json === undefined ? {} : { json: opts.json }) };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify({ version: 1, operation: request.operation, ok: true, data: { changed, affectedSections, changes, dryRun: opts.dryRun ?? false, output: { path: opts.output ?? request.input?.path ?? null, bytes: settings.limits.maxArchiveBytes, sha256: "0".repeat(64) } }, affected: changes.length, locations: changes.map(c => c.after), warnings: [], errors: [] })).length + 1);
  const result = await publishDocumentArchive(snapshot(), publication, { ...context, budget });
  return { changed, affectedSections, changes, dryRun: opts.dryRun ?? false, output: result.published.length ? { path: result.published[0]!.path, bytes: result.published[0]!.bytes, sha256: result.archiveSha256! } : null };
}
