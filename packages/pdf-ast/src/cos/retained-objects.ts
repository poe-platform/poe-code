import { normalizeContentChunks } from "../content/normalize.js";
import { PdfArrayCursor } from "../content/array-cursor.js";
import { PdfReferenceSet } from "./reference-set.js";
import { stageDeflatedPdf } from "./deflate-staging.js";
import { cosName, cosNumber, dictGet, dictSet } from "../ast.js";
import { decryptedPdfStreamDictionary } from "./security.js";
import { PdfError } from "../errors.js";
import type { PdfRetainedDocument } from "../retained-document.js";
import { PdfFileSource } from "../source.js";
import type { PdfIndexStorage } from "./object-index.js";
import type { PdfRetainedOutputObject } from "./retained-writer.js";

export interface PdfRetainedObjectsOptions {
  readonly normalizeContent?: boolean;
  readonly compressStreams?: boolean;
  readonly streamMode?: "preserve" | "compress" | "uncompress";
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
  let count = 0, failed = false;
  const contents = new PdfReferenceSet(storage, Infinity, signal);
  try {
    if (options.normalizeContent) for await (const page of document.pages()) {
      const content = await document.lookup(dictGet(page.dict, "Contents"), undefined, ["Contents"]);
      if (content?.stream && content.reference) await contents.add(content.reference.objectNumber);
      else if (content?.value.kind === "array") {
        const cursor = new PdfArrayCursor(content.value);
        while (true) {
          const work = cursor.next(); let step = work.next();
          while (!step.done) step = work.next(await document.readArrayItem(step.value.items, step.value.position));
          if (step.value.done) break;
          const stream = await document.lookup(step.value.value);
          if (stream?.stream && stream.reference) await contents.add(stream.reference.objectNumber);
        }
      }
    }

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
      const compress = options.streamMode === "compress" || (options.compressStreams && !options.normalizeContent && object.value.kind === "dict" && !dictGet(object.value, "Filter"));
      if ((compress || (options.streamMode && options.streamMode !== "preserve")) && object.value.kind === "dict") {
        const activeSignal = signal ?? new AbortController().signal;
        const input = document.objects.decodeStream(entry.objectNumber, generationNumber);
        const staged = compress ? await stageDeflatedPdf(input, storage, activeSignal, maxStreamBytes)
          : await PdfFileSource.fromStream(storage.fs, storage.directory, input, { signal: activeSignal, maxInputBytes: maxStreamBytes });
        let failed = false;
        try {
          const value = { ...object.value, entries: object.value.entries.filter(item => item.key.decoded !== "Filter" && item.key.decoded !== "DecodeParms" && !(options.compressStreams && item.key.decoded === "Length")) };
          if (compress) dictSet(value, "Filter", cosName("FlateDecode"));
          dictSet(value, "Length", cosNumber(staged.size));
          yield { ...identity, value, stream: { decoded: true, length: staged.size, chunks: staged.stream(0, staged.size, activeSignal) } };
        } catch (error) { failed = true; throw error; }
        finally { await staged.close().catch(error => { if (!failed) throw error; }); }
        continue;
      }
      if (options.normalizeContent && (object.decoded || await contents.has(entry.objectNumber)) && object.value.kind === "dict") {
        const input = document.objects.decodeStream(entry.objectNumber, generationNumber);
        const chunks = await contents.has(entry.objectNumber) ? normalizeContentChunks(input, storage, signal, maxStreamBytes) : input;
        const decoded = await PdfFileSource.fromStream(storage.fs, storage.directory, chunks, { ...(signal ? { signal } : {}), maxInputBytes: maxStreamBytes });
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
  } catch (error) { failed = true; throw error; }
  finally { await contents.close().catch(error => { if (!failed) throw error; }); }
}
