import { resolvePath } from "@poe-code/safe-fs/core";
import { archiveSettings, CancellationError, type ArchiveContext } from "./archive.js";
import { validateDocxInvocation } from "./command.js";
import { DocxUsageError } from "./argument-json.js";
import { DocumentBudget } from "./budget.js";
import { measurePackageResourceSerialization } from "./ancillary-resources.js";
import { documentDialects } from "./dialect.js";
import type { InspectionReference, InspectionWarning } from "./inspection.js";
import { closedRecord, type Location } from "./location-token.js";
import { docxOperationSchemas } from "./operation-schema.js";
import { openDocumentLocations } from "./locations.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { DocumentPackage } from "./package.js";
import { parseDocumentXml, type XmlElement } from "./package-xml.js";
import { publishDocumentFiles, PublicationError, type PublishedFile, type PublicationContext, type PublicationInput } from "./publication.js";
import { resolveDocxSelection } from "./simple-selection.js";

export interface ImageDetails {
  readonly kind: "images"; readonly part: string | null; readonly mime: string | null; readonly declaredMime: string | null; readonly bytes: number | null; readonly sha256: string | null;
  readonly pixelWidth: number | null; readonly pixelHeight: number | null;
  readonly widthEmu: number | null; readonly heightEmu: number | null; readonly placement: "inline" | "floating" | null;
  readonly crop: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number } | null;
  readonly rotation: number | null; readonly flipHorizontal: boolean | null; readonly flipVertical: boolean | null;
  readonly wrapText: "bothSides" | "left" | "right" | "largest" | null;
  readonly wrapPolygon: { readonly start: { readonly x:number; readonly y:number }; readonly lineTo: readonly { readonly x:number; readonly y:number }[] } | null;
  readonly distances: { readonly top:number|null; readonly bottom:number|null; readonly left:number|null; readonly right:number|null } | null;
  readonly allowOverlap:boolean|null; readonly behindText:boolean|null; readonly lockAspect:boolean|null;
  readonly wrap: "none" | "square" | "tight" | "through" | "top-bottom" | null; readonly zOrder: number | null;
  readonly horizontalPosition: { readonly relativeFrom: string | null; readonly offsetEmu: number | null; readonly alignment: string | null } | null;
  readonly verticalPosition: { readonly relativeFrom: string | null; readonly offsetEmu: number | null; readonly alignment: string | null } | null;
  readonly alt: string | null; readonly decorative: boolean | null; readonly owners: readonly Location[];
  readonly fallbackPart: string | null; readonly alternateParts: readonly string[]; readonly linked: boolean;
}
export interface ImageRecord { readonly kind: "images"; readonly location: Location<"image">; readonly name?: string; readonly properties: readonly []; readonly references: readonly InspectionReference[]; readonly support: "read" | "preserve"; readonly details: ImageDetails }
export interface ImageInspectionData { readonly items?: readonly ImageRecord[]; readonly item?: ImageRecord; readonly warnings: readonly InspectionWarning[] }
export type ImageInspectionOptions = ({ readonly operation: "images.list" } & DocxOperationArguments<"images.list">) | ({ readonly operation: "images.get" } & DocxOperationArguments<"images.get">);
export interface ImageExtractionManifestV1 { readonly version: 1; readonly kind: "images"; readonly entries: readonly { readonly path: string; readonly part: string; readonly bytes: number; readonly sha256: string; readonly locations: readonly Location[] }[] }
export interface ImageExtractionData { readonly complete: boolean; readonly inventory: null; readonly manifest: { readonly path: string; readonly bytes: number; readonly sha256: string; readonly published: boolean }; readonly entries: readonly { readonly path: string; readonly part: string; readonly bytes: number; readonly sha256: string; readonly locations: readonly Location[]; readonly published: boolean }[]; readonly warnings: readonly InspectionWarning[] }
export interface ImageExtractionContext extends PublicationContext { readonly admitPublication?: (planned: ImageExtractionData) => undefined }
export class ImageExtractionPublicationError extends PublicationError {
  constructor(error: PublicationError, readonly data: ImageExtractionData) { super(error.code, error.message, error.published, error.stdoutMayBePartial, { cause: error }); }
}
export class ImageExtractionCancellationError extends CancellationError {
  constructor(error: CancellationError, readonly data: ImageExtractionData, readonly published: readonly PublishedFile[]) { super(error.message, { cause: error }); }
}
const svg = "http://schemas.microsoft.com/office/drawing/2016/SVG/main", decorativeNamespace = "http://schemas.microsoft.com/office/drawing/2017/decorative";
function ownData(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new DocxUsageError("Expected plain owned image option data.");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key) || keys && !keys.includes(key) || !("value" in descriptor)) throw new DocxUsageError("Image option accessors and unknown fields are not permitted.");
    result[key] = descriptor.value;
  }
  return result;
}
const attribute = (node: XmlElement | undefined, name: string, namespace = "") => node?.attributes.find(attribute => attribute.namespace === namespace && attribute.localName === name)?.value;
function nativeToken(value:string|undefined):string|undefined {
  if(value===undefined)return undefined;let start=0,end=value.length;
  while(start<end&&" \t\r\n".includes(value[start]!))start++;
  while(end>start&&" \t\r\n".includes(value[end-1]!))end--;
  return value.slice(start,end);
}
function integer(value:string|undefined,minimum:number,maximum=Number.MAX_SAFE_INTEGER):number|null {
  const token=nativeToken(value);if(token===undefined||!token||token.length>32||[...token].some((char,index)=>!(char>="0"&&char<="9")&&!(index===0&&["-","+"].includes(char))))return null;
  const result=Number(token);return Number.isSafeInteger(result)&&result>=minimum&&result<=maximum?result:null;
}
function boolean(value:string|undefined):boolean|null {const token=nativeToken(value);return token==="1"||token==="true"?true:token==="0"||token==="false"?false:null;}

