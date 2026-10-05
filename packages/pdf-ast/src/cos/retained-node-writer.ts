import { cosName, cosNumber, type PdfCosDict, type PdfCosNode } from "../ast.js";
import { readRawPdfDictionaryEntries } from "../content/stored-dictionary.js";
import { readStoredItems } from "../content/stored-record.js";
import { PdfError } from "../errors.js";
import { serializeCosNodeBytes, serializeCosNodeChunks, type SerializeCosNodeOptions } from "./writer.js";

/** Serialize borrowed caller-backed values without expanding containers or
 * strings. The caller retains backing until iteration finishes. Traversal depth
 * follows maxRecursionDepth, as with the synchronous convenience writer. */
export async function* serializeRetainedCosNodeChunks(node: PdfCosNode, options: SerializeCosNodeOptions & { readonly streamLength?: number } = {}): AsyncGenerator<Uint8Array> {
  const capacity = options.chunkBytes ?? 16384, maximum = options.maxOutputBytes ?? Infinity, maxDepth = options.maxRecursionDepth ?? Infinity;
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError("Invalid PDF output chunk size");
  if (maximum !== Infinity && (!Number.isSafeInteger(maximum) || maximum < 0)) throw new RangeError("Invalid PDF output limit");
  if (maxDepth !== Infinity && (!Number.isSafeInteger(maxDepth) || maxDepth < 1)) throw new RangeError("Invalid PDF recursion limit");
  if (options.streamLength !== undefined && (node.kind !== "dict" || !Number.isSafeInteger(options.streamLength) || options.streamLength < 0)) throw new PdfError("E_PARSE", "Invalid streamed PDF object");
  const signal = options.signal, encoder = new TextEncoder(); let total = 0, work = 0;
  const limit = () => new PdfError("E_LIMIT", "PDF output byte limit exceeded");
  async function checkpoint() { signal?.throwIfAborted(); if (++work % 256 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted(); } }
  async function* dictionary(value: PdfCosDict, depth: number, length?: number): AsyncGenerator<string | Uint8Array> {
    yield "<<\n"; let hasLength = false;
    for await (const entry of readRawPdfDictionaryEntries(value, signal)) {
      yield* parts(entry.key, depth + 1); yield " ";
      if (length !== undefined && entry.key.decoded === "Length") { hasLength = true; yield* parts(cosNumber(length), depth + 1); }
      else yield* parts(entry.value, depth + 1);
      yield "\n";
    }
    if (length !== undefined && !hasLength) { yield* parts(cosName("Length"), depth + 1); yield " "; yield* parts(cosNumber(length), depth + 1); yield "\n"; }
    yield ">>";
  }
  async function* parts(value: PdfCosNode, depth: number): AsyncGenerator<string | Uint8Array> {
    await checkpoint(); if (depth > maxDepth) throw new PdfError("E_LIMIT", "PDF object graph nesting depth exceeded");
    if (value.kind === "string" && value.storedBytes) {
      const source = value.storedBytes, hex = value.format === "hex";
      if (!Number.isSafeInteger(source.byteLength) || source.byteLength < 0 || !Number.isSafeInteger(source.position) || source.position < 0 || !Number.isSafeInteger(source.position + source.byteLength)) throw new RangeError("Invalid stored PDF string range");
      if (source.byteLength > (maximum - total - 2) / (hex ? 2 : 1)) throw limit();
      yield hex ? "<" : "(";
      for (let at = 0; at < source.byteLength; at += 4096) {
        await checkpoint(); const length = Math.min(4096, source.byteLength - at);
        const bytes = await source.storage.read(source.position + at, length, signal ? { signal } : undefined); signal?.throwIfAborted();
        if (bytes.length !== length) throw new Error("Incomplete stored PDF string");
        const encoded = serializeCosNodeBytes({ kind: "string", format: hex ? "hex" : "literal", bytes });
        yield encoded.subarray(1, encoded.length - 1);
      }
      yield hex ? ">" : ")";
    } else if (value.kind === "array") {
      yield "[ ";
      for await (const item of value.storedItems ? readStoredItems<PdfCosNode>(value.storedItems, signal) : value.items) { yield* parts(item, depth + 1); yield " "; }
      yield "]";
    } else if (value.kind === "dict") yield* dictionary(value, depth, depth === 0 ? options.streamLength : undefined);
    else if (value.kind === "stream") {
      if (depth + 1 > maxDepth) throw new PdfError("E_LIMIT", "PDF object graph nesting depth exceeded");
      yield* dictionary(value.dict, depth + 1, value.rawBytes.length); yield "\nstream\n"; yield value.rawBytes; yield "\nendstream";
    } else yield* serializeCosNodeChunks(value, { chunkBytes: Math.min(capacity, 4096), maxOutputBytes: maximum - total, maxRecursionDepth: maxDepth, ...(signal ? { signal } : {}) }, depth);
  }
  signal?.throwIfAborted(); let output: Uint8Array | undefined, used = 0;
  for await (const part of parts(node, 0)) {
    signal?.throwIfAborted(); const bytes = typeof part === "string" ? encoder.encode(part) : part;
    if (bytes.length > maximum - total) throw limit(); total += bytes.length;
    for (let at = 0; at < bytes.length;) {
      await checkpoint();
      output ??= new Uint8Array(Math.min(capacity, maximum));
      const length = Math.min(output.length - used, bytes.length - at); output.set(bytes.subarray(at, at + length), used); used += length; at += length;
      if (used === output.length) { yield output; output = undefined; used = 0; }
    }
  }
  if (output && used) yield output.subarray(0, used);
}
