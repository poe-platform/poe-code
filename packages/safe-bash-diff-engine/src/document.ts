import { PagedStorage, type PagedStorageCache } from "@poe-code/safe-fs/storage";
import { readBytes, type ByteSource, type CommandContext } from "safe-bash-contracts";
export interface DocumentBudget {
  readonly context: CommandContext;
  readonly documentCache?: PagedStorageCache;
  step(amount?: number): void;
  checkpoint(): void | Promise<void>;
}

/** Drain every admitted cleanup before reporting any resource failure. */
export async function closeDocumentResources(resources: readonly { close(): Promise<void> }[]): Promise<void> {
  const results = await Promise.allSettled(resources.map(resource => Promise.resolve().then(() => resource.close())));
  const errors = results.filter(result => result.status === "rejected").map(result => result.reason);
  if (errors.length) throw new AggregateError(errors, "Document cleanup failed");
}

export interface DocumentLine { readonly start: number; readonly end: number; readonly hash: number }

/** Immutable byte document and fixed-width line index, both backed by caller storage. */
export class IndexedDocument {
  readonly data: PagedStorage;
  private readonly index: PagedStorage;
  private readonly cache = new Map<number, DocumentLine>();
  // Bound retained comparison payloads to 64 KiB, plus 512 line records.
  private readonly comparisons = new Map<number, { line: DocumentLine; bytes: Uint8Array }>();
  size = 0;
  length = 0;
  binary = false;
  validUtf8 = true;
  private closing: Promise<void> | undefined;
  private loaded = false;

  constructor(readonly budget: DocumentBudget, pages = 16) {
    this.data = new PagedStorage(budget.context, pages, budget.documentCache);
    this.index = new PagedStorage(budget.context, pages, budget.documentCache);
    budget.context.registerCleanup?.(() => this.close());
  }

  async load(source: ByteSource): Promise<void> {
    if (this.loaded) throw new Error("Document is already loaded");
    this.loaded = true;
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    const records = new Uint8Array(24 * 512);
    const view = new DataView(records.buffer);
    let used = 0, start = 0, hash = 2166136261;
    const record = async (end: number) => {
      view.setFloat64(used, start, true);
      view.setFloat64(used + 8, end, true);
      view.setUint32(used + 16, hash, true);
      used += 24;
      this.length++;
      start = end;
      hash = 2166136261;
      if (used === records.length) { await this.index.append(records); used = 0; }
    };
    for await (const bytes of readBytes(source, this.budget.context.signal)) {
      for (let offset = 0; offset < bytes.length; offset += 16384) {
        const block = bytes.subarray(offset, offset + 16384);
        await this.data.append(block);
        if (this.validUtf8) {
          try { decoder.decode(block, { stream: true }); }
          catch { this.validUtf8 = false; }
        }
        for (let i = 0; i < block.length; i++) {
          const byte = block[i]!;
          this.binary ||= byte === 0;
          hash = Math.imul(hash ^ byte, 16777619) >>> 0;
          if (byte === 10) await record(this.size + i + 1);
        }
        this.size += block.length;
        this.budget.step(block.length);
        const checkpoint = this.budget.checkpoint();
        if (checkpoint) await checkpoint;
      }
    }
    if (this.validUtf8) {
      try { decoder.decode(); } catch { this.validUtf8 = false; }
    }
    if (start < this.size) await record(this.size);
    if (used) await this.index.append(records.subarray(0, used));
  }

  async line(position: number): Promise<DocumentLine> {
    if (!Number.isSafeInteger(position) || position < 0 || position >= this.length) throw new RangeError("Invalid document line");
    const cached = this.cache.get(position);
    if (cached) return cached;
    const bytes = await this.index.read(8 + position * 24, 24);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const line = { start: view.getFloat64(0, true), end: view.getFloat64(8, true), hash: view.getUint32(16, true) };
    if (!this.budget.documentCache) {
      if (this.cache.size === 256) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(position, line);
    }
    return line;
  }

  async equal(position: number, other: IndexedDocument, otherPosition: number): Promise<boolean> {
    const cachedLeft = this.comparisons.get(position), cachedRight = other.comparisons.get(otherPosition);
    const left = cachedLeft?.line ?? await this.line(position), right = cachedRight?.line ?? await other.line(otherPosition);
    this.budget.step();
    if (left.end - left.start !== right.end - right.start || left.hash !== right.hash) return false;
    for (let offset = 0; offset < left.end - left.start; offset += 16384) {
      const count = Math.min(16384, left.end - left.start - offset);
      const a = cachedLeft?.bytes ?? await this.data.read(8 + left.start + offset, count);
      const b = cachedRight?.bytes ?? await other.data.read(8 + right.start + offset, count);
      if (!cachedLeft && left.end - left.start <= 128) this.retainComparison(position, left, a);
      if (!cachedRight && right.end - right.start <= 128) other.retainComparison(otherPosition, right, b);
      this.budget.step(count);
      for (let i = 0; i < count; i++) if (a[i] !== b[i]) return false;
      const checkpoint = this.budget.checkpoint();
      if (checkpoint) await checkpoint;
    }
    return true;
  }

  private retainComparison(position: number, line: DocumentLine, bytes: Uint8Array): void {
    if (this.budget.documentCache) return;
    if (this.comparisons.has(position)) return;
    if (this.comparisons.size === 512) this.comparisons.delete(this.comparisons.keys().next().value!);
    this.comparisons.set(position, { line, bytes });
  }

  async *range(start: number, end: number): ByteSource {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > this.size) throw new RangeError("Invalid document range");
    for (let position = start; position < end; position += 16384) {
      const length = Math.min(16384, end - position);
      this.budget.step(length);
      const checkpoint = this.budget.checkpoint();
      if (checkpoint) await checkpoint;
      yield await this.data.read(8 + position, length);
    }
  }

  close(): Promise<void> {
    return this.closing ??= (async () => {
      this.cache.clear();
      this.comparisons.clear();
      await closeDocumentResources([this.data, this.index]);
    })();
  }
}
