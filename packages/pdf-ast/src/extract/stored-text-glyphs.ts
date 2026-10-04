import { decodeStoredPdfString, type PdfPlacedGlyph } from "../ast.js";

export async function* glyphText(glyph: PdfPlacedGlyph, signal: AbortSignal): AsyncGenerator<string, void, void> {
  if (glyph.actualText === undefined && glyph.storedActualText) {
    yield* decodeStoredPdfString(glyph.storedActualText, signal);
  } else {
    const text = glyph.actualText ?? glyph.unicode;
    for (let at = 0; at < text.length; at += 2048) {
      if (at && at % 65536 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      signal.throwIfAborted(); yield text.slice(at, at + 2048);
    }
  }
}

export async function sameReplacement(a: PdfPlacedGlyph, b: PdfPlacedGlyph, signal: AbortSignal): Promise<boolean> {
  if (b.actualText === undefined && !b.storedActualText) return false;
  if (a.actualText !== undefined && b.actualText !== undefined) return a.actualText === b.actualText;
  const first = a.storedActualText, second = b.storedActualText;
  if (a.actualText === undefined && b.actualText === undefined && first && second
    && first.storage === second.storage && first.position === second.position && first.byteLength === second.byteLength) return true;
  const left = glyphText(a, signal), right = glyphText(b, signal);
  let x = "", y = "", i = 0, j = 0, leftDone = false, rightDone = false;
  try {
    for (;;) {
      if (i === x.length && !leftDone) { const next = await left.next(); leftDone = !!next.done; x = next.value ?? ""; i = 0; }
      if (j === y.length && !rightDone) { const next = await right.next(); rightDone = !!next.done; y = next.value ?? ""; j = 0; }
      if (leftDone || rightDone) return leftDone && rightDone;
      const count = Math.min(x.length - i, y.length - j);
      if (x.slice(i, i + count) !== y.slice(j, j + count)) return false;
      i += count; j += count;
    }
  } finally { await left.return(); await right.return(); }
}

