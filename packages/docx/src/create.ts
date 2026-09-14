import { archiveSettings, InvalidValueError, type ArchiveContext, type DocumentArchive } from "./archive.js";
import { readDocumentArchive, type AdmittedDocumentArchive } from "./admission.js";
import { writeDocumentArchive } from "./document-write.js";
import { documentDialects, type DocumentDialect } from "./dialect.js";
import { parseDocumentXml } from "./package-xml.js";
import { validateDocxValue } from "./operation-schema.js";
import type { DocxContent } from "./operation-types.js";
import { closedRecord } from "./location-token.js";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";
import { assertDocumentEditable, publishDocumentArchive, type PublicationOptions, type PublicationContext } from "./publication.js";
import { pageGeometry, renderContent, renderTheme, xmlValue } from "./create-content.js";
import { addDocumentStylesPart } from "./styles-part.js";

export interface DocumentCreateOptions {
  readonly kind?: "docx" | "dotx";
  readonly dialect?: DocumentDialect;
  readonly template?: Uint8Array;
  readonly content?: DocxContent;
  readonly timestamp?: string;
  readonly author?: string;
}

export async function createDocumentArchive(options: DocumentCreateOptions, context: ArchiveContext): Promise<AdmittedDocumentArchive> {
  const { budget } = archiveSettings(context);
  closedRecord(options, ["kind", "dialect", "template", "content", "timestamp", "author"]);
  if ((options.kind !== undefined && options.kind !== "docx" && options.kind !== "dotx") ||
    (options.dialect !== undefined && options.dialect !== "strict" && options.dialect !== "transitional"))
    throw new InvalidValueError("Expected kind docx or dotx and dialect strict or transitional.");
  if (options.content !== undefined && !validateDocxValue("OriginalDocumentContentV1", options.content)) throw new InvalidValueError("Expected typed document content.");
  if (options.timestamp !== undefined && !validateDocxValue("UTC instant", options.timestamp)) throw new InvalidValueError("Expected a UTC timestamp.");
  if (options.author !== undefined && (!validateDocxValue("string", options.author) || [...options.author].length > 255)) throw new InvalidValueError("Expected a bounded author string.");
  if (options.template !== undefined && !(options.template instanceof Uint8Array)) throw new InvalidValueError("Expected supplied template bytes.");
  options = { ...options };
  const content: DocxContent = options.content === undefined ? { version: 1, blocks: [] } : JSON.parse(JSON.stringify(options.content));
  const contentBytes = new TextEncoder().encode(JSON.stringify(content)).length;
  budget.check("xmlPartBytes", contentBytes); budget.charge("retainedBytes", contentBytes * 4); budget.charge("work", contentBytes);
  const template = options.template === undefined ? undefined : await readDocumentArchive(options.template, { ...context, budget });
  const kind = options.kind ?? template?.kind ?? "docx", dialect = options.dialect ?? template?.dialect ?? "transitional";
  if ((kind !== "docx" && kind !== "dotx") || (dialect !== "strict" && dialect !== "transitional"))
    throw new InvalidValueError("Expected kind docx or dotx and dialect strict or transitional.");
  const { w, r } = documentDialects[dialect];
  if (template) {
    if (kind !== template.kind || dialect !== template.dialect) throw new UnsupportedEditError("Creation must retain template kind and dialect.");
    assertDocumentEditable(template, archiveSettings({ ...context, budget }));
    return populateTemplate(template, content, options, { ...context, budget });
  }
  const geometry = pageGeometry(content.page);
  const mainType = `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "docx" ? "document" : "template"}.main+xml`;
  const relationshipNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
  const parts = [
    ["[Content_Types].xml", `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="${mainType}"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`],
    ["_rels/.rels", `<Relationships xmlns="${relationshipNamespace}"><Relationship Id="rId1" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`],
    ["word/_rels/document.xml.rels", `<Relationships xmlns="${relationshipNamespace}"><Relationship Id="rId1" Type="${r}/styles" Target="styles.xml"/></Relationships>`],
    ["word/document.xml", `<w:document xmlns:w="${w}"><w:body><w:p/><w:sectPr>${geometry.xml}</w:sectPr></w:body></w:document>`],
    ["word/styles.xml", `<w:styles xmlns:w="${w}"><w:docDefaults/><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`]
  ];
  const rendered = renderContent(content, w, budget, parseDocumentXml(new TextEncoder().encode(parts[4]![1]!)).root, geometry.width);
  parts[3]![1] = `<w:document xmlns:w="${w}"><w:body>${rendered.body || "<w:p/>"}<w:sectPr>${geometry.xml}</w:sectPr></w:body></w:document>`;
  if (rendered.styles) parts[4]![1] = parts[4]![1]!.slice(0, -11) + rendered.styles + "</w:styles>";
  if (content.theme) {
    parts[0]![1] = parts[0]![1]!.slice(0, -8) + '<Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>';
    parts[2]![1] = parts[2]![1]!.slice(0, -16) + `<Relationship Id="rId2" Type="${r}/theme" Target="theme/theme1.xml"/></Relationships>`;
    parts.push(["word/theme/theme1.xml", renderTheme(content.theme, documentDialects[dialect].a)]);
  }
  if (options.timestamp !== undefined || options.author !== undefined) {
    const time = options.timestamp === undefined ? "" : new Date(options.timestamp).toISOString().slice(0, 19) + "Z";
    parts[0]![1] = parts[0]![1]!.slice(0, -8) + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>';
    parts[1]![1] = parts[1]![1]!.slice(0, -16) + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>';
    parts.push(["docProps/core.xml", `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>${xmlValue(options.author ?? "")}</dc:creator>${time ? `<dcterms:created xsi:type="dcterms:W3CDTF">${time}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${time}</dcterms:modified>` : ""}</cp:coreProperties>`]);
  }
  budget.charge("retainedBytes", parts.reduce((sum, [name, xml]) => sum + (name!.length + xml!.length) * 3, 0));
  const archive: DocumentArchive = {
    comment: new Uint8Array(),
    members: parts.map(([name, xml]) => ({ name: name!, bytes: new TextEncoder().encode(xml),
      directory: false, modified: new Date("1980-01-01T00:00:00Z") }))
  };
  for (const member of archive.members) {
    const remaining = budget.limits.insertedNodes - budget.usage.insertedNodes;
    budget.check("insertedNodes", budget.usage.insertedNodes + 1);
    const before = budget.usage.xmlNodes;
    parseDocumentXml(member.bytes, { maxNodes: Math.min(remaining, budget.limits.xmlNodes),
      maxContentNodes: Math.min(remaining, budget.limits.xmlNodes) }, budget);
    budget.charge("insertedNodes", budget.usage.xmlNodes - before);
  }
  return admitCreated(archive, { ...context, budget });
}

