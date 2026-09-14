import { crc32, createCompressionCodec, type ByteSource } from "@poe-code/office-package";
import { archiveSettings, InvalidValueError, type ArchiveContext, type DocumentArchive } from "./archive.js";
import { xmlValue } from "./create-content.js";
import type { DocxBinaryInput } from "./operation-types.js";
import { DocumentPackage } from "./package.js";
import { DocumentArchiveEditor } from "./package-write.js";
import type { XmlElement } from "./package-xml.js";
import { UnsupportedEditError } from "./xml-write.js";
import { relativePartTarget } from "./part-uri.js";

export interface ControlBinaryResolver {
  readonly capability: string;
  open(path: string, options: { readonly signal: AbortSignal; readonly maxBytes: number }): ByteSource | Promise<ByteSource>;
}
export interface ControlPicture { readonly relationshipId: string; readonly target: string | null; readonly external: boolean; readonly contentType: string | null; }
function unsupported(message = "The picture control has no verified occurrence structure."): never { throw new UnsupportedEditError(message); }
function u32(bytes: Uint8Array, offset: number): number { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset); }
function adler(bytes: Uint8Array): number { let a = 1, b = 0; for (const byte of bytes) { a = (a + byte) % 65521; b = (b + a) % 65521; } return (b << 16 | a) >>> 0; }
/** Admits only non-interlaced eight-bit RGB/RGBA PNG with complete portable payload verification. */
export async function admitControlPng(input: Uint8Array, context: ArchiveContext): Promise<Uint8Array> {
  const { limits, signal, budget } = archiveSettings(context);
  if (!(input instanceof Uint8Array) || input.length > limits.maxEntryBytes) throw new InvalidValueError("Expected bounded PNG bytes.");
  budget.charge("work", input.length); budget.charge("retainedBytes", input.length); const bytes = new Uint8Array(input);
  if (bytes.length < 57 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) unsupported("Expected an admitted PNG picture.");
  let offset = 8, width = 0, height = 0, channels = 0, ended = false, sawData = false, closedData = false; const data: Uint8Array[] = []; let compressedLength = 0;
  while (offset < bytes.length) {
    budget.charge("work", 1); if (offset + 12 > bytes.length) unsupported("Truncated PNG chunk.");
    const length = u32(bytes, offset); if (length > bytes.length - offset - 12) unsupported("Invalid PNG chunk length.");
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if ([...type].some(c => !(c >= "A" && c <= "Z") && !(c >= "a" && c <= "z")) || type[2]! >= "a" || crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== u32(bytes, offset + 8 + length)) unsupported("Invalid PNG chunk type or checksum.");
    const payload = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      if (offset !== 8 || length !== 13) unsupported("Invalid PNG header order.");
      width = u32(payload, 0); height = u32(payload, 4); channels = payload[9] === 2 ? 3 : payload[9] === 6 ? 4 : 0;
      if (!width || !height || !channels || payload[8] !== 8 || payload[10] !== 0 || payload[11] !== 0 || payload[12] !== 0) unsupported("Unsupported PNG pixel profile.");
    } else if (!width) unsupported("Missing PNG header.");
    else if (type === "IDAT") { if (closedData) unsupported("PNG data chunks must be contiguous."); data.push(payload); compressedLength += payload.length; sawData = true; }
    else if (type === "IEND") { if (length !== 0 || !sawData || offset + 12 !== bytes.length) unsupported("Invalid PNG end marker."); ended = true; }
    else { if (sawData) closedData = true; if (type[0]! >= "A" && type[0]! <= "Z" && type !== "PLTE") unsupported("Unsupported PNG critical chunk."); if (type === "PLTE" && (sawData || length === 0 || length > 768 || length % 3 !== 0)) unsupported("Invalid PNG palette."); }
    offset += length + 12;
  }
  if (!ended || compressedLength < 6) unsupported("Incomplete PNG payload.");
  const expected = height * (1 + width * channels); if (!Number.isSafeInteger(expected) || expected > limits.maxEntryBytes) unsupported("PNG expanded pixel limit exceeded.");
  budget.check("expandedPackage", expected); budget.charge("retainedBytes", compressedLength + expected); budget.charge("work", expected);
  const compressed = new Uint8Array(compressedLength); offset = 0; for (const chunk of data) { compressed.set(chunk, offset); offset += chunk.length; }
  if ((compressed[0]! & 15) !== 8 || compressed[0]! >> 4 > 7 || (compressed[0]! * 256 + compressed[1]!) % 31 !== 0 || compressed[1]! & 32) unsupported("Invalid PNG zlib header.");
  const payload = compressed.subarray(2, -4); const codec = createCompressionCodec(); const reader = new codec.CodecReader({ async *[Symbol.asyncIterator]() { yield payload; } }, signal);
  const raw = new Uint8Array(expected); offset = 0;
  try { for await (const chunk of codec.codec(reader, { mode: "inflate-raw", chunkSize: limits.chunkSize }, signal)) { budget.check("work", 0); if (chunk.length > expected - offset) unsupported("PNG expanded pixel length exceeded."); raw.set(chunk, offset); offset += chunk.length; } if (await reader.chunk() !== undefined) unsupported("Trailing PNG compressed pixel data."); }
  catch (error) { budget.check("work", 0); if (error instanceof UnsupportedEditError) throw error; unsupported("Invalid PNG compressed pixels."); }
  finally { await reader.close(); }
  if (offset !== expected || adler(raw) !== u32(compressed, compressed.length - 4)) unsupported("PNG pixel length or checksum mismatch.");
  for (let row = 0; row < height; row++) if (raw[row * (1 + width * channels)]! > 4) unsupported("Invalid PNG row filter.");
  return bytes;
}
export async function acquireControlPng(input: DocxBinaryInput, context: ArchiveContext & { readonly binaryResolver?: ControlBinaryResolver }): Promise<Uint8Array> {
  const { limits, signal, budget } = archiveSettings(context); let bytes: Uint8Array;
  const maxBytes = Math.min(limits.maxEntryBytes, budget.limits.embeddedMediaBytes - budget.usage.embeddedMediaBytes);
  if (input.kind === "bytes") {
    const base64 = input.base64; if (typeof base64 !== "string" || base64.length > Math.ceil(limits.maxEntryBytes / 3) * 4 || base64.length % 4 !== 0 || [...base64].some(c => !"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=".includes(c))) throw new InvalidValueError("Expected bounded canonical base64 picture.");
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0, length = base64.length / 4 * 3 - padding;
    if (length > limits.maxEntryBytes) throw new InvalidValueError("Picture input exceeds the entry limit.");
    budget.check("embeddedMediaBytes", budget.usage.embeddedMediaBytes + length);
    budget.charge("retainedBytes", length * 3); budget.charge("work", base64.length);
    let binary: string; try { binary = atob(base64); if (btoa(binary) !== base64) throw new Error(); } catch { throw new InvalidValueError("Expected canonical base64 picture."); }
    bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  } else if (input.kind === "vfs") {
    const resolver = context.binaryResolver;
    if (!resolver || resolver.capability !== input.capability) unsupported("Picture VFS input requires a matching explicit capability.");
    if (maxBytes === 0) budget.check("embeddedMediaBytes", budget.usage.embeddedMediaBytes + 1);
    const source = await resolver.open(input.path, { signal, maxBytes }); const chunks: Uint8Array[] = []; let total = 0;
    for await (const chunk of source) { budget.check("work", 0); if (!(chunk instanceof Uint8Array)) throw new InvalidValueError("Expected picture byte fragments."); total += chunk.length; if (total > limits.maxEntryBytes) unsupported("Picture input exceeds the entry limit."); budget.check("embeddedMediaBytes", budget.usage.embeddedMediaBytes + total); budget.charge("retainedBytes", chunk.length ? chunk.length + 64 : 0); budget.charge("work", chunk.length + 1); if (chunk.length) chunks.push(new Uint8Array(chunk)); }
    budget.check("work", 0); budget.charge("retainedBytes", total); bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  } else throw new InvalidValueError("Expected explicit picture binary input.");
  budget.charge("embeddedMediaBytes", bytes.length); return admitControlPng(bytes, { limits, signal, budget });
}
function occurrence(content: XmlElement): { node: XmlElement; id: string; namespace: string } {
  const all: XmlElement[] = []; const paths = new Map<XmlElement, XmlElement[]>(); const visit = (node: XmlElement, ancestors: XmlElement[]) => { all.push(node); paths.set(node, [...ancestors, node]); for (const child of node.children) visit(child, [...ancestors, node]); }; visit(content, []);
  const drawings = all.filter(node => node.namespace === content.namespace && node.localName === "drawing");
  const blips = all.filter(node => ["http://schemas.openxmlformats.org/drawingml/2006/main", "http://purl.oclc.org/ooxml/drawingml/main"].includes(node.namespace) && node.localName === "blip");
  if (drawings.length !== 1 || blips.length !== 1 || all.some(node => ["AlternateContent", "imagedata", "object", "pict"].includes(node.localName))) unsupported();
  const node = blips[0]!, embeds = node.attributes.filter(attribute => ["http://schemas.openxmlformats.org/officeDocument/2006/relationships", "http://purl.oclc.org/ooxml/officeDocument/relationships"].includes(attribute.namespace) && attribute.localName === "embed");
  const chain = paths.get(node)!.slice(-7);
  if (chain.length !== 7 || chain[0] !== drawings[0] || !["inline", "anchor"].includes(chain[1]!.localName) || !["http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing", "http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing"].includes(chain[1]!.namespace) ||
    chain[2]!.namespace !== node.namespace || chain[2]!.localName !== "graphic" || chain[3]!.namespace !== node.namespace || chain[3]!.localName !== "graphicData" ||
    !["http://schemas.openxmlformats.org/drawingml/2006/picture", "http://purl.oclc.org/ooxml/drawingml/picture"].includes(chain[4]!.namespace) || chain[4]!.localName !== "pic" || chain[5]!.namespace !== chain[4]!.namespace || chain[5]!.localName !== "blipFill" ||
    chain[3]!.attributes.find(attribute => attribute.localName === "uri" && attribute.namespace === "")?.value !== chain[4]!.namespace ||
    ["extent", "docPr"].some(name => chain[1]!.children.filter(child => child.namespace === chain[1]!.namespace && child.localName === name).length !== 1)) unsupported();
  if (embeds.length !== 1 || node.children.length || node.attributes.some(attribute => attribute.localName === "link")) unsupported();
  return { node, id: embeds[0]!.value, namespace: embeds[0]!.namespace };
}
export function readControlPicture(archive: DocumentArchive, owner: string, content: XmlElement, context: ArchiveContext): ControlPicture {
  const { limits, budget } = archiveSettings(context); const target = occurrence(content); const pkg = new DocumentPackage(archive, limits, budget);
  const edge = pkg.relationships(owner).find(edge => edge.rId === target.id); if (!edge || !edge.reltype.endsWith("/image")) unsupported();
  return { relationshipId: edge.rId, target: edge.is_external ? edge.target_ref : edge.target_part.partname, external: edge.is_external, contentType: edge.is_external ? null : edge.target_part.content_type };
}
const staged = new WeakMap<DocumentArchiveEditor, { owner: string; id: string; media: string; bytes: Uint8Array; reltype: string }[]>();
export function replaceControlPicture(editor: DocumentArchiveEditor, archive: DocumentArchive, owner: string, content: XmlElement, bytes: Uint8Array, context: ArchiveContext): void {
  const { limits, budget } = archiveSettings(context); const pkg = new DocumentPackage(archive, limits, budget); const target = occurrence(content);
  const edge = pkg.relationships(owner).find(edge => edge.rId === target.id); if (!edge || edge.is_external || !edge.reltype.endsWith("/image") || !edge.target_part.content_type.startsWith("image/")) unsupported();
  const additions = staged.get(editor) ?? []; let ordinal = 1; let media: string; do { media = `/word/media/control-picture-${ordinal++}.png`; } while (pkg.parts.some(part => part.partname === media) || additions.some(item => item.media === media));
  const taken = new Set([...pkg.relationships(owner).map(edge => edge.rId), ...additions.filter(item => item.owner === owner).map(item => item.id)]); ordinal = 1; while (taken.has(`rId${ordinal}`)) ordinal++;
  const id = `rId${ordinal}`; editor.xml(owner.slice(1)).setAttribute(target.node, { namespace: target.namespace, localName: "embed" }, id);
  additions.push({ owner, id, media, bytes, reltype: edge.reltype }); staged.set(editor, additions);
}
export function finishControlPictures(editor: DocumentArchiveEditor, archive: DocumentArchive, context: ArchiveContext): DocumentArchive {
  // Add relationships before the editor's normal validation would see new embeds.
  const additions = staged.get(editor) ?? []; if (!additions.length) return editor.snapshot();
  const { budget } = archiveSettings(context);
  for (const owner of new Set(additions.map(item => item.owner))) {
    const slash = owner.lastIndexOf("/"); const relname = owner.slice(1, slash + 1) + "_rels/" + owner.slice(slash + 1) + ".rels";
    const xml = editor.xml(relname); const prefix = xml.root.name.includes(":") ? xml.root.name.slice(0, xml.root.name.indexOf(":") + 1) : "";
    for (const item of additions.filter(item => item.owner === owner)) xml.insertChildren(xml.root, `<${prefix}Relationship Id="${item.id}" Type="${xmlValue(item.reltype)}" Target="${xmlValue(relativePartTarget(owner, item.media))}"/>`);
  }
  const types = editor.xml("[Content_Types].xml"); const prefix = types.root.name.includes(":") ? types.root.name.slice(0, types.root.name.indexOf(":") + 1) : "";
  for (const item of additions) types.insertChildren(types.root, `<${prefix}Override PartName="${item.media}" ContentType="image/png"/>`);
  // Existing editor snapshot validates target existence; take a full lexical snapshot
  // with supplemental members using the owned original archive carried by the caller.
  budget.charge("retainedBytes", additions.reduce((n, item) => n + item.bytes.length, 0));
  const dirty = new Set(editor.dirtyParts);
  return { comment: new Uint8Array(archive.comment), members: [...archive.members.map(member => ({ ...member, bytes: dirty.has(member.name) ? editor.xml(member.name).serialize() : new Uint8Array(member.bytes), modified: new Date(member.modified) })),
    ...additions.map(item => ({ name: item.media.slice(1), bytes: new Uint8Array(item.bytes), directory: false, modified: new Date(archive.members[0]!.modified) }))] };
}