async function hash(bytes: Uint8Array, budget: DocumentBudget): Promise<string> {
  budget.charge("work", bytes.length); budget.charge("retainedBytes", bytes.length + 128);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))); budget.check("work", 0);
  return [...digest].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function mediaType(bytes: Uint8Array, declared: string, budget: DocumentBudget): string {
  budget.charge("work", Math.min(bytes.length, 64));
  const begins = (...signature: number[]) => bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
  if (begins(137,80,78,71,13,10,26,10)) return "image/png";
  if (begins(255,216,255)) return "image/jpeg";
  if (begins(71,73,70,56,55,97) || begins(71,73,70,56,57,97)) return "image/gif";
  if (begins(66,77)) return "image/bmp";
  if (begins(73,73,42,0) || begins(77,77,0,42)) return "image/tiff";
  if (begins(73,73,188,1)) return "image/vnd.ms-photo";
  if (bytes.length >= 44 && begins(1,0,0,0) && bytes[40] === 32 && bytes[41] === 69 && bytes[42] === 77 && bytes[43] === 70) return "image/emf";
  if (bytes.length >= 22 && begins(215,205,198,154)) return "image/wmf";
  if (declared.toLowerCase() === "image/svg+xml") {
    try { const root = parseDocumentXml(bytes, {}, budget).root; if (root.namespace === "http://www.w3.org/2000/svg" && root.localName === "svg") return "image/svg+xml"; }
    catch (error) { if (error && typeof error === "object" && "code" in error && ["limit-exceeded", "cancelled"].includes(String(error.code))) throw error; }
  }
  return "application/octet-stream";
}
const extensions: Readonly<Record<string, string>> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/bmp": "bmp", "image/tiff": "tiff", "image/svg+xml": "svg", "image/emf": "emf", "image/wmf": "wmf", "image/vnd.ms-photo": "wdp", "application/octet-stream": "bin" };
interface Resource { readonly part: string; readonly bytes: Uint8Array; readonly mime: string; readonly sha256: string }
interface Occurrence { readonly record: ImageRecord; readonly resources: readonly Resource[]; readonly complete: boolean }
async function inventory(input: Uint8Array, operation: "images.list" | "images.get" | "images.extract", options: DocxOperationArguments<"images.list"> | DocxOperationArguments<"images.get"> | DocxOperationArguments<"images.extract">, context: ArchiveContext): Promise<{ occurrences: Occurrence[]; warnings: InspectionWarning[]; budget: DocumentBudget }> {
  const settings = archiveSettings(context), invocation = validateDocxInvocation({ operation, inputs: ["document"], options }, settings.budget);
  const budget = settings.budget.lower(Object.fromEntries((options.limit ?? []).map(limit => [limit.name, limit.value])));
  const document = await openDocumentLocations(input, { ...settings, budget }, "inventory"), selected = resolveDocxSelection(document, invocation);
  budget.check("matches", selected.length); budget.charge("retainedBytes", selected.length * 1024);
  const graph = new DocumentPackage(document.snapshot(), settings.limits, budget), roots = new Map<string, XmlElement>(), resources = new Map<string, Resource>(), warnings: InspectionWarning[] = [], occurrences: Occurrence[] = [];
  const warn = (code: string, message: string) => { if (warnings.some(warning => warning.code === code)) return; budget.check("diagnosticBytes", warnings.reduce((size, warning) => size + warning.message.length + warning.code.length + 9, 0) + code.length + message.length + 9); budget.charge("retainedBytes", (message.length + code.length) * 4); warnings.push({ code, message }); };
  const resource = async (part: string): Promise<Resource> => {
    const existing = resources.get(part); if (existing) return existing;
    const member = graph.getPart(part); budget.check("embeddedMediaBytes", member.bytes.length);
    const value = { part: member.partname, bytes: member.bytes, mime: mediaType(member.bytes, member.content_type, budget), sha256: await hash(member.bytes, budget) };
    if (value.mime === "application/octet-stream" || value.mime !== member.content_type.toLowerCase()) warn("unrecognized-image-type", "Image bytes have an unknown or mismatched declared media type; exact bytes remain preserved.");
    resources.set(part, value); return value;
  };
  for (const location of selected) {
    await budget.checkpoint(); let root = roots.get(location.value.part);
    if (!root) { root = parseDocumentXml(graph.getPart(location.value.part).bytes, {}, budget).root; roots.set(location.value.part, root); }
    let node = root; const ancestors = [root]; for (const index of location.value.path) { node = node.children[index]!; ancestors.push(node); }
    const dialect = root.namespace === documentDialects.strict.w ? documentDialects.strict : documentDialects.transitional, { r, a, wp } = dialect;
    const native = node.namespace === a && node.localName === "blip", edges = graph.relationships(location.value.part), references: InspectionReference[] = [];
    const linked = attribute(node, native ? "link" : "href", native ? r : "") !== undefined;
    const resolve = (id: string | undefined): string | null => {
      if (id === undefined) return null; budget.charge("work", edges.length);
      const edge = edges.find(edge => edge.rId === id); if (!edge) { warn("unresolved-image", "Image relationship is unresolved; no bytes are fabricated or acquired."); return null; }
      if (!references.some(reference => reference.id === edge.rId)) references.push({ owner: location.value.part, id: edge.rId, type: edge.reltype, target: edge.target_ref, external: edge.is_external });
      if (edge.reltype !== r + "/image") { warn("unresolved-image", "Image carrier has an unsupported relationship role; bytes remain unacquired."); return null; }
      if (edge.is_external) { warn("linked-image", "External image references remain inert and are never fetched."); return null; }
      return edge.target_part.partname;
    };
    const primaryPart = resolve(attribute(node, native ? "embed" : "id", r));
    const linkId = native ? attribute(node, "link", r) : undefined; if (linkId !== undefined) { resolve(linkId); if (primaryPart) warn("competing-image-link", "An embedded image also has a linked reference; embedded bytes remain primary and the link stays inert."); }
    const primary = primaryPart ? await resource(primaryPart) : null;
    const frame = [...ancestors].reverse().find(node => node.namespace === wp && ["inline", "anchor"].includes(node.localName));
    const metadata: XmlElement[] = [];
    const visit = (current: XmlElement) => { budget.charge("work", 1); metadata.push(current); for (const child of current.children) visit(child); };
    visit(frame ?? node);
    const one = (namespace: string, name: string) => { const matches = metadata.filter(node => node.namespace === namespace && node.localName === name); return matches.length === 1 ? matches[0] : undefined; };
    const extent = frame?.children.find(node => node.namespace === wp && node.localName === "extent"), transform = one(a, "xfrm"), cropNode = one(a, "srcRect"), docPr = one(wp, "docPr");
    const cropValues = cropNode ? ["l", "r", "t", "b"].map(name => integer(attribute(cropNode, name), 0, 100000)) : [];
    const crop = cropValues.length === 4 && cropValues.every(value => value !== null) && cropValues[0]! + cropValues[1]! < 100000 && cropValues[2]! + cropValues[3]! < 100000 ? { left: cropValues[0]! / 100000, right: cropValues[1]! / 100000, top: cropValues[2]! / 100000, bottom: cropValues[3]! / 100000 } : null;
    const position = (name: "positionH" | "positionV"): ImageDetails["horizontalPosition"] => {
      const positions = frame?.children.filter(node => node.namespace === wp && node.localName === name) ?? [];
      if (positions.length !== 1) return null;
      const axis = positions[0]!, offsets = axis.children.filter(node => node.namespace === wp && node.localName === "posOffset"), alignments = axis.children.filter(node => node.namespace === wp && node.localName === "align");
      const relative = attribute(axis, "relativeFrom"), permitted = name === "positionH" ? ["page", "margin", "column", "character", "leftMargin", "rightMargin", "insideMargin", "outsideMargin"] : ["page", "margin", "paragraph", "line", "topMargin", "bottomMargin", "insideMargin", "outsideMargin"];
      const alignment = alignments.length === 1 && offsets.length === 0 && (name === "positionH" ? ["left","right","center","inside","outside"] : ["top","bottom","center","inside","outside"]).includes(alignments[0]!.text) ? alignments[0]!.text : null;
      return { relativeFrom: relative && permitted.includes(relative) ? relative : null, offsetEmu: offsets.length === 1 && alignments.length === 0 ? integer(offsets[0]!.text, -2147483648, 2147483647) : null, alignment };
    };
    const rotation = integer(attribute(transform, "rot"), -21600000, 21600000);
    const wrapping = frame?.children.filter(node => node.namespace === wp && ["wrapNone", "wrapSquare", "wrapTight", "wrapThrough", "wrapTopAndBottom"].includes(node.localName)) ?? [];
    const wraps: Readonly<Record<string, ImageDetails["wrap"]>> = { wrapNone: "none", wrapSquare: "square", wrapTight: "tight", wrapThrough: "through", wrapTopAndBottom: "top-bottom" };
    const wrapNode = wrapping.length === 1 ? wrapping[0] : undefined;
    const wrapTextValue = attribute(wrapNode, "wrapText");
    const wrapText = frame?.localName === "anchor" && wrapNode && ["wrapSquare","wrapTight","wrapThrough"].includes(wrapNode.localName) && ["bothSides","left","right","largest"].includes(wrapTextValue ?? "") ? wrapTextValue as "bothSides"|"left"|"right"|"largest" : null;
    const distance = (side: "T"|"B"|"L"|"R"): number|null => {
      if (frame?.localName !== "anchor") return null;
      const applicable = wrapNode?.localName === "wrapSquare" || ["wrapTight","wrapThrough"].includes(wrapNode?.localName ?? "") && ["L","R"].includes(side) || wrapNode?.localName === "wrapTopAndBottom" && ["T","B"].includes(side);
      const override = applicable ? attribute(wrapNode,"dist"+side) : undefined;
      return integer(override ?? attribute(frame,"dist"+side),0,4294967295);
    };
    let wrapPolygon: ImageDetails["wrapPolygon"] = null;
    const polygons = wrapNode?.children.filter(child => child.namespace === wp && child.localName === "wrapPolygon") ?? [];
    if (frame?.localName === "anchor" && wrapNode && ["wrapTight","wrapThrough"].includes(wrapNode.localName) && polygons.length === 1) {
      const polygon = polygons[0]!, start = polygon.children.filter(child => child.namespace === wp && child.localName === "start"), lines = polygon.children.filter(child => child.namespace === wp && child.localName === "lineTo");
      budget.check("matches",polygon.children.length); budget.charge("retainedBytes",polygon.children.length*64); budget.charge("work",polygon.children.length);
      const point = (child: XmlElement) => { const x=integer(attribute(child,"x"),-27273042329600,27273042316900), y=integer(attribute(child,"y"),-27273042329600,27273042316900); return x!==null&&y!==null&&!child.children.length ? {x,y} : null; };
      if (start.length === 1 && polygon.children[0] === start[0] && lines.length >= 2 && polygon.children.length === lines.length+1) {
        const first=point(start[0]!), others=lines.map(point); if (first&&others.every(value=>value!==null)) wrapPolygon={start:first,lineTo:others as {x:number;y:number}[]};
      }
      if (!wrapPolygon) warn("unrecognized-image-metadata","Missing, invalid or unsupported image metadata remains null; no layout or decoding is inferred.");
    }
    const frameProperties = frame?.children.filter(child=>child.namespace===wp&&child.localName==="cNvGraphicFramePr") ?? [], pictureProperties=metadata.filter(child=>child.namespace===dialect.pic&&child.localName==="cNvPicPr");
    const frameLocks=frameProperties.length===1 ? frameProperties[0]!.children.filter(child=>child.namespace===a&&child.localName==="graphicFrameLocks") : [], pictureLocks=pictureProperties.length===1 ? pictureProperties[0]!.children.filter(child=>child.namespace===a&&child.localName==="picLocks") : [];
    const frameLock=frameLocks.length===1?boolean(attribute(frameLocks[0],"noChangeAspect")):null, pictureLock=pictureLocks.length===1?boolean(attribute(pictureLocks[0],"noChangeAspect")):null;
    const lockAspect=frameLock!==null&&pictureLock!==null&&frameLock===pictureLock?frameLock:null;
    if (lockAspect===null) warn("unrecognized-image-metadata","Missing, invalid or unsupported image metadata remains null; no layout or decoding is inferred.");
    const alternates = node.children.filter(node => node.namespace === a && node.localName === "extLst").flatMap(list => list.children.filter(node => node.namespace === a && node.localName === "ext").flatMap(extension => extension.children.filter(node => node.namespace === svg && node.localName === "svgBlip")));
    const alternateParts = [...new Set(alternates.map(node => resolve(attribute(node, "embed", documentDialects.transitional.r))).filter((part): part is string => part !== null))];
    const alternateLinked = alternates.some(node => attribute(node, "link", documentDialects.transitional.r) !== undefined);
    for (const alternate of alternates) {
      const link = attribute(alternate, "link", documentDialects.transitional.r);
      if (link !== undefined) resolve(link);
    }
    let complete = primary !== null;
    if (alternateLinked || alternates.length > 1 || alternates.length !== alternateParts.length) { complete = false; warn("ambiguous-image-alternate", "Image alternate associations are unresolved or ambiguous; no preferred encoding is invented."); }
    const admitted = primary ? [primary] : [];
    let fallbackPart: string | null = null;
    if (!alternateLinked && alternates.length === 1 && alternateParts.length === 1) {
      const alternate = await resource(alternateParts[0]!);
      if (alternate.mime === "image/svg+xml" && alternate.part !== primary?.part) {
        admitted.push(alternate);
        if (primary && ["image/png", "image/jpeg", "image/gif", "image/bmp", "image/tiff"].includes(primary.mime)) fallbackPart = primary.part;
      } else { complete = false; warn("ambiguous-image-alternate", "An image alternate does not identify a distinct admitted SVG resource; the original relationship remains preserved."); }
    }
    const details: ImageDetails = { kind: "images", part: primary?.part ?? null, mime: primary?.mime ?? null, declaredMime: primary ? graph.getPart(primary.part).content_type : null, bytes: primary?.bytes.length ?? null, sha256: primary?.sha256 ?? null, pixelWidth: null, pixelHeight: null,
      widthEmu: native ? integer(attribute(extent, "cx"), 1) : null, heightEmu: native ? integer(attribute(extent, "cy"), 1) : null, placement: frame ? frame.localName === "inline" ? "inline" : "floating" : null,
      crop: native ? crop : null, rotation: native && rotation !== null ? rotation / 60000 : null, flipHorizontal: native ? boolean(attribute(transform, "flipH")) : null, flipVertical: native ? boolean(attribute(transform, "flipV")) : null,
      wrapText, wrapPolygon, distances: frame?.localName === "anchor" ? {top:distance("T"),bottom:distance("B"),left:distance("L"),right:distance("R")} : null, allowOverlap: frame?.localName === "anchor" ? boolean(attribute(frame,"allowOverlap")) : null, behindText: frame?.localName === "anchor" ? boolean(attribute(frame,"behindDoc")) : null, lockAspect,
      wrap: wrapping.length === 1 ? wraps[wrapping[0]!.localName] ?? null : null, zOrder: frame?.localName === "anchor" ? integer(attribute(frame, "relativeHeight"), 0, 4294967295) : null,
      horizontalPosition: frame?.localName === "anchor" ? position("positionH") : null, verticalPosition: frame?.localName === "anchor" ? position("positionV") : null,
      alt: native ? attribute(docPr, "descr") ?? null : null, decorative: native ? boolean(attribute(one(decorativeNamespace, "decorative"), "val")) : null, owners: [location], fallbackPart, alternateParts, linked: linked || alternateLinked || references.some(reference => reference.external) };
    if (!native || !frame || details.widthEmu === null || details.heightEmu === null || details.rotation === null || details.crop === null || details.decorative === null) warn("unrecognized-image-metadata", "Missing, invalid or unsupported image metadata remains null; no layout or decoding is inferred.");
    if (!primary) warn("unresolved-image", "Image media is linked, missing or unresolved; no bytes are fabricated or acquired.");
    occurrences.push({ record: { kind: "images", location: location as Location<"image">, ...(primary ? { name: primary.part } : {}), properties: [], references, support: native && primary !== null && primary.mime !== "application/octet-stream" ? "read" : "preserve", details }, resources: admitted, complete });
  }
  return { occurrences, warnings, budget };
}

