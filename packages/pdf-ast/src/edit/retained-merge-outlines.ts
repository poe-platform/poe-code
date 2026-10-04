import { cosArray, cosDict, cosName, cosNumber, cosRef, cosString, decodePdfString, dictGet, dictSet, type PdfCosDict, type PdfCosNode, type PdfCosRef, type PdfXRefEntry } from "../ast.js";
import { PdfMutableObjectStore } from "../cos/mutable-object-store.js";
import { PdfReferenceSet } from "../cos/reference-set.js";
import { PdfObjectIndex, type PdfIndexStorage } from "../cos/object-index.js";
import { PdfError } from "../errors.js";
import type { PdfRetainedDocument } from "../retained-document.js";

/** Flattens source outlines in traversal order, with caller-backed records. */
export class PdfMergeOutlines {
  private readonly objects: PdfMutableObjectStore;
  private count = 0;
  private work = 0;
  constructor(private readonly storage: PdfIndexStorage, private readonly signal: AbortSignal, private readonly maxDepth = Infinity) {
    this.objects = new PdfMutableObjectStore(storage, { signal });
  }
  private async checkpoint(depth = 0) {
    this.signal.throwIfAborted();
    if (depth > this.maxDepth) throw new PdfError("E_LIMIT", "PDF outline depth limit exceeded");
    if (++this.work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    this.signal.throwIfAborted();
  }
  private async *walk(document: PdfRetainedDocument, start: PdfCosNode | undefined, outlines: boolean): AsyncGenerator<PdfCosDict> {
    const frames = new PdfMutableObjectStore(this.storage, { signal: this.signal }), seen = new PdfReferenceSet(this.storage, Infinity, this.signal); let pending = 0, failed = false;
    const push = async (node: PdfCosNode | undefined, depth: number) => {
      if (node) await frames.set({ objectNumber: ++pending, generationNumber: 0, value: cosArray([node, cosNumber(depth)]) });
    };
    try {
      await push(start, 0);
      while (pending) {
        const frame = (await frames.get(pending--))!.value;
        if (frame.kind !== "array" || frame.items[1]?.kind !== "number") throw new PdfError("E_PARSE", "Invalid outline traversal frame");
        const node = frame.items[0]!, depth = frame.items[1].value;
        await this.checkpoint(depth);
        if (node.kind === "ref" && !await seen.add(node.objectNumber)) continue;
        const dict = (await document.lookup(node))?.value; if (dict?.kind !== "dict") continue;
        yield dict;
        if (outlines) { await push(dictGet(dict, "Next"), depth); await push(dictGet(dict, "First"), depth + 1); }
        else {
          const kids = (await document.lookup(dictGet(dict, "Kids")))?.value;
          if (kids?.kind === "array") for (let i = kids.items.length - 1; i >= 0; i--) { await this.checkpoint(); await push(kids.items[i], depth + 1); }
        }
      }
    } catch (error) { failed = true; throw error; }
    finally { const results = await Promise.allSettled([frames.close(), seen.close()]); if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason); }
  }
  async append(document: PdfRetainedDocument, pageOffset: number, includeUntitled = false): Promise<void> {
    const resolve = async (node: PdfCosNode | undefined) => (await document.lookup(node))?.value;
    const catalog = await resolve(document.crossReference.rootRef); if (catalog?.kind !== "dict") return;
    const outlines = await resolve(dictGet(catalog, "Outlines")); if (outlines?.kind !== "dict") return;
    let pages: PdfObjectIndex | undefined, pageCount = 0, failed = false;
    const named = async (name: string): Promise<PdfCosNode | undefined> => {
      const legacy = await resolve(dictGet(catalog, "Dests")), direct = legacy?.kind === "dict" ? dictGet(legacy, name) : undefined;
      if (direct) return direct;
      const names = await resolve(dictGet(catalog, "Names"));
      if (names?.kind === "dict") for await (const tree of this.walk(document, dictGet(names, "Dests"), false)) {
        const pairs = await resolve(dictGet(tree, "Names"));
        if (pairs?.kind === "array") for (let i = 0; i + 1 < pairs.items.length; i += 2) {
          await this.checkpoint(); const key = await resolve(pairs.items[i]);
          if ((key?.kind === "string" ? decodePdfString(key) : key?.kind === "name" ? key.decoded : "") === name) return pairs.items[i + 1];
        }
      }
      return undefined;
    };
    const destination = async (value: PdfCosNode | undefined): Promise<number> => {
      let node = await resolve(value);
      if (node?.kind === "dict") node = await resolve(dictGet(node, "D") ?? dictGet(node, "Dest") ?? node);
      if (node?.kind === "string" || node?.kind === "name") {
        node = await resolve(await named(node.kind === "string" ? decodePdfString(node) : node.decoded));
        if (node?.kind === "dict" && dictGet(node, "D")) node = await resolve(dictGet(node, "D"));
      }
      if (node?.kind !== "array" || !node.items.length) return 0;
      if (!pages) {
        async function* entries(): AsyncGenerator<PdfXRefEntry> {
          for await (const page of document.pages()) { pageCount++; if (page.reference) yield { objectNumber: page.reference.objectNumber, type: "uncompressed", offset: page.index }; }
        }
        pages = await PdfObjectIndex.build(entries(), this.storage, { duplicate: "first", runEntries: 64, cacheBytes: 2048, chunkBytes: 2048, signal: this.signal });
      }
      const first = node.items[0]!;
      if (first.kind === "ref") return (await pages.get(first.objectNumber, this.signal))?.offset ?? 0;
      const number = await resolve(first);
      return number?.kind === "number" && number.value >= 0 && number.value < pageCount ? Math.round(number.value) : 0;
    };
    try {
      for await (const outline of this.walk(document, dictGet(outlines, "First"), true)) {
        const title = await resolve(dictGet(outline, "Title")), text = title?.kind === "string" ? decodePdfString(title) : "";
        const index = await destination(dictGet(outline, "Dest") ?? dictGet(outline, "A"));
        if (text || includeUntitled) await this.objects.set({ objectNumber: ++this.count, generationNumber: 0, value: cosDict({ Title: cosString(text), Page: cosNumber(pageOffset + index) }) });
      }
    } catch (error) { failed = true; throw error; }
    finally { await pages?.close().catch(error => { if (!failed) throw error; }); }
  }
  async *entries(): AsyncGenerator<{ title: string; pageIndex: number }, void, void> {
    for await (const object of this.objects.objects()) {
      await this.checkpoint();
      const row = object.value as PdfCosDict, title = dictGet(row, "Title"), index = dictGet(row, "Page");
      if (title?.kind !== "string" || index?.kind !== "number") throw new PdfError("E_PARSE", "Invalid staged outline summary");
      yield { title: decodePdfString(title), pageIndex: index.value };
    }
  }
  async finish(target: PdfMutableObjectStore, catalog: PdfCosDict, pageCount: number, page: (index: number) => Promise<PdfCosRef>): Promise<void> {
    if (!this.count || !pageCount) return;
    const root = await target.allocate();
    for await (const object of this.objects.objects()) {
      await this.checkpoint();
      const row = object.value as PdfCosDict, index = dictGet(row, "Page");
      if (index?.kind !== "number") throw new PdfError("E_PARSE", "Invalid staged outline destination");
      const dict = cosDict({ Title: dictGet(row, "Title")!, Parent: root, Dest: cosArray([await page(Math.min(pageCount - 1, Math.max(0, index.value))), cosName("Fit")]) });
      if (object.objectNumber > 1) dictSet(dict, "Prev", cosRef(root.objectNumber + object.objectNumber - 1));
      if (object.objectNumber < this.count) dictSet(dict, "Next", cosRef(root.objectNumber + object.objectNumber + 1));
      await target.allocate(dict);
    }
    await target.set({ objectNumber: root.objectNumber, generationNumber: 0, value: cosDict({ First: cosRef(root.objectNumber + 1), Last: cosRef(root.objectNumber + this.count), Count: cosNumber(this.count) }) });
    dictSet(catalog, "Outlines", root);
  }
  async close(): Promise<void> { await this.objects.close(); }
}
