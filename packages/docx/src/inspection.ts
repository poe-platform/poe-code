import { parseMediaType } from "./media-type.js";
import { diagramPartRoles } from "./diagrams.js";
import { collectDiagramObservations } from "./diagram-observations.js";
import { chartDefinitionParts } from "./charts.js";
import { decodeChartContent } from "./chart-values.js";
import { readPropertyParts } from "./property-values.js";
import { activeControlLocks, activeSettingsProtection } from "./protection.js";
import { documentPartRole, signatureContentTypes, signatureRelationshipTypes } from "./document-part-roles.js";
import { embeddedFontContentTypes, fontResourceRole, readFontResources, type FontResourceData } from "./font-resources.js";
import { archiveSettings, documentSession, readArchive, InputTypeError, InvalidValueError, type ArchiveContext } from "./archive.js";
import { readDocumentArchive } from "./admission.js";
import { documentDialects, type DocumentDialect } from "./dialect.js";
import { MarkupCompatibility, compatibilityProfileForPart, documentCompatibilityProfile, type CompatibilityContent } from "./compatibility.js";
import { isXmlContentType, parseDocumentXml, UnsupportedProfileError, type XmlElement } from "./package-xml.js";
import { revisionInfo } from "./revision-markup.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { LocationIndex } from "./location-index.js";
import { DocumentLocations, docxLocationBudgets, type LocationQuery } from "./locations.js";
import { encodeGeneratedLocation as encodeLocation, SelectionError, type Location, type LocationPayload } from "./location-token.js";
import { validateDocumentArchive, type ValidationData, type ValidationOptions } from "./validation.js";

export interface InspectionPart { readonly name: string; readonly contentType: string; readonly bytes: number; readonly sha256: string }
export interface InspectionReference { readonly owner: string; readonly id: string; readonly type: string; readonly target: string; readonly external: boolean }
export interface InspectionProperty {
  readonly name: string;
  readonly type: "string" | "boolean" | "integer" | "number" | "date";
  readonly value: string | boolean | number | null;
  readonly writable: boolean;
  readonly cached: boolean;
  readonly part: string;
  readonly group: "core" | "extended" | "custom";
}
export interface InspectionFeature {
  readonly id: string; readonly level: "read" | "preserve";
  readonly subsets: readonly { readonly name: string; readonly level: "read" | "preserve"; readonly reason: string }[];
  readonly detected: boolean;
}
export interface InspectionAnnotation { readonly part: string; readonly kind: string; readonly id: string | null; readonly author: string | null; readonly date: string | null }
export interface InspectionProtection { readonly part: string; readonly kind: string; readonly enforced: boolean | null; readonly edit: string | null }
export interface InspectionWarning { readonly code: string; readonly message: string }
export interface InspectionData {
  readonly unsupportedNamespaces: readonly string[];
  readonly fontResources: FontResourceData;
  readonly kind: "docx" | "dotx";
  readonly dialect: DocumentDialect;
  readonly sizes: { readonly archiveBytes: number; readonly expandedBytes: number; readonly mediaBytes: number };
  readonly parts: readonly InspectionPart[];
  readonly relationships: readonly InspectionReference[];
  readonly contentTypes: { readonly defaults: readonly { extension: string; contentType: string }[]; readonly overrides: readonly { name: string; contentType: string }[] };
  readonly stories: readonly { kind: string; location: Location; properties: readonly InspectionProperty[]; references: readonly InspectionReference[]; support: "read" }[];
  readonly properties: readonly InspectionProperty[];
  readonly features: readonly InspectionFeature[];
  readonly counts: { paragraphs: number; runs: number; tables: number; rows: number; cells: number; images: number; sections: number; comments: number; footnotes: number; endnotes: number; fields: number; controls: number; equations: number; cachedPages: number | null };
  readonly signed: boolean;
  readonly protected: boolean;
  readonly pages: { readonly rendered: null; readonly cachedBreaks: number };
  readonly fonts: { readonly references: readonly string[]; readonly themeReferences: readonly string[]; readonly embedded: readonly string[]; readonly installed: null };
  readonly signatures: { readonly parts: readonly string[]; readonly verified: null };
  readonly media: readonly InspectionPart[];
  readonly annotations: readonly InspectionAnnotation[];
  readonly protection: readonly InspectionProtection[];
  readonly warnings: readonly InspectionWarning[];
}

