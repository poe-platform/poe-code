import { readFontResources, type FontResourceData } from "./font-resources.js";
import { archiveSettings, readArchive, InputTypeError, InvalidValueError, type ArchiveContext } from "./archive.js";
import { readDocumentArchive } from "./admission.js";
import { documentDialects, type DocumentDialect } from "./dialect.js";
import { MarkupCompatibility, documentCompatibilityProfile, type CompatibilityContent } from "./compatibility.js";
import { parseDocumentXml, UnsupportedProfileError, type XmlElement } from "./package-xml.js";
import { LocationIndex } from "./location-index.js";
import { encodeLocation, type Location, type LocationPayload } from "./location-token.js";
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

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
function attribute(node: XmlElement, name: string, namespace = ""): string | undefined {
  return node.attributes.find(a => a.localName === name && a.namespace === namespace)?.value;
}
function textContent(node: XmlElement): string {
  return node.content.map(n => n.kind === "element" ? textContent(n) : n.kind === "text" || n.kind === "cdata" ? n.text : "").join("");
}
function numberValue(value: string, integer: boolean): number | null {
  const digits = value[0] === "+" || value[0] === "-" ? value.slice(1) : value;
  if (!digits || [...digits].some(c => !(integer ? "0123456789" : "0123456789.eE+-").includes(c))) return null;
  const n = Number(value);
  return Number.isFinite(n) && (!integer || Number.isSafeInteger(n)) ? n : null;
}
function propertiesOf(root: XmlElement, part: string, dialect: DocumentDialect): InspectionProperty[] {
  const { ep, cus, vt } = documentDialects[dialect];
  const core = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";
  const group = root.namespace === core && root.localName === "coreProperties" ? "core" :
    root.namespace === ep && root.localName === "Properties" ? "extended" :
    root.namespace === cus && root.localName === "Properties" ? "custom" : undefined;
  if (!group) return [];
  const names: Record<string, string> = { creator: "author", lastModifiedBy: "lastModifiedBy", description: "comments", lastPrinted: "lastPrinted", Pages: "pages", Words: "words", Characters: "characters", CharactersWithSpaces: "charactersWithSpaces", TotalTime: "totalTime", Application: "application", AppVersion: "appVersion", Company: "company", Manager: "manager", Template: "template", Lines: "lines", Paragraphs: "paragraphs" };
  const integers = new Set(["revision", "Pages", "Words", "Characters", "CharactersWithSpaces", "TotalTime", "Paragraphs", "Lines"]);
  return root.children.flatMap(node => {
    if (group === "core" && ![core, "http://purl.org/dc/elements/1.1/", "http://purl.org/dc/terms/"].includes(node.namespace) ||
      group === "extended" && node.namespace !== ep || group === "custom" && (node.namespace !== cus || node.localName !== "property")) return [];
    const valueNode = group === "custom" ? node.children.find(n => n.namespace === vt) : node;
    if (!valueNode) return [];
    const name = group === "custom" ? attribute(node, "name") : names[node.localName] ?? node.localName;
    if (name === undefined) return [];
    const raw = textContent(valueNode);
    const valueType = valueNode.localName;
    let type: InspectionProperty["type"] = "string";
    if (group === "custom") {
      if (["i1", "i2", "i4", "i8", "int", "ui1", "ui2", "ui4", "ui8", "uint"].includes(valueType)) type = "integer";
      else if (["r4", "r8", "decimal"].includes(valueType)) type = "number";
      else if (valueType === "bool") type = "boolean";
      else if (["filetime", "date"].includes(valueType)) type = "date";
    } else if (integers.has(node.localName)) type = "integer";
    else if (["created", "modified", "lastPrinted"].includes(node.localName)) type = "date";
    else if (["DocSecurity", "ScaleCrop", "LinksUpToDate", "SharedDoc", "HyperlinksChanged"].includes(node.localName)) type = node.localName === "DocSecurity" ? "integer" : "boolean";
    let value: InspectionProperty["value"] = raw;
    if (type === "integer" || type === "number") value = numberValue(raw, type === "integer");
    if (type === "boolean") value = ["true", "1"].includes(raw) ? true : ["false", "0"].includes(raw) ? false : null;
    if (type === "date") {
      const utc = raw.endsWith("Z") || raw.slice(10).includes("+") || raw.slice(10).includes("-");
      const day = raw.slice(0, 10);
      const dayDate = new Date(day + "T00:00:00Z");
      const validDay = Number.isFinite(dayDate.getTime()) && dayDate.toISOString().slice(0, 10) === day;
      const millis = utc && validDay ? Date.parse(raw) : NaN;
      value = Number.isFinite(millis) ? new Date(millis).toISOString() : null;
    }
    if (valueNode.children.length || group === "custom" && type === "string" && !["lpstr", "lpwstr", "bstr"].includes(valueType)) value = null;
    return [{ name, type, value, writable: false, cached: group === "extended" && (integers.has(node.localName) || ["Application", "AppVersion"].includes(node.localName)), part, group }];
  });
}

