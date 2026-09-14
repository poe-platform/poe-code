import { archiveSettings, InputTypeError, type ArchiveContext, type ArchiveMember } from "./archive.js";
import { readDocumentArchive, type AdmittedDocumentArchive } from "./admission.js";
import { parseDocumentXml, type XmlElement } from "./package-xml.js";
import { normalizePartName, asciiKey } from "./part-uri.js";
import { SelectionError, closedRecord, encodeLocation, type PartLocation } from "./location-token.js";
import { MarkupCompatibility } from "./compatibility.js";
import { UnsupportedEditError } from "./xml-write.js";
import { assertDocumentEditable, publishDocumentArchive, type PublicationOptions, type PublicationContext } from "./publication.js";
import { DocumentBudget } from "./budget.js";
import { DocumentPackage } from "./package.js";
import { displayXml } from "./xml-display.js";

export interface XmlOptions { readonly part: string; readonly raw?: boolean; readonly pretty?: boolean }
export interface XmlData {
  readonly part: string;
  readonly encoding: "base64" | "utf-8";
  readonly content: string;
  readonly pretty: boolean;
  readonly bytes: number;
  readonly sha256: string;
}
export interface XmlMutationData {
  readonly changed: boolean;
  readonly changes: readonly { readonly kind: "replace"; readonly before: PartLocation; readonly after: PartLocation }[];
  readonly output: { readonly path: string | null; readonly bytes: number; readonly sha256: string } | null;
  readonly dryRun: boolean;
}
function selector(part: string): string {
  if (typeof part !== "string" || !part.startsWith("/") || part.includes("*") || part.includes("?"))
    throw new InputTypeError("Select one absolute XML part name.");
  if (asciiKey(part) === "/[content_types].xml") return "/[Content_Types].xml";
  return normalizePartName(part);
}
function selected(archive: AdmittedDocumentArchive, name: string): ArchiveMember {
  const matches = archive.members.filter(member => !member.directory && asciiKey("/" + member.name) === asciiKey(name));
  if (!matches.length) throw new SelectionError("missing-selection");
  if (matches.length !== 1) throw new SelectionError("ambiguous-selection");
  const member = matches[0]!;
  const type = asciiKey(name) === "/[content_types].xml" ? "application/xml" : archive.package.getPart(name).content_type.toLowerCase();
  if (type !== "application/xml" && type !== "text/xml" && !type.endsWith("+xml"))
    throw new UnsupportedEditError("The selected part is not XML.");
  return member;
}
async function digest(bytes: Uint8Array, budget: DocumentBudget): Promise<string> {
  budget.charge("work", bytes.length);
  budget.charge("retainedBytes", bytes.length);
  const value = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  budget.check("work", 0);
  return [...new Uint8Array(value)].map(n => n.toString(16).padStart(2, "0")).join("");
}
export async function getDocumentXml(input: Uint8Array, context: ArchiveContext, options: XmlOptions): Promise<XmlData | Uint8Array> {
  closedRecord(options, ["part", "raw", "pretty"]);
  options = { ...options };
  const name = selector(options.part);
  for (const value of [options.raw, options.pretty]) if (value !== undefined && typeof value !== "boolean") throw new InputTypeError("XML display flags require booleans.");
  if (options.raw && options.pretty) throw new InputTypeError("Raw and pretty output conflict.");
  const settings = archiveSettings(context);
  const { budget } = settings;
  const archive = await readDocumentArchive(input, { ...context, budget });
  const member = selected(archive, name);
  const xml = parseDocumentXml(member.bytes, { maxBytes: Math.min(settings.limits.maxEntryBytes, budget.limits.xmlPartBytes) }, budget);
  if (options.raw) { budget.check("serializedOutput", xml.bytes.length); return xml.bytes; }
  let content: string;
  if (options.pretty) content = displayXml(xml.root, budget, true);
  else {
    budget.check("serializedOutput", 4 * Math.ceil(xml.bytes.length / 3));
    budget.charge("retainedBytes", xml.bytes.length * 4);
    const chunks: string[] = [];
    for (let offset = 0; offset < xml.bytes.length; offset += 8192) chunks.push(String.fromCharCode(...xml.bytes.subarray(offset, offset + 8192)));
    content = btoa(chunks.join(""));
  }
  const data: XmlData = { part: "/" + member.name, encoding: options.pretty ? "utf-8" : "base64", content, pretty: options.pretty ?? false, bytes: xml.bytes.length, sha256: await digest(xml.bytes, budget) };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify(data)).length);
  return data;
}

function opaqueContent(root: XmlElement, budget: DocumentBudget): string {
  const view = new MarkupCompatibility(root, undefined, budget);
  const records: unknown[] = [];
  const visit = (node: XmlElement, path: number[]) => {
    budget.charge("work", 1);
    if (!view.canEdit(node)) {
      records.push([path, [...node.namespaces], displayXml(node, budget, false)]);
      return;
    }
    const attributes = node.attributes.filter(a => a.namespace !== "http://www.w3.org/2000/xmlns/" && !view.canEdit(a));
    if (attributes.length) records.push([path, [...node.namespaces], attributes]);
    node.children.forEach((child, index) => visit(child, [...path, index]));
  };
  visit(root, []);
  return JSON.stringify(records);
}

