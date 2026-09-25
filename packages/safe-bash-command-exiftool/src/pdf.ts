import type { MetadataTag, TagAssignment } from "./png.js";
import { exiftoolRegistry } from "./registry.js";
import type { Resources } from "./resources.js";

const encoder = new TextEncoder();
const latin1Decoder = new TextDecoder("latin1");

const FIXED_LEN_LITS = (() => {
  const a = new Uint8Array(288);
  a.fill(8, 0, 144);
  a.fill(9, 144, 256);
  a.fill(7, 256, 280);
  a.fill(8, 280, 288);
  return a;
})();
const FIXED_LEN_DISTS = new Uint8Array(32).fill(5);
const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
const LEN_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LEN_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];

function buildHuffman(lengths: Uint8Array): { counts: Uint16Array; symbols: Uint16Array } {
  const counts = new Uint16Array(16);
  for (let i = 0; i < lengths.length; i++) {
    const l = lengths[i]!;
    if (l > 0 && l < 16) counts[l] = (counts[l] ?? 0) + 1;
  }
  const offsets = new Uint16Array(16);
  let sum = 0;
  for (let len = 1; len < 16; len++) {
    offsets[len] = sum;
    sum += counts[len]!;
  }
  const symbols = new Uint16Array(lengths.length);
  for (let sym = 0; sym < lengths.length; sym++) {
    const l = lengths[sym]!;
    if (l > 0) {
      const idx = offsets[l]!;
      symbols[idx] = sym;
      offsets[l] = idx + 1;
    }
  }
  return { counts, symbols };
}

function inflateDeflateRaw(src: Uint8Array, startOffset = 0): Uint8Array {
  let bitPos = startOffset * 8;
  const readBits = (n: number): number => {
    let val = 0;
    for (let i = 0; i < n; i++) {
      const byteIdx = bitPos >>> 3;
      if (byteIdx >= src.length) throw new Error("EOF");
      val |= ((src[byteIdx]! >>> (bitPos & 7)) & 1) << i;
      bitPos++;
    }
    return val;
  };
  const decodeSym = (huff: { counts: Uint16Array; symbols: Uint16Array }): number => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      code |= readBits(1);
      const count = huff.counts[len]!;
      if (code - count < first) return huff.symbols[index + (code - first)]!;
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    throw new Error("Invalid Huffman code");
  };

  const out: number[] = [];
  let bfinal = 0;
  while (!bfinal) {
    bfinal = readBits(1);
    const btype = readBits(2);
    if (btype === 0) {
      bitPos = (bitPos + 7) & ~7;
      const byteIdx = bitPos >>> 3;
      const len = src[byteIdx]! | (src[byteIdx + 1]! << 8);
      bitPos += 32;
      const start = bitPos >>> 3;
      for (let i = 0; i < len; i++) out.push(src[start + i]!);
      bitPos += len * 8;
    } else if (btype === 1 || btype === 2) {
      let litHuff: { counts: Uint16Array; symbols: Uint16Array };
      let distHuff: { counts: Uint16Array; symbols: Uint16Array };
      if (btype === 1) {
        litHuff = buildHuffman(FIXED_LEN_LITS);
        distHuff = buildHuffman(FIXED_LEN_DISTS);
      } else {
        const hlit = readBits(5) + 257;
        const hdist = readBits(5) + 1;
        const hclen = readBits(4) + 4;
        const clen = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) clen[CLEN_ORDER[i]!] = readBits(3);
        const codeHuff = buildHuffman(clen);
        const lengths = new Uint8Array(hlit + hdist);
        let idx = 0;
        while (idx < lengths.length) {
          const sym = decodeSym(codeHuff);
          if (sym < 16) lengths[idx++] = sym;
          else if (sym === 16) {
            const rep = readBits(2) + 3;
            const prev = lengths[idx - 1] ?? 0;
            for (let r = 0; r < rep; r++) lengths[idx++] = prev;
          } else if (sym === 17) {
            idx += readBits(3) + 3;
          } else {
            idx += readBits(7) + 11;
          }
        }
        litHuff = buildHuffman(lengths.subarray(0, hlit));
        distHuff = buildHuffman(lengths.subarray(hlit));
      }
      while (true) {
        const sym = decodeSym(litHuff);
        if (sym === 256) break;
        if (sym < 256) {
          out.push(sym);
        } else {
          const lenIdx = sym - 257;
          const length = LEN_BASE[lenIdx]! + readBits(LEN_EXTRA[lenIdx]!);
          const distSym = decodeSym(distHuff);
          const dist = DIST_BASE[distSym]! + readBits(DIST_EXTRA[distSym]!);
          for (let i = 0; i < length; i++) {
            out.push(out[out.length - dist]!);
          }
        }
      }
    } else {
      throw new Error("Invalid block type");
    }
  }
  return new Uint8Array(out);
}

