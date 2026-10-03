import { decodePdfString, dictGet, type PdfCosNode, type PdfXRefEntry } from "../ast.js";
import { PdfNameIndex } from "../cos/name-index.js";
import { PdfObjectIndex, type PdfIndexStorage } from "../cos/object-index.js";
import { PdfError } from "../errors.js";
import type { PdfRetainedDocument } from "../retained-document.js";

export interface PdfRetainedDestination {
  readonly name: string;
  /** Missing for a malformed destination; named-entry order is preserved. */
  readonly target?: { readonly pageNumber: number; readonly kind: string };
}
export interface PdfRetainedUrl { readonly pageNumber: number; readonly url: string }
export interface PdfUrlSelection { readonly firstPage?: number; readonly lastPage?: number }
interface Options { maxDepth: number; maxStagingBytes?: number; signal?: AbortSignal }

export async function* walkRetainedDestinations(document: PdfRetainedDocument, storage: PdfIndexStorage, options: Options): AsyncGenerator<PdfRetainedDestination, void, void> {
  let pages: PdfObjectIndex | undefined, failed = false, work = 0;
  const maximum = options.maxStagingBytes ?? Infinity;
  const seen = new PdfNameIndex(storage, () => maximum - (pages?.size ?? 0) * 32, options.signal);
  async function resolve(node: PdfCosNode | undefined) { return (await document.lookup(node))?.value; }
  async function* entry(name: string, node: PdfCosNode | undefined): AsyncGenerator<PdfRetainedDestination> {
    options.signal?.throwIfAborted();
    if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    let value = await resolve(node);
    if (value?.kind === "dict") value = await resolve(dictGet(value, "D"));
    if (value?.kind !== "array") { yield { name }; return; }
    const target = value.items[0]; let pageNumber = 1;
    if (target?.kind === "ref") {
      if (!pages) {
        async function* references(): AsyncGenerator<PdfXRefEntry> {
          for await (const page of document.pages()) if (page.reference) yield { objectNumber: page.reference.objectNumber, generationNumber: page.reference.generationNumber, type: "uncompressed", offset: page.index + 1 };
        }
        pages = await PdfObjectIndex.build(references(), storage, { runEntries: 64, chunkBytes: 2048, cacheBytes: 2048, maxStagingBytes: maximum - seen.stagedBytes, ...(options.signal ? { signal: options.signal } : {}) });
      }
      const found = await pages.get(target.objectNumber, options.signal);
      if (found && (found.generationNumber ?? 0) === target.generationNumber) pageNumber = found.offset ?? 1;
    } else {
      const number = await resolve(target);
      if (number?.kind === "number") pageNumber = Math.max(1, Math.floor(number.value) + 1);
    }
    const kind = await resolve(value.items[1]);
    yield { name, target: { pageNumber, kind: kind?.kind === "name" ? kind.decoded : "XYZ" } };
  }
  async function* tree(node: PdfCosNode | undefined, depth: number): AsyncGenerator<PdfRetainedDestination> {
    options.signal?.throwIfAborted();
    if (depth > options.maxDepth) throw new PdfError("E_LIMIT", "PDF destination name-tree depth limit exceeded");
    const resolved = await document.lookup(node);
    if (resolved?.value.kind !== "dict" || resolved.stream) return;
    if (resolved.reference && !(await seen.intern(`${resolved.reference.objectNumber}:${resolved.reference.generationNumber}`)).added) return;
    const names = await resolve(dictGet(resolved.value, "Names"));
    if (names?.kind === "array") for (let i = 0; i + 1 < names.items.length; i += 2) {
      const key = await resolve(names.items[i]);
      if (key?.kind === "string" || key?.kind === "name") yield* entry(key.kind === "string" ? decodePdfString(key) : key.decoded, names.items[i + 1]);
    }
    const kids = await resolve(dictGet(resolved.value, "Kids"));
    if (kids?.kind === "array") for (const kid of kids.items) yield* tree(kid, depth + 1);
  }
  try {
    const root = await resolve(document.crossReference.rootRef); if (root?.kind !== "dict") return;
    const legacy = await resolve(dictGet(root, "Dests"));
    if (legacy?.kind === "dict") for (const pair of legacy.entries) yield* entry(pair.key.decoded, pair.value);
    const names = await resolve(dictGet(root, "Names"));
    if (names?.kind === "dict") yield* tree(dictGet(names, "Dests"), 0);
  } catch (error) { failed = true; throw error; }
  finally {
    const results = await Promise.allSettled([seen.close(), pages?.close()]);
    if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason);
  }
}

export async function* walkRetainedUrls(document: PdfRetainedDocument, storage: PdfIndexStorage, options: Options & PdfUrlSelection): AsyncGenerator<PdfRetainedUrl, void, void> {
  const first = options.firstPage ?? 1, last = options.lastPage ?? Infinity;
  if (!Number.isSafeInteger(first) || first < 1 || (last !== Infinity && (!Number.isSafeInteger(last) || last < first))) throw new RangeError("Invalid PDF URL page range");
  let work = 0;
  for await (const page of document.pages()) {
    if (page.index + 1 < first) continue;
    if (page.index + 1 > last) break;
    const annotations = (await document.lookup(dictGet(page.dict, "Annots")))?.value;
    if (annotations?.kind !== "array") continue;
    for (const node of annotations.items) {
      const annotation = await document.lookup(node); if (annotation?.value.kind !== "dict" || annotation.stream) continue;
      const seen = new PdfNameIndex(storage, options.maxStagingBytes, options.signal);
      let failed = false;
      async function* action(node: PdfCosNode | undefined, depth: number): AsyncGenerator<PdfRetainedUrl> {
        options.signal?.throwIfAborted();
        if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
        if (depth > options.maxDepth) throw new PdfError("E_LIMIT", "PDF URL action depth limit exceeded");
        const resolved = await document.lookup(node);
        if (resolved?.value.kind !== "dict" || resolved.stream) return;
        if (resolved.reference && !(await seen.intern(`${resolved.reference.objectNumber}:${resolved.reference.generationNumber}`)).added) return;
        const uri = (await document.lookup(dictGet(resolved.value, "URI")))?.value;
        if (uri?.kind === "string") yield { pageNumber: page.index + 1, url: decodePdfString(uri) };
        const next = (await document.lookup(dictGet(resolved.value, "Next")))?.value;
        if (next?.kind === "array") for (const item of next.items) yield* action(item, depth + 1);
        else if (next) yield* action(dictGet(resolved.value, "Next"), depth + 1);
      }
      try { yield* action(dictGet(annotation.value, "A"), 0); }
      catch (error) { failed = true; throw error; }
      finally { await seen.close().catch(error => { if (!failed) throw error; }); }
    }
  }
}
