import { archiveSettings, type ArchiveContext, type DocumentArchive } from "./archive.js";
import { DocxUsageError } from "./argument-json.js";
import { validateDocxInvocation } from "./command.js";
import { xmlValue } from "./create-content.js";
import { dialectForNamespace, documentDialects } from "./dialect.js";
import { closedRecord, decodeLocation, encodeLocation, SelectionError, type Location } from "./location-token.js";
import { openDocumentLocations, type DocumentLocations } from "./locations.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { DocumentPackage } from "./package.js";
import { DocumentArchiveEditor } from "./package-write.js";
import { relativePartTarget } from "./part-uri.js";
import { assertDocumentEditable, publishDocumentArchive, type PublicationContext, type PublicationInput } from "./publication.js";
import { formatSectionProperties, readSectionProperties, sectionAttribute, sectionBoolean, sectionChild, type SectionDirectProperties } from "./section-properties.js";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";
import type { DocumentBudget } from "./budget.js";
import type { XmlElement } from "./package-xml.js";

export interface SectionBinding { readonly linkedToPrevious: boolean; readonly sourceSection: number | null; readonly part: string | null }
export interface SectionInfo {
  readonly position: number;
  readonly owner: "paragraph" | "body";
  readonly location: Location<"section">;
  readonly direct: SectionDirectProperties;
  readonly headers: Readonly<Record<"default" | "first" | "even", SectionBinding>>;
  readonly footers: Readonly<Record<"default" | "first" | "even", SectionBinding>>;
}
export interface SectionListData { readonly items: readonly SectionInfo[]; readonly evenAndOddHeaders: boolean; readonly units: "twip" }
export type SectionEditRequest = { [K in "sections.set" | "sections.add"]: { readonly operation: K; readonly options: DocxOperationArguments<K>; readonly input?: PublicationInput } }["sections.set" | "sections.add"];
export interface SectionEditData {
  readonly changed: boolean;
  readonly changes: readonly { readonly kind: "format" | "insert"; readonly before: Location; readonly after: Location }[];
  readonly output: { readonly path: string | null; readonly bytes: number; readonly sha256: string } | null;
  readonly dryRun: boolean;
}
interface Owner { node: XmlElement | undefined; path: readonly number[]; owner: "body" | "paragraph" }
function sectionOwners(body: XmlElement, bodyPath: readonly number[], budget: DocumentBudget): Owner[] {
  const result: Owner[] = [];
  const w = body.namespace;
  let final: XmlElement | undefined;
  body.children.forEach((child, i) => {
    if (child.namespace !== w) return;
    if (child.localName === "sectPr") {
      if (final || i !== body.children.length - 1) throw new UnsupportedEditError("Final section properties must remain last in the body.");
      final = child;
    }
    if (child.localName === "p") {
      const props = sectionChild(child, "pPr"), section = sectionChild(props, "sectPr");
      if (section) result.push({ node: section, path: [...bodyPath, i, child.children.indexOf(props!), props!.children.indexOf(section)], owner: "paragraph" });
    }
  });
  result.push({ node: final, path: final ? [...bodyPath, body.children.indexOf(final)] : bodyPath, owner: "body" });
  const admitted = new Set(result.map(o => o.node));
  const visit = (node: XmlElement) => {
    budget.charge("work", 1);
    if (node.namespace === w && node.localName === "sectPr" && !admitted.has(node)) throw new UnsupportedEditError("Section properties inside revisions or unsupported containers cannot be edited.");
    for (const child of node.children) visit(child);
  };
  visit(body);
  return result;
}
function state(document: DocumentLocations, archive: DocumentArchive, settings: ReturnType<typeof archiveSettings>) {
  const bodyLocation = document.list("story", { scope: "body" })[0]!;
  const main = bodyLocation.value.part.slice(1);
  const editor = new DocumentArchiveEditor(archive, {}, undefined, settings.budget);
  const xml = editor.xml(main);
  const body = xml.root.children.find(c => c.namespace === xml.root.namespace && c.localName === "body")!;
  const owners = sectionOwners(body, bodyLocation.value.path, settings.budget);
  const graph = new DocumentPackage(archive, settings.limits, settings.budget);
  const dialect = dialectForNamespace(xml.root.namespace)!;
  const r = documentDialects[dialect].r;
  const edges = graph.relationships("/" + main);
  const edgesById = new Map(edges.map(edge => [edge.rId, edge]));
  const settingEdges = edges.filter(e => e.reltype === r + "/settings");
  if (settingEdges.length > 1 || settingEdges[0]?.is_external) throw new UnsupportedEditError("Settings require one internal relationship.");
  const settingEdge = settingEdges[0];
  const settingXml = settingEdge ? editor.xml(settingEdge.target_part.name) : undefined;
  const evenAndOddHeaders = sectionBoolean(sectionChild(settingXml?.root, "evenAndOddHeaders"));
  const inherited = { headers: new Map<string, SectionBinding>(), footers: new Map<string, SectionBinding>() };
  const items: SectionInfo[] = owners.map((owner, i) => {
    settings.budget.charge("work", 1);
    settings.budget.check("matches", i + 1);
    const value = { ...bodyLocation.value, story: bodyLocation.value.story + "#sections", path: owner.path };
    const location: Location<"section"> = { kind: "section", value, token: encodeLocation(value), positions: { section: i + 1 } };
    settings.budget.charge("retainedBytes", location.token.length * 4);
    const bindings = (kind: "headers" | "footers") => Object.fromEntries((["default", "first", "even"] as const).map(variant => {
      const name = kind === "headers" ? "header" : "footer";
      const refs = owner.node?.children.filter(n => n.namespace === xml.root.namespace && n.localName === name + "Reference" && sectionAttribute(n, "type") === variant) ?? [];
      if (refs.length > 1) throw new UnsupportedEditError("Duplicate section story bindings cannot be interpreted.");
      let binding = inherited[kind].get(variant);
      if (refs[0]) {
        const id = refs[0].attributes.find(a => a.namespace === r && a.localName === "id")?.value;
        const edge = id === undefined ? undefined : edgesById.get(id);
        if (!edge || edge.reltype !== r + "/" + name || edge.is_external) throw new UnsupportedEditError("Section story binding cannot be resolved.");
        binding = { linkedToPrevious: false, sourceSection: i + 1, part: edge.target_part.partname };
        inherited[kind].set(variant, binding);
      }
      return [variant, { linkedToPrevious: !refs.length, sourceSection: binding?.sourceSection ?? null, part: binding?.part ?? null }];
    })) as unknown as SectionInfo["headers"];
    return { position: i + 1, owner: owner.owner, location, direct: readSectionProperties(owner.node), headers: bindings("headers"), footers: bindings("footers") };
  });
  return { editor, xml, body, main, owners, items, evenAndOddHeaders, graph, dialect, settingXml, settingEdge };
}
function select(items: readonly SectionInfo[], options: DocxOperationArguments<"sections.list">, mutable = false): readonly SectionInfo[] {
  if (options.select !== undefined) {
    const value = decodeLocation(options.select);
    if (value.sourceSha256 !== items[0]?.location.value.sourceSha256 || value.generation !== 0) throw new SelectionError("stale-selection");
    const found = items.find(item => item.location.token === options.select);
    if (!found) throw new SelectionError("missing-selection");
    return [found];
  }
  const selected = options.section === undefined ? items : items.filter(item => item.position === options.section);
  if (!selected.length && mutable && !(options as DocxOperationArguments<"sections.set">).allowEmpty) throw new SelectionError("missing-selection");
  return selected;
}

