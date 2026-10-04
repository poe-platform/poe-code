import { PagedStorage } from "@poe-code/safe-fs/storage";
import { cosArray, cosDict, cosName, cosNumber, cosRef, dictDelete, dictGet, dictSet, type PdfCosDict, type PdfCosNode, type PdfCosRef } from "../ast.js";
import { PdfMutableObjectStore } from "../cos/mutable-object-store.js";
import { PdfReferenceSet } from "../cos/reference-set.js";
import { retainedCosObjects } from "../cos/retained-objects.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import { pdfOutputStreamDictionary, serializeRetainedCosDocumentChunks } from "../cos/retained-writer.js";
import { serializeCosNodeChunks } from "../cos/writer.js";
import { PdfError } from "../errors.js";
import type { PdfRetainedDocument } from "../retained-document.js";

export interface RetainedPageRotation {
  /** Zero-based page index in the retained document. */
  readonly pageIndex: number;
  /** A safe integer multiple of 90; normalized to a quarter turn. */
  readonly degrees: number;
  readonly relative?: boolean;
}

export interface SaveRetainedDocumentOptions {
  /** Ordered edits; duplicate page selections apply cumulatively. */
  readonly rotations?: Iterable<RetainedPageRotation> | AsyncIterable<RetainedPageRotation>;
  /** Defaults to the retained input version. */
  readonly version?: string;
  /** Omit the original document identifier from the output trailer. */
  readonly omitId?: boolean;
  /** Remove document information except an existing modification date, and XMP. */
  readonly removeInfo?: boolean;
  readonly removeMetadata?: boolean;
  readonly removeStructure?: boolean;
  readonly removeAcroform?: boolean;
  readonly removePageLabels?: boolean;
  readonly maxObjects?: number;
  readonly maxPages?: number;
  readonly maxOutputBytes?: number;
  readonly maxRecursionDepth?: number;
  readonly chunkBytes?: number;
  readonly signal?: AbortSignal;
}

/** Save the complete retained graph with ordinary PdfDocument.save page-tree
 * semantics. Objects, payloads and page references use caller backing. */
