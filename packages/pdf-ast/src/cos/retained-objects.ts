import { cosNumber, dictSet } from "../ast.js";
import { decryptedPdfStreamDictionary } from "./security.js";
import { PdfError } from "../errors.js";
import type { PdfRetainedDocument } from "../retained-document.js";
import { PdfFileSource } from "../source.js";
import type { PdfIndexStorage } from "./object-index.js";
import type { PdfRetainedOutputObject } from "./retained-writer.js";

export interface PdfRetainedObjectsOptions {
  readonly normalizeContent?: boolean;
  /** Number of live indirect objects admitted before parsing their values. */
  readonly maxObjects?: number;
  /** Encoded output payload bytes per stream, after decryption. */
  readonly maxStreamBytes?: number;
  readonly signal?: AbortSignal;
}
function limit(value: number | undefined): number {
  if (value === undefined || value === Infinity) return Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("Invalid retained object limit");
  return value;
}

/** Visit every live COS object in identity order, including unreachable objects.
 * Encoded payloads stream from retained input. Decrypted streams use caller
 * backing to determine their output length without retaining payload bytes.
 * Consume each stream before advancing; returning closes that stream's backing.
 * The caller keeps the document/source open and owns their lifetime. */
export async function* retainedCosObjects(document: PdfRetainedDocument, storage: PdfIndexStorage, options: PdfRetainedObjectsOptions = {}): AsyncGenerator<PdfRetainedOutputObject, void, void> {
  const maxObjects = limit(options.maxObjects), maxStreamBytes = limit(options.maxStreamBytes), signal = options.signal;
  let count = 0;
  for await (const entry of document.crossReference.index.entries(signal)) {
    signal?.throwIfAborted(); if (entry.type === "free") continue;
    if (++count > maxObjects) throw new PdfError("E_LIMIT", "PDF retained object count limit exceeded");
    if (count % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    signal?.throwIfAborted();
    const generationNumber = entry.generationNumber ?? 0, object = await document.objects.get(entry.objectNumber, generationNumber);
    signal?.throwIfAborted();
    if (!object) throw new PdfError("E_PARSE", "Missing indexed PDF object");
    const identity = { objectNumber: entry.objectNumber, generationNumber, value: object.value };
    if (!object.stream) { yield identity; continue; }
    if (options.normalizeContent && object.decoded && object.value.kind === "dict") {
      const decoded = await PdfFileSource.fromStream(storage.fs, storage.directory, document.objects.decodeStream(entry.objectNumber, generationNumber), { ...(signal ? { signal } : {}), maxInputBytes: maxStreamBytes });
      let failed = false;
      try {
        const value = { ...object.value, entries: object.value.entries.filter(item => !["Filter", "DecodeParms", "Length"].includes(item.key.decoded)) };
        dictSet(value, "Length", cosNumber(decoded.size));
        yield { ...identity, value, stream: { decoded: true, length: decoded.size, chunks: decoded.stream(0, decoded.size, signal) } };
      } catch (error) { failed = true; throw error; }
      finally { await decoded.close().catch(error => { if (!failed) throw error; }); }
      continue;
    }
    const encodedLength = object.stream.end - object.stream.start;
    if (!document.encryption && encodedLength > maxStreamBytes) throw new PdfError("E_LIMIT", "PDF retained stream byte limit exceeded");
    const decoded = document.objects.decodeStream(entry.objectNumber, generationNumber, { raw: true });
    let staged: PdfFileSource | undefined, failed = false;
    async function* chunks() {
      let work = 0;
      for await (const bytes of decoded) {
        if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
        signal?.throwIfAborted(); yield bytes; signal?.throwIfAborted();
      }
    }
    const checked = chunks();
    try {
      if (document.encryption) {
        staged = await PdfFileSource.fromStream(storage.fs, storage.directory, checked, { ...(signal ? { signal } : {}), maxInputBytes: maxStreamBytes });
        if (identity.value.kind !== "dict") throw new PdfError("E_PARSE", "Expected a retained stream dictionary");
        const value = await decryptedPdfStreamDictionary(document.encryption, entry.objectNumber, identity.value, staged.size,
          async node => node?.kind === "ref" ? (await document.lookup(node))?.value : node);
        yield { ...identity, value, stream: { length: staged.size, chunks: staged.stream(0, staged.size, signal) } };
      } else yield { ...identity, stream: { ...(object.decoded ? { decoded: true } : {}), length: encodedLength, chunks: checked } };
    } catch (error) { failed = true; throw error; }
    finally {
      const results = await Promise.allSettled([checked.return(undefined), decoded.return(undefined), staged?.close()]);
      if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason);
    }
  }
}
