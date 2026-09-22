import { SyntaxReader } from "./syntax.js";
import type { PdfParseOptions, PdfObject } from "./syntax.js";
export interface PdfUnicodeSource {
  destination: Uint8Array;
  raw: Uint8Array;
  start: number;
  end: number;
}
export interface PdfUnicodeMap {
  sources: Map<string, PdfUnicodeSource>;
  mapping: Map<string, string>;
  codeSpaces: { length: number; low: number; high: number }[];
  cidMapping: Map<string, number>;
  vertical: boolean;
}
export function ascii(bytes: Uint8Array, r: SyntaxReader): string {
  r.reserve(bytes.length * 2);
  let s = "";
  for (const b of bytes) {
    r.charge();
    s += String.fromCharCode(b);
  }
  return s;
}
export function integer(bytes: Uint8Array, r: SyntaxReader): number {
  if (!bytes.length || bytes.length > 4) r.fail("SYNTAX", "invalid CMap code width");
  let n = 0;
  for (const b of bytes) {
    r.charge();
    n = n * 256 + b;
  }
  return n;
}
function utf16(bytes: Uint8Array, r: SyntaxReader): string {
  if (bytes.length % 2) r.fail("SYNTAX", "odd UTF16 destination");
  r.reserve(bytes.length * 2);
  let s = "";
  for (let i = 0; i < bytes.length; i += 2) {
    r.charge();
    const c = bytes[i]! * 256 + bytes[i + 1]!;
    if (c >= 0xd800 && c <= 0xdbff) {
      const low = (bytes[i + 2] ?? 0) * 256 + (bytes[i + 3] ?? 0);
      if (i + 3 >= bytes.length || low < 0xdc00 || low > 0xdfff)
        r.fail("SYNTAX", "invalid UTF16 surrogate");
      s += String.fromCodePoint(0x10000 + (c - 0xd800) * 1024 + low - 0xdc00);
      i += 2;
    } else if (c >= 0xdc00 && c <= 0xdfff) r.fail("SYNTAX", "invalid UTF16 surrogate");
    else s += String.fromCharCode(c);
  }
  return s;
}
export function parseMap(r: SyntaxReader, max: number): PdfUnicodeMap {
  if (!Number.isSafeInteger(max) || max < 0) r.fail("ARGUMENT", "invalid mapping limit");
  r.reserve(256);
  const result: PdfUnicodeMap = {
    sources: new Map(),
    mapping: new Map(),
    codeSpaces: [],
    cidMapping: new Map(),
    vertical: false
  };
  let previous: PdfObject | undefined;
  let beforePrevious: PdfObject | undefined;
  let entries = 0;
  const string = () => {
    const o = r.object();
    if (o.kind !== "string") r.fail("SYNTAX", "expected CMap string");
    return o.bytes!;
  };
  const add = (
    length: number,
    code: number,
    value: string,
    destination: Uint8Array,
    original: PdfObject
  ) => {
    r.charge();
    if (++entries > max) r.fail("LIMIT", "CMap mapping limit");
    r.reserve(80 + value.length * 2);
    const key = `${length}:${code}`;
    if (result.mapping.has(key)) r.fail("SYNTAX", "duplicate CMap mapping");
    result.mapping.set(key, value);
    r.reserve(100 + destination.length);
    r.charge(destination.length);
    result.sources.set(key, {
      destination: destination.slice(),
      raw: original.raw!,
      start: original.start,
      end: original.end
    });
  };
  while (r.peek().type !== "EOF") {
    const t = r.peek();
    if (t.object || t.type === "[" || t.type === "<<") {
      beforePrevious = previous;
      previous = r.object();
      continue;
    }
    r.take();
    if (t.type === "usecmap") r.fail("UNSUPPORTED", "external CMap inheritance");
    if (
      t.type === "def" &&
      beforePrevious?.kind === "name" &&
      ascii(beforePrevious.bytes!, r) === "WMode"
    ) {
      if (previous?.kind !== "number" || ![0, 1].includes(previous.value as number))
        r.fail("SYNTAX", "invalid WMode");
      result.vertical = previous.value === 1;
    }
    if (
      ![
        "beginbfchar",
        "beginbfrange",
        "begincodespacerange",
        "begincidchar",
        "begincidrange"
      ].includes(t.type)
    ) {
      previous = undefined;
      continue;
    }
    const count = previous?.value;
    if (
      previous?.kind !== "number" ||
      typeof count !== "number" ||
      !Number.isSafeInteger(count) ||
      count < 0
    )
      r.fail("SYNTAX", "invalid CMap count");
    if (count > max) r.fail("LIMIT", "CMap range limit");
    for (let i = 0; i < count; i++) {
      r.charge();
      const lowBytes = string(),
        low = integer(lowBytes, r);
      if (t.type === "begincidchar") {
        const v = r.object();
        if (
          v.kind !== "number" ||
          !Number.isSafeInteger(v.value) ||
          (v.value as number) < 0 ||
          (v.value as number) > 65535
        )
          r.fail("SYNTAX", "CMap CID");
        if (++entries > max) r.fail("LIMIT", "CMap mapping limit");
        r.reserve(80);
        const key = `${lowBytes.length}:${low}`;
        if (result.cidMapping.has(key)) r.fail("SYNTAX", "duplicate CID mapping");
        result.cidMapping.set(key, v.value as number);
        continue;
      }
      if (t.type === "beginbfchar") {
        const d = r.object();
        if (d.kind !== "string") r.fail("SYNTAX", "CMap destination");
        add(lowBytes.length, low, utf16(d.bytes!, r), d.bytes!, d);
        continue;
      }
      const highBytes = string(),
        high = integer(highBytes, r);
      if (highBytes.length !== lowBytes.length || high < low)
        r.fail("SYNTAX", "invalid CMap range");
      if (t.type === "begincodespacerange") {
        if (result.codeSpaces.length >= max) r.fail("LIMIT", "CMap code space limit");
        r.reserve(32);
        result.codeSpaces.push({ length: lowBytes.length, low, high });
        continue;
      }
      const size = high - low + 1;
      if (size > max - entries) r.fail("LIMIT", "CMap mapping limit");
      const dest = r.object();
      if (t.type === "begincidrange") {
        if (
          dest.kind !== "number" ||
          !Number.isSafeInteger(dest.value) ||
          (dest.value as number) < 0 ||
          (dest.value as number) + size - 1 > 65535
        )
          r.fail("SYNTAX", "CMap CID range");
        for (let j = 0; j < size; j++) {
          r.charge();
          r.reserve(80);
          entries++;
          const key = `${lowBytes.length}:${low + j}`;
          if (result.cidMapping.has(key)) r.fail("SYNTAX", "duplicate CID mapping");
          result.cidMapping.set(key, (dest.value as number) + j);
        }
        continue;
      }
      if (dest.kind === "array") {
        if (dest.items!.length !== size) r.fail("SYNTAX", "CMap range array length");
        for (let j = 0; j < size; j++) {
          const v = dest.items![j]!;
          if (v.kind !== "string") r.fail("SYNTAX", "CMap destination");
          add(lowBytes.length, low + j, utf16(v.bytes!, r), v.bytes!, v);
        }
      } else if (dest.kind === "string") {
        r.reserve(dest.bytes!.length);
        const b = dest.bytes!.slice();
        for (let j = 0; j < size; j++) {
          add(lowBytes.length, low + j, utf16(b, r), b, dest);
          if (j + 1 < size) {
            let k = b.length - 1;
            while (k >= 0 && b[k] === 255) {
              r.charge();
              b[k--] = 0;
            }
            if (k < 0) r.fail("SYNTAX", "CMap destination overflow");
            b[k] = b[k]! + 1;
          }
        }
      } else r.fail("SYNTAX", "CMap destination");
    }
    const end = "end" + t.type.slice(5);
    if (r.take().type !== end) r.fail("SYNTAX", "missing CMap end");
    previous = undefined;
  }
  for (let i = 0; i < result.codeSpaces.length; i++)
    for (let j = 0; j < i; j++) {
      r.charge();
      const a = result.codeSpaces[i]!,
        b = result.codeSpaces[j]!;
      // Prefix-overlapping code spaces make character boundaries ambiguous.
      const short = a.length <= b.length ? a : b,
        long = a.length <= b.length ? b : a;
      const factor = 256 ** (long.length - short.length);
      if (
        Math.floor(long.low / factor) <= short.high &&
        Math.floor(long.high / factor) >= short.low
      )
        r.fail("SYNTAX", "overlapping CMap code spaces");
    }
  return result;
}
export function parseToUnicode(
  bytes: Uint8Array,
  options: PdfParseOptions & { maxMappings?: number } = {}
): PdfUnicodeMap {
  return parseMap(new SyntaxReader(bytes, options, undefined, true), options.maxMappings ?? 65536);
}

