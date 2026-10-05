import { PagedStorage } from "@poe-code/safe-fs/storage";
import { cosArray, cosDict, cosName, cosNumber, cosRef, cosString, dictSet, type PdfCosRef } from "../ast.js";
import type { PdfMutableObjectStore } from "../cos/mutable-object-store.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import { PdfError } from "../errors.js";

export interface RetainedBookmark {
  readonly title: string;
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
      const value = cosDict({ Title: cosString(bookmark.title), Parent: cosRef(frame.number), Dest: cosArray([page, cosName("XYZ"), { kind: "null" }, { kind: "null" }, { kind: "null" }]) });
      const item = await store.allocate(value);
      if (frame.last) {
        const previous = (await store.get(frame.last))!;
        if (previous.value.kind !== "dict") throw new PdfError("E_PARSE", "Expected outline sibling dictionary");
        dictSet(previous.value, "Next", item); await store.set(previous);
        dictSet(value, "Prev", cosRef(frame.last)); await store.set({ objectNumber: item.objectNumber, generationNumber: item.generationNumber, value });
      } else dictSet(parent.value, "First", item);
      dictSet(parent.value, "Last", item); dictSet(parent.value, "Count", cosNumber(++frame.count)); await store.set(parent);
      frame.last = item.objectNumber; await write(depth - 1, frame);
    }
  } catch (error) { failed = true; throw error; }
  finally { await frames.close().catch(error => { if (!failed) throw error; }); }
}
