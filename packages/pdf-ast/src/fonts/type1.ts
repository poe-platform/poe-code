import { PdfFontAllocation, type PdfFontAllocationOptions } from "./memory.js";
import type { PdfPathSegment, PdfPixelStorage } from "../ast.js";
import { createCffGlyphRenderer, type EmbeddedCffFont } from "./cff.js";
import {
  Stream,
  Type1Font,
  getEncoding,
  getGlyphsUnicode,
  type Type1Properties
} from "../vendor/pdfjs-fonts.mjs";

export function parseEmbeddedType1Font(
  bytes: Uint8Array,
  properties: Type1Properties,
  options: Pick<PdfFontAllocationOptions, "onAllocation"> = {}
): EmbeddedCffFont {
  const allocation = new PdfFontAllocation(options);
  allocation.admit(bytes.length);
  const font = new Type1Font("EmbeddedType1", new Stream(bytes.slice()), properties, (bytes) =>
    allocation.admit(bytes)
  );
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
  function* glyphParts(code: number): Generator<{ gid: number; dx: number; dy: number }> {
    const gid = mapping.get(code) || notdef;
    const seac = seacs.get(gid);
    if (seac) {
      const base = charset.indexOf(standardEncoding[seac[2]!]!);
      const accent = charset.indexOf(standardEncoding[seac[3]!]!);
      if (base >= 0 && accent >= 0) {
        const m = properties.fontMatrix;
        yield { gid: base, dx: 0, dy: 0 };
        yield {
          gid: accent,
          dx: seac[0]! * m[0]! + seac[1]! * m[2]! + m[4]!,
          dy: seac[0]! * m[1]! + seac[1]! * m[3]! + m[5]!
        };
        return;
      }
    }
    yield { gid, dx: 0, dy: 0 };
  }
  function displaced(segment: PdfPathSegment, dx: number, dy: number): PdfPathSegment {
    if (segment.kind === "close" || (dx === 0 && dy === 0)) return segment;
    if (segment.kind === "cubic")
      return {
        ...segment,
        x: segment.x + dx,
        y: segment.y + dy,
        x1: segment.x1 + dx,
        y1: segment.y1 + dy,
        x2: segment.x2 + dx,
        y2: segment.y2 + dy
      };
    return { ...segment, x: segment.x + dx, y: segment.y + dy };
  }
  function* glyphSegments(code: number): Generator<PdfPathSegment> {
    for (const { gid, dx, dy } of glyphParts(code)) {
      for (const segment of render.segments(gid)) yield displaced(segment, dx, dy);
    }
  }
  async function* storedSegments(
    code: number,
    storage: PdfPixelStorage,
    signal?: AbortSignal
  ): AsyncGenerator<PdfPathSegment> {
    for (const { gid, dx, dy } of glyphParts(code)) {
      for await (const segment of render.storedSegments(gid, storage, signal))
        yield displaced(segment, dx, dy);
    }
  }
  return {
    unicodeByCode,
    glyphSegments,
    storedSegments,
    getGlyphOutline(code) {
      const path: PdfPathSegment[] = [];
      for (const segment of glyphSegments(code)) {
        allocation.admit(128);
        path.push(segment);
      }
      return path;
    }
  };
}
