import { IntegerTable, PagedStorage } from "@poe-code/safe-fs/storage";
import { cosArray, cosDict, cosName, cosNumber, cosRef, cosString, dictGet, dictSet, type PdfCosNode, type PdfCosDict } from "../ast.js";
import { PdfMutableObjectStore } from "../cos/mutable-object-store.js";
import { PdfReferenceSet } from "../cos/reference-set.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import { serializeRetainedCosDocumentChunks } from "../cos/retained-writer.js";
import { PdfFileSource } from "../source.js";
import { PdfError } from "../errors.js";
import type { PdfRetainedDocument, PdfRetainedPage } from "../retained-document.js";

export interface CopyRetainedPageOptions {
  readonly maxObjects?: number;
  readonly maxOutputBytes?: number;
  readonly maxRecursionDepth?: number;
  readonly chunkBytes?: number;
  readonly signal?: AbortSignal;
}
/** Copy one page, its resource graph, forms and optional-content properties.
 * Source identities and target object bodies live on caller backing. Other
 * source pages become null references, matching ordinary single-page copying. */
export async function* copyRetainedPageChunks(document: PdfRetainedDocument, pageIndex: number, storage: PdfIndexStorage,
  options: CopyRetainedPageOptions = {}): AsyncGenerator<Uint8Array, void, void> {
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) throw new RangeError("Invalid PDF page index");
  const signal = options.signal ?? new AbortController().signal, maximumDepth = options.maxRecursionDepth ?? Infinity;
  if (maximumDepth !== Infinity && (!Number.isSafeInteger(maximumDepth) || maximumDepth < 1)) throw new RangeError("Invalid PDF copy depth");
  const store = new PdfMutableObjectStore(storage, options), backing = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4);
  const memo = new IntegerTable(backing, 64); let failed = false, work = 0;
  async function checkpoint(depth = 0) {
    signal.throwIfAborted(); if (depth > maximumDepth) throw new PdfError("E_LIMIT", "PDF page copy depth limit exceeded");
    if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted();
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
      const reference = await store.allocate(); await memo.set(BigInt(node.objectNumber), BigInt(reference.objectNumber));
      const value = await clone(original.value, depth + 1);
      if (original.stream) {
        // Decrypted encoded streams can change length, so admit a retained
        // snapshot before constructing the target stream's /Length.
        const source = await PdfFileSource.fromStream(storage.fs, storage.directory, document.objects.decodeStream(original.objectNumber, original.generationNumber, { raw: true }), { signal });
        let streamFailed = false;
        try { await store.set({ objectNumber: reference.objectNumber, generationNumber: 0, value, stream: { length: source.size, chunks: source.stream(0, source.size, signal) } }); }
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
    const catalog = cosDict({ Type: cosName("Catalog"), Pages: cosRef(2) });
    await store.allocate(catalog); await store.allocate(cosDict({ Type: cosName("Pages"), Count: cosNumber(0), Kids: cosArray([]) }));
    const info = cosDict({ Producer: cosString("@poe-code/pdf-ast") }), metadata = await document.info();
    for (const key of ["Title", "Author", "Subject", "Keywords", "Creator", "Producer"]) if (metadata[key]) dictSet(info, key, cosString(metadata[key]!));
    await store.allocate(info);
    let selected: PdfRetainedPage | undefined;
    for await (const page of document.pages()) { await checkpoint(); if (page.reference) await memo.set(BigInt(page.reference.objectNumber), 0n); if (page.index === pageIndex) selected = page; }
    if (!selected) throw new PdfError("E_CAPABILITY", `Page index out of bounds: ${pageIndex}`);
    const pageRef = await store.allocate(); if (selected.reference) await memo.set(BigInt(selected.reference.objectNumber), BigInt(pageRef.objectNumber));
    const page = await clone(selected.dict) as PdfCosDict;
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
    if (!dictGet(page, "Resources")) {
      const source = await inherited("Resources"), entries = [];
      if (source?.kind === "dict") for (const entry of source.entries) {
        const value = await sourceValue(entry.value);
        entries.push({ key: { ...entry.key }, value: value?.kind === "dict" ? cosDict(Object.fromEntries(value.entries.map(item => [item.key.decoded, item.value]))) : entry.value });
      }
      dictSet(page, "Resources", await clone({ kind: "dict", entries }));
    }
    if (!dictGet(page, "Rotate")) { const rotation = await inherited("Rotate"), value = rotation?.kind === "number" ? ((rotation.value % 360) + 360) % 360 : 0;
      if (value === 90 || value === 180 || value === 270) dictSet(page, "Rotate", cosNumber(value)); }
    for (const key of ["CropBox", "BleedBox", "TrimBox", "ArtBox"]) if (!dictGet(page, key)) {
      const value = await box(key); if (value[0] !== 0 || value[1] !== 0 || value[2] !== width || value[3] !== height) dictSet(page, key, cosArray(value.map(value => cosNumber(value))));
    }
    await store.set({ objectNumber: pageRef.objectNumber, generationNumber: 0, value: page });
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
      const roots = [], rootNumbers = new IntegerTable(backing, 64);
      for (const field of fields.items) {
        if (!await hasCloned(field)) continue; const cloned = await clone(field); if (cloned.kind !== "ref") continue;
        const dict = await targetDict(cloned), source = await sourceValue(field), sourceKids = source?.kind === "dict" ? await sourceValue(dictGet(source, "Kids")) : undefined;
        let kids = dict && dictGet(dict, "Kids"); if (kids?.kind === "ref") kids = (await store.get(kids.objectNumber))?.value;
        if (dict && kids?.kind === "array" && field.kind === "ref" && sourceKids?.kind === "array" && sourceKids.items.length === kids.items.length) {
          const filtered = []; for (let i = 0; i < kids.items.length; i++) if (await hasCloned(sourceKids.items[i])) filtered.push(kids.items[i]!);
          if (filtered.length) { dictSet(dict, "Kids", cosArray(filtered)); await store.set({ objectNumber: cloned.objectNumber, generationNumber: 0, value: dict }); }
        }
        if (await rootNumbers.get(BigInt(cloned.objectNumber)) === undefined) {
          await rootNumbers.set(BigInt(cloned.objectNumber), 1n); roots.push(cloned);
        }
      }
      if (roots.length) {
        const form = cosDict({ Fields: cosArray(roots) }), ref = await store.allocate(form); dictSet(catalog, "AcroForm", ref);
        for (const key of ["DR", "DA"]) { const value = dictGet(acro, key); if (value) dictSet(form, key, await clone(value)); }
        await store.set({ objectNumber: ref.objectNumber, generationNumber: 0, value: form });
      }
    }
    const optional = sourceCatalog?.kind === "dict" ? dictGet(sourceCatalog, "OCProperties") : undefined;
    if (optional) dictSet(catalog, "OCProperties", await clone(optional));
    if (!await targetDict(dictGet(page, "Resources")!)) dictSet(page, "Resources", cosDict({}));
    dictSet(page, "Parent", cosRef(2));
    await store.set({ objectNumber: pageRef.objectNumber, generationNumber: 0, value: page });
    await store.set({ objectNumber: 1, generationNumber: 0, value: catalog });
    await store.set({ objectNumber: 2, generationNumber: 0, value: cosDict({ Type: cosName("Pages"), Count: cosNumber(1), Kids: cosArray([pageRef]) }) });
    yield* serializeRetainedCosDocumentChunks({ ...options, objects: store.objects(), rootRef: cosRef(1), infoRef: cosRef(3), signal }, storage);
  } catch (error) { failed = true; throw error; }
  finally { const results = await Promise.allSettled([store.close(), backing.close()]); if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason); }
}
