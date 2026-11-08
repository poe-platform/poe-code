import { PagedStorage } from "@poe-code/safe-fs/storage";
import { cosDict, cosNumber, cosRef, cosString, decodePdfString, decodeStoredPdfString, dictSet, type PdfCosArray, type PdfCosDict, type PdfCosNode, type PdfCosRef, type PdfPixelStorage, type PdfXRefEntry } from "../ast.js";
import { readPdfDictionaryValue, readRawPdfDictionaryEntries } from "../content/stored-dictionary.js";
import { appendStoredRecord, readStoredItems, StoredMetadataStack } from "../content/stored-record.js";
import { PdfMutableObjectStore } from "../cos/mutable-object-store.js";
import { PdfReferenceSet } from "../cos/reference-set.js";
import { PdfObjectIndex, type PdfIndexStorage } from "../cos/object-index.js";
import type { ValueArrayStorage } from "../cos/value-parser.js";
import { serializeCosNodeBytes } from "../cos/writer.js";
import { PdfFileSource } from "../source.js";
import { PdfError } from "../errors.js";
import type { PdfRetainedDocument } from "../retained-document.js";

interface OutlineRecord { title: PdfCosNode; pageIndex: number; level: number }
export interface PdfStreamedOutline { readonly title: () => AsyncGenerator<string, void, void>; readonly pageIndex: number; readonly level: number }

