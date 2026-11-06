import type { PdfPlacedGlyph } from "../ast.js";
import type { ExtractTextOptions } from "./text.js";

export type PdfTextGeometry = Pick<PdfPlacedGlyph, "matrix" | "bbox" | "baselineY" | "advanceWidth" | "fontSize">;

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

export function glyphDirection(g: PdfTextGeometry): {
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

/** Poppler assigns diagonal text to a quarter-turn axis before grouping it. */
export function textDirection(g: PdfTextGeometry) {
  const direction = glyphDirection(g);
  const diagonal = Math.abs(direction.ux) > 0.1 && Math.abs(direction.uy) > 0.1;
  if (!diagonal) return { ...direction, diagonal, advance: g.advanceWidth };
  const [a, b, c, d, x, y] = g.matrix;
  const horizontal = Math.abs(a * d) > Math.abs(b * c);
  const ux = horizontal ? (a > 0 || d < 0 ? 1 : -1) : 0;
  const uy = horizontal ? 0 : (c < 0 ? 1 : -1);
  return { ux, uy, along: x * ux + y * uy, normal: -x * uy + y * ux,
    diagonal, advance: g.advanceWidth * (direction.ux * ux + direction.uy * uy) };
}

export function sameTextLine(reference: PdfTextGeometry, current: PdfTextGeometry, raw = false): boolean {
  const a = textDirection(reference), b = textDirection(current);
  const tolerance = Math.max(reference.fontSize, current.fontSize) * (a.diagonal || b.diagonal ? 0.5 : 0.45);
  return a.ux * b.ux + a.uy * b.uy > 0.85
    && (raw && (a.diagonal || b.diagonal) ? Math.abs(b.normal - a.normal) < tolerance : Math.abs(b.normal - a.normal) <= tolerance);
}

export function textWordBreak(previous: PdfTextGeometry, current: PdfTextGeometry, raw = false, wordBreakThreshold?: number): boolean {
  const a = textDirection(previous), b = textDirection(current);
  if (wordBreakThreshold !== undefined) return b.along - a.along - a.advance > wordBreakThreshold * (previous.bbox[3] - previous.bbox[1]);
  if (raw && (a.diagonal || b.diagonal) && Math.abs(b.normal - a.normal) > 0.5) {
    // Raw output inserts spaces from the axis-aligned word edges, even for
    // vertical words; a baseline change alone only ends the internal word.
    const gap = a.uy !== 0
      ? current.matrix[4] - previous.matrix[4] - (previous.bbox[3] - previous.bbox[1])
      : current.matrix[4] - previous.matrix[4] - a.advance * a.ux;
    return Math.abs(gap) > previous.fontSize * 0.2;
  }
  return b.along - a.along - a.advance > Math.max(previous.fontSize, current.fontSize) * 0.22;
}

/** Keep orientation pools together, ordered by their left edge when diagonal
 * text is present. Four quarter-turn pools require only fixed scratch space. */
export class PdfTextGlyphOrder {
  private readonly left = new Map<number, number>();
  private diagonal = false;
  observe(glyph: PdfPlacedGlyph): void {
    const direction = textDirection(glyph), angle = Math.round(Math.atan2(direction.uy, direction.ux) / (Math.PI / 2)) & 3;
    this.diagonal ||= direction.diagonal;
    const left = direction.diagonal && direction.uy !== 0
      ? glyph.matrix[4] + (direction.uy > 0 ? glyph.baselineY - glyph.bbox[3] : glyph.bbox[1] - glyph.baselineY)
      : glyph.bbox[0];
    this.left.set(angle, Math.min(this.left.get(angle) ?? Infinity, left));
  }
  compare(a: PdfPlacedGlyph, b: PdfPlacedGlyph): number {
    const da = textDirection(a), db = textDirection(b);
    const tolerance = Math.max(a.fontSize, b.fontSize) * (da.diagonal || db.diagonal ? 0.5 : 0.45);
    if (da.ux * db.ux + da.uy * db.uy > 0.85) {
      const delta = db.normal - da.normal;
      return Math.abs(delta) > tolerance ? delta : da.along - db.along;
    }
    if (this.diagonal) {
      const aa = Math.round(Math.atan2(da.uy, da.ux) / (Math.PI / 2)) & 3, ab = Math.round(Math.atan2(db.uy, db.ux) / (Math.PI / 2)) & 3;
      return (this.left.get(aa)! - this.left.get(ab)!) || aa - ab;
    }
    const delta = b.baselineY - a.baselineY;
    return Math.abs(delta) > tolerance ? delta : a.bbox[0] - b.bbox[0];
  }
}

export function textGlyphVisible(g: PdfPlacedGlyph, options: ExtractTextOptions): boolean {
  if (!g.unicode.length) return false;
  if (options.discardInvisible && (g.renderMode === 3 || g.renderMode === 7)) return false;
  if (options.pageBounds) {
    const [x0, y0, x1, y1] = options.pageBounds;
    const x = g.matrix[4], y = g.matrix[5], direction = glyphDirection(g);
    const endX = x + direction.ux * g.advanceWidth, endY = y + direction.uy * g.advanceWidth;
    if (Math.max(x, endX) < Math.min(x0, x1) || Math.min(x, endX) > Math.max(x0, x1)
      || Math.max(y, endY) < Math.min(y0, y1) || Math.min(y, endY) > Math.max(y0, y1)) return false;
  }
  if (options.discardDiagonal) {
    const direction = glyphDirection(g);
    if (Math.abs(direction.ux) > 0.1 && Math.abs(direction.uy) > 0.1) return false;
  }
  if (options.clipText && g.clipRect) {
    const x = (g.bbox[0] + g.bbox[2]) / 2, y = (g.bbox[1] + g.bbox[3]) / 2;
    if (x < g.clipRect[0] || x > g.clipRect[2] || y < g.clipRect[1] || y > g.clipRect[3]) return false;
  }
  return true;
}

/** Collapse adjacent ActualText runs and filter glyphs with one pending glyph. */
export class PdfTextGlyphNormalizer {
  private pending: PdfPlacedGlyph | undefined;
  constructor(private readonly options: ExtractTextOptions = {}) {}
  *push(g: PdfPlacedGlyph): Generator<PdfPlacedGlyph, void, void> {
    if (g.actualText === undefined && g.storedActualText) throw new TypeError("Stored ActualText requires PdfRawTextIndex or streamRawTextChunks");
    const previous = this.pending;
    if (previous && g.actualText === previous.actualText && g.mcid === previous.mcid) {
      this.pending = { ...previous, bbox: mergeBBox(previous.bbox, g.bbox), advanceWidth: previous.advanceWidth + g.advanceWidth };
      return;
    }
    yield* this.finish();
    if (g.actualText !== undefined) this.pending = { ...g, unicode: g.actualText, bbox: [...g.bbox] };
    else if (textGlyphVisible(g, this.options)) yield g;
  }
  *finish(): Generator<PdfPlacedGlyph, void, void> {
    const value = this.pending; this.pending = undefined;
    if (value && textGlyphVisible(value, this.options)) yield value;
  }
}
