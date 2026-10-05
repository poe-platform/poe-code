import { applyRetainedInfoUpdates, type RetainedInfoUpdate } from "./retained-info-updates.js";
export type { RetainedInfoUpdate } from "./retained-info-updates.js";
import { setRetainedBookmarks, type RetainedBookmark } from "./retained-bookmarks.js";
export type { RetainedBookmark } from "./retained-bookmarks.js";
import { appendRetainedAttachments, type RetainedAppendAttachment } from "./retained-append-attachments.js";
import { generateRetainedFormAppearances, type RetainedFormUpdate } from "./retained-form-appearances.js";
import { flattenRetainedAnnotations } from "./retained-flatten-annotations.js";
import { stampRetainedPages, type RetainedStampInput } from "./retained-stamps.js";
export type { RetainedStampInput } from "./retained-stamps.js";
import { externalizeRetainedInlineImages, type RetainedInlineImageOptions } from "./retained-inline-images.js";
export type { RetainedInlineImageOptions } from "./retained-inline-images.js";
import { pruneRetainedResources } from "./retained-resource-pruning.js";
import { flattenRetainedRotations } from "./retained-flatten-rotation.js";
import { editRetainedAttachments, type RetainedAttachmentInput } from "./retained-attachment-edits.js";
export { PdfDuplicateAttachment, type RetainedAttachmentInput } from "./retained-attachment-edits.js";
import { PdfMergeLabels, type RetainedPageLabel } from "./retained-merge-labels.js";
export type { RetainedPageLabel } from "./retained-merge-labels.js";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { cosDict, cosNumber, cosRef, dictDelete, dictGet, dictSet, type PdfCosRef } from "../ast.js";
import { PdfMutableObjectStore } from "../cos/mutable-object-store.js";
import { retainedCosObjects } from "../cos/retained-objects.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import { PdfRetainedDocument, PdfRetainedPage } from "../retained-document.js";
import { PdfError } from "../errors.js";
import type { SaveRetainedDocumentOptions } from "./retained-save.js";

export type { RetainedFormUpdate } from "./retained-form-appearances.js";

export type EditRetainedDocumentOptions = Pick<SaveRetainedDocumentOptions, "linearize" | "rotations" | "removeInfo" | "removeMetadata" | "removeStructure" | "removeAcroform" | "removePageLabels" | "maxObjects" | "maxPages" | "maxRecursionDepth" | "signal"> & { readonly formUpdates?: Iterable<RetainedFormUpdate> | AsyncIterable<RetainedFormUpdate>; readonly infoUpdates?: Iterable<RetainedInfoUpdate> | AsyncIterable<RetainedInfoUpdate>; readonly bookmarks?: Iterable<RetainedBookmark> | AsyncIterable<RetainedBookmark>; readonly appendAttachments?: AsyncIterable<RetainedAppendAttachment>; readonly attachmentPageIndex?: number; readonly stamps?: Iterable<RetainedStampInput> | AsyncIterable<RetainedStampInput>; readonly generateAppearances?: boolean; readonly flattenAnnotations?: "all" | "print" | "screen"; readonly flattenRotation?: boolean; readonly externalizeInlineImages?: RetainedInlineImageOptions; readonly removeUnreferencedResources?: boolean; readonly pageLabels?: Iterable<RetainedPageLabel> | AsyncIterable<RetainedPageLabel>; readonly removeAttachments?: Iterable<string> | AsyncIterable<string>; readonly attachmentCopies?: Iterable<RetainedAttachmentInput> | AsyncIterable<RetainedAttachmentInput>; readonly attachments?: Iterable<RetainedAttachmentInput> | AsyncIterable<RetainedAttachmentInput> };

/** Own an editable graph and logical page index on caller storage. This applies
 * edits without the stream dictionary normalization performed by PDF saving.
 * Close the result after all readers/copies have finished; the input is borrowed. */
