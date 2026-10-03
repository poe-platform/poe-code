import type { PdfPlacedGlyph } from "../ast.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import { PdfError } from "../errors.js";
import { PdfFileSource } from "../source.js";
import { PdfStagingStorage } from "../staging-budget.js";
import { glyphDirection, PdfTextGlyphNormalizer } from "./text-glyphs.js";
import type { ExtractTextOptions } from "./text.js";

export interface PdfRawTextOptions extends Omit<ExtractTextOptions, "mode"> {
  readonly chunkBytes?: number;
  readonly maxStagingBytes?: number;
  /** Fixed streaming scratch; input glyphs remain owned by their producer. */
  readonly maxWorkingBytes?: number;
  readonly onAllocation?: (bytes: number) => void;
  readonly signal?: AbortSignal;
}
interface Line { baseline: number; left: number; fontSize: number; prefix: string; first: number }
function paragraph(line: Line): boolean {
  return !(line.fontSize >= 15) && !line.prefix.startsWith("•")
    && !((line.prefix.startsWith("-") || line.prefix.startsWith("*")) && (line.prefix[1] === " " || line.prefix[1] === "\t"));
}
/** Preserve raw-mode formatting while staging one line at a time on caller
 * storage. Final line geometry decides paragraph separation, so no line text
 * is retained in memory while its geometry is still being accumulated. */
