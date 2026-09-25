import { dictGet, type PdfCosArray, type PdfCosDict, type PdfCosNode } from "../ast.js";

export type Standard14FontName =
  | "Helvetica"
  | "Helvetica-Bold"
  | "Helvetica-Oblique"
  | "Helvetica-BoldOblique"
  | "Times-Roman"
  | "Times-Bold"
  | "Times-Italic"
  | "Times-BoldItalic"
  | "Courier"
  | "Courier-Bold"
  | "Courier-Oblique"
  | "Courier-BoldOblique"
  | "Symbol"
  | "ZapfDingbats";

export interface Standard14FontMetrics {
  readonly name: Standard14FontName;
  readonly ascender: number;
  readonly descender: number;
  readonly capHeight: number;
  readonly defaultWidth: number;
  readonly widthsByCode: Readonly<Record<number, number>>;
}

const WIN_ANSI_HIGH_BYTES: Readonly<Record<number, number>> = {
  0x80: 0x20ac,
  0x82: 0x201a,
  0x83: 0x0192,
  0x84: 0x201e,
  0x85: 0x2026,
  0x86: 0x2020,
  0x87: 0x2021,
  0x88: 0x02c6,
  0x89: 0x2030,
  0x8a: 0x0160,
  0x8b: 0x2039,
  0x8c: 0x0152,
  0x8e: 0x017d,
  0x91: 0x2018,
  0x92: 0x2019,
  0x93: 0x201c,
  0x94: 0x201d,
  0x95: 0x2022,
  0x96: 0x2013,
  0x97: 0x2014,
  0x98: 0x02dc,
  0x99: 0x2122,
  0x9a: 0x0161,
  0x9b: 0x203a,
  0x9c: 0x0153,
  0x9e: 0x017e,
  0x9f: 0x0178,
};

const GLYPH_NAME_TO_UNICODE: Readonly<Record<string, string>> = {
  space: " ",
  exclam: "!",
  quotedbl: "\"",
  numbersign: "#",
  dollar: "$",
  percent: "%",
  ampersand: "&",
  quotesingle: "'",
  parenleft: "(",
  parenright: ")",
  asterisk: "*",
  plus: "+",
  comma: ",",
  hyphen: "-",
  minus: "\u2212",
  period: ".",
  slash: "/",
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  colon: ":",
  semicolon: ";",
  less: "<",
  equal: "=",
  greater: ">",
  question: "?",
  at: "@",
  bullet: "\u2022",
  endash: "\u2013",
  emdash: "\u2014",
  quoteleft: "\u2018",
  quoteright: "\u2019",
  quotedblleft: "\u201c",
  quotedblright: "\u201d",
  fi: "fi",
  fl: "fl",
  ff: "ff",
  ffi: "ffi",
  ffl: "ffl",
  Omega: "\u2126",
  Delta: "\u2206",
  mu: "\u00b5",
  fraction: "\u2044",
  dagger: "\u2020",
  daggerdbl: "\u2021",
  perthousand: "\u2030",
  guilsinglleft: "\u2039",
  guilsinglright: "\u203a",
  guillemotleft: "\u00ab",
  guillemotright: "\u00bb",
  OE: "\u0152",
  oe: "\u0153",
  Scaron: "\u0160",
  scaron: "\u0161",
  Ydieresis: "\u0178",
  Zcaron: "\u017d",
  zcaron: "\u017e",
  florin: "\u0192",
  circumflex: "\u02c6",
  tilde: "\u02dc",
  aacute: "\u00e1",
  agrave: "\u00e0",
  acircumflex: "\u00e2",
  adieresis: "\u00e4",
  atilde: "\u00e3",
  aring: "\u00e5",
  ae: "\u00e6",
  ccedilla: "\u00e7",
  eacute: "\u00e9",
  egrave: "\u00e8",
  ecircumflex: "\u00ea",
  edieresis: "\u00eb",
  iacute: "\u00ed",
  igrave: "\u00ec",
  icircumflex: "\u00ee",
  idieresis: "\u00ef",
  ntilde: "\u00f1",
  oacute: "\u00f3",
  ograve: "\u00f2",
  ocircumflex: "\u00f4",
  odieresis: "\u00f6",
  otilde: "\u00f5",
  oslash: "\u00f8",
  uacute: "\u00fa",
  ugrave: "\u00f9",
  ucircumflex: "\u00fb",
  udieresis: "\u00fc",
  yacute: "\u00fd",
  ydieresis: "\u00ff",
  germandbls: "\u00df",
  Euro: "\u20ac",
  copyright: "\u00a9",
  registered: "\u00ae",
  trademark: "\u2122",
  ellipsis: "\u2026",
};