/** Deliberately replaces one complete XML part, with validation before publication. */
export async function replaceDocumentXmlPart(input: Uint8Array, replacement: Uint8Array, options: PublicationOptions & { readonly part: string; readonly allowEmpty?: boolean }, context: PublicationContext): Promise<XmlMutationData> {
  closedRecord(options, ["part", "allowEmpty", "input", "output", "inPlace", "force", "dryRun", "json"]);
  const name = selector(options.part);
  const { part: ignoredPart, allowEmpty, ...publication } = options;
  if (allowEmpty !== undefined && typeof allowEmpty !== "boolean") throw new InputTypeError("allowEmpty requires a boolean.");
  if (publication.input) publication.input = { path: publication.input.path, stat: { ...publication.input.stat } };
  const settings = archiveSettings(context);
  const { budget } = settings;
  const beforeNodes = budget.usage.xmlNodes;
  const xml = parseDocumentXml(replacement, { maxBytes: Math.min(settings.limits.maxEntryBytes, budget.limits.xmlPartBytes) }, budget);
  const replacementNodes = budget.usage.xmlNodes - beforeNodes;
  if (!(input instanceof Uint8Array)) throw new InputTypeError("Expected archive bytes.");
  budget.charge("retainedBytes", input.length);
  const owned = new Uint8Array(input);
  const archive = await readDocumentArchive(owned, { ...context, budget });
  let member: ArchiveMember | undefined;
  try { member = selected(archive, name); }
  catch (error) {
    if (!allowEmpty || !(error instanceof SelectionError) || error.code !== "missing-selection") throw error;
  }
  assertDocumentEditable(archive, settings);
  const changed = member !== undefined && (member.bytes.length !== xml.bytes.length || member.bytes.some((byte, index) => byte !== xml.bytes[index]));
  if (member) {
    const original = parseDocumentXml(member.bytes, {}, budget);
    if (original.root.namespace !== xml.root.namespace || original.root.localName !== xml.root.localName)
      throw new UnsupportedEditError("Replacement must retain the part root expanded name.");
    if (changed) budget.charge("insertedNodes", replacementNodes);
    if (changed && opaqueContent(original.root, budget) !== opaqueContent(xml.root, budget))
      throw new UnsupportedEditError("Replacement changes opaque XML content or its namespace context.");
  }
  const candidate = { ...archive, members: archive.members.map(entry => entry === member ? { ...entry, bytes: xml.bytes } : entry) };
  const graph = new DocumentPackage(candidate, settings.limits, budget);
  for (const part of archive.package.parts) {
    if (graph.getPart(part.partname).content_type.toLowerCase() !== part.content_type.toLowerCase())
      throw new UnsupportedEditError("XML replacement cannot change existing part content types or document kind.");
  }
  const originalMain = archive.package.relationships("/").find(edge => !edge.is_external && edge.target_part.partname === "/" + archive.mainPart)!;
  const mainEdges = graph.relationships("/").filter(edge => edge.reltype === originalMain.reltype);
  if (mainEdges.length !== 1 || mainEdges[0]!.is_external || mainEdges[0]!.target_part.partname !== "/" + archive.mainPart)
    throw new UnsupportedEditError("XML replacement cannot rebind the main document part.");
  const sourceSha256 = await digest(owned, budget);
  const location = (generation: number): PartLocation => {
    const value = { version: 1 as const, sourceSha256, generation, part: "/" + member!.name, story: "/" + member!.name, path: [], range: null };
    return { kind: "part", token: encodeLocation(value), value, positions: {} };
  };
  const changes = changed ? [{ kind: "replace" as const, before: location(0), after: location(1) }] : [];
  const path = publication.inPlace ? publication.input?.path : publication.output;
  if (typeof path === "string") budget.check("serializedOutput", path.length);
  const prospective: XmlMutationData = { changed, changes, dryRun: publication.dryRun ?? false,
    output: publication.dryRun ? null : { path: path ?? null, bytes: settings.limits.maxArchiveBytes, sha256: "0".repeat(64) } };
  const summary = JSON.stringify({ version: 1, operation: "xml.set", ok: true, data: prospective,
    warnings: [], errors: [], affected: changed ? 1 : 0, locations: changes.map(change => change.after) }) + "\n";
  budget.check("serializedOutput", new TextEncoder().encode(summary).length);
  budget.charge("retainedBytes", summary.length * 2);
  const result = await publishDocumentArchive(candidate, publication, { ...context, budget });
  return { changed, changes, dryRun: publication.dryRun ?? false,
    output: result.published.length ? { path: result.published[0]!.path, bytes: result.published[0]!.bytes, sha256: result.archiveSha256! } : null };
}
