import type { PdfPathSegment } from "../ast.js";
import { CFFParser, Stream, Type2Compiled, DrawOPS, getGlyphsUnicode, getDingbatsGlyphsUnicode, SymbolSetEncoding, ZapfDingbatsEncoding } from "../vendor/pdfjs-fonts.mjs";
import { STANDARD_FONT_CFF_BASE64 } from "./standard-font-data.js";
import { normalizeStandard14FontName, type Standard14FontName } from "./standard14.js";

export interface StandardFontOutlines {
  readonly defaultUnicode: ReadonlyMap<number, string>;
  getGlyphOutline(codePoint: number): PdfPathSegment[];
}

const fontCache = new Map<Standard14FontName, StandardFontOutlines>();

export function getStandardFontOutlines(name: string): StandardFontOutlines {
  const standardName = normalizeStandard14FontName(name);
  const cached = fontCache.get(standardName);
  if (cached) return cached;
  const bytes = Uint8Array.from(atob(STANDARD_FONT_CFF_BASE64[standardName]), char => char.charCodeAt(0));
  const cff = new CFFParser(new Stream(bytes), {}, false).parse();
  const unicodeByName = standardName === "ZapfDingbats" ? getDingbatsGlyphsUnicode() : getGlyphsUnicode();
  const glyphIds = new Map<number, number>();
  const aliases = new Map<number, number>();
  cff.charset.charset.forEach((glyphName, gid) => {
    const cp = unicodeByName[glyphName];
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
  const cmap = [...glyphIds].sort(([a], [b]) => a - b).map(([cp, gid]) => ({ start: cp, end: cp, idDelta: gid - cp }));
  const renderer = new Type2Compiled({
    glyphs: cff.charStrings.objects, subrs: cff.topDict.privateDict?.subrsIndex?.objects,
    gsubrs: cff.globalSubrIndex.objects, isCFFCIDFont: cff.isCIDFont, fdSelect: cff.fdSelect, fdArray: cff.fdArray,
  }, cmap, cff.topDict.getByName("FontMatrix") ?? [0.001, 0, 0, 0.001, 0, 0]);
  const defaultUnicode = new Map<number, string>();
  const encoding = standardName === "Symbol" ? SymbolSetEncoding : standardName === "ZapfDingbats" ? ZapfDingbatsEncoding : undefined;
  encoding?.forEach((glyphName, code) => {
    const cp = unicodeByName[glyphName];
    if (cp !== undefined) defaultUnicode.set(code, String.fromCodePoint(cp));
  });
  const paths = new Map<number, PdfPathSegment[]>();
  const font: StandardFontOutlines = {
    defaultUnicode,
    getGlyphOutline(codePoint) {
      const gid = glyphIds.get(codePoint);
      if (gid === undefined) {
        if (standardName === "Symbol" || standardName === "ZapfDingbats") return [];
        const symbol = getStandardFontOutlines("Symbol").getGlyphOutline(codePoint);
        return symbol.length ? symbol : getStandardFontOutlines("ZapfDingbats").getGlyphOutline(codePoint);
      }
      const cachedPath = paths.get(gid);
      if (cachedPath) return cachedPath;
      const commands = renderer.compileGlyph(cff.charStrings.objects[gid]!, gid);
      const path: PdfPathSegment[] = [];
      for (let i = 0; i < commands.length;) {
        const op = commands[i++];
        if (op === DrawOPS.moveTo) path.push({ kind: "move", x: commands[i++]!, y: commands[i++]! });
        else if (op === DrawOPS.lineTo) path.push({ kind: "line", x: commands[i++]!, y: commands[i++]! });
        else if (op === DrawOPS.curveTo) path.push({ kind: "cubic", x1: commands[i++]!, y1: commands[i++]!, x2: commands[i++]!, y2: commands[i++]!, x: commands[i++]!, y: commands[i++]! });
        else if (op === DrawOPS.closePath) path.push({ kind: "close" });
        else throw new Error(`Unsupported PDF.js CFF path operation: ${op}`);
      }
      paths.set(gid, path);
      return path;
    },
  };
  fontCache.set(standardName, font);
  return font;
}
