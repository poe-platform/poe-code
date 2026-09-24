import type { MetadataTag, TagAssignment } from "./png.js";
import { exiftoolRegistry } from "./registry.js";
import type { Resources } from "./resources.js";

const encoder = new TextEncoder();
const latin1Decoder = new TextDecoder("latin1");

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

function decodePdfLiteralString(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = raw[++i];
    if (next === undefined) break;
    if (next === "n") out += "\n";
    else if (next === "r") out += "\r";
    else if (next === "t") out += "\t";
    else if (next === "b") out += "\b";
    else if (next === "f") out += "\f";
    else if (next >= "0" && next <= "7") {
      let oct = next;
      if (raw[i + 1] && raw[i + 1]! >= "0" && raw[i + 1]! <= "7") oct += raw[++i]!;
      if (raw[i + 1] && raw[i + 1]! >= "0" && raw[i + 1]! <= "7") oct += raw[++i]!;
      out += String.fromCharCode(parseInt(oct, 8));
    } else {
      out += next;
    }
  }
  return out;
}

function decodePdfHexString(hex: string): string {
  const clean = hex.replace(/\s+/g, "");
  const padded = clean.length % 2 === 1 ? clean + "0" : clean;
  const bytes = new Uint8Array(padded.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16) || 0;
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let str = "";
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      str += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
    }
    return str;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function encodePdfLiteralString(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
  return `(${escaped})`;
}

function parsePdfStructure(bytes: Uint8Array): {
  version: string;
  pageCount: number;
  info: Map<string, string>;
} {
  const text = latin1Decoder.decode(bytes);
  if (!text.startsWith("%PDF-")) {
    throw new Error("Invalid PDF header");
  }
  const versionMatch = /^%PDF-(\d+\.\d+)/.exec(text);
  const version = versionMatch?.[1] ?? "1.7";

  const pagesMatch = /\/Type\s*\/Pages\b[\s\S]{0,256}?\/Count\s+(\d+)/.exec(text);
  let pageCount = pagesMatch ? Number(pagesMatch[1]) : 0;
  if (!pageCount) {
    const leafMatches = text.match(/\/Type\s*\/Page\b(?!s)/g);
    pageCount = leafMatches ? leafMatches.length : 1;
  }

  const info = new Map<string, string>();
  const entryRegex =
    /\/(Title|Author|Subject|Keywords|Creator|Producer|Description|Comment|Copyright|ModifyDate|CreateDate|ModDate|CreationDate)\s*(?:\(((?:\\.|[^\\()])*)\)|<([0-9A-Fa-f\s]*)>)/g;
  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(text)) !== null) {
    const rawKey = match[1]!;
    const key = rawKey === "ModDate" ? "ModifyDate" : rawKey === "CreationDate" ? "CreateDate" : rawKey;
    const literal = match[2];
    const hex = match[3];
    const val = literal !== undefined ? decodePdfLiteralString(literal) : decodePdfHexString(hex ?? "");
    info.set(key, val);
  }

  return { version, pageCount, info };
}

export function inspectPdf(bytes: Uint8Array, resources: Resources): { readonly tags: readonly MetadataTag[] } {
  resources.admit("work", bytes.length * 4 + 256);
  resources.admit("decoded", bytes.length + 256);
  const { version, pageCount, info } = parsePdfStructure(bytes);
  const tags: MetadataTag[] = [];

  tags.push(makeTag("PDFVersion", version));
  tags.push(makeTag("PageCount", String(pageCount)));

  for (const key of [
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
  ]) {
    const val = info.get(key);
    if (val !== undefined && val !== "") {
      tags.push(makeTag(key, val));
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

  const { info } = parsePdfStructure(bytes);
  if (!info.has("Producer")) {
    info.set("Producer", "@poe-code/pdf-ast");
  }

  let modified = false;
  for (const a of assignments) {
    const canonical = exiftoolRegistry.tags.find((t) => t.toLowerCase() === a.name.toLowerCase()) ?? a.name;
    const current = info.get(canonical) ?? "";
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
      if (nextValue === "") info.delete(canonical);
      else info.set(canonical, nextValue);
    }
  }

  if (!modified) return bytes;

  const text = latin1Decoder.decode(bytes);
  let maxObjNum = 1;
  const objRegex = /(\d+)\s+0\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = objRegex.exec(text)) !== null) {
    const n = Number(m[1]);
    if (n > maxObjNum) maxObjNum = n;
  }
  const infoObjNum = maxObjNum + 1;
  const rootMatch = /\/Root\s+(\d+)\s+(\d+)\s+R/.exec(text);
  const rootRef = rootMatch ? `${rootMatch[1]} ${rootMatch[2]} R` : "1 0 R";
  const prevXrefMatch = /startxref\s+(\d+)/g;
  let lastStartXref = 0;
  let xm: RegExpExecArray | null;
  while ((xm = prevXrefMatch.exec(text)) !== null) {
    lastStartXref = Number(xm[1]);
  }

  const infoEntries = Array.from(info.entries())
    .map(([k, v]) => `/${k} ${encodePdfLiteralString(v)}`)
    .join(" ");

  const offset = bytes.length;
  const objBlock = `\n${infoObjNum} 0 obj\n<< ${infoEntries} >>\nendobj\n`;
  const xrefOffset = offset + encoder.encode(objBlock).length;
  const pad10 = String(offset).padStart(10, "0");
  const trailerBlock =
    `xref\n0 1\n0000000000 65535 f \n${infoObjNum} 1\n${pad10} 00000 n \n` +
    `trailer\n<< /Size ${infoObjNum + 1} /Root ${rootRef} /Info ${infoObjNum} 0 R` +
    (lastStartXref > 0 ? ` /Prev ${lastStartXref}` : "") +
    ` >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  const suffixBytes = encoder.encode(objBlock + trailerBlock);
  const merged = new Uint8Array(bytes.length + suffixBytes.length);
  merged.set(bytes, 0);
  merged.set(suffixBytes, bytes.length);

  return merged;
}
