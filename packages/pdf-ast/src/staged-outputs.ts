import { listenForAbort } from "@poe-code/safe-fs/contracts";
import { PdfNameIndex } from "./cos/name-index.js";
import { PdfObjectIndex, type PdfIndexStorage } from "./cos/object-index.js";
import { PdfError } from "./errors.js";
import { PdfFileSource } from "./source.js";

export interface PdfOutputEntry {
  readonly name: string;
  readonly chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
}
export interface PdfStagedOutput {
  readonly name: string;
  readonly size: number;
  contents(): AsyncGenerator<Uint8Array, void, void>;
}
export interface PdfStagedOutputsOptions {
  readonly chunkBytes?: number;
  /** Aggregate live data, name-index and output-index staging bytes. */
  readonly maxStagingBytes?: number;
  readonly maxNameChars?: number;
  readonly signal?: AbortSignal;
}
function maximum(value: number | undefined, fallback: number): number {
  const result = value ?? fallback;
  if (result !== Infinity && (!Number.isSafeInteger(result) || result < 0)) throw new RangeError("Invalid PDF output limit");
  return Math.min(result, Number.MAX_SAFE_INTEGER);
}
/** Own producer cancellation even while its next() is suspended. */
async function* consume<T>(input: AsyncIterable<T> | Iterable<T>, signal?: AbortSignal): AsyncGenerator<T> {
  signal?.throwIfAborted();
  const iterator = Symbol.asyncIterator in input ? input[Symbol.asyncIterator]() : input[Symbol.iterator]();
  let completed = false;
  let closing: Promise<void> | undefined;
  const close = () => {
    if (completed) return Promise.resolve();
    if (!closing) {
      try { closing = Promise.resolve(iterator.return?.()).then(() => {}, () => {}); }
      catch { closing = Promise.resolve(); }
    }
    return closing;
  };
  try {
    while (true) {
      signal?.throwIfAborted();
      const item = await new Promise<IteratorResult<T>>((resolve, reject) => {
        const dispose = signal ? listenForAbort(signal, () => { dispose(); close(); reject(signal.reason); }) : () => {};
        try {
          Promise.resolve(iterator.next()).then(value => { dispose(); resolve(value); }, error => { dispose(); reject(error); });
        } catch (error) { dispose(); reject(error); }
      });
      signal?.throwIfAborted();
      if (item.done) { completed = true; return; }
      yield item.value;
    }
  } finally { if (signal?.aborted) void close(); else await close(); }
}

async function footer(source: PdfFileSource, end: number, signal?: AbortSignal) {
  if (end < 24) throw new PdfError("E_PARSE", "Invalid staged PDF output footer");
  const bytes = await source.read(end - 24, 24, signal); const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const index = view.getFloat64(0); const characters = view.getFloat64(8); const size = view.getFloat64(16);
  if (![index, characters, size].every(value => Number.isSafeInteger(value) && value >= 0) || characters > Math.floor((end - 24 - size) / 2)) throw new PdfError("E_PARSE", "Invalid staged PDF output record");
  const start = end - 24 - size - characters * 2;
  return { index, characters, size, start, payload: start + characters * 2 };
}

/** Caller-backed replacement for a map of named output buffers. All producers
 * finish before publication begins. Names keep first-insertion order while
 * duplicate names select their last payload, matching buffered command runners. */
export class PdfStagedOutputs {
  private closing: Promise<void> | undefined;
  private constructor(private readonly data: PdfFileSource, private readonly index: PdfObjectIndex,
    private readonly signal: AbortSignal | undefined, private readonly nameLimit: number) {}

