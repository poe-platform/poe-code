import { IntegerTable, PagedStorage } from "@poe-code/safe-fs/storage";
import { cosDict, cosName, dictGet, dictSet, type PdfCosNode, type PdfCosRef } from "../ast.js";
import { PdfNameIndex } from "../cos/name-index.js";
import type { PdfMutableObjectStore } from "../cos/mutable-object-store.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import { stageDeflatedPdf } from "../cos/deflate-staging.js";
import { PdfFileSource } from "../source.js";
import type { PdfRetainedPage } from "../retained-document.js";

/** Preserve shared content identities while replacing streams incrementally. */
export class RetainedContentEditor {
  private readonly backing: PagedStorage;
  private readonly counts: IntegerTable;
  private readonly identities: PdfNameIndex;
  private work = 0;
  private constructor(private readonly store: PdfMutableObjectStore, private readonly storage: PdfIndexStorage, private readonly signal: AbortSignal) {
    this.backing = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4);
    this.counts = new IntegerTable(this.backing); this.identities = new PdfNameIndex(storage, Infinity, signal);
  }
  static async open(store: PdfMutableObjectStore, storage: PdfIndexStorage, signal: AbortSignal) {
    const editor = new RetainedContentEditor(store, storage, signal);
    try { for await (const object of store.objects()) await editor.count(object.value, 1n); return editor; }
    catch (error) { await editor.close().catch(() => {}); throw error; }
  }
  private async identity(ref: PdfCosRef) { return BigInt((await this.identities.intern(`${ref.objectNumber}:${ref.generationNumber}`)).index); }
  private async count(node: PdfCosNode, delta: bigint): Promise<void> {
    this.signal.throwIfAborted(); if (++this.work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    if (node.kind === "ref") { const key = await this.identity(node); await this.counts.set(key, (await this.counts.get(key) ?? 0n) + delta); }
    else if (node.kind === "dict") for (const entry of node.entries) await this.count(entry.value, delta);
    else if (node.kind === "array") for (const item of node.items) await this.count(item, delta);
    else if (node.kind === "stream") await this.count(node.dict, delta);
  }
  async set(reference: PdfCosRef, value: PdfCosNode, stream?: { decoded?: boolean; length: number; chunks: AsyncIterable<Uint8Array> }): Promise<void> {
    const old = await this.store.get(reference.objectNumber); if (old) await this.count(old.value, -1n);
    await this.count(value, 1n);
    await this.store.set({ objectNumber: reference.objectNumber, generationNumber: reference.generationNumber, value, ...(stream ? { stream } : {}) });
  }
  async replace(page: PdfRetainedPage, chunks: AsyncIterable<Uint8Array>, compress = true): Promise<void> {
    const source = compress ? await stageDeflatedPdf(chunks, this.storage, this.signal)
      : await PdfFileSource.fromStream(this.storage.fs, this.storage.directory, chunks, { signal: this.signal });
    let failed = false;
    try {
      const old = dictGet(page.dict, "Contents"), reuse = old?.kind === "ref" && await this.counts.get(await this.identity(old)) === 1n;
      const reference = reuse ? old : await this.store.allocate();
      await this.set(reference, cosDict(compress ? { Filter: cosName("FlateDecode") } : {}), { decoded: true, length: source.size, chunks: source.stream(0, source.size, this.signal) });
      if (!reuse) dictSet(page.dict, "Contents", reference);
      if (page.reference) await this.set(page.reference, page.dict);
    } catch (error) { failed = true; throw error; }
    finally { await source.close().catch(error => { if (!failed) throw error; }); }
  }
  async close() {
    const results = await Promise.allSettled([this.identities.close(), this.backing.close()]);
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }
}
