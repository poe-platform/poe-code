import { serializeLinearizedRetainedChunks } from "../cos/retained-linearization.js";
import { PdfMergeOutlines } from "./retained-merge-outlines.js";
import { PdfMergeLabels } from "./retained-merge-labels.js";
import { PdfMergeAttachments } from "./retained-merge-attachments.js";
import { IntegerTable, PagedStorage } from "@poe-code/safe-fs/storage";
import { cosArray, cosDict, cosName, cosNumber, cosRef, cosString, dictGet, dictSet, type PdfCosNode, type PdfCosDict } from "../ast.js";
import { PdfMutableObjectStore } from "../cos/mutable-object-store.js";
import { PdfReferenceSet } from "../cos/reference-set.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import { serializeCosNodeChunks } from "../cos/writer.js";
import { serializeRetainedCosDocumentChunks } from "../cos/retained-writer.js";
import { PdfFileSource } from "../source.js";
import { PdfError } from "../errors.js";
import { PdfRetainedDocument } from "../retained-document.js";

export interface CopyRetainedPageOptions {
  /** Emit streams decoded by earlier edits without their encoded filters. */
  readonly normalizeContent?: boolean;
  /** Override a source page's rotation before cloning its indirect values.
   * Return undefined to preserve the source; angles must be quarter turns. */
  readonly pageRotation?: (document: PdfRetainedDocument, index: number) => number | undefined | Promise<number | undefined>;
  /** Override copied metadata; an empty object keeps only the default producer. */
  readonly metadata?: Readonly<Record<string, string>>;
  /** Merge all source embedded files; the first occurrence of each name wins. */
  readonly includeAttachments?: boolean;
  /** Merge source page labels, offset by preceding copied pages; use with full-document selections. */
  readonly includePageLabels?: boolean;
  /** Flatten source outlines with full-document selection offsets and first-page fallback. */
  readonly includeOutlines?: boolean;
  readonly maxObjects?: number;
  readonly maxPages?: number;
  readonly maxOutputBytes?: number;
  readonly maxRecursionDepth?: number;
  readonly chunkBytes?: number;
  readonly signal?: AbortSignal;
}
export type PdfRetainedPageIndices = number | Iterable<number> | AsyncIterable<number>;
export interface PdfRetainedPageSelection {
  readonly document: PdfRetainedDocument;
  readonly indices: PdfRetainedPageIndices;
  /** Caller-owned membership for resource materialization across batches of
   * the same logical source. Keep the backing alive while copying. */
  readonly resourceState?: {
    has(index: number): boolean | Promise<boolean>;
    add(index: number): void | Promise<void>;
  };
}
export interface PdfRetainedPageCopy {
  /** Lazily open the unsaved copied graph for another retained operation. */
  openDocument(): Promise<PdfRetainedDocument>;
  chunks(): AsyncGenerator<Uint8Array, void, void>;
  close(): Promise<void>;
}

/** Consume each source completely before requesting the next. Callers may close
 * a yielded source when their source iterator resumes. Page/form lists and
 * source identities use caller backing; source dictionaries remain admitted
 * structural values. Metadata comes from the first source. */
