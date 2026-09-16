import { sha256 } from "@noble/hashes/sha2.js";
import { readBinary } from "./bytes.js";
import type { BinaryInput } from "./contracts.js";
import { parseContentTypes, type PresentationKind } from "./content-types.js";
import { OfficeError } from "./errors.js";
import { loadShared } from "./masters.js";
import { asciiKey, partName } from "./package-uri.js";
import { writePackageArchive } from "./package-writer.js";
import type { SelectionContext } from "./selectors.js";

export interface ExtractedPackageMember {
  readonly part: string;
  readonly name: string;
  readonly contentType: string;
  readonly sha256: string;
  readonly bytes: Uint8Array;
}
export interface PackPackageMember {
  readonly part: string;
  readonly sha256: string;
  readonly bytes: BinaryInput;
}

function record(value: unknown, allowed: readonly string[]): void {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).some(key => typeof key !== "string" || !allowed.includes(key) || !("value" in Object.getOwnPropertyDescriptor(value, key)!)))
    throw new OfficeError("invalid-value", "Expected a plain package record.", "usage");
}
function list(value: unknown, maximum: number): void {
  if (!Array.isArray(value)) throw new OfficeError("invalid-value", "Expected package members.", "usage");
  if (value.length > maximum) throw new OfficeError("resource-limit", "Package member limit exceeded.", "usage");
  if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1 ||
      Array.from({length: value.length}, (_, index) => Object.getOwnPropertyDescriptor(value, String(index))).some(item => !item || !("value" in item)))
    throw new OfficeError("invalid-value", "Expected a dense package array.", "usage");
}

function digest(bytes: Uint8Array): string {
  return Array.from(sha256(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Extracts only explicitly admitted package bytes; never opens an output path. */
export async function extractPackage(
  input: BinaryInput,
  context: SelectionContext,
  options: { readonly parts?: readonly string[] } = {}
): Promise<readonly ExtractedPackageMember[]> {
  record(options, ["parts"]);
  if (!context?.archiveLimits) throw new OfficeError("invalid-value", "Explicit limits are required.", "usage");
  if (options.parts !== undefined) list(options.parts, context.archiveLimits.maxMembers);
  if (!options || Object.keys(options).some(key => key !== "parts") ||
      (options.parts !== undefined && (!Array.isArray(options.parts) || !options.parts.length)))
    throw new OfficeError("invalid-value", "Invalid package extraction options.", "usage");
  const selected = options.parts?.map(part => {
    const canonical = partName(part, false);
    if (canonical !== part) throw new OfficeError("unsafe-path", "A canonical package part is required.", "usage");
    return canonical;
  });
  if (selected && new Set(selected.map(asciiKey)).size !== selected.length)
    throw new OfficeError("invalid-value", "Duplicate extracted part.", "usage");
  const { reader } = await loadShared(input, context, false);
  const types = parseContentTypes(reader.get("/[Content_Types].xml"), {
    maxBytes: context.xmlLimits.maxBytes, maxEntries: context.archiveLimits.maxMembers
  });
  const names = selected ?? [...reader.names].sort();
  return Object.freeze(names.map((part, index) => {
    const bytes = reader.get(part);
    const contentType = part === "/[Content_Types].xml" ? "application/xml" : types.get(part);
    const essence = contentType.split(";", 1)[0]!.trim().toLowerCase();
    const extension = essence === "application/xml" || essence === "text/xml" || essence.endsWith("+xml") ? "xml"
      : ({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/tiff": "tif", "image/bmp": "bmp", "audio/mpeg": "mp3", "video/mp4": "mp4" } as Record<string, string>)[essence] ?? "bin";
    return Object.freeze({ part, name: `part-${String(index + 1).padStart(6, "0")}.${extension}`, contentType, sha256: digest(bytes), bytes });
  }));
}

/** Packs explicit capabilities after namespace, digest and complete graph admission. */
export async function packPackage(
  members: readonly PackPackageMember[],
  context: SelectionContext,
  options: { readonly kind?: PresentationKind } = {}
): Promise<Uint8Array> {
  record(options, ["kind"]);
  if (!context?.limits || !context.archiveLimits || !Array.isArray(members) || !members.length ||
      !options || Object.keys(options).some(key => key !== "kind") ||
      (options.kind !== undefined && !["pptx", "potx", "ppsx"].includes(options.kind)))
    throw new OfficeError("invalid-value", "Explicit package members and limits are required.", "usage");
  if (context.signal?.aborted) throw new OfficeError("cancelled", "Operation cancelled.", "admit");
  if (members.length > context.archiveLimits.maxMembers)
    throw new OfficeError("resource-limit", "Package member limit exceeded.", "admit");
  list(members, context.archiveLimits.maxMembers);
  const names = new Set<string>();
  const parents = new Set<string>();
  let ownedTotal = 0;
  const admitted = members.map(member => {
    record(member, ["part", "sha256", "bytes", "name", "contentType"]);
    if (!member || typeof member.sha256 !== "string" || member.sha256.length !== 64 ||
        [...member.sha256].some(character => !"0123456789abcdef".includes(character)))
      throw new OfficeError("invalid-value", "A lowercase SHA-256 digest is required.", "usage");
    const part = partName(member.part, false);
    if (part !== member.part || part.includes(":"))
      throw new OfficeError("unsafe-path", "A canonical package part is required.", "usage");
    const key = asciiKey(part);
    if (names.has(key) || parents.has(key))
      throw new OfficeError("invalid-opc", "Colliding package members.", "admit");
    let parent = key.slice(0, key.lastIndexOf("/"));
    while (parent) {
      if (names.has(parent)) throw new OfficeError("invalid-opc", "Colliding package members.", "admit");
      parents.add(parent);
      parent = parent.slice(0, parent.lastIndexOf("/"));
    }
    names.add(key);
    let input = member.bytes;
    if (input instanceof Uint8Array) {
      ownedTotal += input.length;
      if (input.length > context.archiveLimits.maxEntryBytes || input.length > context.limits.maxBytes || ownedTotal > context.archiveLimits.maxTotalBytes)
        throw new OfficeError("resource-limit", "Package byte limit exceeded.", "admit");
      input = new Uint8Array(input);
    }
    return { part, sha256: member.sha256, input };
  });
  let total = 0;
  const output = [];
  for (const member of admitted) {
    const remaining = context.archiveLimits.maxTotalBytes - total;
    const bytes = await readBinary(member.input, context, { maxBytes: Math.min(context.limits.maxBytes, context.archiveLimits.maxEntryBytes, Math.max(1, remaining)) });
    if (bytes.length > remaining) throw new OfficeError("resource-limit", "Package byte limit exceeded.", "admit");
    total += bytes.length;
    if (digest(bytes) !== member.sha256)
      throw new OfficeError("invalid-value", "Package member digest does not match.", "admit");
    const name = [...member.part.slice(1)].map(character => character.codePointAt(0)! > 127 ? encodeURIComponent(character) : character).join("");
    output.push({ name, bytes });
  }
  const bytes = await writePackageArchive(output, context, { compression: "store" });
  const loaded = await loadShared(bytes, context);
  if (options.kind !== undefined) {
    const types = parseContentTypes(loaded.reader.get("/[Content_Types].xml"), {
      maxBytes: context.xmlLimits.maxBytes, maxEntries: context.archiveLimits.maxMembers
    });
    types.presentationKind(loaded.main, options.kind);
  }
  return bytes;
}
