import { parseContentOperators } from "./operator-parser.js";
import { parseContentRangeOperators } from "./range-operator-parser.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import { PdfFileSource } from "../source.js";

function lineEndings(bytes: Uint8Array, state = { cr: false }): Uint8Array {
  const output = new Uint8Array(bytes.length);
  let length = 0;
  for (const byte of bytes) {
    if (!(state.cr && byte === 10)) output[length++] = byte === 13 ? 10 : byte;
    state.cr = byte === 13;
  }
  return output.subarray(0, length);
}

/** Inline images contain binary data, even inside otherwise textual content. */
export function normalizeContentBytes(bytes: Uint8Array): Uint8Array {
  if (!bytes.includes(13)) return bytes;
  const output = new Uint8Array(bytes.length);
  let start = 0, length = 0;
  for (const operator of parseContentOperators(bytes)) {
    if (!operator.inlineImage) continue;
    const image = operator.inlineImage, text = lineEndings(bytes.subarray(start, image.start));
    output.set(text, length); length += text.length;
    output.set(bytes.subarray(image.start, image.end), length); length += image.end - image.start;
    start = image.end;
  }
  const text = lineEndings(bytes.subarray(start)); output.set(text, length);
  return output.subarray(0, length + text.length);
}

export async function* normalizeContentChunks(input: AsyncIterable<Uint8Array>, storage: PdfIndexStorage,
  signal?: AbortSignal, maxBytes = Infinity): AsyncGenerator<Uint8Array> {
  const source = await PdfFileSource.fromStream(storage.fs, storage.directory, input, { ...(signal ? { signal } : {}), maxInputBytes: maxBytes });
  let failed = false;
  async function* text(start: number, end: number) {
    const state = { cr: false };
    for await (const bytes of source.stream(start, end - start, signal)) yield lineEndings(bytes, state);
  }
  try {
    let start = 0;
    for await (const operator of parseContentRangeOperators(source, storage, { ...(signal ? { signal } : {}) })) {
      if (!operator.inlineImage) continue;
      const image = operator.inlineImage;
      yield* text(start, image.start);
      yield* source.stream(image.start, image.end - image.start, signal);
      start = image.end;
    }
    yield* text(start, source.size);
  } catch (error) { failed = true; throw error; }
  finally { await source.close().catch(error => { if (!failed) throw error; }); }
}
