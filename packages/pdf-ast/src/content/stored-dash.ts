import type { PdfCosArray, PdfCosNode, PdfPixelStorage, PdfStoredDash } from "../ast.js";
import { readStoredItems } from "./stored-record.js";

/** Normalize directly into caller backing. The allocation reserves address space;
 * the only resident output is one page, even for a very long pattern. */
export async function storeDashArray(array: PdfCosArray, storage: PdfPixelStorage,
  resolve: (node: PdfCosNode) => Promise<PdfCosNode | undefined>, signal?: AbortSignal): Promise<PdfStoredDash | undefined> {
  const count = array.storedItems?.length ?? array.items.length;
  if (!Number.isSafeInteger(count * 8) || count < 0) throw new RangeError("Invalid dash length");
  signal?.throwIfAborted();
  if (!count) return undefined;
  const position = storage.allocate(count * 8);
  if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(position + count * 8)) throw new RangeError("Invalid dash allocation");
  const bytes = new Uint8Array(4096), view = new DataView(bytes.buffer);
  let used = 0, length = 0, total = 0, turns = 0;
  for await (const item of array.storedItems ? readStoredItems<PdfCosNode>(array.storedItems, signal) : array.items) {
    signal?.throwIfAborted();
    const node = item.kind === "ref" ? await resolve(item) : item;
    const value = node?.kind === "number" ? node.value : 0;
    if (value >= 0) {
      view.setFloat64(used, value, true); used += 8; length++; total += value;
      if (used === bytes.length) {
        await storage.write(position + length * 8 - used, bytes, signal ? { signal } : undefined); used = 0;
      }
    }
    if (++turns % 4096 === 0) { await new Promise<void>(done => setTimeout(done, 0)); signal?.throwIfAborted(); }
  }
  if (used) await storage.write(position + length * 8 - used, bytes.subarray(0, used), signal ? { signal } : undefined);
  signal?.throwIfAborted();
  return total > 0 ? { storage, position, length, total } : undefined;
}