/** Original occurrence inventory; shared byte grouping is applied only after selection. */
export async function inspectDocumentImages(input: Uint8Array, options: ImageInspectionOptions, context: ArchiveContext): Promise<ImageInspectionData> {
  const dataOptions = ownData(options), admittedOperation = dataOptions.operation;
  if (admittedOperation !== "images.list" && admittedOperation !== "images.get") throw new DocxUsageError("Expected image list or get operation.");
  const declaration = docxOperationSchemas[admittedOperation]!;
  closedRecord(dataOptions, ["operation", ...Object.keys(declaration.fields), ...declaration.commonOptions]);
  options = dataOptions as unknown as ImageInspectionOptions;
  const { operation, ...selection } = options, result = await inventory(input, operation, selection, context);
  const items: ImageRecord[] = [], hashes = new Map<string, number>(), owners: Location[][] = [], references: Map<string, InspectionReference>[] = [], parts: Set<string>[] = [];
  for (const { record } of result.occurrences) {
    const key = "unique" in selection && selection.unique ? record.details.sha256 : null, previous = key ? hashes.get(key) : undefined;
    const index = previous ?? items.length;
    result.budget.charge("work", record.references.length + record.details.alternateParts.length + 2); result.budget.charge("retainedBytes", 32 * (record.references.length + record.details.alternateParts.length + 2));
    if (previous === undefined) { if (key) hashes.set(key, index); items.push(record); owners.push([]); references.push(new Map()); parts.push(new Set()); }
    owners[index]!.push(record.location);
    for (const reference of record.references) references[index]!.set(JSON.stringify([reference.owner, reference.id]), reference);
    if (record.details.part && record.details.part !== items[index]!.details.part) parts[index]!.add(record.details.part);
    for (const part of record.details.alternateParts) parts[index]!.add(part);
  }
  const finalized = items.map((record, index) => ({ ...record, references: [...references[index]!.values()], details: { ...record.details, owners: owners[index]!, alternateParts: [...parts[index]!] } }));
  result.budget.charge("retainedBytes", finalized.length * 256);
  const data: ImageInspectionData = operation === "images.get" ? { item: finalized[0]!, warnings: result.warnings } : { items: finalized, warnings: result.warnings };
  if (selection.json) measurePackageResourceSerialization(data, result.budget); return data;
}

