import { inlineImageRun } from "./inline-image-xml.js";
import type { ByteSource } from "@poe-code/office-package";
import { archiveSettings, InputTypeError, InvalidValueError, ResourceLimitError, type ArchiveContext, type DocumentArchive } from "./archive.js";
import { DocxUsageError } from "./argument-json.js";
import { validateDocxInvocation } from "./command.js";
import { xmlValue } from "./create-content.js";
import { dialectForNamespace, documentDialects } from "./dialect.js";
import { addressKey, LocationIndex } from "./location-index.js";
import { closedRecord, encodeLocation, type Location } from "./location-token.js";
import { openDocumentLocations } from "./locations.js";
import type { DocxBinaryInput, DocxDirectLength, DocxOperationArguments } from "./operation-types.js";
import { DocumentPackage } from "./package.js";
import { DocumentArchiveEditor } from "./package-write.js";
import { parseDocumentXml } from "./package-xml.js";
import { asciiKey, relativePartTarget } from "./part-uri.js";
import { assertDocumentEditable, publishDocumentArchive, type PublicationContext, type PublicationInput } from "./publication.js";
import { characterizeRasterHeader, type RasterHeader } from "./raster-header.js";
import { assertOutsideRevisionRanges } from "./revision-markup.js";
import { UnsupportedEditError } from "./xml-write.js";
import { resolveDocxSelection } from "./simple-selection.js";
import { measurePackageResourceSerialization } from "./ancillary-resources.js";
import { admitSvgImage } from "./svg-image.js";

export interface ImageBinaryResolver {
  readonly capability: string;
  open(path: string, options: { readonly signal: AbortSignal; readonly maxBytes: number }): ByteSource | Promise<ByteSource>;
}
export interface ImageInsertionRequest { readonly operation: "images.add"; readonly options: DocxOperationArguments<"images.add">; readonly input?: PublicationInput }
export interface ImageInsertionData {
  readonly changed: boolean;
  readonly changes: readonly { readonly kind: "add"; readonly before: Location; readonly after: Location }[];
  readonly output: { readonly path: string | null; readonly bytes: number; readonly sha256: string } | null;
  readonly dryRun: boolean;
}
export interface ImageInsertionContext extends PublicationContext {
  readonly binaryResolver?: ImageBinaryResolver;
  readonly admitPublication?: (planned: ImageInsertionData) => undefined;
}

async function acquireImage(input: DocxBinaryInput, context: ArchiveContext & { readonly binaryResolver?: ImageBinaryResolver }): Promise<Uint8Array> {
  closedRecord(input, ["kind", "base64", "path", "capability"]);
  const { limits, signal, budget } = archiveSettings(context), maxBytes = Math.min(limits.maxEntryBytes, budget.limits.embeddedMediaBytes - budget.usage.embeddedMediaBytes);
  let bytes: Uint8Array;
  if (input.kind === "bytes") {
    closedRecord(input, ["kind", "base64"]);
    const encoded = input.base64;
    if (typeof encoded !== "string" || encoded.length % 4 !== 0) throw new InvalidValueError("Expected canonical image bytes.");
    const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0, size = encoded.length / 4 * 3 - padding;
    if (size > maxBytes) throw new ResourceLimitError("Image bytes exceed the media limit.");
    budget.charge("work", encoded.length); budget.charge("retainedBytes", size * 3);
    let decoded: string; try { decoded = atob(encoded); if (btoa(decoded) !== encoded) throw new Error(); } catch { throw new InvalidValueError("Expected canonical image bytes."); }
    bytes = Uint8Array.from(decoded, c => c.charCodeAt(0));
  } else if (input.kind === "vfs") {
    closedRecord(input, ["kind", "path", "capability"]);
    if (typeof input.path !== "string" || !input.path || typeof input.capability !== "string" || !input.capability) throw new InvalidValueError("Expected an explicit image path capability.");
    const resolver = context.binaryResolver;
    if (!resolver || resolver.capability !== input.capability) throw new UnsupportedEditError("Image input requires a matching explicit VFS capability.");
    signal.throwIfAborted();
    const source = await resolver.open(input.path, { signal, maxBytes }), chunks: Uint8Array[] = []; let total = 0;
    for await (const chunk of source) {
      budget.check("work", 0);
      if (!(chunk instanceof Uint8Array)) throw new InputTypeError("Expected image byte fragments.");
      if (chunk.length > maxBytes - total) throw new ResourceLimitError("Image bytes exceed the media limit.");
      total += chunk.length; budget.charge("work", chunk.length + 1); budget.charge("retainedBytes", chunk.length + 64);
      if (chunk.length) chunks.push(new Uint8Array(chunk));
    }
    budget.check("work", 0); budget.charge("retainedBytes", total); bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  } else throw new InvalidValueError("Expected explicit image binary input.");
  budget.charge("embeddedMediaBytes", bytes.length); budget.check("work", 0); return bytes;
}

