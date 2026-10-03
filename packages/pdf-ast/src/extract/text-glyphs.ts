import type { PdfPlacedGlyph } from "../ast.js";
import type { ExtractTextOptions } from "./text.js";

export function mergeBBox(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number]
): [number, number, number, number] {
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3]),
  ];
}

export function glyphDirection(g: PdfPlacedGlyph): {
  readonly ux: number;
  readonly uy: number;
  readonly along: number;
  readonly normal: number;
} {
  const a = g.matrix[0] ?? 1;
  const b = g.matrix[1] ?? 0;
  const len = Math.hypot(a, b) || 1;
  const ux = a / len;
  const uy = b / len;
  const px = g.matrix[4] ?? g.bbox[0];
  const py = g.matrix[5] ?? g.baselineY;
  return {
    ux,
    uy,
    along: px * ux + py * uy,
    normal: -px * uy + py * ux,
  };
}

/** Collapse adjacent ActualText runs and filter glyphs with one pending glyph. */
export class PdfTextGlyphNormalizer {
  private pending: PdfPlacedGlyph | undefined;
  constructor(private readonly options: ExtractTextOptions = {}) {}
  private visible(g: PdfPlacedGlyph): boolean {
    if (!g.unicode.length) return false;
    if (this.options.discardDiagonal) {
      const direction = glyphDirection(g);
      if (Math.abs(direction.ux) > 0.1 && Math.abs(direction.uy) > 0.1) return false;
    }
    if (this.options.clipText && g.clipRect) {
      const x = (g.bbox[0] + g.bbox[2]) / 2, y = (g.bbox[1] + g.bbox[3]) / 2;
      if (x < g.clipRect[0] || x > g.clipRect[2] || y < g.clipRect[1] || y > g.clipRect[3]) return false;
    }
    return true;
  }
  *push(g: PdfPlacedGlyph): Generator<PdfPlacedGlyph, void, void> {
    const previous = this.pending;
    if (previous && g.actualText === previous.actualText && g.mcid === previous.mcid) {
      this.pending = { ...previous, bbox: mergeBBox(previous.bbox, g.bbox), advanceWidth: previous.advanceWidth + g.advanceWidth };
      return;
    }
    yield* this.finish();
    if (g.actualText !== undefined) this.pending = { ...g, unicode: g.actualText, bbox: [...g.bbox] };
    else if (this.visible(g)) yield g;
  }
  *finish(): Generator<PdfPlacedGlyph, void, void> {
    const value = this.pending; this.pending = undefined;
    if (value && this.visible(value)) yield value;
  }
}
