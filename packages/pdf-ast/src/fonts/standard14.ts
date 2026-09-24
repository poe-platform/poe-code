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
  Euro: "\u20ac",
  copyright: "\u00a9",
  registered: "\u00ae",
  trademark: "\u2122",
  ellipsis: "\u2026",
};

export function glyphNameToUnicode(glyphName: string): string {
  if (GLYPH_NAME_TO_UNICODE[glyphName] !== undefined) {
    return GLYPH_NAME_TO_UNICODE[glyphName]!;
  }
  if (glyphName.length === 1) {
    return glyphName;
  }
  if (glyphName.startsWith("uni") && glyphName.length === 7) {
    const cp = Number.parseInt(glyphName.slice(3), 16);
    if (Number.isFinite(cp)) return String.fromCodePoint(cp);
  }
  if (glyphName.startsWith("u") && (glyphName.length === 5 || glyphName.length === 7)) {
    const cp = Number.parseInt(glyphName.slice(1), 16);
    if (Number.isFinite(cp)) return String.fromCodePoint(cp);
  }
  return "";
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

export function normalizeStandard14FontName(rawName: string): Standard14FontName {
  const stripped = rawName.replace(/^[A-Z]{6}\+/, "");
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

export function buildFontEncodingDifferencesMap(encodingNode: PdfCosNode | undefined): Map<number, string> {
  const diffs = new Map<number, string>();
  if (!encodingNode || encodingNode.kind !== "dict") return diffs;
  const diffArray = dictGet(encodingNode as PdfCosDict, "Differences");
  if (diffArray?.kind !== "array") return diffs;
  let currentCode = 0;
  for (const item of (diffArray as PdfCosArray).items) {
    if (item.kind === "number") {
      currentCode = item.value;
    } else if (item.kind === "name") {
      const u = glyphNameToUnicode(item.decoded);
      if (u) diffs.set(currentCode, u);
      currentCode++;
    }
  }
  return diffs;
}
