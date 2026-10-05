import type { PdfXRefEntry } from "../ast.js";
import { PdfError } from "../errors.js";
import { PdfObjectIndex, type PdfIndexStorage } from "./object-index.js";

/** Traversal membership backed by immutable caller-owned index runs. The
 * resident tail has 64 numbers; at most 53 binary levels each cache at most 64 records.
 * Used by one traversal at a time, never a whole-document resident Set. */
export class PdfReferenceSet {
  private readonly tail = new Set<number>();
  private readonly levels: Array<PdfObjectIndex | undefined> = [];
  private closed = false;
  constructor(private readonly storage: PdfIndexStorage, private readonly maximum = Infinity, private readonly signal?: AbortSignal) {
    if (maximum !== Infinity && (!Number.isSafeInteger(maximum) || maximum < 0)) throw new RangeError("Invalid traversal staging limit");
  }

  async has(number: number): Promise<boolean> {
    if (this.closed) throw new PdfError("E_CAPABILITY", "PDF reference set is closed");
    this.signal?.throwIfAborted();
    if (!Number.isSafeInteger(number) || number < 0) throw new RangeError("Invalid PDF reference number");
    if (this.tail.has(number)) return true;
    for (const level of this.levels) if (await level?.get(number, this.signal)) return true;
    return false;
  }

  async add(number: number): Promise<boolean> {
    if (await this.has(number)) return false;
    this.tail.add(number);
    if (this.tail.size < 64) return true;
    let level = 0;
    while (this.levels[level]) level++;
    const previous = this.levels.slice(0, level);
    const tail = this.tail;
    const signal = this.signal;
    async function* entries(): AsyncGenerator<PdfXRefEntry> {
      for (const objectNumber of tail) yield { objectNumber, type: "uncompressed", offset: 0 };
      for (const index of previous) yield* index!.entries(signal);
    }
    const retained = this.levels.reduce((sum, index) => sum + (index?.size ?? 0) * 32, 0);
    const remaining = Math.min(this.maximum, Number.MAX_SAFE_INTEGER) - retained;
    if (remaining < 0) throw new PdfError("E_LIMIT", "PDF traversal staging byte limit exceeded");
    const combined = await PdfObjectIndex.build(entries(), this.storage, {
      runEntries: 64, chunkBytes: 2048, cacheBytes: 2048, maxStagingBytes: remaining,
      ...(signal ? { signal } : {}),
    });
    try {
      for (let i = 0; i < level; i++) { await this.levels[i]!.close(); this.levels[i] = undefined; }
      this.levels[level] = combined;
      this.tail.clear();
    } catch (error) { try { await combined.close(); } catch { /* Preserve cleanup failure. */ } throw error; }
    return true;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const results = await Promise.allSettled(this.levels.map(index => index?.close()));
    this.tail.clear(); this.levels.length = 0;
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }
}

/** Ancestors whose parser frames have been released. The local depth preserves
 * admission accounting while membership lives in caller-backed index runs. */
export interface PdfReferencePath {
  readonly seen: PdfReferenceSet;
  readonly parent: PdfReferencePath | undefined;
  depth: number;
}