/** Flattens source outlines with caller-backed traversal, values and records. */
export class PdfMergeOutlines {
  private readonly backing: PagedStorage;
  private readonly retained: PdfPixelStorage;
  private readonly values: ValueArrayStorage;
  private count = 0;
  private first = -1;
  private last = -1;
  private work = 0;
  private closed = false;
  constructor(private readonly storage: PdfIndexStorage, private readonly signal: AbortSignal, private readonly maxDepth = Infinity, maxStagingBytes = Infinity) {
    this.backing = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4);
    let allocated = 0;
    this.retained = { allocate: length => {
      if (!Number.isSafeInteger(length) || length < 0 || length > maxStagingBytes - allocated) throw new PdfError("E_LIMIT", "PDF outline staging byte limit exceeded");
      const position = this.backing.allocate(length); allocated += length; return position;
    }, read: this.backing.read.bind(this.backing), write: this.backing.write.bind(this.backing) };
    this.values = { dictionaryStorage: this.retained, arrayStorage: this.retained, stringStorage: this.retained, containerStorage: this.retained,
      deferDictionaryValues: true, deferArrayValues: true, storeRootDictionary: true, storeRootArray: true, storeRootString: true };
  }
  private async checkpoint(depth = 0) {
    this.signal.throwIfAborted();
    if (this.closed) throw new PdfError("E_CAPABILITY", "PDF outlines are closed");
    if (depth > this.maxDepth) throw new PdfError("E_LIMIT", "PDF outline depth limit exceeded");
    if (++this.work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    this.signal.throwIfAborted();
  }
  private field(dict: PdfCosDict, key: string) { return readPdfDictionaryValue(dict, key, this.signal, { preserveDeferred: true }); }
  private async *items(array: PdfCosArray): AsyncGenerator<PdfCosNode> {
    if (array.storedItems) yield* readStoredItems<PdfCosNode>(array.storedItems, this.signal);
    else for (const item of array.items) { await this.checkpoint(); yield item; }
  }
  private async *text(node: PdfCosNode): AsyncGenerator<string, void, void> {
    await this.checkpoint();
    if (node.kind === "string" && node.storedBytes) yield* decodeStoredPdfString(node.storedBytes, this.signal);
    else {
      const value = node.kind === "string" ? decodePdfString(node) : node.kind === "name" ? node.decoded : "";
      for (let at = 0; at < value.length; at += 2048) { await this.checkpoint(); yield value.slice(at, at + 2048); }
    }
  }
  private async matches(left: PdfCosNode, right: PdfCosNode): Promise<boolean> {
    const a = this.text(left), b = this.text(right); let x = "", y = "", adone = false, bdone = false;
    try {
      while (true) {
        while (!x && !adone) { const next = await a.next(); adone = !!next.done; x = next.value ?? ""; }
        while (!y && !bdone) { const next = await b.next(); bdone = !!next.done; y = next.value ?? ""; }
        if (!x || !y) return adone && bdone && x === y;
        const length = Math.min(x.length, y.length); if (x.slice(0, length) !== y.slice(0, length)) return false;
        x = x.slice(length); y = y.slice(length);
      }
    } finally { await a.return(); await b.return(); }
  }
  private async *walk(document: PdfRetainedDocument, start: PdfCosNode | undefined, outlines: boolean): AsyncGenerator<{ dict: PdfCosDict; level: number }> {
    const frames = new StoredMetadataStack<{ node: PdfCosNode; depth: number }>(this.retained, this.signal), seen = new PdfReferenceSet(this.storage, Infinity, this.signal);
    let failed = false;
    const push = async (node: PdfCosNode | undefined, depth: number) => { if (node) await frames.push({ node, depth }); };
    try {
      await push(start, 0);
      while (frames.length) {
        const { node, depth } = (await frames.pop())!; await this.checkpoint(depth);
        if (node.kind === "ref" && !await seen.add(node.objectNumber)) continue;
        const dict = (await document.lookup(node, this.values))?.value; if (dict?.kind !== "dict") continue;
        yield { dict, level: depth + 1 };
        if (outlines) { await push(await this.field(dict, "Next"), depth); await push(await this.field(dict, "First"), depth + 1); }
        else {
          const kids = (await document.lookup(await this.field(dict, "Kids"), this.values))?.value;
          if (kids?.kind === "array") {
            const reverse = new StoredMetadataStack<PdfCosNode>(this.retained, this.signal);
            for await (const item of this.items(kids)) await reverse.push(item);
            while (reverse.length) { await this.checkpoint(); await push(await reverse.pop(), depth + 1); }
          }
        }
      }
    } catch (error) { failed = true; throw error; }
    finally { await seen.close().catch(error => { if (!failed) throw error; }); }
  }
  async append(document: PdfRetainedDocument, pageOffset: number, includeUntitled = false, includeNameTitles = false): Promise<void> {
    const resolve = async (node: PdfCosNode | undefined) => (await document.lookup(node, this.values))?.value;
    const catalog = await resolve(document.crossReference.rootRef); if (catalog?.kind !== "dict") return;
    const outlines = await resolve(await this.field(catalog, "Outlines")); if (outlines?.kind !== "dict") return;
    let pages: PdfObjectIndex | undefined, pageCount = 0, failed = false;
    const named = async (name: PdfCosNode): Promise<PdfCosNode | undefined> => {
      const legacy = await resolve(await this.field(catalog, "Dests")); let direct: PdfCosNode | undefined;
      if (legacy?.kind === "dict") for await (const entry of readRawPdfDictionaryEntries(legacy, this.signal)) if (await this.matches(entry.key, name)) direct = entry.value;
      if (direct) return direct;
      const names = await resolve(await this.field(catalog, "Names"));
      if (names?.kind === "dict") for await (const { dict: tree } of this.walk(document, await this.field(names, "Dests"), false)) {
        const pairs = await resolve(await this.field(tree, "Names"));
        if (pairs?.kind === "array") {
          const values = this.items(pairs);
          try {
            while (true) {
              const key = await values.next(); if (key.done) break;
              const value = await values.next(); if (value.done) break;
              const resolved = await resolve(key.value);
              if (await this.matches(resolved ?? cosString(""), name)) return value.value;
            }
          } finally { await values.return(undefined); }
        }
      }
      return undefined;
    };
    const destination = async (value: PdfCosNode | undefined): Promise<number> => {
      let node = await resolve(value);
      if (node?.kind === "dict") node = await resolve(await this.field(node, "D") ?? await this.field(node, "Dest") ?? node);
      if (node?.kind === "string" || node?.kind === "name") {
        node = await resolve(await named(node));
        if (node?.kind === "dict") { const dest = await this.field(node, "D"); if (dest) node = await resolve(dest); }
      }
      if (node?.kind !== "array" || !(node.storedItems?.length ?? node.items.length)) return 0;
      if (!pages) {
        async function* entries(): AsyncGenerator<PdfXRefEntry> {
          for await (const page of document.pages()) { pageCount++; if (page.reference) yield { objectNumber: page.reference.objectNumber, type: "uncompressed", offset: page.index }; }
        }
        pages = await PdfObjectIndex.build(entries(), this.storage, { duplicate: "first", runEntries: 64, cacheBytes: 2048, chunkBytes: 2048, signal: this.signal });
      }
      const items = this.items(node); let first: PdfCosNode;
      try { first = (await items.next()).value!; } finally { await items.return(undefined); }
      if (first.kind === "ref") return (await pages.get(first.objectNumber, this.signal))?.offset ?? 0;
      const number = await resolve(first);
      return number?.kind === "number" && number.value >= 0 && number.value < pageCount ? Math.round(number.value) : 0;
    };
    try {
      for await (const { dict: outline, level } of this.walk(document, await this.field(outlines, "First"), true)) {
        const value = await resolve(await this.field(outline, "Title"));
        const title = value?.kind === "string" || includeNameTitles && value?.kind === "name" ? value : cosString("");
        let nonempty = false; for await (const part of this.text(title)) if (part) { nonempty = true; break; }
        const index = await destination(await this.field(outline, "Dest") ?? await this.field(outline, "A"));
        if (nonempty || includeUntitled) {
          const position = await appendStoredRecord(this.retained, { title, pageIndex: pageOffset + index, level }, this.last, this.signal);
          if (this.first === -1) this.first = position;
          this.last = position; this.count++;
        }
      }
    } catch (error) { failed = true; throw error; }
    finally { await pages?.close().catch(error => { if (!failed) throw error; }); }
  }
  async *entries(): AsyncGenerator<{ title: string; pageIndex: number }, void, void> {
    for await (const { title, pageIndex } of this.details()) yield { title, pageIndex };
  }
  async *details(): AsyncGenerator<{ title: string; pageIndex: number; level: number }, void, void> {
    for await (const item of this.streamDetails()) { let title = ""; for await (const part of item.title()) title += part; yield { title, pageIndex: item.pageIndex, level: item.level }; }
  }
  async *streamDetails(): AsyncGenerator<PdfStreamedOutline, void, void> {
    for await (const row of readStoredItems<OutlineRecord>({ storage: this.retained, position: this.first, length: this.count }, this.signal)) {
      await this.checkpoint(); yield { title: () => this.text(row.title), pageIndex: row.pageIndex, level: row.level };
    }
  }
  async finish(target: PdfMutableObjectStore, catalog: PdfCosDict, pageCount: number, page: (index: number) => Promise<PdfCosRef>): Promise<void> {
    if (!this.count || !pageCount) return;
    const root = await target.allocate(), count = this.count; let ordinal = 0;
    for await (const item of this.streamDetails()) {
      await this.checkpoint(); ordinal++;
      const ref = await target.allocate(), destination = await page(Math.min(pageCount - 1, Math.max(0, item.pageIndex))), encoder = new TextEncoder();
      let utf16 = false;
      for await (const part of item.title()) utf16 ||= cosString(part).format === "hex";
      async function* body() {
        yield encoder.encode(`<<\n/Title ${utf16 ? "<FEFF" : "("}`);
        for await (const part of item.title()) {
          if (utf16) { let hex = ""; for (let at = 0; at < part.length; at++) hex += part.charCodeAt(at).toString(16).padStart(4, "0").toUpperCase(); yield encoder.encode(hex); }
          else { const bytes = serializeCosNodeBytes(cosString(part)); yield bytes.subarray(1, bytes.length - 1); }
        }
        yield encoder.encode(`${utf16 ? ">" : ")"}\n/Parent ${root.objectNumber} 0 R\n/Dest [ ${destination.objectNumber} ${destination.generationNumber} R /Fit ]\n`);
        if (ordinal > 1) yield encoder.encode(`/Prev ${ref.objectNumber - 1} 0 R\n`);
        if (ordinal < count) yield encoder.encode(`/Next ${ref.objectNumber + 1} 0 R\n`);
        yield encoder.encode(">>");
      }
      const source = await PdfFileSource.fromStream(this.storage.fs, this.storage.directory, body(), { signal: this.signal }); let failed = false;
      try { await target.setSerializedValue({ objectNumber: ref.objectNumber, generationNumber: 0, body: { length: source.size, chunks: source.stream(0, source.size, this.signal) } }); }
      catch (error) { failed = true; throw error; }
      finally { await source.close().catch(error => { if (!failed) throw error; }); }
    }
    await target.set({ objectNumber: root.objectNumber, generationNumber: 0, value: cosDict({ First: cosRef(root.objectNumber + 1), Last: cosRef(root.objectNumber + this.count), Count: cosNumber(this.count) }) });
    dictSet(catalog, "Outlines", root);
  }
  async close(): Promise<void> { this.closed = true; await this.backing.close(); }
}