function checkedExtent(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER) throw new InvalidValueError("Image dimensions must be positive safe EMUs.");
  const result = Math.round(value);
  if (!Number.isSafeInteger(result) || result <= 0) throw new InvalidValueError("Image dimensions must be positive safe EMUs.");
  return result;
}
function xmlTextSize(value: string, utf8: boolean, escaped = false): { bytes: number; characters: number } {
  let bytes = 0, characters = 0;
  for (let index = 0; index < value.length; index++) {
    const point = value.codePointAt(index)!;
    if (escaped && !(point === 9 || point === 10 || point === 13 || point >= 32 && point <= 0xd7ff || point >= 0xe000 && point <= 0xfffd || point >= 0x10000 && point <= 0x10ffff)) throw new InvalidValueError("Invalid XML character in image alternative text.");
    const expansion = escaped ? point === 38 ? 5 : point === 60 || point === 62 || point === 9 ? 4 : point === 34 ? 6 : point === 10 || point === 13 ? 5 : 0 : 0;
    const units = expansion || (point > 65535 ? 2 : 1);
    characters += units; bytes += utf8 ? expansion || (point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4) : units * 2;
    if (point > 65535) index++;
  }
  return { bytes, characters };
}
function imageSize(header: RasterHeader, options: DocxOperationArguments<"images.add">): { width: number; height: number; crop: string } {
  const length = (value: DocxDirectLength | undefined) => value === undefined ? undefined : checkedExtent(value.value * ({ emu: 1, in: 914400, cm: 360000, mm: 36000, pt: 12700 }[value.unit]));
  const nativeWidth = header.pixelWidth / (header.horizontalDpi ?? 72) * 914400, nativeHeight = header.pixelHeight / (header.verticalDpi ?? 72) * 914400;
  const width = length(options.width), height = length(options.height); let x = width ?? nativeWidth, y = height ?? nativeHeight, crop = "";
  if (options.fit && (width === undefined || height === undefined)) throw new DocxUsageError("Explicit fit requires both box dimensions.");
  if ((width === undefined || height === undefined || options.fit === "contain" || options.fit === "cover") && (!Number.isFinite(nativeWidth) || nativeWidth <= 0 || !Number.isFinite(nativeHeight) || nativeHeight <= 0)) throw new InvalidValueError("Native image dimensions must form a finite positive ratio.");
  if (!options.fit && width === undefined && height !== undefined) x = checkedExtent(height * (nativeWidth / nativeHeight));
  if (!options.fit && height === undefined && width !== undefined) y = checkedExtent(width * (nativeHeight / nativeWidth));
  if (options.fit === "contain") { const scale = Math.min(x / nativeWidth, y / nativeHeight); x = checkedExtent(nativeWidth * scale); y = checkedExtent(nativeHeight * scale); }
  if (options.fit === "cover") {
    const scale = Math.max(x / nativeWidth, y / nativeHeight), horizontal = Math.round((1 - x / (nativeWidth * scale)) * 50000), vertical = Math.round((1 - y / (nativeHeight * scale)) * 50000);
    if (horizontal * 2 >= 100000 || vertical * 2 >= 100000) throw new InvalidValueError("Image crop cannot retain an empty source.");
    crop = `<di:srcRect xmlns:di="${documentDialects.transitional.a}" l="${horizontal}" r="${horizontal}" t="${vertical}" b="${vertical}"/>`;
  }
  return { width: checkedExtent(x), height: checkedExtent(y), crop };
}

