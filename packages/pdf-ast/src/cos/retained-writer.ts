import { PagedStorage } from "@poe-code/safe-fs/storage";
import { cosDict, cosNumber, cosName, type PdfCosNode } from "../ast.js";
import { PdfError } from "../errors.js";
import type { PdfIndexStorage } from "./object-index.js";
import { serializeCosNodeChunks, type SerializeCosOptions } from "./writer.js";

export interface PdfRetainedOutputObject {
  readonly objectNumber: number;
  readonly generationNumber: number;
  readonly value: PdfCosNode;
  /** Encoded bytes for a dictionary stream. Length must be known before output. */
  readonly stream?: { readonly length: number; readonly chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array> };
}
/** Pre-serialized object body (without obj/endobj). The producer owns COS
 * syntax and stream encoding; the writer validates identity and byte length. */
export interface PdfSerializedOutputObject {
  readonly objectNumber: number;
  readonly generationNumber: number;
  readonly body: { readonly length: number; readonly chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array> };
}
export function pdfOutputStreamDictionary(value: PdfCosNode, length: number) {
  if (value.kind !== "dict" || !Number.isSafeInteger(length) || length < 0) throw new PdfError("E_PARSE", "Invalid streamed PDF object");
  let hasLength = false;
  const dict = { ...value, entries: value.entries.map(entry => {
    if (entry.key.decoded !== "Length") return entry;
    hasLength = true; return { ...entry, value: cosNumber(length) };
  }) };
  if (!hasLength) dict.entries.push({ key: cosName("Length"), value: cosNumber(length) });
  return dict;
}
export interface SerializeRetainedCosOptions extends Pick<SerializeCosOptions, "rootRef" | "infoRef" | "encryptRef" | "idArray" | "version" | "maxObjects" | "maxOutputBytes" | "maxRecursionDepth"> {
  /** Object numbers are ascending unless objectOrder is provided. */
  readonly objectOrder?: "ascending" | "provided";
  /** Layout hooks run while caller staging remains writable. */
  readonly onObjectWritten?: (number: number, start: number, end: number) => void | Promise<void>;
  readonly onComplete?: (length: number, xrefOffset: number) => void | Promise<void>;
  /** Each body is released before requesting the next. */
  readonly objects: AsyncIterable<PdfRetainedOutputObject | PdfSerializedOutputObject> | Iterable<PdfRetainedOutputObject | PdfSerializedOutputObject>;
  readonly chunkBytes?: number;
  /** Cross-reference address space admitted before reserving backing slots. */
  readonly maxIndexBytes?: number;
  readonly signal?: AbortSignal;
}
function maximum(value: number | undefined, name: string): number {
  if (value === undefined || value === Infinity) return Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid ${name}`);
  return value;
}

/** Ordinary PDF serialization without an object array or resident xref Map.
 * The caller owns object order, stream encoding/encryption and publication.
 * A 64 KiB cache holds xref slots; larger indexes spill only to supplied safe-fs. */
export async function* serializeRetainedCosDocumentChunks(options: SerializeRetainedCosOptions, storage: PdfIndexStorage): AsyncGenerator<Uint8Array, void, void> {
  const signal = options.signal ?? new AbortController().signal;
  signal.throwIfAborted();
  const chunkBytes = options.chunkBytes ?? 65536;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1) throw new RangeError("Invalid chunkBytes");
  const maxOutput = maximum(options.maxOutputBytes, "maxOutputBytes"), maxObjects = maximum(options.maxObjects, "maxObjects"), maxIndex = maximum(options.maxIndexBytes, "maxIndexBytes");
  const offsets = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4);
  const base = offsets.allocate(0), encoder = new TextEncoder();
  let offset = 0, lastObject = 0, reserved = 0, failed = false, work = 0;
  function* emit(bytes: Uint8Array): Generator<Uint8Array, void, void> {
    if (bytes.length > maxOutput - offset) throw new PdfError("E_LIMIT", "PDF output byte limit exceeded");
    for (let at = 0; at < bytes.length; at += chunkBytes) {
      signal.throwIfAborted(); const owned = bytes.slice(at, at + chunkBytes); offset += owned.length; yield owned;
    }
  }
  function* node(value: PdfCosNode): Generator<Uint8Array, void, void> {
    for (const bytes of serializeCosNodeChunks(value, { chunkBytes, maxOutputBytes: maxOutput - offset, maxRecursionDepth: options.maxRecursionDepth ?? Infinity, signal })) yield* emit(bytes);
  }
  try {
    yield* emit(encoder.encode(`%PDF-${options.version ?? "1.7"}\n%\x81\x81\x81\x81\n\n`));
    for await (const object of options.objects) {
      signal.throwIfAborted(); if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      const number = object.objectNumber, generation = object.generationNumber;
      if (!Number.isSafeInteger(number) || (number < 1 || (options.objectOrder !== "provided" && number <= lastObject)) || !Number.isSafeInteger(generation) || generation < 0 || generation > 65535) throw new PdfError("E_PARSE", "Invalid or unordered PDF output identity");
      if (number > maxObjects) throw new PdfError("E_LIMIT", "PDF largest object number exceeds limit");
      const required = (number + 1) * 16;
      if (!Number.isSafeInteger(required) || required > maxIndex) throw new PdfError("E_LIMIT", "PDF cross-reference storage limit exceeded");
      if (required > reserved) { offsets.allocate(required - reserved); reserved = required; }
      if (options.objectOrder === "provided") {
        const previous = await offsets.read(base + number * 16, 8);
        if (new DataView(previous.buffer, previous.byteOffset, previous.length).getFloat64(0)) throw new PdfError("E_PARSE", "Duplicate PDF output identity");
      }
      lastObject = Math.max(lastObject, number);
      const objectStart = offset;
      const record = new Uint8Array(16), view = new DataView(record.buffer); view.setFloat64(0, offset); view.setFloat64(8, generation);
      await offsets.write(base + number * 16, record);
      yield* emit(encoder.encode(`${number} ${generation} obj\n`));
      if ("body" in object) {
        const { length, chunks } = object.body;
        if (!Number.isSafeInteger(length) || length < 0) throw new PdfError("E_PARSE", "Invalid serialized PDF body length");
        if (length > maxOutput - offset) throw new PdfError("E_LIMIT", "PDF output byte limit exceeded");
        let written = 0;
        for await (const bytes of chunks) {
          signal.throwIfAborted(); if (bytes.length > length - written) throw new PdfError("E_PARSE", "Excess serialized PDF body bytes");
          written += bytes.length;
          for (const chunk of emit(bytes)) {
            yield chunk;
            if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
          }
          if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
        if (written !== length) throw new PdfError("E_PARSE", "Incomplete serialized PDF body bytes");
      } else if (object.stream) {
        const { length, chunks } = object.stream;
        if (object.value.kind !== "dict" || !Number.isSafeInteger(length) || length < 0) throw new PdfError("E_PARSE", "Invalid streamed PDF object");
        if (length > maxOutput - offset) throw new PdfError("E_LIMIT", "PDF output byte limit exceeded");
        const dict = pdfOutputStreamDictionary(object.value, length);
        yield* node(dict); yield* emit(encoder.encode("\nstream\n"));
        let written = 0;
        for await (const bytes of chunks) {
          signal.throwIfAborted(); if (bytes.length > length - written) throw new PdfError("E_PARSE", "Excess PDF stream bytes");
          written += bytes.length;
          for (const chunk of emit(bytes)) {
            yield chunk;
            if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
          }
          if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
        if (written !== length) throw new PdfError("E_PARSE", "Incomplete PDF stream bytes");
        yield* emit(encoder.encode("\nendstream"));
      } else yield* node(object.value);
      yield* emit(encoder.encode("\nendobj\n\n"));
      await options.onObjectWritten?.(number, objectStart, offset);
    }
    const xrefOffset = offset, size = lastObject + 1;
    yield* emit(encoder.encode(`xref\n0 ${size}\n0000000000 65535 f \n`));
    for (let number = 1; number < size; number++) {
      signal.throwIfAborted(); if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      const record = await offsets.read(base + number * 16, 16), view = new DataView(record.buffer, record.byteOffset, record.length);
      const position = view.getFloat64(0), generation = view.getFloat64(8);
      yield* emit(encoder.encode(position ? `${String(position).padStart(10, "0")} ${String(generation).padStart(5, "0")} n \n` : "0000000000 65535 f \n"));
    }
    yield* emit(encoder.encode("trailer\n"));
    yield* node(cosDict({ Size: cosNumber(size), Root: options.rootRef, Info: options.infoRef, Encrypt: options.encryptRef, ID: options.idArray }));
    yield* emit(encoder.encode(`\n\nstartxref\n${xrefOffset}\n%%EOF`));
    await options.onComplete?.(offset, xrefOffset);
  } catch (error) { failed = true; throw error; }
  finally { await offsets.close().catch(error => { if (!failed) throw error; }); }
}