export async function* saveRetainedDocumentChunks(document: PdfRetainedDocument, storage: PdfIndexStorage, options: SaveRetainedDocumentOptions = {}): AsyncGenerator<Uint8Array, void, void> {
  const signal = options.signal ?? new AbortController().signal, depthLimit = options.maxRecursionDepth ?? Infinity, maxPages = options.maxPages ?? Infinity;
  if (maxPages !== Infinity && (!Number.isSafeInteger(maxPages) || maxPages < 0)) throw new RangeError("Invalid page limit");
  if (depthLimit !== Infinity && (!Number.isSafeInteger(depthLimit) || depthLimit < 1)) throw new RangeError("Invalid save depth");
  const objects = new PdfMutableObjectStore(storage, { ...options, signal }), pages = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4);
  let infoRef = document.crossReference.infoRef;
  const pageBase = pages.allocate(0); let pageCount = 0, work = 0, failed = false;
  const resolve = async (node: PdfCosNode | undefined) => {
    const found = await document.lookup(node);
    return found?.reference ? (await objects.get(found.reference.objectNumber))?.value : found?.value;
  };
  async function checkpoint(depth = 0) {
    signal.throwIfAborted(); if (depth > depthLimit) throw new PdfError("E_LIMIT", "PDF save page inheritance depth limit exceeded");
    if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted();
  }
  async function inherited(page: PdfCosDict, ref: PdfCosRef, key: string): Promise<PdfCosNode | undefined> {
    const seen = new PdfReferenceSet(storage, Infinity, signal); let current: PdfCosDict | undefined = page, depth = 0, failed = false;
    try {
      await seen.add(ref.objectNumber);
      while (current) {
        await checkpoint(++depth); const node = dictGet(current, key); if (node) return resolve(node);
        const parent = dictGet(current, "Parent"); if (parent?.kind === "ref" && !await seen.add(parent.objectNumber)) break;
        const next = await resolve(parent); current = next?.kind === "dict" ? next : undefined;
      }
      return undefined;
    } catch (error) { failed = true; throw error; }
    finally { await seen.close().catch(error => { if (!failed) throw error; }); }
  }
  async function* references() {
    for (let i = 0; i < pageCount; i++) {
      await checkpoint(); const bytes = await pages.read(pageBase + i * 16, 16), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      yield cosRef(view.getFloat64(0), view.getFloat64(8));
    }
  }
  async function applyRotations() {
    for await (const edit of options.rotations ?? []) {
      await checkpoint();
      if (!Number.isSafeInteger(edit.pageIndex) || edit.pageIndex < 0 || edit.pageIndex >= pageCount) throw new RangeError("Page index out of bounds");
      if (!Number.isSafeInteger(edit.degrees) || edit.degrees % 90 !== 0) throw new RangeError("Page rotation must be a multiple of 90 degrees");
      const bytes = await pages.read(pageBase + edit.pageIndex * 16, 16), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      const object = (await objects.get(view.getFloat64(0)))!, dict = object.value as PdfCosDict;
      const original = await resolve(dictGet(dict, "Rotate")), normalized = original?.kind === "number" ? ((original.value % 360) + 360) % 360 : 0;
      const current = edit.relative && (normalized === 90 || normalized === 180 || normalized === 270) ? normalized : 0;
      const degrees = (current + ((edit.degrees % 360) + 360) % 360) % 360;
      dictSet(dict, "Rotate", cosNumber(degrees)); await objects.set({ ...object, value: dict });
    }
  }
  const encoder = new TextEncoder();
  async function* pageTree(dict: PdfCosDict, ref: PdfCosRef) {
    const object = (await objects.get(ref.objectNumber))!;
    if (object.stream) dict = pdfOutputStreamDictionary(dict, object.stream.length);
    let kids; for (const entry of dict.entries) if (entry.key.decoded === "Kids") kids = entry;
    yield encoder.encode("<<\n");
    for (const entry of dict.entries) {
      yield* serializeCosNodeChunks(entry.key, { chunkBytes: options.chunkBytes ?? 16384, maxRecursionDepth: depthLimit, signal }, 1); yield encoder.encode(" ");
      if (entry === kids) {
        if (pageCount && depthLimit < 2) throw new PdfError("E_LIMIT", "PDF save depth limit exceeded");
        yield encoder.encode("[ "); for await (const ref of references()) yield encoder.encode(`${ref.objectNumber} ${ref.generationNumber} R `); yield encoder.encode("]");
      } else yield* serializeCosNodeChunks(entry.value, { chunkBytes: options.chunkBytes ?? 16384, maxRecursionDepth: depthLimit, signal }, 1);
      yield encoder.encode("\n");
    }
    yield encoder.encode(">>");
    if (object.stream) { yield encoder.encode("\nstream\n"); yield* object.stream.chunks; yield encoder.encode("\nendstream"); }
  }
  try {
    for await (const object of retainedCosObjects(document, storage, { ...(options.maxObjects === undefined ? {} : { maxObjects: options.maxObjects }), ...(options.maxOutputBytes === undefined ? {} : { maxStreamBytes: options.maxOutputBytes }), signal })) await objects.set(object);
    if (options.removeInfo && infoRef) {
      const found = await document.lookup(infoRef), object = found?.reference ? await objects.get(found.reference.objectNumber) : undefined;
      if (object?.value.kind === "dict" && !object.stream) {
        const date = dictGet(object.value, "ModDate"); object.value.entries.length = 0;
        if (date) dictSet(object.value, "ModDate", date); else infoRef = undefined;
        await objects.set(object);
      }
    }
    const catalog = await resolve(document.crossReference.rootRef);
    const catalogObject = await document.lookup(document.crossReference.rootRef);
    if (catalog?.kind === "dict" && !catalogObject?.stream) {
      if (options.removeInfo || options.removeMetadata) dictDelete(catalog, "Metadata");
      if (options.removeStructure) { dictDelete(catalog, "StructTreeRoot"); dictDelete(catalog, "MarkInfo"); }
      if (options.removeAcroform) dictDelete(catalog, "AcroForm");
      if (options.removePageLabels) dictDelete(catalog, "PageLabels");
    }
    let pagesRef: PdfCosRef | undefined, pagesDict: PdfCosDict | undefined;
    if (catalog?.kind === "dict") {
      const node = dictGet(catalog, "Pages"), value = await resolve(node);
      if (node?.kind === "ref" && value?.kind === "dict") { pagesRef = node; pagesDict = value; }
      for await (const page of document.pages()) {
        await checkpoint(); if (pageCount >= maxPages) throw new PdfError("E_LIMIT", "PDF save page limit exceeded");
        const ref = page.reference ?? await objects.allocate(page.dict), dict = page.reference ? (await objects.get(ref.objectNumber))!.value as PdfCosDict : page.dict;
        const resources = await resolve(dictGet(dict, "Resources"));
        if (resources?.kind !== "dict") {
          const source = await inherited(dict, ref, "Resources"), entries = [];
          if (source?.kind === "dict") for (const entry of source.entries) {
            const value = await resolve(entry.value);
            entries.push({ key: { ...entry.key }, value: value?.kind === "dict" ? cosDict(Object.fromEntries(value.entries.map(item => [item.key.decoded, item.value]))) : entry.value });
          }
          dictSet(dict, "Resources", { kind: "dict", entries });
        }
        for (const key of ["MediaBox", "CropBox", "Rotate"]) if (!dictGet(dict, key)) { const value = await inherited(dict, ref, key); if (value) dictSet(dict, key, value); }
        await objects.set({ ...(await objects.get(ref.objectNumber))!, value: dict });
        const bytes = new Uint8Array(16), view = new DataView(bytes.buffer); view.setFloat64(0, ref.objectNumber); view.setFloat64(8, ref.generationNumber);
        await pages.write(pages.allocate(16), bytes); pageCount++;
      }
      await applyRotations();
      if (!pagesRef) { pagesDict = cosDict({ Type: cosName("Pages"), Count: cosNumber(0), Kids: cosArray([]) }); pagesRef = await objects.allocate(pagesDict); dictSet(catalog, "Pages", pagesRef); }
      for await (const ref of references()) {
        const object = (await objects.get(ref.objectNumber))!, dict = object.value as PdfCosDict;
        dictSet(dict, "Parent", pagesRef); await objects.set({ ...object, value: dict });
      }
      pagesDict = (await objects.get(pagesRef.objectNumber))!.value as PdfCosDict;
      dictSet(pagesDict, "Kids", cosArray([])); dictSet(pagesDict!, "Count", cosNumber(pageCount));
      await objects.set({ ...(await objects.get(pagesRef.objectNumber))!, value: pagesDict! });
      await objects.set({ ...(await objects.get(document.crossReference.rootRef.objectNumber))!, value: catalog });
    } else await applyRotations();
    async function* output() {
      for await (const object of objects.outputObjects()) {
        if (object.objectNumber !== pagesRef?.objectNumber) { yield object; continue; }
        let length = 0; for await (const bytes of pageTree(pagesDict!, pagesRef!)) length += bytes.length;
        yield { objectNumber: object.objectNumber, generationNumber: object.generationNumber, body: { length, chunks: pageTree(pagesDict!, pagesRef!) } };
      }
    }
    const ref = document.crossReference;
    yield* serializeRetainedCosDocumentChunks({ ...options, objects: output(), rootRef: ref.rootRef, infoRef, idArray: options.omitId ? undefined : ref.idArray, version: options.version ?? ref.version, signal }, storage);
  } catch (error) { failed = true; throw error; }
  finally { const results = await Promise.allSettled([objects.close(), pages.close()]); if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason); }
}