function tryInflatePdfStream(rawSlice: Uint8Array): Uint8Array | undefined {
  if (rawSlice.length >= 2 && (rawSlice[0]! & 0x0f) === 8 && ((rawSlice[0]! << 8) + rawSlice[1]!) % 31 === 0) {
    try {
      return inflateDeflateRaw(rawSlice, 2);
    } catch {
      // Fall through to raw deflate
    }
  }
  try {
    return inflateDeflateRaw(rawSlice, 0);
  } catch {
    return undefined;
  }
}

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
  if (/[^\x20-\x7e]/.test(value)) {
    let hex = "FEFF";
    for (let i = 0; i < value.length; i++) {
      hex += value.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase();
    }
    return `<${hex}>`;
  }
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
  return `(${escaped})`;
}

function normalizePdfDate(raw: string): string {
  const m =
    /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:([Z+-])(?:(\d{2})'?(?:(\d{2})'?)?)?)?/.exec(
      raw.trim()
    );
  if (!m) return raw;
  const yyyy = m[1]!;
  const mm = m[2] ?? "01";
  const dd = m[3] ?? "01";
  const hh = m[4] ?? "00";
  const min = m[5] ?? "00";
  const ss = m[6] ?? "00";
  const sign = m[7];
  const tzh = m[8] ?? "00";
  const tzm = m[9] ?? "00";
  const tz = !sign ? "" : sign === "Z" ? "Z" : `${sign}${tzh}:${tzm}`;
  return `${yyyy}:${mm}:${dd} ${hh}:${min}:${ss}${tz}`;
}

