import { IntegerTable, PagedStorage } from "@poe-code/safe-fs/storage";
import { cosArray, cosDict, cosName, cosNumber, dictGet, dictSet, type PdfCosNode, type PdfCosRef } from "../ast.js";
import type { PdfMutableObjectStore } from "../cos/mutable-object-store.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import { PdfNameIndex } from "../cos/name-index.js";
import { stageDeflatedPdf } from "../cos/deflate-staging.js";
import type { PdfRetainedDocument } from "../retained-document.js";

/** Flatten page rotations while keeping decoded contents and reference counts on caller storage. */
export async function flattenRetainedRotations(document: PdfRetainedDocument, store: PdfMutableObjectStore, storage: PdfIndexStorage, signal: AbortSignal): Promise<void> {
  const backing = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4), counts = new IntegerTable(backing);
  const identities = new PdfNameIndex(storage, Infinity, signal);
  let failed = false, work = 0;
  const identity = async (ref: PdfCosRef) => BigInt((await identities.intern(`${ref.objectNumber}:${ref.generationNumber}`)).index);
  async function checkpoint() { signal.throwIfAborted(); if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0)); }
  async function count(node: PdfCosNode, delta: bigint): Promise<void> {
    await checkpoint();
    if (node.kind === "ref") { const key = await identity(node); await counts.set(key, (await counts.get(key) ?? 0n) + delta); }
    else if (node.kind === "dict") for (const entry of node.entries) await count(entry.value, delta);
    else if (node.kind === "array") for (const item of node.items) await count(item, delta);
    else if (node.kind === "stream") await count(node.dict, delta);
  }
  async function save(ref: PdfCosRef, value: PdfCosNode) {
    const old = await store.get(ref.objectNumber); if (old) await count(old.value, -1n);
    await count(value, 1n); await store.set({ objectNumber: ref.objectNumber, generationNumber: ref.generationNumber, value });
  }
  try {
    for await (const object of store.objects()) await count(object.value, 1n);
    for await (const page of document.pages()) {
      await checkpoint(); const attributes = await page.attributes(), rotation = attributes.rotation;
      if (!rotation || !page.reference) continue;
      const [x0, y0, x1, y1] = attributes.mediaBox, width = Math.abs(x1 - x0), height = Math.abs(y1 - y0);
      function point(x: number, y: number): [number, number] { return rotation === 90 ? [y, width - x] : rotation === 180 ? [width - x, height - y] : [height - y, x]; }
      async function rectangle(node: PdfCosNode | undefined) {
        const array = (await document.lookup(node))?.value; if (array?.kind !== "array" || array.items.length < 4) return;
        const numbers = [];
        for (const item of array.items.slice(0, 4)) { const value = (await document.lookup(item))?.value; numbers.push(value?.kind === "number" ? value.value : 0); }
        const a = point(numbers[0]!, numbers[1]!), b = point(numbers[2]!, numbers[3]!);
        return cosArray([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])].map(value => cosNumber(value)));
      }
      const prefix = rotation === 90 ? `q\n0 -1 1 0 0 ${width} cm\n` : rotation === 180 ? `q\n-1 0 0 -1 ${width} ${height} cm\n` : `q\n0 1 -1 0 ${height} 0 cm\n`;
      if (rotation !== 180) dictSet(page.dict, "MediaBox", cosArray([0, 0, height, width].map(value => cosNumber(value))));
      for (const key of ["CropBox", "BleedBox", "TrimBox", "ArtBox"]) { const mapped = await rectangle(dictGet(page.dict, key)); if (mapped) dictSet(page.dict, key, mapped); }
      const annotations = await document.lookup(dictGet(page.dict, "Annots"));
      if (annotations?.value.kind === "array") {
        for (const item of annotations.value.items) {
          const annotation = item.kind === "ref" && item.objectNumber === page.reference.objectNumber && item.generationNumber === page.reference.generationNumber ? { value: page.dict, reference: page.reference } : await document.lookup(item); if (annotation?.value.kind !== "dict" || annotation.stream) continue;
          const mapped = await rectangle(dictGet(annotation.value, "Rect")); if (!mapped) continue;
          dictSet(annotation.value, "Rect", mapped);
          if (annotation.reference) await save(annotation.reference, annotation.value);
        }
        if (annotations.reference) await save(annotations.reference, annotations.value);
      }
      // Persist geometry before checking content sharing, as the buffered editor does.
      await save(page.reference, page.dict);
      const encoder = new TextEncoder();
      async function* contents() { yield encoder.encode(prefix); yield* page.streamContents(); yield encoder.encode("\nQ\n"); }
      const compressed = await stageDeflatedPdf(contents(), storage, signal); let streamFailed = false;
      try {
        const old = dictGet(page.dict, "Contents"), reuse = old?.kind === "ref" && await counts.get(await identity(old)) === 1n;
        const ref = reuse ? old : await store.allocate();
        const previous = await store.get(ref.objectNumber); if (previous) await count(previous.value, -1n);
        await store.set({ objectNumber: ref.objectNumber, generationNumber: ref.generationNumber, value: cosDict({ Filter: cosName("FlateDecode") }), stream: { length: compressed.size, chunks: compressed.stream(0, compressed.size, signal) } });
        if (!reuse) dictSet(page.dict, "Contents", ref);
        dictSet(page.dict, "Rotate", cosNumber(0)); await save(page.reference, page.dict);
      } catch (error) { streamFailed = true; throw error; }
      finally { await compressed.close().catch(error => { if (!streamFailed) throw error; }); }
    }
  } catch (error) { failed = true; throw error; }
  finally { const results = await Promise.allSettled([identities.close(), backing.close()]); if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason); }
}
