import type { FileSystem } from "@poe-code/safe-fs/contracts";
import { listenForAbort } from "@poe-code/safe-fs/contracts";
import type { PdfXRefEntry } from "../ast.js";
import { PdfError } from "../errors.js";
import { PdfFileSource } from "../source.js";

const recordBytes = 32;

export interface PdfIndexStorage {
  readonly fs: FileSystem;
  readonly directory: string;
}
export interface PdfObjectIndexOptions {
  readonly runEntries?: number;
  readonly chunkBytes?: number;
  readonly cacheBytes?: number;
  readonly maxEntries?: number;
  /** Aggregate live staged bytes, including both inputs and output during merges. */
  readonly maxStagingBytes?: number;
  readonly signal?: AbortSignal;
}

function integer(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid ${name}`);
  return value;
}
function budget(value: number | undefined, name: string): number {
  return value === undefined || value === Infinity ? Infinity : integer(value, name);
}

function fields(entry: PdfXRefEntry): readonly [number, number, number, number] {
  const key = integer(entry.objectNumber, "PDF object number");
  if (entry.type === "free") return [key, integer(entry.nextFreeObjectNumber ?? 0, "free object number"), integer(entry.generationNumber ?? 0, "generation number"), 0];
  if (entry.type === "uncompressed") return [key, integer(entry.offset!, "object offset"), integer(entry.generationNumber ?? 0, "generation number"), 1];
  if (entry.type === "compressed") return [key, integer(entry.objectStreamNumber!, "object stream number"), integer(entry.indexInStream ?? entry.indexInObjectStream!, "object stream index"), 2];
  throw new PdfError("E_PARSE", "Invalid PDF cross-reference entry type");
}

function decode(bytes: Uint8Array, offset = 0): PdfXRefEntry {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, recordBytes);
  const objectNumber = view.getFloat64(0);
  const first = view.getFloat64(8);
  const second = view.getFloat64(16);
  const type = view.getFloat64(24);
  if (type === 0) return { objectNumber, type: "free", nextFreeObjectNumber: first, generationNumber: second };
  if (type === 1) return { objectNumber, type: "uncompressed", offset: first, generationNumber: second };
  if (type === 2) return { objectNumber, type: "compressed", objectStreamNumber: first, indexInStream: second };
  throw new PdfError("E_PARSE", "Invalid staged PDF index record");
}

async function* encode(entries: Iterable<PdfXRefEntry> | AsyncIterable<PdfXRefEntry>, chunkBytes: number): AsyncGenerator<Uint8Array> {
  let bytes = new Uint8Array(chunkBytes);
  let offset = 0;
  for await (const entry of entries) {
    const view = new DataView(bytes.buffer, offset, recordBytes);
    const values = fields(entry);
    for (let i = 0; i < values.length; i++) view.setFloat64(i * 8, values[i]!);
    offset += recordBytes;
    if (offset === bytes.length) { yield bytes; bytes = new Uint8Array(chunkBytes); offset = 0; }
  }
  if (offset) yield bytes.subarray(0, offset);
}

async function* records(source: PdfFileSource, signal?: AbortSignal): AsyncGenerator<PdfXRefEntry> {
  for await (const bytes of source.stream(0, source.size, signal)) {
    if (bytes.length % recordBytes !== 0) throw new PdfError("E_PARSE", "Truncated staged PDF index");
    for (let offset = 0; offset < bytes.length; offset += recordBytes) { signal?.throwIfAborted(); yield decode(bytes, offset); }
  }
}

async function* merge(first: PdfFileSource, second: PdfFileSource, signal?: AbortSignal): AsyncGenerator<PdfXRefEntry> {
  const left = records(first, signal);
  const right = records(second, signal);
  try {
    let a = await left.next();
    let b = await right.next();
    let turns = 0;
    while (!a.done || !b.done) {
      signal?.throwIfAborted();
      if (!a.done && (b.done || a.value.objectNumber <= b.value.objectNumber)) {
        yield a.value;
        if (!b.done && a.value.objectNumber === b.value.objectNumber) b = await right.next();
        a = await left.next();
      } else if (!b.done) { yield b.value; b = await right.next(); }
      if (++turns % 1024 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  } finally { await left.return(undefined); await right.return(undefined); }
}

/** Immutable cross-reference index in caller-authorized storage. Input order is
 * newest first; the first occurrence wins, including free-entry tombstones.
 * Construction keeps one sort batch and two merge windows in memory. Dormant
 * runs retain empty caches; at most 53 levels exist for safe-integer counts. */
export class PdfObjectIndex {
  private closing: Promise<void> | undefined;
  private constructor(private readonly source: PdfFileSource, private readonly signal: AbortSignal | undefined) {}
  get size(): number { return this.source.size / recordBytes; }

  static async build(input: Iterable<PdfXRefEntry> | AsyncIterable<PdfXRefEntry>, storage: PdfIndexStorage,
    options: PdfObjectIndexOptions = {}): Promise<PdfObjectIndex> {
    const runEntries = integer(options.runEntries ?? 2048, "runEntries");
    const chunkBytes = integer(options.chunkBytes ?? 64 * 1024, "chunkBytes");
    const cacheBytes = integer(options.cacheBytes ?? 256 * 1024, "cacheBytes");
    if (!runEntries || chunkBytes < recordBytes || chunkBytes % recordBytes !== 0 || cacheBytes < chunkBytes) throw new RangeError("Invalid PDF index batch/cache sizes");
    const maxEntries = budget(options.maxEntries, "maxEntries");
    const maxStagingBytes = budget(options.maxStagingBytes, "maxStagingBytes");
    const { signal } = options;
    signal?.throwIfAborted();
    const owned = new Set<PdfFileSource>();
    const levels: (PdfFileSource | undefined)[] = [];
    let stagedBytes = 0;
    let admitted = 0;
    let batch: PdfXRefEntry[] = [];
    const dispose = async (source: PdfFileSource) => {
      try { await source.close(); }
      finally { owned.delete(source); stagedBytes -= source.size; }
    };
    const stage = async (entries: Iterable<PdfXRefEntry> | AsyncIterable<PdfXRefEntry>) => {
      let reserved = 0;
      async function* chunks() {
        for await (const bytes of encode(entries, chunkBytes)) {
          signal?.throwIfAborted();
          if (bytes.length > Math.min(maxStagingBytes, Number.MAX_SAFE_INTEGER) - stagedBytes) throw new PdfError("E_LIMIT", "PDF index staging byte limit exceeded");
          stagedBytes += bytes.length;
          reserved += bytes.length;
          yield bytes;
        }
      }
      try {
        const source = await PdfFileSource.fromStream(storage.fs, storage.directory, chunks(), { chunkBytes, cacheBytes, ...(signal ? { signal } : {}) });
        owned.add(source);
        return source;
      } catch (error) { stagedBytes -= reserved; throw error; }
    };
    const flush = async () => {
      batch.sort((a, b) => a.objectNumber - b.objectNumber);
      // Stable sort keeps the first revision entry for each object.
      const sorted = batch;
      batch = [];
      function* unique() {
        let previous = -1;
        for (const entry of sorted) if (entry.objectNumber !== previous) { previous = entry.objectNumber; yield entry; }
      }
      let run = await stage(unique());
      let level = 0;
      while (levels[level]) {
        const earlier = levels[level]!;
        const combined = await stage(merge(earlier, run, signal));
        await dispose(earlier);
        await dispose(run);
        levels[level++] = undefined;
        run = combined;
      }
      levels[level] = run;
    };
    const iterator = Symbol.asyncIterator in input ? input[Symbol.asyncIterator]() : input[Symbol.iterator]();
    let ended = false;
    // Each pending pull owns its cancellation promise. Reusing one never-settled
    // race promise would retain a reaction for every entry in the document.
    const next = async () => {
      signal?.throwIfAborted();
      if (!signal) return iterator.next();
      let dispose = () => {};
      const cancelled = new Promise<never>((ignored, reject) => {
        dispose = listenForAbort(signal, () => reject(signal.reason));
      });
      const pending = Promise.resolve().then(() => { signal.throwIfAborted(); return iterator.next(); });
      try { return await Promise.race([pending, cancelled]); }
      finally { dispose(); }
    };
    try {
      while (true) {
        const step = await next();
        signal?.throwIfAborted();
        if (step.done) { ended = true; break; }
        if (admitted >= Math.min(maxEntries, Number.MAX_SAFE_INTEGER)) throw new PdfError("E_LIMIT", "PDF index entry limit exceeded");
        admitted++;
        // Normalize and own scalar fields before advancing a reusable producer.
        const values = fields(step.value);
        const entry: PdfXRefEntry = step.value.type === "compressed"
          ? { objectNumber: values[0], type: "compressed", objectStreamNumber: values[1], indexInStream: values[2] }
          : step.value.type === "free"
            ? { objectNumber: values[0], type: "free", nextFreeObjectNumber: values[1], generationNumber: values[2] }
            : { objectNumber: values[0], type: "uncompressed", offset: values[1], generationNumber: values[2] };
        batch.push(entry);
        if (batch.length === runEntries) await flush();
        if (admitted % 1024 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      if (batch.length) await flush();
      let result: PdfFileSource | undefined;
      for (let level = levels.length - 1; level >= 0; level--) {
        const run = levels[level];
        if (!run) continue;
        if (!result) result = run;
        else {
          const combined = await stage(merge(result, run, signal));
          await dispose(result);
          await dispose(run);
          result = combined;
        }
      }
      result ??= await stage([]);
      signal?.throwIfAborted();
      owned.delete(result);
      return new PdfObjectIndex(result, signal);
    } catch (error) {
      for (const source of owned) { try { await source.close(); } catch { /* Preserve the primary failure. */ } }
      throw error;
    } finally {
      if (!ended) {
        // An asynchronous generator may queue return behind a pending next.
        // Observe its rejection without making cancellation wait on upstream.
        try {
          const returning = iterator.return?.();
          if (returning) {
            if (signal?.aborted) void Promise.resolve(returning).catch(() => {});
            else await returning;
          }
        } catch { /* Preserve the primary failure. */ }
      }
    }
  }

  async get(objectNumber: number, signal?: AbortSignal): Promise<PdfXRefEntry | undefined> {
    integer(objectNumber, "PDF object number");
    this.assertOpen(signal);
    let low = 0;
    let high = this.size;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      const entry = decode(await this.source.read(middle * recordBytes, recordBytes, signal));
      this.assertOpen(signal);
      if (entry.objectNumber === objectNumber) return entry;
      if (entry.objectNumber < objectNumber) low = middle + 1;
      else high = middle;
    }
    return undefined;
  }

  private assertOpen(signal?: AbortSignal): void {
    this.signal?.throwIfAborted();
    signal?.throwIfAborted();
    if (this.closing) throw new PdfError("E_CAPABILITY", "PDF object index is closed");
  }

  async *entries(signal?: AbortSignal): AsyncGenerator<PdfXRefEntry> {
    this.assertOpen(signal);
    for await (const entry of records(this.source, signal)) {
      this.assertOpen(signal);
      yield entry;
    }
  }
  close(): Promise<void> {
    this.closing ??= this.source.close();
    return this.closing;
  }
}
