import { cosDict, cosNumber, type PdfCosArray, type PdfCosRef, type PdfXRefEntry } from "../ast.js";
import { PdfError } from "../errors.js";
import { PdfObjectIndex, type PdfIndexStorage } from "./object-index.js";
import type { PdfMutableObjectStore } from "./mutable-object-store.js";
import type { PdfOpenedObjectReader, OpenPdfObjectReaderOptions } from "./object-reader.js";
import { resolvePdfStreamDictionary } from "./filter-dictionary.js";
import { decodePdfStreamChunks, type PdfStreamDecodeOptions } from "./filter-stream.js";

export interface OpenStoredPdfOptions extends OpenPdfObjectReaderOptions {
  readonly rootRef: PdfCosRef;
  readonly infoRef?: PdfCosRef;
  readonly version?: string;
  readonly idArray?: PdfCosArray;
}

/** Index a caller-owned, already decoded object graph without serializing its
 * stream dictionaries. Keep the store alive and its identities stable until
 * the reader closes. Stream spans are relative to their individual payloads. */
export async function openStoredPdfObjectReader(store: PdfMutableObjectStore, storage: PdfIndexStorage, options: OpenStoredPdfOptions): Promise<PdfOpenedObjectReader> {
  let maximum = 0, closed = false;
  async function* identities(): AsyncGenerator<PdfXRefEntry> {
    for await (const object of store.identities()) {
      options.signal?.throwIfAborted(); maximum = Math.max(maximum, object.objectNumber);
      yield { objectNumber: object.objectNumber, generationNumber: object.generationNumber, type: "uncompressed", offset: 0 };
    }
  }
  const index = await PdfObjectIndex.build(identities(), storage, { ...options.xref?.index, ...(options.signal ? { signal: options.signal } : {}) });
  function check() { options.signal?.throwIfAborted(); if (closed) throw new PdfError("E_CAPABILITY", "Stored PDF reader is closed"); }
  function validateIdentity(number: number, generation: number) {
    if (!Number.isSafeInteger(number) || number < 0 || !Number.isSafeInteger(generation) || generation < 0) throw new RangeError("Invalid PDF object identity");
  }
  const reader: PdfOpenedObjectReader["reader"] = {
    async get(number, generation = 0) {
      check();
      validateIdentity(number, generation);
      if (number === 0) return undefined;
      const object = await store.get(number); check();
      if (!object || object.generationNumber !== generation) return undefined;
      return { objectNumber: number, generationNumber: generation, value: object.value, ...(object.stream?.decoded ? { decoded: true } : {}), span: { start: 0, end: 0 },
        ...(object.stream ? { stream: { start: 0, end: object.stream.length } } : {}) };
    },
    async *decodeStream(number, generation = 0, decodeOptions: Pick<PdfStreamDecodeOptions, "stopBeforeImageCodec" | "raw"> = {}) {
      check(); validateIdentity(number, generation);
      const object = number === 0 ? undefined : await store.get(number);
      if (object?.generationNumber !== generation || !object.stream || object.value.kind !== "dict") throw new PdfError("E_PARSE", "Expected an indexed PDF stream");
      const dict = await resolvePdfStreamDictionary(object.value, ref => reader.get(ref.objectNumber, ref.generationNumber), new Set([number]), options);
      const snapshot = object.stream;
      async function* input() {
        for await (const bytes of snapshot.chunks) { check(); yield bytes; }
      }
      yield* decodePdfStreamChunks(dict, input, { ...options, ...decodeOptions });
      check();
      if (!decodeOptions.raw && !decodeOptions.stopBeforeImageCodec) await store.markDecoded(object);
    },
    async *objectStreamEntries() {
      // Every stored graph object has its own index entry.
      check(); yield* [];
    },
    async close() { closed = true; await index.close(); },
  };
  const trailer = cosDict({ Root: options.rootRef, ...(options.idArray ? { ID: options.idArray } : {}), ...(options.infoRef ? { Info: options.infoRef } : {}), Size: cosNumber(maximum + 1) });
  return { reader, crossReference: { rootRef: options.rootRef, ...(options.idArray ? { idArray: options.idArray } : {}), ...(options.infoRef ? { infoRef: options.infoRef } : {}), version: options.version ?? "1.7", trailer, index, xrefOffset: 0, revisionCount: 0 }, close: reader.close };
}