export async function* streamRawTextChunks(glyphs: AsyncIterable<PdfPlacedGlyph> | Iterable<PdfPlacedGlyph>,
  storage: PdfIndexStorage, options: PdfRawTextOptions = {}): AsyncGenerator<Uint8Array, void, void> {
  const chunkBytes = options.chunkBytes ?? 4096, maximum = options.maxWorkingBytes ?? Infinity;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 8) throw new RangeError("chunkBytes must be at least 8");
  if (maximum !== Infinity && (!Number.isSafeInteger(maximum) || maximum < 0)) throw new RangeError("Invalid maxWorkingBytes");
  const scratch = chunkBytes * 8 + 4096;
  if (!Number.isSafeInteger(scratch) || scratch > maximum) throw new PdfError("E_LIMIT", "PDF raw text working byte limit exceeded");
  options.signal?.throwIfAborted(); options.onAllocation?.(scratch);
  const shared = new PdfStagingStorage(storage, options.maxStagingBytes);
  const input = (async function* () {
    const normalizer = new PdfTextGlyphNormalizer(options);
    const upstream = Symbol.asyncIterator in glyphs ? glyphs[Symbol.asyncIterator]() : glyphs[Symbol.iterator]();
    let failed = false;
    try {
      while (true) {
        options.signal?.throwIfAborted();
        const next = await upstream.next(); if (next.done) break;
        yield* normalizer.push(next.value);
      }
      yield* normalizer.finish();
    } catch (error) { failed = true; throw error; }
    finally { try { await upstream.return?.(); } catch (error) { if (!failed) await Promise.reject(error); } }
  })();
  const encoder = new TextEncoder(), buffer = new Uint8Array(chunkBytes);
  function* encode(text: string, offset = 0, limit = text.length): Generator<Uint8Array, void, void> {
    while (offset < limit) {
      let end = Math.min(limit, offset + Math.floor(chunkBytes / 3));
      if (end < limit && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff
        && text.charCodeAt(end) >= 0xdc00 && text.charCodeAt(end) <= 0xdfff) end--;
      const { read, written } = encoder.encodeInto(text.slice(offset, end), buffer);
      offset += read; yield buffer.subarray(0, written);
    }
  }
  function* emit(chunk: Uint8Array): Generator<Uint8Array, void, void> {
    options.signal?.throwIfAborted(); yield chunk;
  }
  let pending: PdfPlacedGlyph | undefined, exhausted = false, previous: Line | undefined, tail: Uint8Array | undefined;
  let failed = false;
  try {
    while (!exhausted || pending) {
      options.signal?.throwIfAborted();
      if (!pending) { const next = await input.next(); if (next.done) break; pending = next.value; }
      const reference = pending;
      const line: Line = { baseline: reference.baselineY, left: Infinity, fontSize: 12, prefix: "", first: -1 };
      async function* chunks(): AsyncGenerator<Uint8Array, void, void> {
        let wordPrevious: PdfPlacedGlyph | undefined, hasWords = false, prefixStarted = false, highSurrogate = "";
        function* text(value: string) {
          if (line.first < 0 && value.length) line.first = value.charCodeAt(0);
          if (line.prefix.length < 2) {
            const part = prefixStarted ? value : value.trimStart();
            if (part.length) { prefixStarted = true; line.prefix += part.slice(0, 2 - line.prefix.length); }
          }
          let start = 0, end = value.length;
          if (highSurrogate && value.length) {
            const first = value.charCodeAt(0);
            if (first >= 0xdc00 && first <= 0xdfff) { yield* encode(highSurrogate + value[0]!); start = 1; }
            else yield* encode(highSurrogate);
            highSurrogate = "";
          }
          if (end > start && value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff) {
            highSurrogate = value[end - 1]!; end--;
          }
          yield* encode(value, start, end);
        }
        while (pending) {
          options.signal?.throwIfAborted(); const glyph = pending; pending = undefined;
          if (glyph.unicode === " " || glyph.unicode === "\t") wordPrevious = undefined;
          else {
            if (wordPrevious) {
              const gap = glyphDirection(glyph).along - (glyphDirection(wordPrevious).along + wordPrevious.advanceWidth);
              if (gap > Math.max(wordPrevious.fontSize, glyph.fontSize) * 0.22) wordPrevious = undefined;
            }
            if (!wordPrevious) {
              if (hasWords) yield* text(" ");
              else { line.fontSize = glyph.fontSize; hasWords = true; }
            }
            line.left = Math.min(line.left, glyph.bbox[0]);
            yield* text(glyph.unicode); wordPrevious = glyph;
          }
          const next = await input.next();
          if (next.done) { exhausted = true; break; }
          pending = next.value;
          const first = glyphDirection(reference), current = glyphDirection(pending);
          if (!(first.ux * current.ux + first.uy * current.uy > 0.85
            && Math.abs(current.normal - first.normal) <= Math.max(reference.fontSize, pending.fontSize) * 0.45)) break;
        }
        if (highSurrogate) yield* encode(highSurrogate);
      }
      const source = await PdfFileSource.fromStream(shared.fs, shared.directory, chunks(), {
        chunkBytes, cacheBytes: chunkBytes, maxInputBytes: options.maxStagingBytes ?? Infinity,
        ...(options.signal ? { signal: options.signal } : {}),
      });
      let lineFailed = false;
      try {
        if (!source.size) continue;
        if (previous) {
          const gap = previous.baseline - line.baseline;
          const sameBlock = paragraph(previous) && paragraph(line) && gap > 0 && gap <= previous.fontSize * 1.9
            && Math.abs(line.left - previous.left) < previous.fontSize * 5;
          const rejoin = sameBlock && (options.rejoinHyphens ?? true) && tail?.[0] === 45 && line.first >= 97 && line.first <= 122;
          if (!rejoin) { if (tail) yield* emit(tail); yield* emit(encoder.encode(sameBlock ? "\n" : "\n\n")); }
          tail = undefined;
        }
        for await (const chunk of source.stream(0, source.size, options.signal)) {
          const last = new Uint8Array([chunk[chunk.length - 1]!]);
          if (tail) yield* emit(tail);
          if (chunk.length > 1) yield* emit(chunk.subarray(0, chunk.length - 1));
          tail = last;
        }
        previous = line;
      } catch (error) { lineFailed = true; throw error; }
      finally { await source.close().catch(error => { if (!lineFailed) throw error; }); }
    }
    if (tail) yield* emit(tail);
  } catch (error) { failed = true; throw error; }
  finally { await input.return().catch(error => { if (!failed) throw error; }); }
}