/** Noncreating section inventory. Stored lengths are twips; missing geometry stays null. */
export async function inspectDocumentSections(input: Uint8Array, options: DocxOperationArguments<"sections.list">, context: ArchiveContext): Promise<SectionListData> {
  const settings = archiveSettings(context);
  const invocation = validateDocxInvocation({ operation: "sections.list", inputs: ["document"], options }, settings.budget);
  const opts = invocation.options as DocxOperationArguments<"sections.list">;
  const budget = settings.budget.lower(Object.fromEntries((opts.limit ?? []).map(item => [item.name, item.value])));
  const document = await openDocumentLocations(input, { ...settings, budget });
  const current = state(document, document.snapshot(), { ...settings, budget });
  const data: SectionListData = { items: select(current.items, opts), evenAndOddHeaders: current.evenAndOddHeaders, units: "twip" };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify(data)).length);
  return data;
}

/** Edits existing section owners or appends a boundary; never lays out or paginates. */
export async function editDocumentSections(input: Uint8Array, request: SectionEditRequest, context: PublicationContext): Promise<SectionEditData> {
  closedRecord(request, ["operation", "options", "input"]);
  if (!["sections.set", "sections.add"].includes(request.operation)) throw new DocxUsageError("Expected a section editing operation.");
  const settings = archiveSettings(context);
  const invocation = validateDocxInvocation({ operation: request.operation, inputs: [request.input?.path ?? "document"], options: request.options }, settings.budget);
  const opts = invocation.options as DocxOperationArguments<"sections.set">;
  if (opts.evenAndOddHeaders !== undefined && (opts.all !== true || opts.section !== undefined || opts.select !== undefined)) throw new DocxUsageError("Even/odd headers are document-wide; use explicit all-section selection.");
  if (request.operation === "sections.add" && ["select", "section", "all"].some(k => invocation.options[k] !== undefined)) throw new DocxUsageError("Section addition appends to the body and rejects selection.");
  const budget = settings.budget.lower(Object.fromEntries((opts.limit ?? []).map(item => [item.name, item.value])));
  const document = await openDocumentLocations(input, { ...settings, budget });
  let archive = document.snapshot();
  assertDocumentEditable(archive, { ...settings, budget });
  const current = state(document, archive, { ...settings, budget });
  const { xml, owners, items, main, body, editor } = current;
  const selected = request.operation === "sections.add" ? [items.at(-1)!] : select(items, opts, true);
  const changes: { kind: "format" | "insert"; before: Location; after: Location }[] = [];
  const geometryFields = ["orientation", "pageWidth", "pageHeight", "topMargin", "bottomMargin", "leftMargin", "rightMargin", "gutter", "headerDistance", "footerDistance", "columns", "columnGap", "startType"];
  if (geometryFields.some(k => invocation.options[k] !== undefined) && items.some(item => item.direct.startType === "continuous" && [item.direct.pageWidth, item.direct.pageHeight, item.direct.leftMargin, item.direct.rightMargin, item.direct.topMargin, item.direct.bottomMargin].some(n => n === null)))
    throw new UnsupportedEditError("Unresolved continuous-section page dependencies prevent isolated geometry edits.");
  const policyChanged = opts.evenAndOddHeaders !== undefined && opts.evenAndOddHeaders !== current.evenAndOddHeaders;
  for (const item of selected) {
    budget.charge("work", 1);
    const owner = owners[item.position - 1]!;
    const adding = request.operation === "sections.add";
    const properties = formatSectionProperties(xml, owner.node, adding ? { startType: opts.startType ?? { enum: "WD_SECTION_START", name: "NEW_PAGE" } } : opts, adding, sectionBoolean(sectionChild(current.settingXml?.root, "gutterAtTop")));
    if (adding) {
      const original = owner.node ? xml.sourceXml(owner.node) : `<sp:sectPr xmlns:sp="${xml.root.namespace}"/>`;
      const boundary = `<sp:p xmlns:sp="${xml.root.namespace}"><sp:pPr>${original}</sp:pPr></sp:p>`;
      if (owner.node) xml.replaceElement(owner.node, boundary + properties);
      else xml.insertChildren(body, boundary + properties);
    } else if (properties !== (owner.node ? xml.sourceXml(owner.node) : "")) {
      if (owner.node) xml.replaceElement(owner.node, properties); else xml.insertChildren(body, properties);
    } else if (!policyChanged) continue;
    const bodyPath = document.list("story", { scope: "body" })[0]!.value.path;
    const path = adding ? [...bodyPath, body.children.length + (owner.node ? 0 : 1)] : !owner.node && properties ? [...bodyPath, body.children.length] : owner.path;
    const value = { ...item.location.value, generation: 1, path };
    const after: Location<"section"> = { ...item.location, value, token: encodeLocation(value), positions: { section: adding ? items.length + 1 : item.position } };
    changes.push({ kind: adding ? "insert" : "format", before: item.location, after });
  }
  archive = editor.snapshot();
  if (policyChanged) {
    const w = xml.root.namespace, r = documentDialects[current.dialect].r;
    const markup = `<sp:evenAndOddHeaders xmlns:sp="${w}" sp:val="${Number(opts.evenAndOddHeaders)}"/>`;
    if (current.settingXml) {
      const old = sectionChild(current.settingXml.root, "evenAndOddHeaders");
      if (old) current.settingXml.replaceElement(old, markup);
      else current.settingXml.insertChildren(current.settingXml.root, markup, current.settingXml.root.children.find(c => c.namespace === w && !["writeProtection", "view", "zoom", "removePersonalInformation", "removeDateAndTime", "doNotDisplayPageBoundaries", "displayBackgroundShape", "printPostScriptOverText", "printFractionalCharacterWidth", "printFormsData", "embedTrueTypeFonts", "embedSystemFonts", "saveSubsetFonts", "saveFormsData", "mirrorMargins", "alignBordersAndEdges", "bordersDoNotSurroundHeader", "bordersDoNotSurroundFooter", "gutterAtTop", "hideSpellingErrors", "hideGrammaticalErrors", "activeWritingStyle", "proofState", "formsDesign", "attachedTemplate", "linkStyles", "stylePaneFormatFilter", "stylePaneSortMethod", "documentType", "mailMerge", "revisionView", "trackRevisions", "doNotTrackMoves", "doNotTrackFormatting", "documentProtection", "autoFormatOverride", "styleLockTheme", "styleLockQFSet", "defaultTabStop", "autoHyphenation", "consecutiveHyphenLimit", "hyphenationZone", "doNotHyphenateCaps", "showEnvelope", "summaryLength", "clickAndTypeStyle", "defaultTableStyle"].includes(c.localName)));
      archive = editor.snapshot();
    } else {
      const name = current.graph.allocatePartName("/word/settings", ".xml");
      const types = new DocumentXmlEditor(archive.members.find(m => m.name === "[Content_Types].xml")!.bytes, {}, undefined, budget);
      types.insertChildren(types.root, `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="${xmlValue(name)}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>`);
      const split = main.lastIndexOf("/"), relName = main.slice(0, split + 1) + "_rels/" + main.slice(split + 1) + ".rels";
      const rel = archive.members.find(m => m.name === relName);
      const ns = "http://schemas.openxmlformats.org/package/2006/relationships";
      const relXml = new DocumentXmlEditor(rel?.bytes ?? new TextEncoder().encode(`<Relationships xmlns="${ns}"/>`), {}, undefined, budget);
      relXml.insertChildren(relXml.root, `<Relationship xmlns="${ns}" Id="${current.graph.allocateRelationshipId("/" + main)}" Type="${r}/settings" Target="${xmlValue(relativePartTarget("/" + main, name))}"/>`);
      const members = archive.members.map(m => m.name === "[Content_Types].xml" ? { ...m, bytes: types.serialize() } : m === rel ? { ...m, bytes: relXml.serialize() } : m);
      if (!rel) members.push({ name: relName, bytes: relXml.serialize(), directory: false, modified: new Date("1980-01-01T00:00:00Z") });
      members.push({ name: name.slice(1), bytes: new TextEncoder().encode(`<sp:settings xmlns:sp="${w}">${markup}</sp:settings>`), directory: false, modified: new Date("1980-01-01T00:00:00Z") });
      archive = { ...archive, members };
    }
  }
  const publication = { ...(request.input ? { input: request.input } : {}), ...(opts.output === undefined ? {} : { output: opts.output }), ...(opts.inPlace === undefined ? {} : { inPlace: opts.inPlace }), ...(opts.force === undefined ? {} : { force: opts.force }), ...(opts.dryRun === undefined ? {} : { dryRun: opts.dryRun }), ...(opts.json === undefined ? {} : { json: opts.json }) };
  const prospective = { changed: changes.length > 0, changes, dryRun: opts.dryRun ?? false, output: { path: opts.output ?? request.input?.path ?? null, bytes: settings.limits.maxArchiveBytes, sha256: "0".repeat(64) } };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify({ version: 1, operation: request.operation, ok: true, data: prospective, affected: changes.length, locations: changes.map(c => c.after), warnings: [], errors: [] }) + "\n").length);
  const result = await publishDocumentArchive(archive, publication, { ...context, budget });
  return { changed: changes.length > 0, changes, dryRun: opts.dryRun ?? false, output: result.published.length ? { path: result.published[0]!.path, bytes: result.published[0]!.bytes, sha256: result.archiveSha256! } : null };
}
