import type { PdfPlacedGlyph } from '../ast.js';

// Word geometry stays on the driver's storage. The same program serves the
// buffered SDK and the bounded-memory text index.
export type Type3Word = [first: number, end: number, left: number, right: number,
  baseline: number, size: number, used: number, next: number, line: number];
export type Type3OrderRequest =
  | { kind: 'glyph'; position: number }
  | { kind: 'read'; index: number }
  | { kind: 'write'; index: number; word: Type3Word }
  | { kind: 'emit'; first: number; end: number; lineStart: boolean; wordStart: boolean };
export type Type3OrderReply = { glyph: PdfPlacedGlyph; next: number } | Type3Word | undefined;

/** Poppler's word pool: start at the leftmost word in the first four baseline
 * buckets, then extend through nearby baselines until spacing or overlap stops
 * the line. Explicit spaces end source words even when their advance is zero. */
export function* type3WordOrder(first: number, fixedPitch?: number): Generator<Type3OrderRequest, void, Type3OrderReply> {
  function* read(index: number): Generator<Type3OrderRequest, Type3Word, Type3OrderReply> {
    return (yield { kind: 'read', index }) as Type3Word;
  }
  let count = 0, word: Type3Word | undefined, previous: PdfPlacedGlyph | undefined;
  let prior: PdfPlacedGlyph | undefined, right = 0;
  for (let position = first; position !== -1;) {
    const { glyph, next } = (yield { kind: 'glyph', position }) as { glyph: PdfPlacedGlyph; next: number };
    const x = prior && prior.baselineY === glyph.baselineY ? right + (glyph.matrix[4] - (prior.matrix[4] + prior.advanceWidth)) : glyph.matrix[4];
    right = x + (glyph.type3AdvanceWidth ?? glyph.advanceWidth); prior = glyph;
    const space = glyph.unicode === ' ' || glyph.unicode === '\t';
    const size = glyph.type3FontSize ?? glyph.fontSize;
    const gap = previous ? glyph.matrix[4] - previous.matrix[4] - previous.advanceWidth : 0;
    if (word && (space || Math.abs(glyph.baselineY - word[4]) > 0.5 || gap > size * 0.1 || gap < -size * 0.2)) {
      yield { kind: 'write', index: count++, word }; word = undefined;
    }
    if (!space) {
      word ??= [position, next, x, x, glyph.baselineY, size, 0, -1, -1];
      word[1] = next; word[3] = right;
    }
    previous = space ? undefined : glyph; position = next;
  }
  if (word) yield { kind: 'write', index: count++, word };
  let remaining = count;
  while (remaining) {
    let bucket = Infinity;
    for (let i = 0; i < count; i++) { const w = yield* read(i); if (!w[6]) bucket = Math.min(bucket, Math.floor(-w[4] / 4)); }
    let start = -1, left = Infinity;
    for (let i = 0; i < count; i++) {
      const w = yield* read(i);
      if (!w[6] && Math.floor(-w[4] / 4) < bucket + 4 && w[2] < left) { start = i; left = w[2]; }
    }
    const initial = yield* read(start); let last = start;
    initial[6] = 1; initial[8] = start; remaining--;
    yield { kind: 'write', index: start, word: initial };
    while (true) {
      const tail = yield* read(last); let best = -1, bestLeft = Infinity, overlap = false;
      for (let i = 0; i < count; i++) {
        const w = yield* read(i);
        if (w[6] || Math.abs(w[4] - initial[4]) > initial[5] * 0.5) continue;
        const gap = w[2] - tail[3];
        if (gap < -initial[5] * 0.5) { overlap = true; break; }
        if (gap < (fixedPitch ?? initial[5] * 1.5) && (w[2] < bestLeft || (w[2] === bestLeft && best !== -1 && w[4] > (yield* read(best))[4]))) { best = i; bestLeft = w[2]; }
      }
      if (overlap || best === -1) break;
      tail[7] = best; yield { kind: 'write', index: last, word: tail };
      const w = yield* read(best); w[6] = 1; remaining--;
      yield { kind: 'write', index: best, word: w }; last = best;
    }
  }
  // Line construction can start with a subscript; emit in baseline/left order.
  while (true) {
    let start = -1, top = -Infinity, left = Infinity;
    for (let i = 0; i < count; i++) {
      const w = yield* read(i);
      if (w[8] === i && (w[4] > top || (w[4] === top && w[2] < left))) { start = i; top = w[4]; left = w[2]; }
    }
    if (start === -1) break;
    let previousRight = 0, lineStart = true;
    const initial = yield* read(start);
    for (let i = start; i !== -1;) {
      const w = yield* read(i);
      yield { kind: 'emit', first: w[0], end: w[1], lineStart, wordStart: lineStart || w[2] - previousRight >= initial[5] * 0.03 };
      previousRight = w[3]; lineStart = false; w[8] = -1;
      yield { kind: 'write', index: i, word: w }; i = w[7];
    }
  }
}
