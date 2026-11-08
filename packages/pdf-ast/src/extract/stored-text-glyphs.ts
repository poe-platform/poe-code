import { decodeStoredPdfString, type PdfStoredBytes, type PdfPlacedGlyph } from "../ast.js";

export type PdfTextGlyph = PdfPlacedGlyph & {readonly storedUnicode?: PdfStoredBytes;readonly storedFontName?:PdfStoredBytes};

async function* rawText(text: string, source: PdfStoredBytes | undefined, signal: AbortSignal): AsyncGenerator<string, void, void> {
  signal.throwIfAborted();
  if (source) {
    if (!Number.isSafeInteger(source.position) || source.position < 0 || !Number.isSafeInteger(source.byteLength)
      || source.byteLength < 0 || source.byteLength % 2 || !Number.isSafeInteger(source.position + source.byteLength)) {
      throw new RangeError("Invalid stored glyph text range");
    }
    for (let at = 0; at < source.byteLength; at += 4096) {
      signal.throwIfAborted();
      const size = Math.min(4096, source.byteLength - at);
      const bytes = await source.storage.read(source.position + at, size, { signal });
      signal.throwIfAborted();
      if (bytes.length !== size) throw new Error("Incomplete stored glyph text");
      const view = new DataView(bytes.buffer, bytes.byteOffset, size), codes = new Uint16Array(size / 2);
      for (let i = 0; i < codes.length; i++) codes[i] = view.getUint16(i * 2);
      yield String.fromCharCode(...codes);
      if (at && at % 65536 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  } else for (let at = 0; at < text.length; at += 2048) {
    if (at && at % 65536 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    signal.throwIfAborted(); yield text.slice(at, at + 2048);
  }
}
export async function* glyphText(glyph: PdfTextGlyph, signal: AbortSignal): AsyncGenerator<string, void, void> {
  if(glyph.actualText===undefined&&glyph.storedActualText)yield* decodeStoredPdfString(glyph.storedActualText,signal);
  else yield* rawText(glyph.actualText??glyph.unicode,glyph.actualText===undefined?glyph.storedUnicode:undefined,signal);
}
export function glyphFontName(glyph:PdfTextGlyph,signal:AbortSignal):AsyncGenerator<string,void,void>{return rawText(glyph.fontName,glyph.storedFontName,signal);}

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

