import { PdfFontAllocation, type PdfFontAllocationOptions } from "./memory.js";
import { createCffGlyphRenderer } from "./cff.js";
import type { PdfPathSegment } from "../ast.js";
import { CFFParser, Stream, getGlyphsUnicode, getDingbatsGlyphsUnicode, SymbolSetEncoding, ZapfDingbatsEncoding } from "../vendor/pdfjs-fonts.mjs";
import { STANDARD_FONT_CFF_BASE64 } from "./standard-font-data.js";
import { normalizeStandard14FontName, type Standard14FontName } from "./standard14.js";

export interface StandardFontOutlines {
  readonly defaultUnicode: ReadonlyMap<number, string>;
  getGlyphOutline(codePoint: number): PdfPathSegment[];
}

const fontCache = new Map<Standard14FontName, StandardFontOutlines>();
let cachedGlyphsUnicodeMap: Record<string, number> | undefined;
let cachedDingbatsUnicodeMap: Record<string, number> | undefined;
let fontCacheEvictScheduled = false;

function scheduleFontCacheEviction(): void {
  if (fontCacheEvictScheduled) return;
  fontCacheEvictScheduled = true;
  queueMicrotask(() => {
    fontCacheEvictScheduled = false;
    fontCache.clear();
    cachedGlyphsUnicodeMap = undefined;
    cachedDingbatsUnicodeMap = undefined;
  });
}

export function getStandardFontOutlines(name: string, options: Pick<PdfFontAllocationOptions, "onAllocation"> = {}): StandardFontOutlines {
  const standardName = normalizeStandard14FontName(name);
  if (!options.onAllocation) scheduleFontCacheEviction();
  const cached = options.onAllocation ? undefined : fontCache.get(standardName);
  if (cached) return cached;
  const allocation = new PdfFontAllocation(options);
  const allocationOptions = { onAllocation: (bytes: number) => allocation.admit(bytes) };
  allocation.admit(1024 + STANDARD_FONT_CFF_BASE64[standardName].length * 3);
  const binary = atob(STANDARD_FONT_CFF_BASE64[standardName]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const cff = new CFFParser(new Stream(bytes), {}, false, allocationOptions.onAllocation).parse();
  // Include the bundled Adobe lookup table even when another caller warmed it.
  allocation.admit(1024 * 1024 + cff.charset.charset.length * 512);
  const unicodeByName = standardName === "ZapfDingbats" ? (cachedDingbatsUnicodeMap ??= getDingbatsGlyphsUnicode()) : (cachedGlyphsUnicodeMap ??= getGlyphsUnicode());
  const glyphIds = new Map<number, number>();
  const aliases = new Map<number, number>();
  cff.charset.charset.forEach((glyphName, gid) => {
    const cp = typeof glyphName === "string" ? unicodeByName[glyphName] : undefined;
    if (cp !== undefined) {
      glyphIds.set(cp, gid);
      const normalized = String.fromCodePoint(cp).normalize("NFKC");
      if ([...normalized].length === 1) aliases.set(normalized.codePointAt(0)!, gid);
      // Adobe names use the mathematical increment character for Greek Delta.
      if (glyphName === "Delta") aliases.set(0x0394, gid);
    }
  });
  for (const [codePoint, gid] of aliases) {
    if (!glyphIds.has(codePoint)) glyphIds.set(codePoint, gid);
  }
  const renderGlyph = createCffGlyphRenderer(cff, allocationOptions);
  let symbolFallback: StandardFontOutlines | undefined;
  let dingbatsFallback: StandardFontOutlines | undefined;
  const defaultUnicode = new Map<number, string>();
  const encoding = standardName === "Symbol" ? SymbolSetEncoding : standardName === "ZapfDingbats" ? ZapfDingbatsEncoding : undefined;
  encoding?.forEach((glyphName, code) => {
    const cp = unicodeByName[glyphName];
    if (cp !== undefined) defaultUnicode.set(code, String.fromCodePoint(cp));
  });
  const font: StandardFontOutlines = {
    defaultUnicode,
    getGlyphOutline(codePoint) {
      const gid = glyphIds.get(codePoint);
      if (gid === undefined) {
        if (standardName === "Symbol" || standardName === "ZapfDingbats") return [];
        const symbol = (symbolFallback ??= getStandardFontOutlines("Symbol", allocationOptions)).getGlyphOutline(codePoint);
        return symbol.length ? symbol : (dingbatsFallback ??= getStandardFontOutlines("ZapfDingbats", allocationOptions)).getGlyphOutline(codePoint);
      }
      return renderGlyph(gid);
    },
  };
  if (!options.onAllocation) fontCache.set(standardName, font);
  return font;
}