const RAW_LIGATURE_PRE_NFKC: Readonly<Record<string, string>> = {
  ff: "\ufb00",
  fi: "\ufb01",
  fl: "\ufb02",
  ffi: "\ufb03",
  ffl: "\ufb04",
};

function isAsciiHexDigit(ch: number): boolean {
  return (
    (ch >= 0x30 && ch <= 0x39) ||
    (ch >= 0x41 && ch <= 0x46) ||
    (ch >= 0x61 && ch <= 0x66)
  );
}

function parseStrictHexChunk(str: string): number | undefined {
  if (str.length === 0) return undefined;
  for (let i = 0; i < str.length; i++) {
    if (!isAsciiHexDigit(str.charCodeAt(i))) return undefined;
  }
  const val = Number.parseInt(str, 16);
  return Number.isFinite(val) ? val : undefined;
}

function resolveSingleGlyphComponent(baseName: string, isVariantPass: boolean): string | undefined {
  if (baseName === ".notdef") return "";
  if (isVariantPass && RAW_LIGATURE_PRE_NFKC[baseName] !== undefined) {
    return RAW_LIGATURE_PRE_NFKC[baseName]!;
  }
  if (GLYPH_NAME_TO_UNICODE[baseName] !== undefined) {
    return GLYPH_NAME_TO_UNICODE[baseName]!;
  }
  if (baseName.length === 1) {
    return baseName;
  }
  if (baseName.startsWith("uni") && baseName.length >= 7 && (baseName.length - 3) % 4 === 0) {
    const hexPart = baseName.slice(3);
    if (hexPart === "0000") return "";
    const scalars: string[] = [];
    for (let i = 0; i + 4 <= hexPart.length && scalars.length < 8; i += 4) {
      const cp = parseStrictHexChunk(hexPart.slice(i, i + 4));
      if (cp === undefined || cp === 0 || (cp >= 0xd800 && cp <= 0xdfff)) {
        continue;
      }
      scalars.push(String.fromCodePoint(cp));
    }
    return scalars.length > 0 ? scalars.join("") : undefined;
  }
  if (baseName.startsWith("u") && baseName.length >= 5 && baseName.length <= 7) {
    const hexPart = baseName.slice(1);
    const cp = parseStrictHexChunk(hexPart);
    if (cp === undefined) return undefined;
    if (cp === 0) return "";
    if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return undefined;
    return String.fromCodePoint(cp);
  }
  return undefined;
}

export function glyphNameToUnicode(glyphName: string): string {
  const resolved = resolveGlyphNameOptional(glyphName);
  return resolved ?? "";
}

export function resolveGlyphNameOptional(glyphName: string): string | undefined {
  if (glyphName === ".notdef" || glyphName === "u0000" || glyphName === "uni0000") {
    return "";
  }
  // Pass 1: Direct lookup in Adobe Glyph List (with NFKC ligature expansion)
  if (GLYPH_NAME_TO_UNICODE[glyphName] !== undefined) {
    return GLYPH_NAME_TO_UNICODE[glyphName]!;
  }
  if (glyphName.length === 1) {
    return glyphName;
  }

  // Pass 2: Strip variant suffix (.swash, .sc, etc.) and split ligature components (_)
  const dotIdx = glyphName.indexOf(".");
  const hasDotVariant = dotIdx > 0;
  const basePart = hasDotVariant ? glyphName.slice(0, dotIdx) : glyphName;

  if (basePart.includes("_")) {
    const components = basePart.split("_");
    const out: string[] = [];
    for (const comp of components) {
      if (!comp) continue;
      const mapped = resolveSingleGlyphComponent(comp, hasDotVariant);
      if (mapped !== undefined && mapped.length > 0) {
        out.push(mapped);
      }
    }
    return out.length > 0 ? out.join("") : undefined;
  }

  return resolveSingleGlyphComponent(basePart, hasDotVariant);
}