export function createRetainedPageCopy(document: PdfRetainedDocument, indices: PdfRetainedPageIndices, storage: PdfIndexStorage, options?: CopyRetainedPageOptions): Promise<PdfRetainedPageCopy>;
export function createRetainedPageCopy(sources: Iterable<PdfRetainedPageSelection> | AsyncIterable<PdfRetainedPageSelection>, storage: PdfIndexStorage, options?: CopyRetainedPageOptions): Promise<PdfRetainedPageCopy>;
export async function createRetainedPageCopy(input: PdfRetainedDocument | Iterable<PdfRetainedPageSelection> | AsyncIterable<PdfRetainedPageSelection>,
  indicesOrStorage: PdfRetainedPageIndices | PdfIndexStorage, storageOrOptions?: PdfIndexStorage | CopyRetainedPageOptions,
  singleOptions: CopyRetainedPageOptions = {}): Promise<PdfRetainedPageCopy> {
  const single = "pages" in input;
  const storage = (single ? storageOrOptions : indicesOrStorage) as PdfIndexStorage;
  const options = single ? singleOptions : (storageOrOptions as CopyRetainedPageOptions | undefined) ?? {};
  const sources = single ? [{ document: input, indices: indicesOrStorage as PdfRetainedPageIndices }] : input;
  const maxPages = options.maxPages ?? Infinity;
  if (maxPages !== Infinity && (!Number.isSafeInteger(maxPages) || maxPages < 0)) throw new RangeError("Invalid PDF copy page limit");
  const signal = options.signal ?? new AbortController().signal, maximumDepth = options.maxRecursionDepth ?? Infinity;
  if (maximumDepth !== Infinity && (!Number.isSafeInteger(maximumDepth) || maximumDepth < 1)) throw new RangeError("Invalid PDF copy depth");
  const store = new PdfMutableObjectStore(storage, options), lists = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4);
  const attachments = options.includeAttachments ? new PdfMergeAttachments(storage, signal) : undefined;
  const labels = options.includePageLabels ? new PdfMergeLabels(storage, signal, maximumDepth) : undefined;
  const outlines = options.includeOutlines ? new PdfMergeOutlines(storage, signal, maximumDepth) : undefined;
  const pageReferences = outlines ? new IntegerTable(lists, 64) : undefined;
  const catalog = cosDict({ Type: cosName("Catalog"), Pages: cosRef(2) });
  type ReferenceList = { first: number; last: number; count: number };
  const pages: ReferenceList = { first: 0, last: 0, count: 0 }, formFields: ReferenceList = { first: 0, last: 0, count: 0 };
  let mayLinearize = false;
  let work = 0, pageCount = 0, copiedMetadata = options.metadata !== undefined, formRef: ReturnType<typeof cosRef> | undefined;
  let opened: Promise<PdfRetainedDocument> | undefined, closing: Promise<void> | undefined;
  function close(): Promise<void> {
    return closing ??= (async () => {
      const closed = await Promise.allSettled([opened?.then(document => document.close())]);
      const resources = await Promise.allSettled([store.close(), lists.close(), attachments?.close(), labels?.close(), outlines?.close()]);
      for (const result of [...closed, ...resources]) if (result.status === "rejected") throw result.reason;
    })();
  }
  function information(metadata: Readonly<Record<string, string>> = {}) {
    const info = cosDict({ Producer: cosString("@poe-code/pdf-ast") });
    for (const key of ["Title", "Author", "Subject", "Keywords", "Creator", "Producer"]) if (metadata[key]) dictSet(info, key, cosString(metadata[key]!));
    return info;
  }
  async function checkpoint(depth = 0) {
    signal.throwIfAborted(); if (depth > maximumDepth) throw new PdfError("E_LIMIT", "PDF page copy depth limit exceeded");
    if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted();
  }
  async function appendReference(list: ReferenceList, number: number) {
    const position = lists.allocate(16), bytes = new Uint8Array(16); new DataView(bytes.buffer).setFloat64(8, number); await lists.write(position, bytes);
    if (list.last) { const link = new Uint8Array(8); new DataView(link.buffer).setFloat64(0, position); await lists.write(list.last, link); }
    if (list === pages) await pageReferences?.set(BigInt(list.count), BigInt(number));
    list.first ||= position; list.last = position; list.count++;
  }
  async function* references(list: ReferenceList) {
    let position = list.first;
    while (position) {
      await checkpoint(); const bytes = await lists.read(position, 16), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      position = view.getFloat64(0); yield cosRef(view.getFloat64(8));
    }
  }
  async function append(document: PdfRetainedDocument, pageIndices: PdfRetainedPageIndices, resourceState?: PdfRetainedPageSelection["resourceState"]) {
    const backing = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4);
    const sourcePages = new PdfMutableObjectStore(storage, { maxRecursionDepth: maximumDepth, signal });
    const memo = new IntegerTable(backing, 64), wanted = new IntegerTable(backing, 64), sourceReferences = new IntegerTable(backing, 64);
    let firstSelection = 0, lastSelection = 0, sourceFailed = false;
    async function* selections() {
      let position = firstSelection;
      while (position) {
        await checkpoint();
        const bytes = await backing.read(position, 24), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
        position = view.getFloat64(0); yield { index: view.getFloat64(8), objectNumber: view.getFloat64(16) };
      }
    }
    async function sourceValue(node: PdfCosNode | undefined) { return (await document.lookup(node))?.value; }
    async function targetDict(node: PdfCosNode): Promise<PdfCosDict | undefined> {
      let depth = 0;
      while (node.kind === "ref") { await checkpoint(++depth); const value = await store.get(node.objectNumber); if (!value) return undefined; node = value.value; }
      return node.kind === "dict" ? node : undefined;
    }
    async function clone(node: PdfCosNode, depth = 0): Promise<PdfCosNode> {
      await checkpoint(depth);
      if (node.kind === "ref") {
        const found = await memo.get(BigInt(node.objectNumber));
        if (found !== undefined) return found === 0n ? { kind: "null" } : cosRef(Number(found));
        const entry = await document.crossReference.index.get(node.objectNumber, signal);
        const original = entry && entry.type !== "free" ? await document.objects.get(node.objectNumber, entry.generationNumber ?? 0) : undefined;
        if (!original) return cosRef(0);
        if (!original.stream && original.value.kind === "dict" && dictGet(original.value, "Linearized") !== undefined) mayLinearize = true;
        const reference = await store.allocate(); await memo.set(BigInt(node.objectNumber), BigInt(reference.objectNumber));
        let value = await clone(original.value, depth + 1);
        if (original.stream) {
          // Decrypted encoded streams can change length, so admit a retained
          // snapshot before constructing the target stream's /Length.
          const source = await PdfFileSource.fromStream(storage.fs, storage.directory, document.objects.decodeStream(original.objectNumber, original.generationNumber, { raw: !(options.normalizeContent && original.decoded) }), { signal });
          let streamFailed = false;
          try {
            if (options.normalizeContent && original.decoded && value.kind === "dict") {
              value = { ...value, entries: value.entries.filter(entry => !["Filter", "DecodeParms", "Length"].includes(entry.key.decoded)) };
              dictSet(value, "Length", cosNumber(source.size));
            }
            await store.set({ objectNumber: reference.objectNumber, generationNumber: 0, value, stream: { ...(original.decoded ? { decoded: true } : {}), length: source.size, chunks: source.stream(0, source.size, signal) } });
          }
          catch (error) { streamFailed = true; throw error; }
          finally { await source.close().catch(error => { if (!streamFailed) throw error; }); }
        } else await store.set({ objectNumber: reference.objectNumber, generationNumber: 0, value });
        return reference;
      }
      if (node.kind === "array") { const items = []; for (const item of node.items) items.push(await clone(item, depth + 1)); return cosArray(items); }
      if (node.kind === "dict") {
        const type = dictGet(node, "Type"), pageTree = type?.kind === "name" && (type.decoded === "Page" || type.decoded === "Pages");
        const entries = []; for (const entry of node.entries) { if (pageTree && entry.key.decoded === "Parent") continue; entries.push({ key: { ...entry.key }, value: await clone(entry.value, depth + 1) }); }
        return { kind: "dict", entries };
      }
      return node;
    }
    try {
      if (!copiedMetadata) {
        await store.set({ objectNumber: 3, generationNumber: 0, value: information(await document.info()) }); copiedMetadata = true;
      }
      for await (const index of typeof pageIndices === "number" ? [pageIndices] : pageIndices) {
        await checkpoint();
        if (!Number.isSafeInteger(index) || index < 0 || index === Number.MAX_SAFE_INTEGER) throw new RangeError("Invalid PDF page index");
        if (pageCount >= maxPages) throw new PdfError("E_LIMIT", "PDF copied page limit exceeded");
        const ref = await store.allocate(); await wanted.set(BigInt(index), 1n);
        const position = backing.allocate(24), bytes = new Uint8Array(24), view = new DataView(bytes.buffer);
        view.setFloat64(8, index); view.setFloat64(16, ref.objectNumber); await backing.write(position, bytes);
        if (lastSelection) { const link = new Uint8Array(8); new DataView(link.buffer).setFloat64(0, position); await backing.write(lastSelection, link); }
        firstSelection ||= position; lastSelection = position; pageCount++;
      }
      for await (const page of document.pages()) {
        await checkpoint(); if (page.reference) await memo.set(BigInt(page.reference.objectNumber), 0n);
        if (await wanted.get(BigInt(page.index)) !== undefined) {
          await sourcePages.set({ objectNumber: page.index + 1, generationNumber: 0, value: page.dict });
          await sourceReferences.set(BigInt(page.index), BigInt(page.reference?.objectNumber ?? 0));
        }
      }
      for await (const selection of selections()) {
        const reference = await sourceReferences.get(BigInt(selection.index));
        if (reference === undefined) throw new PdfError("E_CAPABILITY", `Page index out of bounds: ${selection.index}`);
        if (reference > 0n) await memo.set(reference, BigInt(selection.objectNumber));
      }
      for await (const selection of selections()) {
        const selected = { dict: (await sourcePages.get(selection.index + 1))!.value as PdfCosDict }, pageRef = cosRef(selection.objectNumber);
        if (!dictGet(selected.dict, "Resources") && await resourceState?.has(selection.index)) dictSet(selected.dict, "Resources", await sourceResources());
        const rotation = await options.pageRotation?.(document, selection.index);
        if (rotation !== undefined) {
          if (!Number.isSafeInteger(rotation) || rotation % 90 !== 0) throw new RangeError("Page rotation must be a multiple of 90 degrees");
          dictSet(selected.dict, "Rotate", cosNumber(((rotation % 360) + 360) % 360));
        }
        const page = await clone(selected.dict) as PdfCosDict;
        if (dictGet(page, "Linearized") !== undefined) mayLinearize = true;
        async function inherited(key: string): Promise<PdfCosNode | undefined> {
          let current: PdfCosDict | undefined = selected!.dict, depth = 0; const visited = new Set<number>();
          while (current) {
            await checkpoint(++depth); const node = dictGet(current, key); if (node) return sourceValue(node);
            const parent = dictGet(current, "Parent"); if (parent?.kind === "ref") { if (visited.has(parent.objectNumber)) break; visited.add(parent.objectNumber); }
            const value = await sourceValue(parent); current = value?.kind === "dict" ? value : undefined;
          }
          return undefined;
        }
        async function box(key: string): Promise<number[]> {
          const direct = await inherited(key), media = direct?.kind === "array" ? direct : key !== "MediaBox" ? await inherited("MediaBox") : undefined;
          if (media?.kind === "array" && media.items.length >= 4) {
            const numbers = []; for (const item of media.items.slice(0, 4)) { const value = await sourceValue(item); if (value?.kind !== "number") return key === "MediaBox" ? [0, 0, 612, 792] : box("MediaBox"); numbers.push(value.value); } return numbers;
          }
          return key === "MediaBox" ? [0, 0, 612, 792] : box("MediaBox");
        }
        const media = await box("MediaBox"), width = Math.abs(media[2]! - media[0]!), height = Math.abs(media[3]! - media[1]!);
        if (!dictGet(page, "MediaBox")) dictSet(page, "MediaBox", cosArray(media.map(value => cosNumber(value))));
        async function sourceResources(): Promise<PdfCosDict> {
          const source = await inherited("Resources"), entries = [];
          if (source?.kind === "dict") for (const entry of source.entries) {
            const value = await sourceValue(entry.value);
            entries.push({ key: { ...entry.key }, value: value?.kind === "dict" ? cosDict(Object.fromEntries(value.entries.map(item => [item.key.decoded, item.value]))) : entry.value });
          }
          return { kind: "dict", entries };
        }
        if (!dictGet(page, "Resources")) {
          const resources = await sourceResources();
          // PdfPage.getResourcesDict materializes this on the source. Repeated
          // selections then clone that dictionary in its updated entry order.
          dictSet(selected.dict, "Resources", resources);
          await sourcePages.set({ objectNumber: selection.index + 1, generationNumber: 0, value: selected.dict });
          await resourceState?.add(selection.index);
          dictSet(page, "Resources", await clone(resources));
        }
        if (!dictGet(page, "Rotate")) { const rotation = await inherited("Rotate"), value = rotation?.kind === "number" ? ((rotation.value % 360) + 360) % 360 : 0;
          if (value === 90 || value === 180 || value === 270) dictSet(page, "Rotate", cosNumber(value)); }
        for (const key of ["CropBox", "BleedBox", "TrimBox", "ArtBox"]) if (!dictGet(page, key)) {
          const value = await box(key); if (value[0] !== 0 || value[1] !== 0 || value[2] !== width || value[3] !== height) dictSet(page, key, cosArray(value.map(value => cosNumber(value))));
        }
        await store.set({ objectNumber: pageRef.objectNumber, generationNumber: 0, value: page });
      }
      const sourceCatalog = await sourceValue(document.crossReference.rootRef), acro = sourceCatalog?.kind === "dict" ? await sourceValue(dictGet(sourceCatalog, "AcroForm")) : undefined;
      const fields = acro?.kind === "dict" ? await sourceValue(dictGet(acro, "Fields")) : undefined;
      async function hasCloned(node: PdfCosNode | undefined): Promise<boolean> {
        const seen = new PdfReferenceSet(storage, Infinity, signal); let failed = false;
        async function visit(node: PdfCosNode | undefined, depth: number): Promise<boolean> {
          await checkpoint(depth); if (!node) return false;
          if (node.kind === "ref") { const value = await memo.get(BigInt(node.objectNumber)); if (value !== undefined && value > 0n) return true; if (!await seen.add(node.objectNumber)) return false; }
          const value = await sourceValue(node), kids = value?.kind === "dict" ? await sourceValue(dictGet(value, "Kids")) : undefined;
          if (kids?.kind === "array") for (const child of kids.items) if (await visit(child, depth + 1)) return true;
          return false;
        }
        try { return await visit(node, 0); } catch (error) { failed = true; throw error; } finally { await seen.close().catch(error => { if (!failed) throw error; }); }
      }
      if (fields?.kind === "array" && acro?.kind === "dict") {
        let addedFields = false; const rootNumbers = new IntegerTable(backing, 64);
        for (const field of fields.items) {
          if (!await hasCloned(field)) continue; const cloned = await clone(field); if (cloned.kind !== "ref") continue;
          const dict = await targetDict(cloned), source = await sourceValue(field), sourceKids = source?.kind === "dict" ? await sourceValue(dictGet(source, "Kids")) : undefined;
          let kids = dict && dictGet(dict, "Kids"); if (kids?.kind === "ref") kids = (await store.get(kids.objectNumber))?.value;
          if (dict && kids?.kind === "array" && field.kind === "ref" && sourceKids?.kind === "array" && sourceKids.items.length === kids.items.length) {
            const filtered = []; for (let i = 0; i < kids.items.length; i++) if (await hasCloned(sourceKids.items[i])) filtered.push(kids.items[i]!);
            if (filtered.length) { dictSet(dict, "Kids", cosArray(filtered)); await store.set({ objectNumber: cloned.objectNumber, generationNumber: 0, value: dict }); }
          }
          if (await rootNumbers.get(BigInt(cloned.objectNumber)) === undefined) {
            await rootNumbers.set(BigInt(cloned.objectNumber), 1n); await appendReference(formFields, cloned.objectNumber); addedFields = true;
          }
        }
        if (addedFields) {
          const form = formRef ? (await store.get(formRef.objectNumber))!.value as PdfCosDict : cosDict({ Fields: cosArray([]) });
          if (!formRef) { formRef = await store.allocate(form); dictSet(catalog, "AcroForm", formRef); }
          for (const key of ["DR", "DA"]) { const value = dictGet(acro, key); if (value && !dictGet(form, key)) dictSet(form, key, await clone(value)); }
          await store.set({ objectNumber: formRef.objectNumber, generationNumber: 0, value: form });
        }
      }
      const optional = sourceCatalog?.kind === "dict" ? dictGet(sourceCatalog, "OCProperties") : undefined;
      if (optional && !dictGet(catalog, "OCProperties")) dictSet(catalog, "OCProperties", await clone(optional));
      for await (const selection of selections()) {
        const page = (await store.get(selection.objectNumber))!.value as PdfCosDict;
        if (!await targetDict(dictGet(page, "Resources")!)) dictSet(page, "Resources", cosDict({}));
        dictSet(page, "Parent", cosRef(2));
        await store.set({ objectNumber: selection.objectNumber, generationNumber: 0, value: page });
        await appendReference(pages, selection.objectNumber);
      }
    } catch (error) { sourceFailed = true; throw error; }
    finally { const results = await Promise.allSettled([sourcePages.close(), backing.close()]); if (!sourceFailed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason); }
  }
  const encoder = new TextEncoder();
  async function* dictionary(dict: PdfCosDict, field: string, values: ReferenceList) {
    yield encoder.encode("<<\n");
    for (const entry of dict.entries) {
      yield* serializeCosNodeChunks(entry.key, { chunkBytes: options.chunkBytes ?? 16384, maxRecursionDepth: maximumDepth, signal }, 1); yield encoder.encode(" ");
      if (entry.key.decoded === field) {
        if (values.count && maximumDepth < 2) throw new PdfError("E_LIMIT", "PDF page copy depth limit exceeded");
        yield encoder.encode("[ ");
        for await (const reference of references(values)) yield encoder.encode(`${reference.objectNumber} 0 R `);
        yield encoder.encode("]");
      } else yield* serializeCosNodeChunks(entry.value, { chunkBytes: options.chunkBytes ?? 16384, maxRecursionDepth: maximumDepth, signal }, 1);
      yield encoder.encode("\n");
    }
    yield encoder.encode(">>");
  }
  try {
    await store.allocate(catalog); await store.allocate(cosDict({ Type: cosName("Pages"), Count: cosNumber(0), Kids: cosArray([]) }));
    await store.allocate(information(options.metadata));
    for await (const source of sources) { await checkpoint(); await attachments?.append(source.document); await labels?.append(source.document, pageCount); await outlines?.append(source.document, pageCount); await append(source.document, source.indices, source.resourceState); }
    await outlines?.finish(store, catalog, pageCount, async index => cosRef(Number(await pageReferences!.get(BigInt(index)))));
    const attachmentNames = await attachments?.finish(store, catalog);
    const pageLabels = await labels?.finish(store, catalog);
    await store.set({ objectNumber: 1, generationNumber: 0, value: catalog });
    const pageTree = cosDict({ Type: cosName("Pages"), Count: cosNumber(pageCount), Kids: cosArray([]) });
    if (pageLabels) await store.setSerializedValue(pageLabels);
    if (attachmentNames) await store.setSerializedValue(attachmentNames);
    async function saveList(number: number, dict: PdfCosDict, field: string, values: ReferenceList) {
      let length = 0; for await (const bytes of dictionary(dict, field, values)) length += bytes.length;
      await store.setSerializedValue({ objectNumber: number, generationNumber: 0, body: { length, chunks: dictionary(dict, field, values) } });
    }
    await saveList(2, pageTree, "Kids", pages);
    if (formRef) await saveList(formRef.objectNumber, (await store.get(formRef.objectNumber))!.value as PdfCosDict, "Fields", formFields);
    return {
      openDocument() {
        if (closing) return Promise.reject(new PdfError("E_CAPABILITY", "Retained page copy is closed"));
        return opened ??= PdfRetainedDocument.openStore(store, storage, { rootRef: cosRef(1), infoRef: cosRef(3), pageReferences: () => references(pages), maxPages, maxRecursionDepth: maximumDepth, signal });
      },
      chunks() {
        const configured = { ...options, rootRef: cosRef(1), infoRef: cosRef(3), signal };
        return mayLinearize ? serializeLinearizedRetainedChunks(store, storage, configured, () => store.outputObjects(), number => store.get(number), [2, formRef?.objectNumber, attachmentNames?.objectNumber, pageLabels?.objectNumber].filter((number): number is number => number !== undefined))
          : serializeRetainedCosDocumentChunks({ ...configured, objects: store.outputObjects() }, storage);
      },
      close,
    };
  } catch (error) { await close().catch(() => {}); throw error; }
}

