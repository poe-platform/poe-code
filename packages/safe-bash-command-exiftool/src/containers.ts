import { inflateDeflateRaw } from "./pdf.js";
import type { MetadataTag } from "./png.js";
import type { Resources } from "./resources.js";

function makeTag(name: string, value: string, group: string, index: number): MetadataTag {
  return {
    name,
    rawName: name,
    value,
    group,
    chunkType: group,
    index,
    instance: 0,
    offset: 0,
    raw: new TextEncoder().encode(value),
  };
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function readZipEntries(bytes: Uint8Array, resources: Resources): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.byteLength - 22; i >= Math.max(0, bytes.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd >= 0) {
    const count = view.getUint16(eocd + 10, true);
    let cdOffset = view.getUint32(eocd + 16, true);
    for (let i = 0; i < count && cdOffset + 46 <= bytes.byteLength; i++) {
      if (view.getUint32(cdOffset, true) !== 0x02014b50) break;
      const method = view.getUint16(cdOffset + 10, true);
      const compSize = view.getUint32(cdOffset + 20, true);
      const nameLen = view.getUint16(cdOffset + 28, true);
      const extraLen = view.getUint16(cdOffset + 30, true);
      const commentLen = view.getUint16(cdOffset + 32, true);
      const localOffset = view.getUint32(cdOffset + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(cdOffset + 46, cdOffset + 46 + nameLen));
      cdOffset += 46 + nameLen + extraLen + commentLen;
      if (localOffset + 30 <= bytes.byteLength && view.getUint32(localOffset, true) === 0x04034b50) {
        const lNameLen = view.getUint16(localOffset + 26, true);
        const lExtraLen = view.getUint16(localOffset + 28, true);
        const dataStart = localOffset + 30 + lNameLen + lExtraLen;
        if (dataStart + compSize <= bytes.byteLength) {
          const slice = bytes.subarray(dataStart, dataStart + compSize);
          resources.admit("work", compSize + 64);
          if (method === 0) entries.set(name, slice);
          else if (method === 8 && (name.endsWith(".xml") || name.endsWith(".opf") || name === "mimetype")) {
            try { entries.set(name, new Uint8Array(inflateDeflateRaw(slice, 0))); } catch { /* Unreadable optional metadata entries are omitted. */ }
          }
        }
      }
    }
  }
  return entries;
}

export function inspectContainerOrWebp(bytes: Uint8Array, extension: string, resources: Resources): { tags: MetadataTag[] } | undefined {
  const tags: MetadataTag[] = [];
  let idx = 0;

  // 1. WebP ("RIFF....WEBP")
  if (
    bytes.byteLength >= 16 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    resources.admit("work", bytes.byteLength);
    tags.push(makeTag("FileType", "WEBP", "File", idx++));
    tags.push(makeTag("MIMEType", "image/webp", "File", idx++));
    let width = 0;
    let height = 0;
    const chunkFourCC = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
    if (chunkFourCC === "VP8 " && bytes.byteLength >= 30) {
      width = ((bytes[26]! | (bytes[27]! << 8)) & 0x3fff);
      height = ((bytes[28]! | (bytes[29]! << 8)) & 0x3fff);
    } else if (chunkFourCC === "VP8L" && bytes.byteLength >= 25) {
      const b0 = bytes[21]!, b1 = bytes[22]!, b2 = bytes[23]!, b3 = bytes[24]!;
      width = 1 + (((b1 & 0x3f) << 8) | b0);
      height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    } else if (chunkFourCC === "VP8X" && bytes.byteLength >= 30) {
      width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
      height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
    }
    if (width > 0 && height > 0) {
      tags.push(makeTag("ImageWidth", String(width), "RIFF", idx++));
      tags.push(makeTag("ImageHeight", String(height), "RIFF", idx++));
      tags.push(makeTag("ImageSize", `${width}x${height}`, "Composite", idx++));
    }
    return { tags };
  }

  // 2. ZIP-based Document Containers (DOCX, PPTX, XLSX, ODT, EPUB)
  const isZip = bytes.byteLength >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (isZip || ["DOCX", "PPTX", "XLSX", "ODT", "EPUB"].includes(extension)) {
    if (!isZip) throw new Error(`Invalid or corrupted ${extension} archive`);
    const entries = readZipEntries(bytes, resources);
    const mimeEntry = entries.get("mimetype") ? new TextDecoder().decode(entries.get("mimetype")!).trim() : "";
    let fileType = extension;
    let mimeType = "application/zip";
    if (entries.has("word/document.xml") || extension === "DOCX") {
      fileType = "DOCX";
      mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    } else if (entries.has("ppt/presentation.xml") || extension === "PPTX") {
      fileType = "PPTX";
      mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    } else if (entries.has("xl/workbook.xml") || extension === "XLSX") {
      fileType = "XLSX";
      mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    } else if (mimeEntry === "application/vnd.oasis.opendocument.text" || entries.has("content.xml") || extension === "ODT") {
      fileType = "ODT";
      mimeType = "application/vnd.oasis.opendocument.text";
    } else if (mimeEntry === "application/epub+zip" || entries.has("META-INF/container.xml") || extension === "EPUB") {
      fileType = "EPUB";
      mimeType = "application/epub+zip";
    }
    tags.push(makeTag("FileType", fileType, "File", idx++));
    tags.push(makeTag("MIMEType", mimeType, "File", idx++));

    const xmlTexts: string[] = [];
    for (const [name, data] of entries) {
      if (name === "docProps/core.xml" || name === "docProps/app.xml" || name === "meta.xml" || name.endsWith(".opf")) {
        xmlTexts.push(new TextDecoder().decode(data));
      }
    }
    const combinedXml = xmlTexts.join("\n");
    const extractXmlTag = (pattern: RegExp, tagNames: readonly string[]) => {
      const m = pattern.exec(combinedXml);
      if (m && m[1]?.trim()) {
        const val = unescapeXml(m[1]);
        for (const tName of tagNames) {
          tags.push(makeTag(tName, val, "XML", idx++));
        }
      }
    };
    extractXmlTag(/<(?:dc:)?title[^>]*>([\s\S]*?)<\/(?:dc:)?title>/i, ["Title"]);
    extractXmlTag(/<(?:dc:)?creator[^>]*>([\s\S]*?)<\/(?:dc:)?creator>/i, ["Creator", "Author"]);
    extractXmlTag(/<(?:dc:)?subject[^>]*>([\s\S]*?)<\/(?:dc:)?subject>/i, ["Subject"]);
    extractXmlTag(/<(?:dc:)?description[^>]*>([\s\S]*?)<\/(?:dc:)?description>/i, ["Description"]);
    extractXmlTag(/<(?:dcterms:created|meta:creation-date)[^>]*>([\s\S]*?)<\/(?:dcterms:created|meta:creation-date)>/i, ["CreateDate"]);
    extractXmlTag(/<(?:dcterms:modified|dc:date)[^>]*>([\s\S]*?)<\/(?:dcterms:modified|dc:date)>/i, ["ModifyDate"]);
    extractXmlTag(/<(?:Application|meta:generator)[^>]*>([\s\S]*?)<\/(?:Application|meta:generator)>/i, ["Software"]);
    extractXmlTag(/<Pages[^>]*>(\d+)<\/Pages>/i, ["PageCount"]);
    return { tags };
  }
  return undefined;
}
