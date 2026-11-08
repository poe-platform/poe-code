import { PdfTextStore } from "../cos/text-store.js";
import { serializeCosNodeChunks } from "../cos/writer.js";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { cosArray, cosDict, cosName, cosNumber, cosRef, cosString, dictSet, type PdfCosRef } from "../ast.js";
import { PdfMutableObjectStore } from "../cos/mutable-object-store.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import { PdfError } from "../errors.js";

export interface RetainedBookmark {
  readonly title: string | (() => AsyncIterable<string>);
  /** One-based hierarchy depth; jumps descend through the last child only. */
  readonly level: number;
  /** One-based destination, clamped to the document's page range. */
  readonly pageNumber: number;
}

/** Replace outlines in producer order. Parent frames live in caller storage,
 * including their last sibling and immediate child count. */
export async function setRetainedBookmarks(store: PdfMutableObjectStore, storage: PdfIndexStorage, root: PdfCosRef, pageCount: number, pageReference: (index: number) => Promise<PdfCosRef>, bookmarks: Iterable<RetainedBookmark> | AsyncIterable<RetainedBookmark>, signal: AbortSignal, maxDepth = Infinity): Promise<void> {
  if (!pageCount) return;
  const catalog = await store.get(root.objectNumber);
  if (catalog?.value.kind !== "dict") return;
  const frames = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4);
  const titles = new PdfTextStore(storage, { signal }), records = new PdfMutableObjectStore(storage, { signal });
  const base = frames.allocate(0); let depth = 0, capacity = 0, failed = false, work = 0;
  type Frame = { number: number; last: number; count: number };
  async function write(index: number, frame: Frame) {
    if (index >= capacity) { frames.allocate(24); capacity++; }
    const bytes = new Uint8Array(24), view = new DataView(bytes.buffer);
    view.setFloat64(0, frame.number); view.setFloat64(8, frame.last); view.setFloat64(16, frame.count);
    await frames.write(base + index * 24, bytes);
  }
  async function read(index: number): Promise<Frame> {
    const bytes = await frames.read(base + index * 24, 24), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    return { number: view.getFloat64(0), last: view.getFloat64(8), count: view.getFloat64(16) };
  }
  try {
    for await (const bookmark of bookmarks) {
      signal.throwIfAborted();
      if (++work % 64 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted(); }
      if (!Number.isSafeInteger(bookmark.level) || !Number.isSafeInteger(bookmark.pageNumber)) throw new RangeError("Bookmark level and page number must be safe integers");
      if (!depth) {
        const outlines = await store.allocate(cosDict({ Type: cosName("Outlines") }));
        dictSet(catalog.value, "Outlines", outlines); await store.set(catalog);
        await write(0, { number: outlines.objectNumber, last: 0, count: 0 }); depth = 1;
      }
      const target = Math.max(1, bookmark.level);
      depth = Math.min(depth, target);
      while (depth < target) {
        const parent = await read(depth - 1); if (!parent.last) break;
        if (depth >= maxDepth) throw new PdfError("E_LIMIT", "PDF bookmark depth limit exceeded");
        await write(depth, { number: parent.last, last: 0, count: 0 }); depth++;
      }
      const frame = await read(depth - 1), parent = (await store.get(frame.number))!;
      if (parent.value.kind !== "dict") throw new PdfError("E_PARSE", "Expected outline parent dictionary");
      const page = await pageReference(Math.max(0, Math.min(pageCount - 1, bookmark.pageNumber - 1)));
      const title = await titles.append(typeof bookmark.title === "string" ? bookmark.title : bookmark.title());
      const value = cosDict({ Title: cosString(""), Parent: cosRef(frame.number), Dest: cosArray([page, cosName("XYZ"), { kind: "null" }, { kind: "null" }, { kind: "null" }]) });
      const item = await store.allocate(value);
      await records.allocate(cosArray([cosNumber(item.objectNumber), cosNumber(title)]));
      if (frame.last) {
        const previous = (await store.get(frame.last))!;
        if (previous.value.kind !== "dict") throw new PdfError("E_PARSE", "Expected outline sibling dictionary");
        dictSet(previous.value, "Next", item); await store.set(previous);
        dictSet(value, "Prev", cosRef(frame.last)); await store.set({ objectNumber: item.objectNumber, generationNumber: item.generationNumber, value });
      } else dictSet(parent.value, "First", item);
      dictSet(parent.value, "Last", item); dictSet(parent.value, "Count", cosNumber(++frame.count)); await store.set(parent);
      frame.last = item.objectNumber; await write(depth - 1, frame);
    }
    // Link only small dictionaries. Restore title payloads after all parent and
    // sibling edits, so updating links never parses an already-written title.
    for await (const record of records.objects()) {
      if (record.value.kind !== "array" || record.value.items[0]?.kind !== "number" || record.value.items[1]?.kind !== "number") throw new PdfError("E_PARSE", "Invalid bookmark title record");
      const number = record.value.items[0].value, title = record.value.items[1].value, object = (await store.get(number))!;
      if (object.value.kind !== "dict") throw new PdfError("E_PARSE", "Invalid bookmark dictionary");
      const entries = object.value.entries;
      async function* chunks() {
        const encoder = new TextEncoder(); yield encoder.encode("<<\n");
        for (const entry of entries) {
          signal.throwIfAborted(); yield* serializeCosNodeChunks(entry.key, { signal }); yield encoder.encode(" ");
          if (entry.key.decoded === "Title") yield* titles.serialized(title);
          else yield* serializeCosNodeChunks(entry.value, { signal });
          yield encoder.encode("\n");
        }
        yield encoder.encode(">>");
      }
      let length = 0; for await (const bytes of chunks()) length += bytes.length;
      await store.setSerializedValue({ objectNumber: number, generationNumber: object.generationNumber, body: { length, chunks: chunks() } });
    }
  } catch (error) { failed = true; throw error; }
  finally { const results = await Promise.allSettled([frames.close(), titles.close(), records.close()]); if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason); }
}