function readBalancedLiteralString(text: string, openParenIndex: number): { raw: string; endIndex: number } {
  let depth = 0;
  let i = openParenIndex;
  for (; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) {
        return { raw: text.slice(openParenIndex + 1, i), endIndex: i + 1 };
      }
    }
  }
  return { raw: text.slice(openParenIndex + 1), endIndex: text.length };
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

  let pageCount = 0;
  const dictRe = /<<([\s\S]*?)>>/g;
  let dm: RegExpExecArray | null;
  while ((dm = dictRe.exec(text)) !== null) {
    const body = dm[1]!;
    if (/\/Type\s*\/Pages\b/.test(body)) {
      const cm = /\/Count\s+(\d+)/.exec(body);
      if (cm) {
        const c = Number(cm[1]);
        if (c > pageCount) pageCount = c;
      }
    }
  }
  if (!pageCount) {
    const leafMatches = text.match(/\/Type\s*\/Page\b(?!s)/g);
    pageCount = leafMatches ? leafMatches.length : 1;
  }

  const info = new Map<string, string>();
  const infoRefs = [...text.matchAll(/\/Info\s+(\d+)\s+\d+\s+R/g)];
  let infoSourceText = text;
  if (infoRefs.length > 0) {
    const activeObjNum = infoRefs.at(-1)![1]!;
    const objMatches = [...text.matchAll(new RegExp(`(?:^|[\\r\\n])\\s*${activeObjNum}\\s+0\\s+obj\\b([\\s\\S]*?)endobj`, "g"))];
    if (objMatches.length > 0) {
      infoSourceText = objMatches.at(-1)![1]!;
    }
  }
  let fullText = text;
  let infoScanText = infoSourceText;
  const flateRe = /<<[\s\S]*?\/Filter\s*\/FlateDecode[\s\S]*?>>\s*stream\r?\n/g;
  let fm: RegExpExecArray | null;
  while ((fm = flateRe.exec(text)) !== null) {
    const dataStart = flateRe.lastIndex;
    const endStreamIdx = text.indexOf("endstream", dataStart);
    if (endStreamIdx > dataStart) {
      let end = endStreamIdx;
      if (bytes[end - 1] === 0x0a) end--;
      if (bytes[end - 1] === 0x0d) end--;
      const rawSlice = bytes.subarray(dataStart, end);
      const inflated = tryInflatePdfStream(rawSlice);
      if (inflated) {
        const decodedInflated = new TextDecoder("utf-8", { fatal: false }).decode(inflated);
        fullText += "\n" + decodedInflated;
        infoScanText += "\n" + decodedInflated;
      }
    }
  }

  const keyRegex =
    /\/(Title|Author|Subject|Keywords|Creator|Producer|Description|Comment|Copyright|ModifyDate|CreateDate|ModDate|CreationDate)\s*/g;
  let km: RegExpExecArray | null;
  while ((km = keyRegex.exec(infoScanText)) !== null) {
    const rawKey = km[1]!;
    const key = rawKey === "ModDate" ? "ModifyDate" : rawKey === "CreationDate" ? "CreateDate" : rawKey;
    const afterKey = keyRegex.lastIndex;
    const nextChar = infoScanText[afterKey];
    if (nextChar === "(") {
      const { raw, endIndex } = readBalancedLiteralString(infoScanText, afterKey);
      const decoded = decodePdfLiteralString(raw);
      info.set(
        key,
        key === "CreateDate" || key === "ModifyDate" ? normalizePdfDate(decoded) : decoded
      );
      keyRegex.lastIndex = endIndex;
    } else if (nextChar === "<" && infoScanText[afterKey + 1] !== "<") {
      const closeAngle = infoScanText.indexOf(">", afterKey + 1);
      if (closeAngle > afterKey) {
        const decoded = decodePdfHexString(infoScanText.slice(afterKey + 1, closeAngle));
        info.set(
          key,
          key === "CreateDate" || key === "ModifyDate" ? normalizePdfDate(decoded) : decoded
        );
        keyRegex.lastIndex = closeAngle + 1;
      }
    }
  }

  // Extract XMP metadata tags as fallback when absent from /Info
  const xmpTagPairs: ReadonlyArray<readonly [string, RegExp]> = [
    ["Title", /<dc:title\b[^>]*>[\s\S]*?<rdf:li\b[^>]*>([\s\S]*?)<\/rdf:li>/i],
    ["Author", /<dc:creator\b[^>]*>[\s\S]*?<rdf:li\b[^>]*>([\s\S]*?)<\/rdf:li>/i],
    ["Description", /<dc:description\b[^>]*>[\s\S]*?<rdf:li\b[^>]*>([\s\S]*?)<\/rdf:li>/i],
    ["Keywords", /<pdf:Keywords\b[^>]*>([\s\S]*?)<\/pdf:Keywords>/i],
    ["Producer", /<pdf:Producer\b[^>]*>([\s\S]*?)<\/pdf:Producer>/i],
    ["Creator", /<xmp:CreatorTool\b[^>]*>([\s\S]*?)<\/xmp:CreatorTool>/i],
    ["CreateDate", /<xmp:CreateDate\b[^>]*>([\s\S]*?)<\/xmp:CreateDate>/i],
    ["ModifyDate", /<xmp:ModifyDate\b[^>]*>([\s\S]*?)<\/xmp:ModifyDate>/i],
  ];
  for (const [tag, re] of xmpTagPairs) {
    if (!info.has(tag)) {
      const xm = re.exec(fullText);
      if (xm && xm[1]) {
        info.set(tag, xm[1].trim());
      }
    }
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
    .flatMap(([k, v]) => {
      const encoded = encodePdfLiteralString(v);
      if (k === "CreateDate") return [`/CreateDate ${encoded}`, `/CreationDate ${encoded}`];
      if (k === "ModifyDate") return [`/ModifyDate ${encoded}`, `/ModDate ${encoded}`];
      return [`/${k} ${encoded}`];
    })
    .join(" ");

  const offset = bytes.length + 1; // +1 for the leading '\n' before `${infoObjNum} 0 obj`
  const objBlock = `\n${infoObjNum} 0 obj\n<< ${infoEntries} >>\nendobj\n`;
  const xrefOffset = bytes.length + encoder.encode(objBlock).length;
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
