import { PagedStorage } from "@poe-code/safe-fs/storage";
import { cosArray, cosDict, cosHexString, cosName, cosNumber, cosString, decodePdfString, dictSet, type PdfCosArray, type PdfCosRef } from "../ast.js";
import { PdfMutableObjectStore } from "../cos/mutable-object-store.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import type { PdfRetainedDocument, PdfRetainedPage } from "../retained-document.js";
import { serializeCosNodeChunks } from "../cos/writer.js";
import { setRetainedBookmarks, type RetainedBookmark } from "./retained-bookmarks.js";

export type RetainedInfoUpdate =
  | { readonly kind: "info"; readonly key: string; readonly value: string }
  | { readonly kind: "id"; readonly index: 0 | 1; readonly bytes: Uint8Array }
  | { readonly kind: "page"; readonly pageNumber: number; readonly property: "rotation" | "dimensions" | "media" | "crop"; readonly values: readonly number[] }
  | { readonly kind: "label"; readonly index: number; readonly start: number; readonly prefix?: string; readonly style?: string }
  | ({ readonly kind: "bookmark" } & RetainedBookmark);

/** Apply metadata immediately, then last-wins page properties in first-seen
 * order, labels and bookmarks. Record counts and hierarchy use caller storage. */
export async function applyRetainedInfoUpdates(document: PdfRetainedDocument, store: PdfMutableObjectStore, storage: PdfIndexStorage, count: number, getPage: (index: number) => Promise<PdfRetainedPage>, updates: Iterable<RetainedInfoUpdate> | AsyncIterable<RetainedInfoUpdate>, signal: AbortSignal, maxDepth?: number): Promise<{ infoRef: PdfCosRef | undefined; idArray: PdfCosArray | undefined }> {
  const pages = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4);
  const base = pages.allocate(count * 4 * 48), heads = [-1, -1, -1, -1], tails = [-1, -1, -1, -1];
  const labels = new PdfMutableObjectStore(storage, { signal }), bookmarks = new PdfMutableObjectStore(storage, { signal });
  let infoRef = document.crossReference.infoRef, idArray = document.crossReference.idArray, labelCount = 0, work = 0, failed = false;
  const rootRef = document.crossReference.rootRef;
  async function checkpoint() { signal.throwIfAborted(); if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted(); }
  const position = (group: number, index: number) => base + (group * count + index) * 48;
  try {
    for await (const update of updates) {
      await checkpoint();
      if (update.kind === "info") {
        const standard = ["Title", "Author", "Subject", "Keywords", "Creator", "Producer"].includes(update.key);
        let info = infoRef ? await store.get(infoRef.objectNumber) : undefined;
        if (infoRef && info?.value.kind !== "dict") {
          const resolved = await document.lookup(infoRef);
          if (resolved?.value.kind === "dict" && resolved.reference) info = await store.get(resolved.reference.objectNumber);
        }
        if (!infoRef || (standard && info?.value.kind !== "dict")) {
          infoRef = await store.allocate(cosDict(!standard ? { Title: cosString("") } : {})); info = await store.get(infoRef.objectNumber);
        }
        if (info?.value.kind === "dict") { dictSet(info.value, update.key, cosString(update.value)); await store.set(info); }
      } else if (update.kind === "id") {
        if (idArray === document.crossReference.idArray) {
          const first = await document.lookup(idArray?.items[0]), second = await document.lookup(idArray?.items[1]);
          const a = first?.value.kind === "string" ? first.value.bytes : new Uint8Array(16), b = second?.value.kind === "string" ? second.value.bytes : a;
          idArray = cosArray([cosHexString(a), cosHexString(b)]);
        }
        idArray!.items[update.index] = cosHexString(new Uint8Array(update.bytes));
      } else if (update.kind === "page") {
        const index = update.pageNumber - 1;
        if (!Number.isSafeInteger(index) || index < 0 || index >= count) continue;
        const group = ["rotation", "dimensions", "media", "crop"].indexOf(update.property), size = group === 0 ? 1 : group === 1 ? 2 : 4;
        if (update.values.length !== size || !update.values.every(Number.isFinite)) throw new RangeError("Invalid page property values");
        const offset = position(group, index), bytes = await pages.read(offset, 48), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
        if (!view.getFloat64(0)) {
          view.setFloat64(0, 1); view.setFloat64(8, -1);
          if (tails[group]! >= 0) { const link = new Uint8Array(8); new DataView(link.buffer).setFloat64(0, index); await pages.write(position(group, tails[group]!) + 8, link); }
          else heads[group] = index;
          tails[group] = index;
        }
        for (let i = 0; i < size; i++) view.setFloat64(16 + i * 8, update.values[i]!);
        await pages.write(offset, bytes);
      } else if (update.kind === "label") {
        const value = cosDict({ St: cosNumber(update.start) });
        if (update.prefix) dictSet(value, "P", cosString(update.prefix));
        if (update.style) dictSet(value, "S", cosName(update.style));
        await labels.allocate(cosArray([cosNumber(update.index), value])); labelCount++;
      } else await bookmarks.allocate(cosArray([cosString(update.title), cosNumber(update.level), cosNumber(update.pageNumber)]));
    }
    for (let group = 0; group < 4; group++) for (let index = heads[group]!; index >= 0;) {
      await checkpoint();
      const bytes = await pages.read(position(group, index), 48), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length), page = await getPage(index);
      if (group === 0) dictSet(page.dict, "Rotate", cosNumber((((Math.round(view.getFloat64(16) / 90) * 90) % 360) + 360) % 360));
      else {
        const values = group === 1 ? [0, 0, view.getFloat64(16), view.getFloat64(24)] : [16, 24, 32, 40].map(offset => view.getFloat64(offset));
        dictSet(page.dict, group === 3 ? "CropBox" : "MediaBox", cosArray(values.map(value => cosNumber(value))));
      }
      await store.set({ objectNumber: page.reference!.objectNumber, generationNumber: page.reference!.generationNumber, value: page.dict });
      index = view.getFloat64(8);
    }
    if (labelCount) {
      const root = await store.get(rootRef.objectNumber);
      if (root?.value.kind === "dict") {
        const ref = await store.allocate(cosDict({})); dictSet(root.value, "PageLabels", ref); await store.set(root);
        async function* chunks() {
          const encoder = new TextEncoder(); yield encoder.encode("<<\n/Nums [ ");
          for await (const object of labels.objects()) {
            await checkpoint(); if (object.value.kind !== "array") throw new Error("Invalid label record");
            for (const node of object.value.items) { yield* serializeCosNodeChunks(node, { signal }); yield encoder.encode(" "); }
          }
          yield encoder.encode("]\n>>");
        }
        let length = 0; for await (const bytes of chunks()) length += bytes.length;
        await store.setSerializedValue({ objectNumber: ref.objectNumber, generationNumber: 0, body: { length, chunks: chunks() } });
      }
    }
    async function* outlineUpdates(): AsyncGenerator<RetainedBookmark> {
      for await (const object of bookmarks.objects()) {
        await checkpoint(); const value = object.value;
        if (value.kind !== "array" || value.items[0]?.kind !== "string" || value.items[1]?.kind !== "number" || value.items[2]?.kind !== "number") throw new Error("Invalid bookmark record");
        yield { title: decodePdfString(value.items[0]), level: value.items[1].value, pageNumber: value.items[2].value };
      }
    }
    await setRetainedBookmarks(store, storage, rootRef, count, async index => (await getPage(index)).reference!, outlineUpdates(), signal, maxDepth);
    return { infoRef, idArray };
  } catch (error) { failed = true; throw error; }
  finally { const results = await Promise.allSettled([pages.close(), labels.close(), bookmarks.close()]); if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason); }
}
