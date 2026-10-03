import type { PdfXRefEntry } from "../ast.js";
import { PdfError } from "../errors.js";
import { PdfObjectIndex, type PdfIndexStorage } from "./object-index.js";

/** Exact UTF-16 trie. Edges are numeric records in caller-backed index runs,
 * not hashes, filenames, or resident strings. Keeps at most 64 pending edges
 * plus 256 hot edges and logarithmically many bounded index caches. One traversal owns the set. */
export class PdfNameIndex {
  private readonly tail = new Map<number, number>();
  private readonly hot = new Map<number, number>();
  private readonly levels: Array<PdfObjectIndex | undefined> = [];
  private nextNode = 2;
  private nextName = 0;
  private closed = false;
  constructor(private readonly storage: PdfIndexStorage, private readonly maximum = Infinity, private readonly signal?: AbortSignal) {
    if (maximum !== Infinity && (!Number.isSafeInteger(maximum) || maximum < 0)) throw new RangeError("Invalid name staging limit");
  }

  private async get(edge: number): Promise<number | undefined> {
    if (this.tail.has(edge)) return this.tail.get(edge);
    if (this.hot.has(edge)) return this.hot.get(edge);
    for (const level of this.levels) { const entry = await level?.get(edge, this.signal); if (entry) { if (this.hot.size < 256) this.hot.set(edge, entry.offset!); return entry.offset; } }
    return undefined;
  }

  private async insert(edge: number, node: number): Promise<void> {
    this.tail.set(edge, node);
    if (this.hot.size < 256) this.hot.set(edge, node);
    if (this.tail.size < 64) return;
    let level = 0; while (this.levels[level]) level++;
    const inputs = this.levels.slice(0, level); const tail = this.tail; const signal = this.signal;
    async function* rows(): AsyncGenerator<PdfXRefEntry> {
      for (const [objectNumber, offset] of tail) yield { objectNumber, offset, type: "uncompressed" };
      for (const index of inputs) yield* index!.entries(signal);
    }
    const retained = this.levels.reduce((sum, index) => sum + (index?.size ?? 0) * 32, 0);
    const remaining = Math.min(this.maximum, Number.MAX_SAFE_INTEGER) - retained;
    if (remaining < 0) throw new PdfError("E_LIMIT", "PDF name staging byte limit exceeded");
    const combined = await PdfObjectIndex.build(rows(), this.storage, {
      runEntries: 64, chunkBytes: 2048, cacheBytes: 2048, maxStagingBytes: remaining, ...(signal ? { signal } : {}),
    });
    try {
      for (let i = 0; i < level; i++) { await this.levels[i]!.close(); this.levels[i] = undefined; }
      this.levels[level] = combined; this.tail.clear();
    } catch (error) { try { await combined.close(); } catch { /* Preserve cleanup failure. */ } throw error; }
  }

  async intern(value: string): Promise<{ index: number; added: boolean }> {
    if (this.closed) throw new PdfError("E_CAPABILITY", "PDF name index is closed");
    this.signal?.throwIfAborted();
    let node = 1;
    for (let i = 0; i < value.length * 2; i++) {
      this.signal?.throwIfAborted();
      if (i > 0 && i % 1024 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); this.signal?.throwIfAborted(); }
      const code = value.charCodeAt(Math.floor(i / 2));
      const unit = i % 2 === 0 ? code & 255 : code >>> 8;
      const edge = node * 257 + unit + 1;
      let child = await this.get(edge);
      if (child === undefined) {
        if (this.nextNode > Math.floor(Number.MAX_SAFE_INTEGER / 257) - 1) throw new PdfError("E_LIMIT", "PDF name index address limit exceeded");
        child = this.nextNode++; await this.insert(edge, child);
      }
      node = child;
    }
    const terminal = node * 257;
    const existing = await this.get(terminal);
    if (existing !== undefined) return { index: existing, added: false };
    const index = this.nextName++;
    await this.insert(terminal, index); return { index, added: true };
  }

  async close(): Promise<void> {
    if (this.closed) return; this.closed = true;
    const results = await Promise.allSettled(this.levels.map(index => index?.close()));
    this.tail.clear(); this.hot.clear(); this.levels.length = 0;
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }
}