async function admitCreated(archive: DocumentArchive, context: ArchiveContext): Promise<AdmittedDocumentArchive> {
  const { budget } = archiveSettings(context);
  const chunks: Uint8Array[] = [];
  await writeDocumentArchive(archive, { async write(bytes) {
    chunks.push(bytes);
  } }, { order: "name", compression: "store" }, { ...context, budget });
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  budget.charge("retainedBytes", size);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return readDocumentArchive(bytes, { ...context, budget });
}

async function populateTemplate(template: AdmittedDocumentArchive, content: DocxContent, options: DocumentCreateOptions, context: ArchiveContext): Promise<AdmittedDocumentArchive> {
  const { budget } = archiveSettings(context);
  const { w, r } = documentDialects[template.dialect];
  if (content.page || content.theme || options.timestamp !== undefined || options.author !== undefined)
    throw new UnsupportedEditError("Template creation retains existing page, theme and metadata settings.");
  const main = template.members.find(member => member.name === template.mainPart)!;
  const editor = new DocumentXmlEditor(main.bytes, {}, undefined, budget);
  const body = editor.root.children.find(child => child.namespace === w && child.localName === "body")!;
  if (!body) throw new UnsupportedEditError("Template requires one direct document body.");
  const section = body.children.find(child => child.namespace === w && child.localName === "sectPr");
  const stylesEdge = template.package.relationships("/" + main.name).find(edge => edge.reltype === `${r}/styles`);
  const stylesMember = stylesEdge && !stylesEdge.is_external ? template.members.find(member => "/" + member.name === stylesEdge.target_part.partname) : undefined;
  const stylesEditor = stylesMember ? new DocumentXmlEditor(stylesMember.bytes, {}, undefined, budget) : undefined;
  const rendered = renderContent(content, w, budget, stylesEditor?.root, pageGeometry(undefined, section, w).width);
  if (rendered.body) editor.insertChildren(body, rendered.body, section);
  if (rendered.styles && stylesEditor) stylesEditor.insertChildren(stylesEditor.root, rendered.styles);
  const archive = { ...template, members: template.members.map(member => member === main ? { ...member, bytes: editor.serialize() } : member === stylesMember && rendered.styles ? { ...member, bytes: stylesEditor!.serialize() } : member) };
  if (rendered.styles && !stylesEditor) return admitCreated(addDocumentStylesPart(archive, template, rendered.styles, budget).archive, context);
  return admitCreated(archive, context);
}

export interface CreateMutationData {
  readonly changed: true; readonly changes: readonly []; readonly dryRun: boolean;
  readonly output: { readonly path: string | null; readonly bytes: number; readonly sha256: string } | null;
}

/** Creates and publishes through the same bounded engine used by the command. */
export async function createDocument(options: DocumentCreateOptions, publication: Omit<PublicationOptions, "creation" | "inPlace">, context: PublicationContext): Promise<CreateMutationData> {
  const { budget } = archiveSettings(context);
  closedRecord(publication, ["input", "output", "force", "dryRun", "json"]);
  publication = { ...publication, ...(publication.input ? { input: { path: publication.input.path, stat: { ...publication.input.stat } } } : {}) };
  const prospective = { version: 1, operation: "create", ok: true, data: { changed: true, changes: [], dryRun: publication.dryRun ?? false,
    output: publication.dryRun ? null : { path: publication.output ?? null, bytes: context.limits.maxArchiveBytes, sha256: "0".repeat(64) } }, warnings: [], errors: [], affected: 1, locations: [] };
  if (publication.output !== "-" || publication.dryRun) budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify(prospective) + "\n").length);
  const archive = await createDocumentArchive(options, { ...context, budget });
  const result = await publishDocumentArchive(archive, { ...publication, creation: true }, { ...context, budget, encoding: { order: "name", compression: "store" } });
  return { changed: true, changes: [], dryRun: publication.dryRun ?? false,
    output: result.published.length ? { path: result.published[0]!.path, bytes: result.published[0]!.bytes, sha256: result.archiveSha256! } : null };
}