/** Inserts original inert raster bytes through an admitted owner and bounded publication. */
export async function insertDocumentImage(input: Uint8Array, request: ImageInsertionRequest, context: ImageInsertionContext): Promise<ImageInsertionData> {
  if (!request || ![Object.prototype, null].includes(Object.getPrototypeOf(request))) throw new InputTypeError("Expected a closed image insertion request.");
  closedRecord(request, ["operation", "options", "input"]);
  if (request.operation !== "images.add") throw new DocxUsageError("Expected image insertion.");
  if (request.input !== undefined) {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(request.input))) throw new InputTypeError("Expected a closed file identity.");
    closedRecord(request.input, ["path", "stat"]);
    if (!request.input.stat || ![Object.prototype, null].includes(Object.getPrototypeOf(request.input.stat))) throw new InputTypeError("Expected a closed file stat.");
    closedRecord(request.input.stat, ["type", "size", "allocatedBytes", "ioBlockSize", "preferredIoBlockSize", "mode", "mtimeMs", "atimeMs", "ctimeMs", "birthtimeMs", "revision", "identityScope", "ino", "dev", "rdevMajor", "rdevMinor", "nlink", "uid", "gid"]);
    request = { operation: request.operation, options: request.options, input: { path: request.input.path, stat: { ...request.input.stat } } };
  }
  const settings = archiveSettings(context), invocation = validateDocxInvocation({ operation: request.operation, inputs: [request.input?.path ?? "document"], options: request.options }, settings.budget), options = invocation.options as DocxOperationArguments<"images.add">;
  const budget = settings.budget.lower(Object.fromEntries((options.limit ?? []).map(item => [item.name, item.value]))), scoped = { ...settings, budget };
  if (options.placement === "floating") throw new UnsupportedEditError("This insertion profile admits inline pictures only.");
  const document = await openDocumentLocations(input, scoped), selected = resolveDocxSelection(document, invocation), archive = document.snapshot();
  assertDocumentEditable(archive, scoped);
  if (selected.some(item => item.value.range !== null || !["paragraph", "story", "cell"].includes(item.kind))) throw new DocxUsageError("Image insertion requires a whole paragraph or supported block container.");
  const source = await acquireImage(options.file, { ...scoped, ...(context.binaryResolver ? { binaryResolver: context.binaryResolver } : {}) });
  let vector: Uint8Array | undefined;
  if (options.fallback !== undefined) { admitSvgImage(source, scoped); vector = source; }
  const bytes = options.fallback === undefined ? source : await acquireImage(options.fallback, { ...scoped, ...(context.binaryResolver ? { binaryResolver: context.binaryResolver } : {}) });
  const header = characterizeRasterHeader(bytes, scoped);
  if (!vector && header.mime !== "image/png" && header.mime !== "image/jpeg") throw new UnsupportedEditError("This raster insertion profile admits PNG and JPEG only.");
  for (const [descriptor, mime] of [[options.file, vector ? "image/svg+xml" : header.mime], ...(options.fallback ? [[options.fallback, header.mime] as const] : [])] as const) {
    if (descriptor.kind !== "vfs") continue;
    const name = descriptor.path.slice(descriptor.path.lastIndexOf("/") + 1), suffix = asciiKey(name.slice(name.lastIndexOf(".") + 1));
    const expected = ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff", svg: "image/svg+xml" } as Record<string, string>)[suffix];
    if (expected && expected !== mime) throw new InvalidValueError("Image filename type conflicts with its admitted signature.");
  }
  const size = imageSize(header, options), main = document.list("story", { scope: "body" })[0]!.value.part, dialect = dialectForNamespace(parseDocumentXml(archive.members.find(m => "/" + m.name === main)!.bytes, {}, budget).root.namespace)!, ns = documentDialects[dialect];
  const graph = new DocumentPackage(archive, settings.limits, budget), takenNames = new Set(archive.members.map(m => asciiKey("/" + m.name)));
  const extension = ({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/bmp": "bmp", "image/tiff": "tiff" } as Record<string, string>)[header.mime]!;
  let mediaOrdinal = 1, media: string; do { media = `${main.slice(0, main.lastIndexOf("/"))}/media/image-${mediaOrdinal++}.${extension}`; } while (takenNames.has(asciiKey(media)));
  takenNames.add(asciiKey(media));
  let vectorPart: string | undefined;
  if (vector) {
    do { vectorPart = `${main.slice(0, main.lastIndexOf("/"))}/media/image-${mediaOrdinal++}.svg`; } while (takenNames.has(asciiKey(vectorPart)));
  }
  const drawingIds = new Set<string>();
  for (const member of archive.members) {
    const part = graph.parts.find(p => p.partname === "/" + member.name);
    if (!part || !(part.content_type.endsWith("+xml") || part.content_type === "application/xml" || part.content_type === "text/xml")) continue;
    const visit = (node: ReturnType<typeof parseDocumentXml>["root"]) => { budget.charge("work", 1); if (node.namespace === ns.wp && node.localName === "docPr") { const id = node.attributes.find(a => a.namespace === "" && a.localName === "id")?.value; if (id) drawingIds.add(String(Number(id))); } for (const child of node.children) visit(child); };
    visit(parseDocumentXml(member.bytes, {}, budget).root);
  }
  const additions = new Map<string, { name: string; xml: string }>(), editor = new DocumentArchiveEditor(archive, {}, undefined, budget), updates: { before: Location; path: readonly number[] }[] = [];
  for (const before of selected) {
    const xml = editor.xml(before.value.part.slice(1)); let node = xml.root;
    const ancestors = [node]; for (const index of before.value.path) { node = node.children[index]!; ancestors.push(node); }
    if (ancestors.some(n => n.namespace === ns.w && (["ins", "del", "moveFrom", "moveTo"].includes(n.localName) || n.children.some(c => c.namespace === ns.w && ["pPr", "tcPr"].includes(c.localName) && c.children.some(p => p.localName.endsWith("Change")))))) throw new UnsupportedEditError("Tracked containers require explicit revision operations.");
    assertOutsideRevisionRanges(xml.root, node, budget, xml.compatibility.branches);
    if (node.namespace !== ns.w || !["p", "body", "tc", "hdr", "ftr", "footnote", "endnote", "comment", "txbxContent"].includes(node.localName)) throw new UnsupportedEditError("Unsupported image insertion container.");
    const ownerMember = archive.members.find(m => "/" + m.name === before.value.part)!, utf8 = parseDocumentXml(ownerMember.bytes, {}, budget).encoding === "UTF-8", alt = options.alt ?? "";
    budget.charge("work", alt.length);
    const alternativeSize = xmlTextSize(alt, utf8, true);
    budget.check("xmlPartBytes", ownerMember.bytes.length + alternativeSize.bytes);
    const owner = before.value.part, slash = owner.lastIndexOf("/"), relname = owner.slice(1, slash + 1) + "_rels/" + owner.slice(slash + 1) + ".rels";
    let idOrdinal = 1; const taken = new Set(graph.relationships(owner).map(edge => edge.rId)); while (taken.has(`rId${idOrdinal}`)) idOrdinal++; const relationshipId = `rId${idOrdinal}`;
    taken.add(relationshipId);
    while (taken.has(`rId${idOrdinal}`)) idOrdinal++;
    const vectorRelationshipId = vectorPart ? `rId${idOrdinal}` : undefined;
    const relationship = `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="${relationshipId}" Type="${ns.r}/image" Target="${xmlValue(relativePartTarget(owner, media))}"/>` + (vectorPart ? `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="${vectorRelationshipId}" Type="${ns.r}/image" Target="${xmlValue(relativePartTarget(owner, vectorPart))}"/>` : "");
    if (archive.members.some(m => m.name === relname)) { const rels = editor.xml(relname); rels.insertChildren(rels.root, relationship); }
    else additions.set(owner, { name: relname, xml: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationship}</Relationships>` });
    let drawingId = 1; while (drawingIds.has(String(drawingId))) drawingId++; if (drawingId > 4294967295) throw new ResourceLimitError("No drawing identifier is available."); drawingIds.add(String(drawingId));
    const picture = inlineImageRun(ns, drawingId, relationshipId, size, { alt, decorative: options.decorative, ...(vectorRelationshipId ? { vectorRelationshipId } : {}) });
    const { prefix, suffix } = picture;
    const containerPrefix = before.kind === "paragraph" ? "" : `<wi:p xmlns:wi="${ns.w}">`, containerSuffix = before.kind === "paragraph" ? "" : "</wi:p>";
    const fragments = [containerPrefix, prefix, suffix, containerSuffix]; let markupBytes = alternativeSize.bytes, markupCharacters = alternativeSize.characters;
    for (const fragment of fragments) { budget.charge("work", fragment.length); const measured = xmlTextSize(fragment, utf8); markupBytes += measured.bytes; markupCharacters += measured.characters; }
    const emptyExpansion = xml.sourceXml(node).endsWith("/>") ? xmlTextSize(node.name, utf8).bytes + (utf8 ? 2 : 4) : 0;
    const ownerBytes = ownerMember.bytes.length + markupBytes + emptyExpansion;
    budget.check("xmlPartBytes", ownerBytes); budget.charge("retainedBytes", markupCharacters * 8 + ownerBytes * 8); budget.charge("work", markupCharacters * 8 + ownerBytes * 4);
    const section = node.children.find(c => c.namespace === ns.w && c.localName === "sectPr"), paragraphPath = before.kind === "paragraph" ? before.value.path : [...before.value.path, section ? node.children.indexOf(section) : node.children.length];
    const runIndex = before.kind === "paragraph" ? node.children.length : 0;
    const run = picture.run;
    xml.insertChildren(node, before.kind === "paragraph" ? run : containerPrefix + run + containerSuffix, section);
    updates.push({ before, path: [...paragraphPath, runIndex, 0, 0, 3, 0, 0, 1, 0] });
  }
  if (updates.length) { const types = editor.xml("[Content_Types].xml"); types.insertChildren(types.root, `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="${xmlValue(media)}" ContentType="${header.mime}"/>` + (vectorPart ? `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="${xmlValue(vectorPart)}" ContentType="image/svg+xml"/>` : "")); }
  const dirty = new Set(editor.dirtyParts), copied = archive.comment.length + archive.members.reduce((n, m) => n + (dirty.has(m.name) ? 0 : m.bytes.length) + 128, 0) + [...additions.values()].reduce((n, a) => n + a.xml.length * 3 + 128, 0);
  budget.charge("retainedBytes", copied); budget.charge("work", copied);
  const candidate: DocumentArchive = { comment: new Uint8Array(archive.comment), members: [...archive.members.map(m => ({ ...m, bytes: dirty.has(m.name) ? editor.xml(m.name).serialize() : new Uint8Array(m.bytes) })), ...[...additions.values()].map(a => ({ name: a.name, bytes: new TextEncoder().encode(a.xml), directory: false, modified: new Date(archive.members[0]!.modified) })), ...(updates.length ? [{ name: media.slice(1), bytes, directory: false, modified: new Date(archive.members[0]!.modified) }, ...(vectorPart && vector ? [{ name: vectorPart.slice(1), bytes: vector, directory: false, modified: new Date(archive.members[0]!.modified) }] : [])] : [])] };
  const index = new LocationIndex(candidate, settings.limits, main.slice(1), dialect, budget);
  budget.charge("retainedBytes", updates.length * 4096); budget.charge("work", updates.length * 4096);
  const changes = updates.map(({ before, path }) => { const entry = index.byAddress.get(addressKey({ ...before.value, path }))?.find(e => e.kind === "image"); if (!entry) throw new UnsupportedEditError("Inserted image location could not be resolved."); const value = { ...before.value, path, generation: 1, range: null }; const after: Location<"image"> = { kind: "image", value, token: encodeLocation(value), positions: entry.positions }; return { kind: "add" as const, before, after }; });
  const planned: ImageInsertionData = { changed: changes.length > 0, changes, dryRun: options.dryRun ?? false, output: options.dryRun ? null : { path: options.inPlace ? request.input?.path ?? null : options.output === "-" ? null : options.output ?? null, bytes: settings.limits.maxArchiveBytes, sha256: "0".repeat(64) } };
  if (options.json) { const responseSize = measurePackageResourceSerialization({ version: 1, operation: request.operation, ok: true, data: planned, affected: changes.length, locations: changes.map(c => c.after), warnings: [], errors: [] }, budget) + 1; budget.check("serializedOutput", responseSize); budget.charge("retainedBytes", responseSize * 8); budget.charge("work", responseSize * 8); }
  if (context.admitPublication) { const result = context.admitPublication(planned); if (result !== undefined) { if (result && typeof (result as Promise<unknown>).then === "function") void Promise.resolve(result).catch(() => {}); throw new InputTypeError("Image publication admission must be synchronous."); } }
  const result = await publishDocumentArchive(candidate, { ...(request.input ? { input: request.input } : {}), ...(options.output === undefined ? {} : { output: options.output }), ...(options.inPlace === undefined ? {} : { inPlace: options.inPlace }), ...(options.force === undefined ? {} : { force: options.force }), ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }), ...(options.json === undefined ? {} : { json: options.json }) }, { ...context, budget });
  return { ...planned, output: result.published.length ? { path: result.published[0]!.path, bytes: result.published[0]!.bytes, sha256: result.archiveSha256! } : null };
}