/** Publishes owned original media bytes and an explicit deterministic image manifest. */
export async function extractDocumentImages(input: Uint8Array, options: DocxOperationArguments<"images.extract"> & { readonly input?: PublicationInput }, context: ImageExtractionContext): Promise<ImageExtractionData> {
  const declaration = docxOperationSchemas["images.extract"]!;
  options = ownData(options, ["input", ...Object.keys(declaration.fields), ...declaration.commonOptions]) as typeof options;
  const { input: borrowedIdentity, ...selection } = options;
  let identity: PublicationInput | undefined;
  if (borrowedIdentity !== undefined) {
    const admitted = ownData(borrowedIdentity, ["path", "stat"]), stat = ownData(admitted.stat, ["type", "size", "allocatedBytes", "ioBlockSize", "preferredIoBlockSize", "mode", "mtimeMs", "atimeMs", "ctimeMs", "birthtimeMs", "revision", "identityScope", "ino", "dev", "rdevMajor", "rdevMinor", "nlink", "uid", "gid"]);
    if (typeof admitted.path !== "string" || !admitted.path) throw new DocxUsageError("Image input identity requires an explicit path.");
    identity = { path: admitted.path, stat: stat as unknown as PublicationInput["stat"] };
  }
  const result = await inventory(input, "images.extract", selection, context), directory = selection.outputDir;
  if (!directory || !directory.startsWith("/") || resolvePath("/", directory) !== directory || directory.includes("\0")) throw new DocxUsageError("Image extraction requires a canonical absolute VFS output directory.");
  if (!context.filesystem) throw new PublicationError("unsupported-publication", "Image extraction requires an explicitly supplied publication filesystem.");
  const entries: ImageExtractionData["entries"][number][] = [], files: { path: string; bytes: Uint8Array }[] = [];
  for (const occurrence of result.occurrences) for (const resource of occurrence.resources) {
    result.budget.charge("retainedBytes", resource.bytes.length); result.budget.charge("work", resource.bytes.length);
    const path = resolvePath(directory, `image-${entries.length + 1}.${extensions[resource.mime] ?? "bin"}`);
    entries.push({ path, part: resource.part, bytes: resource.bytes.length, sha256: resource.sha256, locations: [occurrence.record.location], published: false }); files.push({ path, bytes: new Uint8Array(resource.bytes) });
  }
  const manifestValue: ImageExtractionManifestV1 = { version: 1, kind: "images", entries: entries.map(({ path, part, bytes, sha256, locations }) => ({ path: path.slice(directory === "/" ? 1 : directory.length + 1), part, bytes, sha256, locations })) };
  const size = measurePackageResourceSerialization(manifestValue, result.budget); result.budget.charge("retainedBytes", size * 6);
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifestValue)), manifest = { path: resolvePath(directory, "manifest.json"), bytes: manifestBytes.length, sha256: await hash(manifestBytes, result.budget), published: false };
  files.push({ path: manifest.path, bytes: manifestBytes });
  const data: ImageExtractionData = { complete: result.occurrences.every(occurrence => occurrence.complete), inventory: null, manifest, entries, warnings: result.warnings };
  if (selection.json) measurePackageResourceSerialization(data, result.budget);
  if (context.admitPublication) {
    result.budget.charge("retainedBytes", entries.length * 128 + 128);
    const planned = Object.freeze({ ...data, manifest: Object.freeze({ ...manifest }), entries: Object.freeze(entries.map(entry => Object.freeze({ ...entry, locations: Object.freeze([...entry.locations]) }))), warnings: Object.freeze([...result.warnings]) });
    const admitted = (context.admitPublication as (data: ImageExtractionData) => unknown)(planned);
    if (admitted !== undefined) { void Promise.resolve(admitted).catch(() => {}); throw new DocxUsageError("Image publication admission must complete synchronously and return undefined."); }
  }
  result.budget.charge("retainedBytes", (entries.length + 1) * 256); result.budget.charge("work", (entries.length + 1) * 8);
  let published;
  try { published = await publishDocumentFiles(files, { ...(identity ? { input: identity } : {}), ...(selection.force === undefined ? {} : { force: selection.force }), ...(selection.allowPartialOutput === undefined ? {} : { allowPartialOutput: selection.allowPartialOutput }) }, { ...context, filesystem: context.filesystem, budget: result.budget }); }
  catch (error) {
    if (!(error instanceof PublicationError) && !(error instanceof CancellationError)) throw error;
    const receipts = "published" in error && Array.isArray(error.published) ? error.published as readonly PublishedFile[] : [], paths = new Set(receipts.map(file => file.path));
    const partial = { ...data, complete: false, manifest: { ...manifest, published: paths.has(manifest.path) }, entries: entries.map(entry => ({ ...entry, published: paths.has(entry.path) })) };
    if (error instanceof CancellationError) throw new ImageExtractionCancellationError(error, partial, receipts);
    throw new ImageExtractionPublicationError(error, partial);
  }
  const paths = new Set(published.published.map(file => file.path));
  return { ...data, manifest: { ...manifest, published: paths.has(manifest.path) }, entries: entries.map(entry => ({ ...entry, published: paths.has(entry.path) })) };
}