const pdfDocSpecial: Record<number, string> = {
  24: "˘",
  25: "ˇ",
  26: "ˆ",
  27: "˙",
  28: "˝",
  29: "˛",
  30: "˚",
  31: "˜",
  128: "•",
  129: "†",
  130: "‡",
  131: "…",
  132: "—",
  133: "–",
  134: "ƒ",
  135: "⁄",
  136: "‹",
  137: "›",
  138: "−",
  139: "‰",
  140: "„",
  141: "“",
  142: "”",
  143: "‘",
  144: "’",
  145: "‚",
  146: "™",
  147: "ﬁ",
  148: "ﬂ",
  149: "Ł",
  150: "Œ",
  151: "Š",
  152: "Ÿ",
  153: "Ž",
  154: "ı",
  155: "ł",
  156: "œ",
  157: "š",
  158: "ž",
  160: "€"
};
export function metadataText(bytes: Uint8Array, r: SyntaxReader): string {
  if (bytes[0] === 254 && bytes[1] === 255) return utf16(bytes.subarray(2), r);
  if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) {
    r.charge(bytes.length);
    r.reserve(bytes.length * 2);
    try {
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(3));
    } catch {
      r.fail("SYNTAX", "invalid UTF8 ActualText");
    }
  }
  let s = "";
  r.reserve(bytes.length * 2);
  for (const b of bytes) {
    r.charge();
    if ([127, 159, 173].includes(b)) r.fail("SYNTAX", "undefined PDFDocEncoding byte");
    s += pdfDocSpecial[b] ?? String.fromCharCode(b);
  }
  return s;
}
const glyphNames: Record<string, string> = {
  space: " ",
  fi: "ﬁ",
  fl: "ﬂ",
  ffi: "ﬃ",
  ffl: "ﬄ",
  ff: "ﬀ",
  Omega: "Ω",
  Euro: "€",
  bullet: "•",
  endash: "–",
  emdash: "—",
  quoteleft: "‘",
  quoteright: "’",
  quotedblleft: "“",
  quotedblright: "”",
  minus: "−",
  period: ".",
  comma: ",",
  colon: ":",
  semicolon: ";",
  hyphen: "-",
  parenleft: "(",
  parenright: ")",
  slash: "/",
  backslash: "\\",
  ampersand: "&",
  exclam: "!",
  question: "?",
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9"
};
export function glyphName(name: string, r: SyntaxReader): string | undefined {
  r.charge(name.length);
  r.reserve(name.length * 6);
  if (name === ".notdef") return undefined;
  const base = name.split(".")[0]!;
  if (base.includes("_")) {
    let result = "";
    for (const part of base.split("_")) {
      if (!part) continue;
      const mapped = glyphName(part, r);
      if (mapped === undefined) return undefined;
      result += mapped;
    }
    return result;
  }
  if (base.length === 1 && ((base >= "A" && base <= "Z") || (base >= "a" && base <= "z")))
    return base;
  if (Object.hasOwn(glyphNames, base)) return glyphNames[base];
  const hex = (s: string): number | undefined => {
    let n = 0;
    for (const c of s) {
      r.charge();
      const v = "0123456789abcdef".indexOf(c.toLowerCase());
      if (v < 0) return undefined;
      n = n * 16 + v;
    }
    return n;
  };
  if (base.startsWith("uni") && base.length > 3 && (base.length - 3) % 4 === 0) {
    let result = "";
    for (let i = 3; i < base.length; i += 4) {
      const n = hex(base.slice(i, i + 4));
      if (n === undefined || (n >= 0xd800 && n <= 0xdfff)) return undefined;
      result += String.fromCodePoint(n);
    }
    r.reserve(result.length * 2);
    return result;
  }
  if (base.startsWith("u") && base.length >= 5 && base.length <= 7) {
    const n = hex(base.slice(1));
    if (n !== undefined && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff))
      return String.fromCodePoint(n);
  }
  return undefined;
}
export const macRoman =
  "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄¤‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ";
