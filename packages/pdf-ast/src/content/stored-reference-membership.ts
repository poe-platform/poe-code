import type { PdfCosNode, PdfStoredItems, PdfXRefEntry } from "../ast.js";
import { PdfObjectIndex, type PdfIndexStorage } from "../cos/object-index.js";
import { readStoredItems } from "./stored-record.js";

/** Two immutable membership indexes; both input records and sorted runs use
 * caller backing. No set grows with the number of optional-content layers. */
export class StoredReferenceMembership {
  private readonly cache = new Map<PdfStoredItems, PdfObjectIndex>();
  constructor(private readonly storage: PdfIndexStorage, private readonly signal?: AbortSignal, private readonly admit?: (bytes: number) => void) {}

  async has(items: PdfStoredItems, objectNumber: number): Promise<boolean> {
    this.signal?.throwIfAborted();
    // Preserve matching for malformed references that the xref index cannot key.
    if (!Number.isSafeInteger(objectNumber) || objectNumber < 0) {
      for await (const node of readStoredItems<PdfCosNode>(items, this.signal))
        if (node.kind === "ref" && (node.objectNumber === objectNumber || Number.isNaN(node.objectNumber) && Number.isNaN(objectNumber))) return true;
      return false;
    }
    let index = this.cache.get(items);
    if (!index) {
      if (this.cache.size === 2) {
        const [key, oldest] = this.cache.entries().next().value!;
        await oldest.close(); this.cache.delete(key);
      }
      this.admit?.(32768);
      const signal = this.signal;
      async function* references(): AsyncGenerator<PdfXRefEntry> {
        for await (const node of readStoredItems<PdfCosNode>(items, signal))
          if (node.kind === "ref" && Number.isSafeInteger(node.objectNumber) && node.objectNumber >= 0)
            yield { objectNumber: node.objectNumber, type: "uncompressed", offset: 0 };
      }
      index = await PdfObjectIndex.build(references(), this.storage, { runEntries: 64, chunkBytes: 2048, cacheBytes: 2048, ...(signal ? { signal } : {}) });
    }
    this.cache.delete(items); this.cache.set(items, index);
    return (await index.get(objectNumber, this.signal)) !== undefined;
  }

  async close(): Promise<void> {
    const results = await Promise.allSettled([...this.cache.values()].map(index => index.close()));
    this.cache.clear();
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }
}