export const inspectionLocationView = Symbol("inspection-location-view");
interface InspectionContext extends ArchiveContext { readonly [inspectionLocationView]?: { document?: DocumentLocations; roots?: ReadonlyMap<string, XmlElement> } }

/** Narrow location details while preserving the independently inventoried package census. */
export function selectInspectionLocations(document: DocumentLocations, roots: ReadonlyMap<string, XmlElement>, options: DocxOperationArguments<"inspect">): readonly Location[] {
  if (options.select !== undefined) return [document.resolve(options.select)];
  const section = options.section === undefined ? undefined : document.at("section", options.section);
  const query: LocationQuery = { scope: options.scope ?? "body", ...(options.section === undefined ? {} : { section: options.section }) };
  let owner: Location | undefined;
  if (options.comment !== undefined || options.note !== undefined)
    owner = document.at("story", (options.comment ?? options.note)!, { scope: options.comment === undefined ? query.scope ?? "body" : "comments" });
  for (const kind of ["table", "cell", "paragraph", "run", "image", "link", "control", "revision", "shape", "field", "bookmark"] as const) {
    if (options[kind] === undefined) continue;
    if (kind === "cell") owner = document.cell(owner!.token, options.cell!);
    else if (kind === "revision") {
      const budget = docxLocationBudgets.get(document)!;
      const revisions = document.list("annotation", owner ? { owner: owner.token } : query).filter(location => {
        budget.charge("work", location.value.path.length + 1);
        let node = roots.get(location.value.part);
        for (const index of location.value.path) node = node?.children[index];
        return node !== undefined && revisionInfo(node) !== undefined;
      });
      owner = revisions[options.revision! - 1];
      if (!owner) throw new SelectionError("missing-selection");
    } else owner = document.at(kind, options[kind] as number, owner ? { owner: owner.token } : query);
  }
  return owner ? [owner] : section && (options.scope === undefined || options.scope === "body") ? [section] : document.list("story", query);
}

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
function attribute(node: XmlElement, name: string, namespace = ""): string | undefined {
  return node.attributes.find(a => a.localName === name && a.namespace === namespace)?.value;
}
/** Package data only: no layout, installed-font discovery or linked-resource acquisition. */
export async function inspectDocument(input: Uint8Array, context: InspectionContext): Promise<InspectionData> {
  const { limits, signal, budget } = archiveSettings(context);
  if (!(input instanceof Uint8Array)) throw new InputTypeError("Expected archive bytes.");
  budget.check("compressedInput", input.length);
  budget.charge("retainedBytes", input.length);
  const owned = new Uint8Array(input);
  const archive = await readDocumentArchive(owned, { ...context, limits, signal, budget });
  const hash = async (bytes: Uint8Array): Promise<string> => {
    budget.charge("work", bytes.length);
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
    budget.check("work", 0);
    return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, "0")).join("");
  };
  const sourceSha256 = await hash(owned);
  const graph = archive.package;
  const parts: InspectionPart[] = [];
  for (const member of [...archive.members].filter(m => !m.directory).sort((a, b) => compare(a.name, b.name))) {
    const name = member.name.toLowerCase() === "[content_types].xml" ? "/[Content_Types].xml" : graph.getPart("/" + member.name).partname;
    parts.push({ name, contentType: name === "/[Content_Types].xml" ? "application/xml" : graph.getPart(name).content_type, bytes: member.bytes.length, sha256: await hash(member.bytes) });
  }
  parts.sort((a, b) => compare(a.name, b.name));
  const relationships: InspectionReference[] = [];
  for (const owner of ["/", ...graph.parts.filter(p => p.content_type.toLowerCase() !== "application/vnd.openxmlformats-package.relationships+xml").map(p => p.partname)].sort(compare)) {
    for (const edge of graph.relationships(owner))
      relationships.push({ owner, id: edge.rId, type: edge.reltype, target: edge.target_ref, external: edge.is_external });
  }
  const counts: InspectionData["counts"] = { paragraphs: 0, runs: 0, tables: 0, rows: 0, cells: 0, images: 0, sections: 0, comments: 0, footnotes: 0, endnotes: 0, fields: 0, controls: 0, equations: 0, cachedPages: null };
  const countNames = new Map<string, keyof typeof counts>([["p", "paragraphs"], ["r", "runs"], ["tbl", "tables"], ["tr", "rows"], ["tc", "cells"], ["sectPr", "sections"], ["comment", "comments"], ["sdt", "controls"]]);
  const { w, a, m } = documentDialects[archive.dialect];
  const properties: InspectionProperty[] = [];
  const annotations: InspectionAnnotation[] = [];
  const protection: InspectionProtection[] = [];
  const fontNames = new Set<string>();
  const themeNames = new Set<string>();
  const unknownNamespaces = new Set<string>();
  const roots = new Map<string, XmlElement>();
  const compatibilityViews = new Map<string, MarkupCompatibility>();
  let cachedBreaks = 0;
  let compatibility = false;
  const annotationNames = new Set(["comment", "ins", "del", "moveFrom", "moveTo", "rPrChange", "pPrChange", "tblPrChange", "tcPrChange", "sectPrChange", "numberingChange"]);
  for (const part of [...graph.parts].sort((a, b) => compare(a.partname, b.partname))) {
    const type = part.content_type.toLowerCase();
    if (!isXmlContentType(type)) continue;
    const root = parseDocumentXml(part.bytes, {}, budget).root;
    roots.set(part.partname, root);
    const role = documentPartRole(type, root);
    const fontRole = fontResourceRole(type, root);
    const raw = [root];
    while (raw.length) {
      budget.charge("work", 1);
      const node = raw.pop()!;
      for (const child of node.children) { budget.charge("retainedBytes", 16); raw.push(child); }
      if (node.namespace === "http://schemas.openxmlformats.org/markup-compatibility/2006" || node.attributes.some(attr => attr.namespace === "http://schemas.openxmlformats.org/markup-compatibility/2006")) compatibility = true;
      if (!documentCompatibilityProfile.understoodNamespaces.includes(node.namespace) && node.namespace !== "http://schemas.openxmlformats.org/markup-compatibility/2006") unknownNamespaces.add(node.namespace);
      for (const attr of node.attributes) if (attr.namespace && attr.namespace !== "http://www.w3.org/2000/xmlns/" && attr.namespace !== "http://schemas.openxmlformats.org/markup-compatibility/2006" && !documentCompatibilityProfile.understoodNamespaces.includes(attr.namespace)) unknownNamespaces.add(attr.namespace);
    }
    const view = new MarkupCompatibility(root, compatibilityProfileForPart(part.partname), budget);
    budget.charge("retainedBytes", 64);
    compatibilityViews.set(part.partname, view);
    const settingsProtection = role === "settings" ? activeSettingsProtection(root, view, budget) : new Set<XmlElement>();
    const controlLocks = role === "story" || role === "glossary" ? activeControlLocks(root, view, budget) : new Map<XmlElement, never>();
    compatibility ||= view.branches.length > 0;
    const stack: CompatibilityContent[] = [...view.content].reverse();
    while (stack.length) {
      budget.charge("work", 1);
      const current = stack.pop()!;
      if (!("source" in current)) continue;
      const node = current.source;
      if (current.disposition !== "understood") { unknownNamespaces.add(node.namespace); continue; }
      for (let index = current.content.length - 1; index >= 0; index--) stack.push(current.content[index]!);
      if (node.namespace === w && (role === "story" || role === "glossary" || role === "settings")) {
        const name = node.localName;
        const count = countNames.get(name);
        if (count && count !== "cachedPages") counts[count]++;
        if (["footnote", "endnote"].includes(name) && !["separator", "continuationSeparator", "continuationNotice"].includes(attribute(node, "type", w) ?? "normal")) counts[name === "footnote" ? "footnotes" : "endnotes"]++;
        if (name === "fldSimple" || name === "fldChar" && attribute(node, "fldCharType", w) === "begin") counts.fields++;
        if (name === "lastRenderedPageBreak") cachedBreaks++;
        if (annotationNames.has(name)) annotations.push({ part: part.partname, kind: name, id: attribute(node, "id", w) ?? null, author: attribute(node, "author", w) ?? null, date: attribute(node, "date", w) ?? null });
        if (settingsProtection.has(node) || controlLocks.has(node)) {
          const enforcement = attribute(node, "enforcement", w);
          const edit = attribute(node, name === "lock" ? "val" : "edit", w) ?? null;
          const enforced = name === "lock" ? edit !== "unlocked" : name === "writeProtection" ? true : enforcement === undefined ? false : ["1", "true", "on"].includes(enforcement) ? true : ["0", "false", "off"].includes(enforcement) ? false : null;
          protection.push({ part: part.partname, kind: name, enforced, edit });
        }
      }
      if (node.namespace === w && (role === "story" || role === "glossary" || role === "settings" || fontRole === "styles")) {
        if (node.localName === "rFonts") for (const attr of node.attributes) {
          if (attr.namespace !== w) continue;
          if (["ascii", "hAnsi", "eastAsia", "cs"].includes(attr.localName)) fontNames.add(attr.value);
          if (["asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme"].includes(attr.localName)) themeNames.add(attr.value);
        }
      }
      if (node.namespace === a && (fontRole === "theme" || role === "story" || role === "glossary" || ["application/vnd.openxmlformats-officedocument.drawingml.chart+xml", "application/vnd.ms-office.chartex+xml"].includes(parseMediaType(type))) && ["latin", "ea", "cs", "font"].includes(node.localName)) { const value = attribute(node, "typeface"); if (value) fontNames.add(value); }
      if (node.namespace === m && node.localName === "oMath") counts.equations++;
    }
  }
  const propertyParts = readPropertyParts(archive, budget, roots);
  for (const part of propertyParts) for (const property of part.properties) if (property.value) properties.push({ ...property.value, writable: property.value.writable && part.owned && !part.ambiguous && part.safeCustom, part: part.name, group: part.group });
  properties.sort((a, b) => compare(a.part, b.part) || compare(a.name, b.name));
  const pages = properties.filter(p => p.group === "extended" && p.name === "pages");
  counts.cachedPages = pages.length === 1 && typeof pages[0]!.value === "number" && pages[0]!.value >= 0 ? pages[0]!.value : null;
  const index = new LocationIndex(archive, limits, archive.mainPart, archive.dialect, budget, graph, roots);
  const view = context[inspectionLocationView];
  if (view) {
    view.document = new DocumentLocations(archive, sourceSha256, { ...context, limits, signal, budget }, "inventory", index);
    view.roots = roots;
  }
  counts.images = index.entries.filter(entry => entry.kind === "image").length;
  const stories = index.entries.filter(entry => entry.kind === "story").map(entry => {
    const value: LocationPayload = { version: 1, sourceSha256, generation: context[documentSession]?.generation ?? 0, part: entry.part, story: entry.story, path: entry.path, range: null };
    const token = encodeLocation(value);
    budget.charge("retainedBytes", token.length * 4);
    return { kind: entry.scope ?? "story", location: { kind: "story" as const, token, value, positions: { ...entry.positions } }, properties: [], references: relationships.filter(r => r.owner === entry.part), support: "read" as const };
  });
  const signatureReferences = relationships.filter(reference => signatureRelationshipTypes.includes(reference.type));
  const signatureTargets = new Set<string>(); for (const owner of ["/", ...graph.parts.filter(part => part.content_type.toLowerCase() !== "application/vnd.openxmlformats-package.relationships+xml").map(part => part.partname)]) for (const edge of graph.relationships(owner)) if (!edge.is_external && signatureRelationshipTypes.includes(edge.reltype)) signatureTargets.add(edge.target_part.partname);
  const signatureParts = parts.filter(part => signatureContentTypes.includes(part.contentType.toLowerCase()) || signatureTargets.has(part.name));
  const signed = signatureParts.length > 0 || signatureReferences.length > 0;
  const media = parts.filter(p => ["image/", "audio/", "video/"].some(prefix => p.contentType.toLowerCase().startsWith(prefix)));
  const embedded = parts.filter(p => embeddedFontContentTypes.includes(parseMediaType(p.contentType))).map(p => p.name);
  const warnings: InspectionWarning[] = [
    { code: "partial-validation", message: "Inspection is an inventory; core-v1 validation is partial and does not certify schema conformance." },
    { code: "cached-layout", message: "Page metadata and stored page breaks are cached; rendered pages are not measured." },
    { code: "font-availability", message: "Font names are document references; installed fonts are not queried." }
  ];
  if (propertyParts.some(p => !p.owned || p.ambiguous || !p.safeCustom || p.properties.some(property => !property.value || property.value.value === null))) warnings.push({ code: "invalid-property", message: "One or more stored property values are invalid or unsupported; opaque values remain preserved outside scalar snapshots." });
  if (signatureParts.length) warnings.push({ code: "unverified-signatures", message: "Signature parts are present; cryptographic signatures are not verified." });
  if (protection.length) warnings.push({ code: "unvalidated-protection", message: "Protection metadata is present; passwords and enforcement are not verified." });
  if (unknownNamespaces.size) warnings.push({ code: "unvalidated-extensions", message: "Opaque extension content is inventoried without semantic validation." });
  const chartParts = chartDefinitionParts(graph, budget);
  const decodedCharts = chartParts.some(part => parseMediaType(part.content_type) === "application/vnd.openxmlformats-officedocument.drawingml.chart+xml" && roots.has(part.partname) && decodeChartContent(roots.get(part.partname)!, part.partname, budget).status === "decoded");
  const diagramRoles = diagramPartRoles(graph, archive.dialect, budget);
  const diagramObservations = [...roots].flatMap(([part, root]) => collectDiagramObservations(root, archive.dialect, part, budget, compatibilityViews.get(part)));
  const knownDiagrams = diagramRoles.size > 0 || diagramObservations.some(observation => observation.kind === "relIds");
  const detections: readonly [string, boolean, "read" | "preserve"][] = [
    ["F01", true, "read"], ["F02", true, "read"], ["F03", archive.kind === "dotx", "read"], ["F05", compatibility, "read"], ["F06", true, "read"],
    ["F19", counts.tables > 0, "read"], ["F21", relationships.some(r => Object.values(documentDialects).some(dialect => r.type === `${dialect.r}/hyperlink`)), "read"], ["F22", counts.fields > 0, "read"],
    ["F24", counts.footnotes + counts.endnotes > 0, "read"], ["F25", counts.comments > 0, "read"], ["F26", annotations.some(a => a.kind !== "comment"), "read"],
    ["F27", annotations.some(a => ["moveFrom", "moveTo", "tblPrChange", "tcPrChange", "sectPrChange"].includes(a.kind)), "read"],
    ["F37", chartParts.length > 0, decodedCharts ? "read" : "preserve"],
    ["F38", knownDiagrams, "preserve"],
    ["F28", counts.controls > 0, "read"], ["F30", propertyParts.length > 0, properties.length > 0 ? "read" : "preserve"], ["F31", media.length > 0, "read"], ["F39", counts.equations > 0, "preserve"],
    ["F41", relationships.some(r => ["http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml", "http://purl.oclc.org/ooxml/officeDocument/relationships/customXml", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/glossaryDocument", "http://purl.oclc.org/ooxml/officeDocument/relationships/glossaryDocument"].includes(r.type)) || parts.some(p => parseMediaType(p.contentType) === "application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml" || parseMediaType(p.contentType) === "application/vnd.openxmlformats-officedocument.customxmlproperties+xml"), "preserve"], ["F42", fontNames.size + embedded.length + protection.length > 0 || parts.some(p => ["application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.fonttable+xml"].includes(parseMediaType(p.contentType))), "read"], ["F43", signed, "preserve"]
  ];
  const fontResources = readFontResources(archive, roots, budget, compatibilityViews);
  for (const table of fontResources.fontTables) for (const font of table.fonts) if (font.name) fontNames.add(font.name);
  if (fontResources.diagnostics.length) warnings.push({ code: "unresolved-font-resources", message: "Theme or embedded font references have unresolved package resources; see fontResources.diagnostics." });
  const result: InspectionData = { fontResources, kind: archive.kind, dialect: archive.dialect, sizes: { archiveBytes: owned.length, expandedBytes: parts.reduce((sum, p) => sum + p.bytes, 0), mediaBytes: media.reduce((sum, p) => sum + p.bytes, 0) }, parts, relationships,
    contentTypes: { defaults: graph.defaults.map(d => ({ extension: d.extension, contentType: d.content_type })).sort((a, b) => compare(a.extension, b.extension)), overrides: graph.overrides.map(d => ({ name: d.partname, contentType: d.content_type })).sort((a, b) => compare(a.name, b.name)) },
    unsupportedNamespaces: [...unknownNamespaces].sort(compare), stories, properties, counts, features: detections.map(([id, detected, level]) => ({ id, detected, level, subsets: id === "F39" ? [{name:"inventory",level,reason:"Physical stored math inventory preserves opaque units and does not evaluate equations."},{name:"bounded-fragment-edit",level:"read" as const,reason:"Explicit equation utilities admit bounded fragments only at current editable paragraph or whole-unit tokens; inventory counts remain exposed expressions."}] : id === "F38" ? [{ name: "inventory", level, reason: "Diagram resource inventory and preservation only; no layout generation." }, ...(diagramObservations.some(observation => observation.kind !== "relIds") ? [{ name: "opaque-graphics", level: "preserve" as const, reason: "Opaque physical graphics observations do not establish known diagram semantics." }] : [])] : [{ name: "inventory", level, reason: "Package inventory only; no editing or rendering claim." }] })),
    signed, protected: protection.some(p => p.enforced !== false), pages: { rendered: null, cachedBreaks },
    fonts: { references: [...fontNames].sort(compare), themeReferences: [...themeNames].sort(compare), embedded, installed: null },
    signatures: { parts: signatureParts.map(p => p.name), verified: null }, media, annotations, protection, warnings };
  const size = new TextEncoder().encode(JSON.stringify(result)).length;
  budget.check("serializedOutput", size);
  budget.charge("retainedBytes", size);
  return result;
}

export async function validateDocument(input: Uint8Array, context: ArchiveContext, options: ValidationOptions = {}): Promise<ValidationData> {
  const { limits, signal, budget } = archiveSettings(context);
  if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some(k => !["profile", "maxParts", "maxBytes", "maxNodes", "maxDiagnostics"].includes(k)) || options.profile !== undefined && options.profile !== "core-v1")
    throw new InvalidValueError("Unknown validation profile or option.");
  if (input instanceof Uint8Array && input.length >= 8 && [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((b, i) => input[i] === b)) {
    budget.check("compressedInput", input.length);
    throw new UnsupportedProfileError("Compound binary Word or encrypted Office containers are unsupported.");
  }
  const archive = await readArchive(input, { limits, signal, budget });
  const report = validateDocumentArchive(archive, options, budget);
  return { ...report, checks: report.checks.map(c => c.id === "container" ? { id: c.id, status: "passed" } : c),
    warnings: ["Partial schema and semantic validation only; no full conformance certification.", "Protection, signature cryptography, extension semantics and rendered layout are unvalidated."] };
}
