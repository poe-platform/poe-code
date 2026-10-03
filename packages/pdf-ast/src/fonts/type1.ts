import { PdfFontAllocation, type PdfFontAllocationOptions } from "./memory.js";
import type { PdfPathSegment } from "../ast.js";
import { createCffGlyphRenderer, type EmbeddedCffFont } from "./cff.js";
import { Stream, Type1Font, getEncoding, getGlyphsUnicode, type Type1Properties } from "../vendor/pdfjs-fonts.mjs";

export function parseEmbeddedType1Font(bytes: Uint8Array, properties: Type1Properties, options: Pick<PdfFontAllocationOptions, "onAllocation"> = {}): EmbeddedCffFont {
  const allocation = new PdfFontAllocation(options);
  allocation.admit(bytes.length);
  const font = new Type1Font("EmbeddedType1", new Stream(bytes.slice()), properties, bytes => allocation.admit(bytes));
  const cff = font.cff;
  // Type1Font owns the original mapping, including its extra .notdef glyph.
  const charset = cff.charset.charset as string[];
  const seacs = font.seacs;
  const mapping = font.getGlyphMapping(properties);
  const notdef = Math.max(0, charset.indexOf(".notdef", 1));
  const unicodeByName = getGlyphsUnicode();
  const unicodeByCode = new Map<number, string>();
  for (const [code, gid] of mapping) {
    if (charset[gid] === ".notdef") continue;
    const unicode = unicodeByName[charset[gid]!];
    if (unicode !== undefined) unicodeByCode.set(code, String.fromCodePoint(unicode));
  }
  const render = createCffGlyphRenderer(cff, options);
  const standardEncoding = getEncoding("StandardEncoding")!;
  return {
    unicodeByCode,
    getGlyphOutline(code) {
      const gid = mapping.get(code) || notdef;
      let path = render(gid);
      const seac = seacs.get(gid);
      if (seac) {
        // PDF.js fonts.js resolves seac through StandardEncoding and transforms
        // its accent displacement with the font matrix.
        const base = charset.indexOf(standardEncoding[seac[2]!]!);
        const accent = charset.indexOf(standardEncoding[seac[3]!]!);
        if (base >= 0 && accent >= 0) {
          const m = properties.fontMatrix;
          const dx = seac[0]! * m[0]! + seac[1]! * m[2]! + m[4]!;
          const dy = seac[0]! * m[1]! + seac[1]! * m[3]! + m[5]!;
          const basePath = render(base), accentPath = render(accent);
          allocation.admit(64 + (basePath.length + accentPath.length) * 128);
          path = [...basePath, ...accentPath.map((segment): PdfPathSegment => {
            if (segment.kind === "close") return segment;
            if (segment.kind === "cubic") return { ...segment, x: segment.x + dx, y: segment.y + dy, x1: segment.x1 + dx, y1: segment.y1 + dy, x2: segment.x2 + dx, y2: segment.y2 + dy };
            return { ...segment, x: segment.x + dx, y: segment.y + dy };
          })];
        }
      }
      return path;
    },
  };
}
