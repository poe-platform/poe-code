import { SaxesParser, type SaxesTagNS } from "saxes";
import {
  CancellationError,
  archiveSettings,
  readArchive,
  ResourceLimitError,
  type ArchiveContext,
  type DocumentArchive
} from "./archive.js";

export class InvalidPackageError extends Error {
  readonly code = "invalid-package";
}
export class InvalidXmlError extends Error {
  readonly code = "invalid-xml";
}

export class UnsupportedProfileError extends Error {
  readonly code = "unsupported-profile";
}

export interface AdmittedDocumentArchive extends DocumentArchive {
  readonly kind: "docx" | "dotx";
  readonly dialect: "strict" | "transitional";
  readonly mainPart: string;
}

const contentTypesNamespace = "http://schemas.openxmlformats.org/package/2006/content-types";
const relationshipsNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
const documentTypes = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  dotx: "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml"
};
const macroTypes = new Set([
  "application/vnd.ms-word.document.macroenabled.main+xml",
  "application/vnd.ms-word.template.macroenabledtemplate.main+xml",
  "application/vnd.ms-office.vbaproject",
  "application/vnd.ms-word.vbadata+xml"
]);
const dialects = {
  strict: "http://purl.oclc.org/ooxml/wordprocessingml/main",
  transitional: "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
};
const officeRelationships = new Set([
  "http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument",
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
]);

function invalid(): never {
  throw new InvalidPackageError("Invalid document OPC container.");
}

function attribute(tag: SaxesTagNS, name: string): string {
  const value = tag.attributes[name];
  if (!value || value.uri || !value.value) return invalid();
  return value.value;
}

function partKey(name: string, target = false): string {
  if (
    !name ||
    name.includes("\\") ||
    name.includes(":") ||
    name.includes("?") ||
    name.includes("#") ||
    [...name].some((char) => char <= " ")
  )
    invalid();
  const parts: string[] = [];
  for (const segment of name.split("/")) {
    if (target && segment === ".") continue;
    if (target && segment === "..") {
      if (!parts.pop()) invalid();
      continue;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return invalid();
    }
    if (
      !decoded ||
      decoded === "." ||
      decoded === ".." ||
      decoded.endsWith(".") ||
      [...decoded].some((char) => char < " " || char === "/" || char === "\\" || char === ":")
    )
      invalid();
    parts.push(decoded.toLowerCase());
  }
  if (!parts.length) invalid();
  return parts.join("/");
}

// Parse bounded admitted bytes without retaining a document tree or resolving entities.
function xml(bytes: Uint8Array, visit: (tag: SaxesTagNS, depth: number) => void): void {
  try {
    let encoding = "utf-8";
    if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = "utf-16le";
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = "utf-16be";
    const decoder = new TextDecoder(encoding, { fatal: true });
    const parser = new SaxesParser({ xmlns: true });
    let depth = 0;
    const rejectXml = () => {
      throw new InvalidXmlError("Malformed or prohibited document XML.");
    };
    parser.on("error", rejectXml);
    parser.on("doctype", rejectXml);
    parser.on("opentag", (tag) => visit(tag, ++depth));
    parser.on("closetag", () => {
      depth--;
    });
    for (let offset = 0; offset < bytes.length; offset += 4096) {
      parser.write(decoder.decode(bytes.subarray(offset, offset + 4096), { stream: true }));
    }
    parser.write(decoder.decode()).close();
  } catch (error) {
    if (
      error instanceof UnsupportedProfileError ||
      error instanceof InvalidPackageError ||
      error instanceof InvalidXmlError
    )
      throw error;
    throw new InvalidXmlError("Malformed or prohibited document XML.");
  }
}