export function decodeWinAnsiByte(code: number): string {
  const mapped = WIN_ANSI_HIGH_BYTES[code];
  if (mapped !== undefined) return String.fromCodePoint(mapped);
  if (code >= 0x20 && code <= 0xff) return String.fromCodePoint(code);
  return "";
}

export function encodeWinAnsiChar(char: string): number {
  const cp = char.codePointAt(0) ?? 0x3f;
  for (const [byteStr, mappedCp] of Object.entries(WIN_ANSI_HIGH_BYTES)) {
    if (mappedCp === cp) return Number(byteStr);
  }
  if (cp >= 0x20 && cp <= 0xff) return cp;
  return 0x3f;
}

export function encodeWinAnsiBytes(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    out.push(encodeWinAnsiChar(ch));
  }
  return Uint8Array.from(out);
}

function buildProportionalWidths(isBold: boolean, isSerif: boolean): Record<number, number> {
  const w: Record<number, number> = {};
  const base = isBold ? 610 : 556;
  for (let i = 32; i <= 255; i++) w[i] = base;
  w[32] = 278; // space
  const narrow = isBold ? 333 : 278;
  for (const ch of "iIlj!|.,:;'`") {
    w[ch.charCodeAt(0)] = narrow;
  }
  for (const ch of "()[]{}") {
    w[ch.charCodeAt(0)] = isBold ? 389 : 333;
  }
  for (const ch of "ftrJ") {
    w[ch.charCodeAt(0)] = isBold ? 389 : 333;
  }
  for (const ch of "mwMW") {
    w[ch.charCodeAt(0)] = isBold ? 944 : 833;
  }
  for (const ch of "ABCDEFGHKLNOPQRSTUVXYZ") {
    w[ch.charCodeAt(0)] = isSerif ? (isBold ? 722 : 667) : (isBold ? 722 : 667);
  }
  for (const ch of "0123456789") {
    w[ch.charCodeAt(0)] = 556;
  }
  return w;
}

function buildMonospaceWidths(): Record<number, number> {
  const w: Record<number, number> = {};
  for (let i = 0; i <= 255; i++) w[i] = 600;
  return w;
}

const HELVETICA_REGULAR = buildProportionalWidths(false, false);
const HELVETICA_BOLD = buildProportionalWidths(true, false);
const TIMES_REGULAR = buildProportionalWidths(false, true);
const TIMES_BOLD = buildProportionalWidths(true, true);
const COURIER_WIDTHS = buildMonospaceWidths();

