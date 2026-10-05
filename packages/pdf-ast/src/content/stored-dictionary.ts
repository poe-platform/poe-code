import { PdfNameIndex } from "../cos/name-index.js";
import { PdfObjectIndex, type PdfIndexStorage } from "../cos/object-index.js";
import type { PdfXRefEntry } from "../ast.js";
import { readStoredRecord, storedRecordMatches, writeStoredRecord } from "./stored-record.js";
import type { PdfCosDict, PdfCosNode, PdfDictEntry } from "../ast.js";
import { readStoredItems } from "./stored-record.js";

/** Preserve source order and duplicates while keeping only one entry resident. */
export async function* readPdfDictionaryEntries(dict: PdfCosDict, signal?: AbortSignal): AsyncGenerator<PdfDictEntry, void> {
  signal?.throwIfAborted();
  if (dict.storedEntries) yield* readStoredItems<PdfDictEntry>(dict.storedEntries, signal);
  else for (const entry of dict.entries) { signal?.throwIfAborted(); yield entry; }
}

/** Same last-key-wins semantics as dictGet, without collecting a retained map. */
export async function readPdfDictionaryValue(dict: PdfCosDict, key: string, signal?: AbortSignal): Promise<PdfCosNode | undefined> {
  if (dict.storedEntries) {
    const {storage, length} = dict.storedEntries;
    if (!Number.isSafeInteger(length) || length < 0) throw new RangeError("Invalid stored array length");
    let position = dict.storedEntries.position, selected = -1;
    for (let i = 0; i < length; i++) {
      if (i && i % 256 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      const record = await storedRecordMatches(storage, position, ["key", "decoded"], key, signal);
      if (record.matched) selected = position;
      position = record.next;
    }
    if (position !== -1) throw new Error("Invalid stored array terminator");
    signal?.throwIfAborted();
    return selected === -1 ? undefined : (await readStoredRecord<PdfDictEntry>(storage, selected, signal)).value.value;
  }
  let value: PdfCosNode | undefined;
  for await (const entry of readPdfDictionaryEntries(dict, signal)) if (entry.key.decoded === key) value = entry.value;
  return value;
}

/** Clone a resource map and fill missing keys from an appearance. Destination
 * duplicates keep their first insertion order and last value; source keys keep
 * their first value. External indexes replace an unbounded resident name map. */
export async function mergePdfResourceDictionaries(destination: PdfCosDict, source: PdfCosDict | undefined, indexStorage: PdfIndexStorage, signal?: AbortSignal): Promise<PdfCosDict> {
  const storage = destination.storedEntries?.storage ?? source?.storedEntries?.storage;
  if (!storage) throw new TypeError("Resource merge requires caller-backed entries");
  const names = new PdfNameIndex(indexStorage, Infinity, signal);
  let index: PdfObjectIndex | undefined, failed = false;
  async function* rows(): AsyncGenerator<PdfXRefEntry> {
    for (const [dict, replace] of [[destination, true], [source, false]] as const) {
      if (!dict) continue;
      for await (const entry of readPdfDictionaryEntries(dict, signal)) {
        const name = await names.intern(entry.key.decoded);
        if (!replace && !name.added) continue;
        const position = await writeStoredRecord(storage!, entry, -1, signal);
        yield {objectNumber: name.index, type: "uncompressed", offset: position};
      }
    }
  }
  try {
    index = await PdfObjectIndex.build(rows(), indexStorage, {duplicate: "last", runEntries: 64, chunkBytes: 2048, cacheBytes: 2048, ...(signal ? {signal} : {})});
    let position = -1, previous = -1, length = 0;
    const link = new Uint8Array(8), view = new DataView(link.buffer);
    for await (const row of index.entries(signal)) {
      if (previous !== -1) {
        view.setFloat64(0, row.offset!, true);
        await storage.write(previous, link, signal ? {signal} : undefined);
        signal?.throwIfAborted();
      } else position = row.offset!;
      previous = row.offset!;
      length++;
    }
    return {kind: "dict", entries: [], storedEntries: {storage, position, length}};
  } catch (error) { failed = true; throw error; }
  finally {
    const results = await Promise.allSettled([index?.close(), names.close()]);
    if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason);
  }
}

/** Lookup only the selected entry of a possibly indirect resource map. */
export interface PdfResourceRequest {
  readonly kind: "resource";
  readonly resources: PdfCosDict;
  readonly category: string;
  readonly name: string;
}