export const standardEncoding: Record<number, string> = {
  39: "’",
  96: "‘",
  161: "¡",
  162: "¢",
  163: "£",
  164: "⁄",
  165: "¥",
  166: "ƒ",
  167: "§",
  168: "¤",
  169: "'",
  170: "“",
  171: "«",
  172: "‹",
  173: "›",
  174: "ﬁ",
  175: "ﬂ",
  177: "–",
  178: "†",
  179: "‡",
  180: "·",
  182: "¶",
  183: "•",
  184: "‚",
  185: "„",
  186: "”",
  187: "»",
  188: "…",
  189: "‰",
  191: "¿",
  193: "`",
  194: "´",
  195: "ˆ",
  196: "˜",
  197: "¯",
  198: "˘",
  199: "˙",
  200: "¨",
  202: "˚",
  203: "¸",
  205: "˝",
  206: "˛",
  207: "ˇ",
  208: "—",
  225: "Æ",
  227: "ª",
  232: "Ł",
  233: "Ø",
  234: "Œ",
  235: "º",
  241: "æ",
  245: "ı",
  248: "ł",
  249: "ø",
  250: "œ",
  251: "ß"
};
export const winAnsi: Record<number, string> = {
  127: "•",
  129: "•",
  141: "•",
  143: "•",
  144: "•",
  157: "•",
  160: " ",
  173: "-",
  128: "€",
  130: "‚",
  131: "ƒ",
  132: "„",
  133: "…",
  134: "†",
  135: "‡",
  136: "ˆ",
  137: "‰",
  138: "Š",
  139: "‹",
  140: "Œ",
  142: "Ž",
  145: "‘",
  146: "’",
  147: "“",
  148: "”",
  149: "•",
  150: "–",
  151: "—",
  152: "˜",
  153: "™",
  154: "š",
  155: "›",
  156: "œ",
  158: "ž",
  159: "Ÿ"
};
