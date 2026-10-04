import { PagedStorage } from "@poe-code/safe-fs/storage";
import { cosNumber, cosRef, dictDelete, dictGet, dictSet, type PdfCosRef } from "../ast.js";
import { PdfMutableObjectStore } from "../cos/mutable-object-store.js";
import { retainedCosObjects } from "../cos/retained-objects.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import { PdfRetainedDocument, PdfRetainedPage } from "../retained-document.js";
import { PdfError } from "../errors.js";
import type { SaveRetainedDocumentOptions } from "./retained-save.js";

export type EditRetainedDocumentOptions = Pick<SaveRetainedDocumentOptions, "rotations" | "removeInfo" | "removeMetadata" | "removeStructure" | "removeAcroform" | "removePageLabels" | "maxObjects" | "maxPages" | "maxRecursionDepth" | "signal">;

/** Own an editable graph and logical page index on caller storage. This applies
 * edits without the stream dictionary normalization performed by PDF saving.
 * Close the result after all readers/copies have finished; the input is borrowed. */
export async function editRetainedDocument(source: PdfRetainedDocument, storage: PdfIndexStorage, options: EditRetainedDocumentOptions = {}): Promise<{ document: PdfRetainedDocument; close(): Promise<void> }> {
  if (options.maxPages !== undefined && options.maxPages !== Infinity && (!Number.isSafeInteger(options.maxPages) || options.maxPages < 0)) throw new RangeError("Invalid page limit");
  if (options.maxRecursionDepth !== undefined && options.maxRecursionDepth !== Infinity && (!Number.isSafeInteger(options.maxRecursionDepth) || options.maxRecursionDepth < 1)) throw new RangeError("Invalid edit depth");
  const signal = options.signal ?? new AbortController().signal;
  const store = new PdfMutableObjectStore(storage, { ...options, signal });
  const pages = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4);
  const base = pages.allocate(0); let count = 0, document: PdfRetainedDocument | undefined;
  let closing: Promise<void> | undefined;
  let infoRef = source.crossReference.infoRef;
  function close(): Promise<void> {
    return closing ??= (async () => {
      const results = await Promise.allSettled([document?.close(), store.close(), pages.close()]);
      for (const result of results) if (result.status === "rejected") throw result.reason;
    })();
  }
  async function reference(index: number): Promise<PdfCosRef> {
    const bytes = await pages.read(base + index * 16, 16), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    return cosRef(view.getFloat64(0), view.getFloat64(8));
  }
  async function* pageReferences() { for (let index = 0; index < count; index++) { signal.throwIfAborted(); yield await reference(index); } }
  try {
    for await (const object of retainedCosObjects(source, storage, { ...(options.maxObjects === undefined ? {} : { maxObjects: options.maxObjects }), signal })) await store.set(object);
    for await (const page of source.pages()) {
      signal.throwIfAborted(); if (count >= (options.maxPages ?? Infinity)) throw new PdfError("E_LIMIT", "PDF edited page limit exceeded");
      const ref = page.reference ?? await store.allocate(page.dict), bytes = new Uint8Array(16), view = new DataView(bytes.buffer);
      view.setFloat64(0, ref.objectNumber); view.setFloat64(8, ref.generationNumber); await pages.write(pages.allocate(16), bytes); count++;
    }
    const configured = { rootRef: source.crossReference.rootRef, version: source.crossReference.version, signal, pageReferences,
      ...(options.maxPages === undefined ? {} : { maxPages: options.maxPages }), ...(options.maxRecursionDepth === undefined ? {} : { maxRecursionDepth: options.maxRecursionDepth }) };
    document = await PdfRetainedDocument.openStore(store, storage, { ...configured, ...(infoRef ? { infoRef } : {}) });
    for await (const edit of options.rotations ?? []) {
      signal.throwIfAborted();
      if (!Number.isSafeInteger(edit.pageIndex) || edit.pageIndex < 0 || edit.pageIndex >= count) throw new RangeError("Page index out of bounds");
      if (!Number.isSafeInteger(edit.degrees) || edit.degrees % 90 !== 0) throw new RangeError("Page rotation must be a multiple of 90 degrees");
      const ref = await reference(edit.pageIndex), object = (await store.get(ref.objectNumber))!;
      if (object.value.kind !== "dict") throw new PdfError("E_PARSE", "Expected a stored page dictionary");
      const current = edit.relative ? (await new PdfRetainedPage(document, edit.pageIndex, object.value, ref).attributes()).rotation : 0;
      dictSet(object.value, "Rotate", cosNumber(((current + edit.degrees) % 360 + 360) % 360)); await store.set(object);
    }
    async function removeRoot(keys: readonly string[]) {
      const found = await document!.lookup(source.crossReference.rootRef);
      if (found?.value.kind !== "dict" || found.stream || !found.reference) return;
      for (const key of keys) dictDelete(found.value, key);
      await store.set({ objectNumber: found.reference.objectNumber, generationNumber: found.reference.generationNumber, value: found.value });
    }
    if (options.removePageLabels) await removeRoot(["PageLabels"]);
    if (options.removeInfo) {
      await removeRoot(["Metadata"]);
      const found = await document.lookup(source.crossReference.infoRef);
      if (found?.value.kind === "dict" && !found.stream && found.reference) {
        const date = dictGet(found.value, "ModDate"); found.value.entries.length = 0;
        if (date) dictSet(found.value, "ModDate", date); else infoRef = undefined;
        await store.set({ objectNumber: found.reference.objectNumber, generationNumber: found.reference.generationNumber, value: found.value });
      }
    }
    if (options.removeMetadata) await removeRoot(["Metadata"]);
    if (options.removeStructure) await removeRoot(["StructTreeRoot", "MarkInfo"]);
    if (options.removeAcroform) await removeRoot(["AcroForm"]);
    if (infoRef !== source.crossReference.infoRef) {
      await document.close();
      document = await PdfRetainedDocument.openStore(store, storage, { ...configured, ...(infoRef ? { infoRef } : {}) });
    }
    return { document, close };
  } catch (error) { await close().catch(() => {}); throw error; }
}
