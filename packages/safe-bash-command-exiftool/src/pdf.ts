import { PdfDocument, cosString, dictGet, dictSet } from "@poe-code/pdf-ast";
import type { MetadataTag, TagAssignment } from "./png.js";
import { exiftoolRegistry } from "./registry.js";
import type { Resources } from "./resources.js";

const encoder = new TextEncoder();

export const pdfWriteTags = new Set([
  "Title",
  "Author",
  "Subject",
  "Keywords",
  "Creator",
  "Producer",
  "Description",
  "Comment",
  "Copyright",
  "ModifyDate",
  "CreateDate",
]);

function makeTag(name: string, value: string, index = 0, instance = 0): MetadataTag {
  return {
    name,
    rawName: name,
    value,
    raw: encoder.encode(value),
    chunkType: "iTXt",
    index,
    group: "PDF",
    instance,
    offset: 0,
  };
}

export function inspectPdf(bytes: Uint8Array, resources: Resources): { readonly tags: readonly MetadataTag[] } {
  resources.admit("work", bytes.length * 4 + 256);
  resources.admit("decoded", bytes.length + 256);
  const doc = PdfDocument.load(bytes);
  const tags: MetadataTag[] = [];

  tags.push(makeTag("PDFVersion", doc.cos.version || "1.7"));
  tags.push(makeTag("PageCount", String(doc.getPageCount())));

  const meta = doc.getMetadata();
  if (meta.title !== undefined && meta.title !== "") tags.push(makeTag("Title", meta.title));
  if (meta.author !== undefined && meta.author !== "") tags.push(makeTag("Author", meta.author));
  if (meta.subject !== undefined && meta.subject !== "") tags.push(makeTag("Subject", meta.subject));
  if (meta.keywords !== undefined && meta.keywords !== "") tags.push(makeTag("Keywords", meta.keywords));
  if (meta.creator !== undefined && meta.creator !== "") tags.push(makeTag("Creator", meta.creator));
  if (meta.producer !== undefined && meta.producer !== "") tags.push(makeTag("Producer", meta.producer));

  for (const extra of ["Description", "Comment", "Copyright", "ModifyDate", "CreateDate", "ModDate", "CreationDate"]) {
    const val = doc.cos.getInfoString(extra);
    if (val !== undefined && val !== "") {
      const normalizedName =
        extra === "ModDate" ? "ModifyDate" : extra === "CreationDate" ? "CreateDate" : extra;
      if (!tags.some((t) => t.name === normalizedName)) {
        tags.push(makeTag(normalizedName, val));
      }
    }
  }

  resources.admit("retained", tags.length * 128);
  return { tags };
}

export function editPdf(
  bytes: Uint8Array,
  assignments: readonly TagAssignment[],
  resources: Resources
): Uint8Array {
  resources.admit("work", bytes.length * 6 + assignments.length * 128);
  resources.admit("decoded", bytes.length + 512);

  for (const a of assignments) {
    if (a.name.toLowerCase() === "all") {
      throw new Error(
        "PDF parser/writer not yet supported; metadata deletion retains historical revisions and never guarantees redaction"
      );
    }
    const canonical = exiftoolRegistry.tags.find((t) => t.toLowerCase() === a.name.toLowerCase()) ?? a.name;
    if (!pdfWriteTags.has(canonical)) {
      throw new Error("Tag write not yet supported: " + a.name);
    }
  }

  const doc = PdfDocument.load(bytes);
  let infoDict = doc.cos.infoRef ? doc.cos.resolveDict(doc.cos.infoRef) : undefined;
  if (!infoDict) {
    doc.setProducer(doc.getMetadata().producer ?? "@poe-code/pdf-ast");
    infoDict = doc.cos.infoRef ? doc.cos.resolveDict(doc.cos.infoRef) : undefined;
  }

  let modified = false;
  for (const a of assignments) {
    const canonical = exiftoolRegistry.tags.find((t) => t.toLowerCase() === a.name.toLowerCase()) ?? a.name;
    const current = doc.cos.getInfoString(canonical) ?? "";
    let nextValue: string | undefined;

    if (a.operation === "set") {
      nextValue = a.value;
    } else if (a.operation === "add") {
      nextValue = current ? `${current}, ${a.value}` : a.value;
    } else if (a.operation === "remove") {
      if (a.value === "" || current === a.value) {
        nextValue = "";
      } else {
        continue;
      }
    }

    if (nextValue !== undefined && nextValue !== current) {
      modified = true;
      if (canonical === "Title") doc.setTitle(nextValue);
      else if (canonical === "Author") doc.setAuthor(nextValue);
      else if (canonical === "Subject") doc.setSubject(nextValue);
      else if (canonical === "Keywords") doc.setKeywords(nextValue);
      else if (canonical === "Creator") doc.setCreator(nextValue);
      else if (canonical === "Producer") doc.setProducer(nextValue);
      else if (infoDict) {
        dictSet(infoDict, canonical, cosString(nextValue));
      }
    }
  }

  if (!modified) return bytes;
  return doc.save();
}