export function copyRetainedPagesChunks(document: PdfRetainedDocument, indices: PdfRetainedPageIndices, storage: PdfIndexStorage, options?: CopyRetainedPageOptions): AsyncGenerator<Uint8Array, void, void>;
export function copyRetainedPagesChunks(sources: Iterable<PdfRetainedPageSelection> | AsyncIterable<PdfRetainedPageSelection>, storage: PdfIndexStorage, options?: CopyRetainedPageOptions): AsyncGenerator<Uint8Array, void, void>;
export async function* copyRetainedPagesChunks(input: PdfRetainedDocument | Iterable<PdfRetainedPageSelection> | AsyncIterable<PdfRetainedPageSelection>,
  indicesOrStorage: PdfRetainedPageIndices | PdfIndexStorage, storageOrOptions?: PdfIndexStorage | CopyRetainedPageOptions,
  singleOptions: CopyRetainedPageOptions = {}): AsyncGenerator<Uint8Array, void, void> {
  const copy = "pages" in input
    ? await createRetainedPageCopy(input, indicesOrStorage as PdfRetainedPageIndices, storageOrOptions as PdfIndexStorage, singleOptions)
    : await createRetainedPageCopy(input, indicesOrStorage as PdfIndexStorage, storageOrOptions as CopyRetainedPageOptions | undefined);
  let failed = false;
  try { yield* copy.chunks(); }
  catch (error) { failed = true; throw error; }
  finally { await copy.close().catch(error => { if (!failed) throw error; }); }
}

export { copyRetainedPagesChunks as copyRetainedPageChunks };