export const STANDARD_14_FONTS: Readonly<Record<Standard14FontName, Standard14FontMetrics>> = {
  Helvetica: { name: "Helvetica", ascender: 718, descender: -207, capHeight: 718, defaultWidth: 556, widthsByCode: HELVETICA_REGULAR },
  "Helvetica-Bold": { name: "Helvetica-Bold", ascender: 718, descender: -207, capHeight: 718, defaultWidth: 610, widthsByCode: HELVETICA_BOLD },
  "Helvetica-Oblique": { name: "Helvetica-Oblique", ascender: 718, descender: -207, capHeight: 718, defaultWidth: 556, widthsByCode: HELVETICA_REGULAR },
  "Helvetica-BoldOblique": { name: "Helvetica-BoldOblique", ascender: 718, descender: -207, capHeight: 718, defaultWidth: 610, widthsByCode: HELVETICA_BOLD },
  "Times-Roman": { name: "Times-Roman", ascender: 683, descender: -217, capHeight: 662, defaultWidth: 500, widthsByCode: TIMES_REGULAR },
  "Times-Bold": { name: "Times-Bold", ascender: 683, descender: -217, capHeight: 676, defaultWidth: 556, widthsByCode: TIMES_BOLD },
  "Times-Italic": { name: "Times-Italic", ascender: 683, descender: -217, capHeight: 653, defaultWidth: 500, widthsByCode: TIMES_REGULAR },
  "Times-BoldItalic": { name: "Times-BoldItalic", ascender: 683, descender: -217, capHeight: 669, defaultWidth: 556, widthsByCode: TIMES_BOLD },
  Courier: { name: "Courier", ascender: 629, descender: -157, capHeight: 562, defaultWidth: 600, widthsByCode: COURIER_WIDTHS },
  "Courier-Bold": { name: "Courier-Bold", ascender: 629, descender: -157, capHeight: 562, defaultWidth: 600, widthsByCode: COURIER_WIDTHS },
  "Courier-Oblique": { name: "Courier-Oblique", ascender: 629, descender: -157, capHeight: 562, defaultWidth: 600, widthsByCode: COURIER_WIDTHS },
  "Courier-BoldOblique": { name: "Courier-BoldOblique", ascender: 629, descender: -157, capHeight: 562, defaultWidth: 600, widthsByCode: COURIER_WIDTHS },
  Symbol: { name: "Symbol", ascender: 693, descender: -216, capHeight: 693, defaultWidth: 500, widthsByCode: HELVETICA_REGULAR },
  ZapfDingbats: { name: "ZapfDingbats", ascender: 690, descender: -143, capHeight: 690, defaultWidth: 600, widthsByCode: COURIER_WIDTHS },
};

function stripSubsetPrefix(name: string): string {
  if (name.length >= 8 && name[6] === "+") {
    let allUpper = true;
    for (let i = 0; i < 6; i++) {
      const c = name.charCodeAt(i);
      if (c < 65 || c > 90) {
        allUpper = false;
        break;
      }
    }
    if (allUpper) return name.slice(7);
  }
  return name;
}

export function normalizeStandard14FontName(rawName: string): Standard14FontName {
  const stripped = stripSubsetPrefix(rawName);
  if (stripped in STANDARD_14_FONTS) {
    return stripped as Standard14FontName;
  }
  const lower = stripped.toLowerCase();
  if (lower.includes("courier")) {
    if (lower.includes("bold") && (lower.includes("oblique") || lower.includes("italic"))) return "Courier-BoldOblique";
    if (lower.includes("bold")) return "Courier-Bold";
    if (lower.includes("oblique") || lower.includes("italic")) return "Courier-Oblique";
    return "Courier";
  }
  if (lower.includes("times")) {
    if (lower.includes("bold") && (lower.includes("italic") || lower.includes("oblique"))) return "Times-BoldItalic";
    if (lower.includes("bold")) return "Times-Bold";
    if (lower.includes("italic") || lower.includes("oblique")) return "Times-Italic";
    return "Times-Roman";
  }
  if (lower.includes("bold") && (lower.includes("oblique") || lower.includes("italic"))) return "Helvetica-BoldOblique";
  if (lower.includes("bold")) return "Helvetica-Bold";
  if (lower.includes("oblique") || lower.includes("italic")) return "Helvetica-Oblique";
  return "Helvetica";
}

export function measureStandard14TextWidth(text: string, fontName: Standard14FontName, fontSize: number): number {
  const metrics = STANDARD_14_FONTS[fontName];
  let totalUnits = 0;
  for (const ch of text) {
    const code = encodeWinAnsiChar(ch);
    totalUnits += metrics.widthsByCode[code] ?? metrics.defaultWidth;
  }
  return (totalUnits * fontSize) / 1000;
}

function isAsciiAlpha(ch: number): boolean {
  return (ch >= 0x41 && ch <= 0x5a) || (ch >= 0x61 && ch <= 0x7a);
}