  static async create(storage: PdfIndexStorage, input: AsyncIterable<PdfOutputEntry> | Iterable<PdfOutputEntry>, options: PdfStagedOutputsOptions = {}): Promise<PdfStagedOutputs> {
    const chunkBytes = maximum(options.chunkBytes, 65536);
    if (chunkBytes < 32 || chunkBytes === Number.MAX_SAFE_INTEGER) throw new RangeError("PDF output chunkBytes must be finite and at least 32");
    const limit = maximum(options.maxStagingBytes, Infinity);
    const nameLimit = maximum(options.maxNameChars, 1048576);
    const { signal } = options;
    let written = 0;
    const names = new PdfNameIndex(storage, () => limit - written, signal);
    let data: PdfFileSource | undefined; let index: PdfObjectIndex | undefined;
    const charge = (size: number) => {
      if (size > limit - written - names.stagedBytes) throw new PdfError("E_LIMIT", "PDF output staging byte limit exceeded");
      written += size;
    };
    async function* records(): AsyncGenerator<Uint8Array> {
      for await (const entry of consume(input, signal)) {
        signal?.throwIfAborted();
        if (entry.name.length > nameLimit) throw new PdfError("E_LIMIT", "PDF output name limit exceeded");
        const identity = await names.intern(entry.name);
        for (let at = 0; at < entry.name.length;) {
          const count = Math.min(Math.floor(chunkBytes / 2), entry.name.length - at);
          charge(count * 2);
          const bytes = new Uint8Array(count * 2); const view = new DataView(bytes.buffer);
          for (let i = 0; i < count; i++) view.setUint16(i * 2, entry.name.charCodeAt(at + i));
          at += count; yield bytes;
        }
        let size = 0;
        for await (const bytes of consume(entry.chunks, signal)) {
          signal?.throwIfAborted();
          charge(bytes.length); size += bytes.length;
          yield bytes;
        }
        charge(24);
        const bytes = new Uint8Array(24); const view = new DataView(bytes.buffer);
        view.setFloat64(0, identity.index); view.setFloat64(8, entry.name.length); view.setFloat64(16, size); yield bytes;
      }
    }
    try {
      data = await PdfFileSource.fromStream(storage.fs, storage.directory, records(), { chunkBytes, cacheBytes: chunkBytes, maxInputBytes: limit, ...(signal ? { signal } : {}) });
      await names.close();
      const source = data;
      async function* rows() {
        let end = source.size;
        while (end) {
          const record = await footer(source, end, signal);
          yield { objectNumber: record.index, type: "uncompressed" as const, offset: end };
          end = record.start;
        }
      }
      const indexChunk = Math.floor(chunkBytes / 32) * 32;
      index = await PdfObjectIndex.build(rows(), storage, { duplicate: "first", runEntries: 64,
        chunkBytes: indexChunk, cacheBytes: indexChunk, maxStagingBytes: limit - data.size, ...(signal ? { signal } : {}),
      });
      return new PdfStagedOutputs(data, index, signal, nameLimit);
    } catch (error) {
      for (const owned of [index, data, names]) { try { await owned?.close(); } catch { /* Preserve staging failure. */ } }
      throw error;
    }
  }

  async *entries(): AsyncGenerator<PdfStagedOutput, void, void> {
    if (this.closing) throw new PdfError("E_CAPABILITY", "PDF staged outputs are closed");
    for await (const entry of this.index.entries(this.signal)) {
      const record = await footer(this.data, entry.offset!, this.signal);
      if (record.characters > this.nameLimit) throw new PdfError("E_LIMIT", "PDF output name limit exceeded");
      let name = ""; let at = record.start;
      while (at < record.payload) {
        const bytes = await this.data.read(at, Math.min(Math.floor(this.data.chunkBytes / 2) * 2, record.payload - at), this.signal);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
        let part = ""; for (let i = 0; i < bytes.length; i += 2) part += String.fromCharCode(view.getUint16(i));
        name += part; at += bytes.length;
      }
      const data = this.data; const signal = this.signal;
      yield { name, size: record.size, contents: () => data.stream(record.payload, record.size, signal) };
    }
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      const results = await Promise.allSettled([this.index.close(), this.data.close()]);
      for (const result of results) if (result.status === "rejected") throw result.reason;
    })();
    return this.closing;
  }
}
