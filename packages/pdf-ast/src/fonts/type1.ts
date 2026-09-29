import type { PdfPathSegment } from "../ast.js";
import { createCffGlyphRenderer, type EmbeddedCffFont } from "./cff.js";
import { CFFParser, Stream, Type1Font, getEncoding, getGlyphsUnicode, type Type1Properties } from "../vendor/pdfjs-fonts.mjs";

export function parseEmbeddedType1Font(bytes: Uint8Array, properties: Type1Properties): EmbeddedCffFont {
  const font = new Type1Font("EmbeddedType1", new Stream(bytes.slice()), properties);
  const cff = new CFFParser(new Stream(Uint8Array.from(font.data)), {}, false).parse();
  // Type1Font owns the mapping: reparsing the generated CFF charset is not
  // sufficient to preserve original glyph IDs (including its extra .notdef).
  const charset = font.getCharset();
  cff.charset.charset = charset;
  const mapping = font.getGlyphMapping(properties);
  const notdef = Math.max(0, charset.indexOf(".notdef", 1));
  const unicodeByName = getGlyphsUnicode();
  const unicodeByCode = new Map<number, string>();
  for (const [code, gid] of mapping) {
    if (charset[gid] === ".notdef") continue;
    const unicode = unicodeByName[charset[gid]!];
    if (unicode !== undefined) unicodeByCode.set(code, String.fromCodePoint(unicode));
  }
  const render = createCffGlyphRenderer(cff);
  const standardEncoding = getEncoding("StandardEncoding")!;
  const paths = new Map<number, PdfPathSegment[]>();
  return {
    unicodeByCode,
    getGlyphOutline(code) {
      const gid = mapping.get(code) || notdef;
      const cached = paths.get(gid);
      if (cached) return cached;
      let path = render(gid);
      const seac = font.seacs.get(gid);
      if (seac) {
        // PDF.js fonts.js resolves seac through StandardEncoding and transforms
        // its accent displacement with the font matrix.
        const base = charset.indexOf(standardEncoding[seac[2]!]!);
        const accent = charset.indexOf(standardEncoding[seac[3]!]!);
        if (base >= 0 && accent >= 0) {
          const m = properties.fontMatrix;
          const dx = seac[0]! * m[0]! + seac[1]! * m[2]! + m[4]!;
          const dy = seac[0]! * m[1]! + seac[1]! * m[3]! + m[5]!;
          path = [...render(base), ...render(accent).map((segment): PdfPathSegment => {
            if (segment.kind === "close") return segment;
            if (segment.kind === "cubic") return { ...segment, x: segment.x + dx, y: segment.y + dy, x1: segment.x1 + dx, y1: segment.y1 + dy, x2: segment.x2 + dx, y2: segment.y2 + dy };
            return { ...segment, x: segment.x + dx, y: segment.y + dy };
          })];
        }
      }
      paths.set(gid, path);
      return path;
    },
  };
}