function isAsciiDigit(ch: number): boolean {
  return ch >= 0x30 && ch <= 0x39;
}

function parseDecimalNumericGlyphName(name: string): number | undefined {
  if (name.length === 0) return undefined;
  let pos = 0;
  if (name[0] === "-") {
    pos = 1;
  } else {
    let alphaCount = 0;
    while (pos < name.length && isAsciiAlpha(name.charCodeAt(pos)) && alphaCount < 2) {
      pos++;
      alphaCount++;
    }
  }
  const numStart = pos;
  while (pos < name.length && isAsciiDigit(name.charCodeAt(pos))) {
    pos++;
  }
  if (pos === numStart) return undefined;
  for (let i = pos; i < name.length; i++) {
    const c = name.charCodeAt(i);
    if (isAsciiAlpha(c) || isAsciiDigit(c)) return undefined;
  }
  const val = Number.parseInt(name.slice(name[0] === "-" ? 0 : numStart, pos), 10);
  return Number.isFinite(val) ? val : undefined;
}

function parseHexNumericGlyphName(name: string): number | undefined {
  let rest = name;
  if (rest.length === 3 && isAsciiAlpha(rest.charCodeAt(0))) {
    rest = rest.slice(1);
  }
  if (rest.length !== 2) return undefined;
  return parseStrictHexChunk(rest);
}

export function buildFontEncodingDifferencesMap(encodingNode: PdfCosNode | undefined): Map<number, string> {
  const diffs = new Map<number, string>();
  if (!encodingNode || encodingNode.kind !== "dict") return diffs;
  const diffArray = dictGet(encodingNode as PdfCosDict, "Differences");
  if (diffArray?.kind !== "array") return diffs;
  const items = (diffArray as PdfCosArray).items;
  const sequenceStarts: number[] = [];
  const glyphEntries: Array<{ code: number; name: string }> = [];
  let currentCode = 0;
  for (const item of items) {
    if (item.kind === "number") {
      currentCode = item.value;
      sequenceStarts.push(item.value);
    } else if (item.kind === "name") {
      glyphEntries.push({ code: currentCode, name: item.decoded });
      currentCode++;
    }
  }

  const startsAdmitted =
    sequenceStarts.length > 0 &&
    glyphEntries.length > 0 &&
    sequenceStarts.every((s) => Number.isInteger(s) && s >= 0 && s <= 5);

  if (startsAdmitted) {
    const allDecimal = glyphEntries.every((e) => parseDecimalNumericGlyphName(e.name) !== undefined);
    const allHex = !allDecimal && glyphEntries.every((e) => parseHexNumericGlyphName(e.name) !== undefined);
    if (allDecimal || allHex) {
      for (const entry of glyphEntries) {
        const parsed = allDecimal
          ? parseDecimalNumericGlyphName(entry.name)
          : parseHexNumericGlyphName(entry.name);
        if (parsed !== undefined && parsed > 0 && parsed <= 0x10ffff && (parsed < 0xd800 || parsed > 0xdfff)) {
          diffs.set(entry.code, String.fromCodePoint(parsed));
        } else {
          diffs.set(entry.code, "");
        }
      }
      return diffs;
    }
  }

  for (const entry of glyphEntries) {
    const u = resolveGlyphNameOptional(entry.name);
    if (u !== undefined) {
      diffs.set(entry.code, u);
    }
  }
  return diffs;
}

export function buildFontEncodingGlyphNamesMap(encodingNode: PdfCosNode | undefined): Map<number, string> {
  const names = new Map<number, string>();
  if (!encodingNode || encodingNode.kind !== "dict") return names;
  const diffArray = dictGet(encodingNode as PdfCosDict, "Differences");
  if (diffArray?.kind !== "array") return names;
  let currentCode = 0;
  for (const item of (diffArray as PdfCosArray).items) {
    if (item.kind === "number") {
      currentCode = item.value;
    } else if (item.kind === "name") {
      names.set(currentCode, item.decoded);
      currentCode++;
    }
  }
  return names;
}