export async function editRetainedDocument(source: PdfRetainedDocument, storage: PdfIndexStorage, options: EditRetainedDocumentOptions = {}): Promise<{ document: PdfRetainedDocument; pageCount: number; getPage(index: number): Promise<PdfRetainedPage>; close(): Promise<void> }> {
  if (options.maxPages !== undefined && options.maxPages !== Infinity && (!Number.isSafeInteger(options.maxPages) || options.maxPages < 0)) throw new RangeError("Invalid page limit");
  if (options.maxRecursionDepth !== undefined && options.maxRecursionDepth !== Infinity && (!Number.isSafeInteger(options.maxRecursionDepth) || options.maxRecursionDepth < 1)) throw new RangeError("Invalid edit depth");
  const signal = options.signal ?? new AbortController().signal;
  const store = new PdfMutableObjectStore(storage, { ...options, signal });
  const pages = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4);
  const base = pages.allocate(0); let count = 0, document: PdfRetainedDocument | undefined;
  let closing: Promise<void> | undefined;
  let infoRef = source.crossReference.infoRef, addedObjects = false;
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
  async function getPage(index: number): Promise<PdfRetainedPage> {
    signal.throwIfAborted();
    if (!Number.isSafeInteger(index) || index < 0 || index >= count) throw new RangeError("Page index out of bounds");
    const ref = await reference(index), object = await store.get(ref.objectNumber);
    if (object?.value.kind !== "dict") throw new PdfError("E_PARSE", "Expected a stored page dictionary");
    return new PdfRetainedPage(document!, index, object.value, ref);
  }
  async function* pageReferences() { for (let index = 0; index < count; index++) { signal.throwIfAborted(); yield await reference(index); } }
  try {
    for await (const object of retainedCosObjects(source, storage, { ...(options.maxObjects === undefined ? {} : { maxObjects: options.maxObjects }), signal })) await store.set(object);
    for await (const page of source.pages()) {
      signal.throwIfAborted(); if (count >= (options.maxPages ?? Infinity)) throw new PdfError("E_LIMIT", "PDF edited page limit exceeded");
      const ref = page.reference ?? await store.allocate(page.dict), bytes = new Uint8Array(16), view = new DataView(bytes.buffer);
      view.setFloat64(0, ref.objectNumber); view.setFloat64(8, ref.generationNumber); await pages.write(pages.allocate(16), bytes); count++;
    }
    const configured = { rootRef: source.crossReference.rootRef, version: source.crossReference.version, ...(source.crossReference.idArray ? { idArray: source.crossReference.idArray } : {}), signal, pageReferences,
      ...(options.maxPages === undefined ? {} : { maxPages: options.maxPages }), ...(options.maxRecursionDepth === undefined ? {} : { maxRecursionDepth: options.maxRecursionDepth }) };
    document = await PdfRetainedDocument.openStore(store, storage, { ...configured, ...(infoRef ? { infoRef } : {}) });
    if (options.infoUpdates) {
      const updated = await applyRetainedInfoUpdates(document, store, storage, count, getPage, options.infoUpdates, signal, options.maxRecursionDepth);
      infoRef = updated.infoRef;
      if (updated.idArray) configured.idArray = updated.idArray;
      await document.close();
      document = await PdfRetainedDocument.openStore(store, storage, { ...configured, ...(infoRef ? { infoRef } : {}) });
      addedObjects = true;
    }
    for await (const edit of options.rotations ?? []) {
      signal.throwIfAborted();
      if (!Number.isSafeInteger(edit.pageIndex) || edit.pageIndex < 0 || edit.pageIndex >= count) throw new RangeError("Page index out of bounds");
      if (!Number.isSafeInteger(edit.degrees) || edit.degrees % 90 !== 0) throw new RangeError("Page rotation must be a multiple of 90 degrees");
      const ref = await reference(edit.pageIndex), object = (await store.get(ref.objectNumber))!;
      if (object.value.kind !== "dict") throw new PdfError("E_PARSE", "Expected a stored page dictionary");
      const current = edit.relative ? (await new PdfRetainedPage(document, edit.pageIndex, object.value, ref).attributes()).rotation : 0;
      dictSet(object.value, "Rotate", cosNumber(((current + edit.degrees) % 360 + 360) % 360)); await store.set(object);
    }
    if (options.stamps) { await stampRetainedPages(document, store, storage, getPage, options.stamps, signal); addedObjects = true; }
    if (options.flattenRotation) { await flattenRetainedRotations(document, store, storage, signal); addedObjects = true; }
    if (options.flattenAnnotations) { await flattenRetainedAnnotations(document, store, storage, options.flattenAnnotations, signal); addedObjects = true; }
    if (options.externalizeInlineImages) { await externalizeRetainedInlineImages(document, store, storage, options.externalizeInlineImages, signal); addedObjects = true; }
    if (options.removeUnreferencedResources) await pruneRetainedResources(document, store, storage, signal);
    if (options.linearize) { await store.allocate(cosDict({ Linearized: cosNumber(1), N: cosNumber(count) })); addedObjects = true; }
    async function removeRoot(keys: readonly string[]) {
      const found = await document!.lookup(source.crossReference.rootRef);
      if (found?.value.kind !== "dict" || found.stream || !found.reference) return;
      for (const key of keys) dictDelete(found.value, key);
      await store.set({ objectNumber: found.reference.objectNumber, generationNumber: found.reference.generationNumber, value: found.value });
    }
    if (options.pageLabels !== undefined) {
      const root = await document.lookup(source.crossReference.rootRef);
      if (root?.value.kind === "dict" && !root.stream && root.reference) {
        const labels = new PdfMergeLabels(storage, signal, options.maxRecursionDepth); let failed = false;
        try {
          await labels.appendLabels(options.pageLabels);
          const output = (await labels.finish(store, root.value, true))!;
          await store.setSerializedValue(output); addedObjects = true;
          await store.set({ objectNumber: root.reference.objectNumber, generationNumber: root.reference.generationNumber, value: root.value });
        } catch (error) { failed = true; throw error; }
        finally { await labels.close().catch(error => { if (!failed) throw error; }); }
      }
    } else if (options.removePageLabels) await removeRoot(["PageLabels"]);
    if (options.bookmarks) { await setRetainedBookmarks(store, storage, source.crossReference.rootRef, count, reference, options.bookmarks, signal, options.maxRecursionDepth); addedObjects = true; }
    for await (const update of options.formUpdates ?? []) { await generateRetainedFormAppearances(document, store, storage, signal, update); addedObjects = true; }
    if (options.generateAppearances && !options.removeAcroform) { await generateRetainedFormAppearances(document, store, storage, signal); addedObjects = true; }
    if (options.removeInfo) {
      await removeRoot(["Metadata"]);
      const found = await document.lookup(infoRef);
      if (found?.value.kind === "dict" && !found.stream && found.reference) {
        const date = dictGet(found.value, "ModDate"); found.value.entries.length = 0;
        if (date) dictSet(found.value, "ModDate", date); else infoRef = undefined;
        await store.set({ objectNumber: found.reference.objectNumber, generationNumber: found.reference.generationNumber, value: found.value });
      }
    }
    if (options.removeMetadata) await removeRoot(["Metadata"]);
    if (options.removeStructure) await removeRoot(["StructTreeRoot", "MarkInfo"]);
    if (options.removeAcroform) await removeRoot(["AcroForm"]);
    if (options.attachmentCopies) {
      const copies = (async function* () { yield* options.attachmentCopies!; })(), first = await copies.next();
      if (!first.done) {
        async function* additions() { yield first.value!; yield* copies; }
        let failed = false;
        try { await editRetainedAttachments(document, store, storage, [], additions(), signal, true); addedObjects = true; }
        catch (error) { failed = true; throw error; }
        finally { await copies.return().catch(error => { if (!failed) throw error; }); }
      }
    }
    if (options.removeAttachments !== undefined || options.attachments !== undefined) {
      await editRetainedAttachments(document, store, storage, options.removeAttachments ?? [], options.attachments ?? [], signal); addedObjects = true;
    }
    if (options.appendAttachments) {
      if (options.attachmentPageIndex !== undefined && (!Number.isSafeInteger(options.attachmentPageIndex) || options.attachmentPageIndex < 0 || options.attachmentPageIndex >= count)) throw new RangeError("Attachment page index out of bounds");
      if (addedObjects) {
        await document.close();
        document = await PdfRetainedDocument.openStore(store, storage, { ...configured, ...(infoRef ? { infoRef } : {}) });
      }
      await appendRetainedAttachments(document, store, storage, options.appendAttachments, { signal, ...(options.attachmentPageIndex !== undefined ? { pageIndex: options.attachmentPageIndex } : {}) }); addedObjects = true;
    }
    if (addedObjects || infoRef !== source.crossReference.infoRef) {
      await document.close();
      document = await PdfRetainedDocument.openStore(store, storage, { ...configured, ...(infoRef ? { infoRef } : {}) });
    }
    return { document, pageCount: count, getPage, close };
  } catch (error) { await close().catch(() => {}); throw error; }
}