/** Package data only: no layout, installed-font discovery or linked-resource acquisition. */
export async function inspectDocument(input: Uint8Array, context: ArchiveContext): Promise<InspectionData> {
  const { limits, signal, budget } = archiveSettings(context);
  if (!(input instanceof Uint8Array)) throw new InputTypeError("Expected archive bytes.");
  budget.check("compressedInput", input.length);
  budget.charge("retainedBytes", input.length);
  const owned = new Uint8Array(input);
  const archive = await readDocumentArchive(owned, { limits, signal, budget });
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
  for (const owner of ["/", ...graph.parts.filter(p => !p.content_type.endsWith("relationships+xml")).map(p => p.partname)].sort(compare)) {
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
  let cachedBreaks = 0;
  let compatibility = false;
  const annotationNames = new Set(["comment", "ins", "del", "moveFrom", "moveTo", "rPrChange", "pPrChange", "tblPrChange", "tcPrChange", "sectPrChange", "numberingChange"]);
  for (const part of [...graph.parts].sort((a, b) => compare(a.partname, b.partname))) {
    const type = part.content_type.toLowerCase();
    if (!(type.endsWith("+xml") || type === "application/xml" || type === "text/xml")) continue;
    const root = parseDocumentXml(part.bytes, {}, budget).root;
    roots.set(part.partname, root);
    properties.push(...propertiesOf(root, part.partname, archive.dialect));
    const raw = [root];
    while (raw.length) {
      budget.charge("work", 1);
      const node = raw.pop()!;
      raw.push(...node.children);
      if (node.namespace === "http://schemas.openxmlformats.org/markup-compatibility/2006" || node.attributes.some(attr => attr.namespace === "http://schemas.openxmlformats.org/markup-compatibility/2006")) compatibility = true;
      if (!documentCompatibilityProfile.understoodNamespaces.includes(node.namespace) && node.namespace !== "http://schemas.openxmlformats.org/markup-compatibility/2006") unknownNamespaces.add(node.namespace);
      for (const attr of node.attributes) if (attr.namespace && attr.namespace !== "http://www.w3.org/2000/xmlns/" && attr.namespace !== "http://schemas.openxmlformats.org/markup-compatibility/2006" && !documentCompatibilityProfile.understoodNamespaces.includes(attr.namespace)) unknownNamespaces.add(attr.namespace);
    }
    const view = new MarkupCompatibility(root, undefined, budget);
    compatibility ||= view.branches.length > 0;
    const stack: CompatibilityContent[] = [...view.content].reverse();
    while (stack.length) {
      budget.charge("work", 1);
      const current = stack.pop()!;
      if (!("source" in current)) continue;
      const node = current.source;
      if (current.disposition !== "understood") { unknownNamespaces.add(node.namespace); continue; }
      stack.push(...[...current.content].reverse());
      if (node.namespace === w) {
        const name = node.localName;
        const count = countNames.get(name);
        if (count && count !== "cachedPages") counts[count]++;
        if (["footnote", "endnote"].includes(name) && !["separator", "continuationSeparator", "continuationNotice"].includes(attribute(node, "type", w) ?? "normal")) counts[name === "footnote" ? "footnotes" : "endnotes"]++;
        if (name === "fldSimple" || name === "fldChar" && attribute(node, "fldCharType", w) === "begin") counts.fields++;
        if (name === "lastRenderedPageBreak") cachedBreaks++;
        if (annotationNames.has(name)) annotations.push({ part: part.partname, kind: name, id: attribute(node, "id", w) ?? null, author: attribute(node, "author", w) ?? null, date: attribute(node, "date", w) ?? null });
        if (["documentProtection", "writeProtection", "lock"].includes(name)) {
          const enforcement = attribute(node, "enforcement", w);
          const edit = attribute(node, name === "lock" ? "val" : "edit", w) ?? null;
          const enforced = name === "lock" ? edit !== "unlocked" : name === "writeProtection" ? true : enforcement === undefined ? false : ["1", "true", "on"].includes(enforcement) ? true : ["0", "false", "off"].includes(enforcement) ? false : null;
          protection.push({ part: part.partname, kind: name, enforced, edit });
        }
        if (name === "font") { const value = attribute(node, "name", w); if (value) fontNames.add(value); }
        if (name === "rFonts") for (const attr of node.attributes) {
          if (attr.namespace !== w) continue;
          if (["ascii", "hAnsi", "eastAsia", "cs"].includes(attr.localName)) fontNames.add(attr.value);
          if (["asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme"].includes(attr.localName)) themeNames.add(attr.value);
        }
      }
      if (node.namespace === a && node.localName === "blip") counts.images++;
      if (node.namespace === a && ["latin", "ea", "cs", "font"].includes(node.localName)) { const value = attribute(node, "typeface"); if (value) fontNames.add(value); }
      if (node.namespace === m && node.localName === "oMath") counts.equations++;
    }
  }
  properties.sort((a, b) => compare(a.part, b.part) || compare(a.name, b.name));
  const pages = properties.filter(p => p.group === "extended" && p.name === "pages");
  counts.cachedPages = pages.length === 1 && typeof pages[0]!.value === "number" && pages[0]!.value >= 0 ? pages[0]!.value : null;
  const index = new LocationIndex(archive, limits, archive.mainPart, archive.dialect, budget);
  const stories = index.entries.filter(entry => entry.kind === "story").map(entry => {
    const value: LocationPayload = { version: 1, sourceSha256, generation: 0, part: entry.part, story: entry.story, path: entry.path, range: null };
    const token = encodeLocation(value);
    budget.charge("retainedBytes", token.length * 4);
    return { kind: entry.scope ?? "story", location: { kind: "story" as const, token, value, positions: { ...entry.positions } }, properties: [], references: relationships.filter(r => r.owner === entry.part), support: "read" as const };
  });
  const signatureParts = parts.filter(p => p.contentType.toLowerCase().startsWith("application/vnd.openxmlformats-package.digital-signature") || p.name.toLowerCase().startsWith("/_xmlsignatures/"));
  const media = parts.filter(p => ["image/", "audio/", "video/"].some(prefix => p.contentType.toLowerCase().startsWith(prefix)));
  const embedded = parts.filter(p => p.contentType.toLowerCase().includes("font")).filter(p => !p.contentType.endsWith("+xml")).map(p => p.name);
  const warnings: InspectionWarning[] = [
    { code: "partial-validation", message: "Inspection is an inventory; core-v1 validation is partial and does not certify schema conformance." },
    { code: "cached-layout", message: "Page metadata and stored page breaks are cached; rendered pages are not measured." },
    { code: "font-availability", message: "Font names are document references; installed fonts are not queried." }
  ];
  if (properties.some(p => p.value === null)) warnings.push({ code: "invalid-property", message: "One or more stored property values are invalid or unsupported; unknown values are reported as null." });
  if (signatureParts.length) warnings.push({ code: "unverified-signatures", message: "Signature parts are present; cryptographic signatures are not verified." });
  if (protection.length) warnings.push({ code: "unvalidated-protection", message: "Protection metadata is present; passwords and enforcement are not verified." });
  if (unknownNamespaces.size) warnings.push({ code: "unvalidated-extensions", message: "Opaque extension content is inventoried without semantic validation." });
  const detections: readonly [string, boolean, "read" | "preserve"][] = [
    ["F01", true, "read"], ["F02", true, "read"], ["F03", archive.kind === "dotx", "read"], ["F05", compatibility, "read"], ["F06", true, "read"],
    ["F19", counts.tables > 0, "read"], ["F21", relationships.some(r => r.type.endsWith("/hyperlink")), "read"], ["F22", counts.fields > 0, "read"],
    ["F24", counts.footnotes + counts.endnotes > 0, "read"], ["F25", counts.comments > 0, "read"], ["F26", annotations.some(a => a.kind !== "comment"), "read"],
    ["F27", annotations.some(a => ["moveFrom", "moveTo", "tblPrChange", "tcPrChange", "sectPrChange"].includes(a.kind)), "read"],
    ["F28", counts.controls > 0, "read"], ["F30", properties.length > 0, "read"], ["F31", media.length > 0, "read"], ["F39", counts.equations > 0, "preserve"],
    ["F41", relationships.some(r => r.type.endsWith("/customXml") || r.type.endsWith("/glossaryDocument")) || parts.some(p => p.contentType.includes("glossary") || p.name.startsWith("/customXml/")), "preserve"], ["F42", fontNames.size + embedded.length + protection.length > 0 || parts.some(p => p.contentType.endsWith(".settings+xml") || p.contentType.endsWith(".fontTable+xml")), "read"], ["F43", signatureParts.length > 0, "preserve"]
  ];
  const fontResources = readFontResources(archive, roots, budget);
  if (fontResources.diagnostics.length) warnings.push({ code: "unresolved-font-resources", message: "Theme or embedded font references have unresolved package resources; see fontResources.diagnostics." });
  const result: InspectionData = { fontResources, kind: archive.kind, dialect: archive.dialect, sizes: { archiveBytes: owned.length, expandedBytes: parts.reduce((sum, p) => sum + p.bytes, 0), mediaBytes: media.reduce((sum, p) => sum + p.bytes, 0) }, parts, relationships,
    contentTypes: { defaults: graph.defaults.map(d => ({ extension: d.extension, contentType: d.content_type })).sort((a, b) => compare(a.extension, b.extension)), overrides: graph.overrides.map(d => ({ name: d.partname, contentType: d.content_type })).sort((a, b) => compare(a.name, b.name)) },
    stories, properties, counts, features: detections.map(([id, detected, level]) => ({ id, detected, level, subsets: [{ name: "inventory", level, reason: "Package inventory only; no editing or rendering claim." }] })),
    signed: signatureParts.length > 0, protected: protection.some(p => p.enforced !== false), pages: { rendered: null, cachedBreaks },
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