export async function readDocumentArchive(
  input: Uint8Array,
  context: ArchiveContext
): Promise<AdmittedDocumentArchive> {
  const { limits, signal } = archiveSettings(context);
  if (signal.aborted) throw new CancellationError("Document admission cancelled.");
  if (
    input instanceof Uint8Array &&
    input.length >= 8 &&
    [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((value, index) => input[index] === value)
  ) {
    if (input.length > limits.maxArchiveBytes)
      throw new ResourceLimitError("Archive byte budget exceeded.");
    throw new UnsupportedProfileError(
      "Compound binary Word or encrypted Office containers are unsupported."
    );
  }
  const archive = await readArchive(input, { limits, signal });
  const total = archive.members.reduce((sum, member) => sum + member.bytes.length, 0);
  // Reserve strings, parser state and lookup metadata in addition to owned payloads.
  if (
    input.length * 4 + total * 16 + archive.members.length * 1024 + 65536 >
    limits.maxRetainedBytes
  )
    throw new ResourceLimitError("Document admission retained byte budget exceeded.");
  const parts = new Map<string, (typeof archive.members)[number]>();
  for (const member of archive.members) {
    if (member.directory) continue;
    const key = partKey(member.name);
    if (parts.has(key)) invalid();
    parts.set(key, member);
  }
  const typesPart = parts.get("[content_types].xml");
  const relsPart = parts.get("_rels/.rels");
  if (!typesPart || !relsPart) invalid();
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  xml(typesPart.bytes, (tag, depth) => {
    if (tag.uri !== contentTypesNamespace) invalid();
    if (depth === 1) {
      if (tag.local !== "Types") invalid();
      return;
    }
    if (depth !== 2 || (tag.local !== "Default" && tag.local !== "Override")) invalid();
    const type = attribute(tag, "ContentType");
    const lower = type.toLowerCase();
    if (macroTypes.has(lower))
      throw new UnsupportedProfileError("Macro-enabled document containers are unsupported.");
    const override = tag.local === "Override";
    const name = attribute(tag, override ? "PartName" : "Extension");
    if (override && !name.startsWith("/")) invalid();
    if (!override && (name.includes(".") || name.includes("/") || name.includes("%"))) invalid();
    const key = override ? partKey(name.slice(1)) : name.toLowerCase();
    const map = override ? overrides : defaults;
    if (map.has(key)) invalid();
    map.set(key, type);
  });
  for (const name of overrides.keys()) if (!parts.has(name)) invalid();
  const types = new Map<string, string>();
  for (const name of parts.keys()) {
    if (name === "[content_types].xml") continue;
    const extension = name
      .slice(name.lastIndexOf("/") + 1)
      .split(".")
      .at(-1)!;
    const type = overrides.get(name) ?? defaults.get(extension);
    if (!type) invalid();
    types.set(name, type);
  }
  if (types.get("_rels/.rels") !== "application/vnd.openxmlformats-package.relationships+xml")
    invalid();
  let mainKey: string | undefined;
  const ids = new Set<string>();
  xml(relsPart.bytes, (tag, depth) => {
    if (tag.uri !== relationshipsNamespace) invalid();
    if (depth === 1) {
      if (tag.local !== "Relationships") invalid();
      return;
    }
    if (depth !== 2 || tag.local !== "Relationship") invalid();
    const id = attribute(tag, "Id");
    const type = attribute(tag, "Type");
    const target = attribute(tag, "Target");
    if (ids.has(id)) invalid();
    ids.add(id);
    const mode = tag.attributes.TargetMode?.value ?? "Internal";
    if (mode !== "External" && mode !== "Internal") invalid();
    const main = officeRelationships.has(type);
    if (main && (mainKey !== undefined || mode === "External")) invalid();
    if (mode === "Internal") {
      const key = partKey(target.startsWith("/") ? target.slice(1) : target, true);
      if (!parts.has(key)) invalid();
      if (main) mainKey = key;
    }
  });
  if (mainKey === undefined) invalid();
  const main = parts.get(mainKey)!;
  const type = types.get(mainKey);
  const kind =
    type === documentTypes.docx ? "docx" : type === documentTypes.dotx ? "dotx" : undefined;
  if (!kind)
    throw new UnsupportedProfileError("The package is not a supported Word document or template.");
  let dialect: AdmittedDocumentArchive["dialect"] | undefined;
  xml(main.bytes, (tag, depth) => {
    if (depth !== 1) return;
    if (tag.local !== "document") invalid();
    dialect =
      tag.uri === dialects.strict
        ? "strict"
        : tag.uri === dialects.transitional
          ? "transitional"
          : undefined;
    if (!dialect) invalid();
  });
  if (!dialect) invalid();
  if (signal.aborted) throw new CancellationError("Document admission cancelled.");
  return { ...archive, kind, dialect, mainPart: main.name };
}
