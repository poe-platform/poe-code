import { IntegerTable, PagedStorage } from "@poe-code/safe-fs/storage";
import { cosRef, type PdfCosNode, type PdfCosRef } from "../ast.js";
import { PdfError } from "../errors.js";
import type { PdfIndexStorage } from "./object-index.js";
import { pdfOutputStreamDictionary, type PdfSerializedOutputObject, type PdfRetainedOutputObject } from "./retained-writer.js";
import { parseCosRangeValue, type ParseCosRangeOptions } from "./range-parser.js";
import { serializeCosNodeChunks } from "./writer.js";

export interface PdfMutableObjectStoreOptions extends Pick<ParseCosRangeOptions, "maxNodes" | "maxTokenBytes" | "maxRecursionDepth" | "signal"> {
  readonly maxObjects?: number;
  /** Append-only backing, including superseded values and index nodes. */
  readonly maxStagingBytes?: number;
}
function maximum(value: number | undefined): number {
  if (value === undefined || value === Infinity) return Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("Invalid mutable PDF storage limit");
  return value;
}

// The general parser records input syntax in encoding, while the writer uses
// format. Stored values must replay the syntax we chose when accepting them.
function restoreStringFormats(value: PdfCosNode): PdfCosNode {
  if (value.kind === "string") return { ...value, format: value.encoding ?? "literal" };
  if (value.kind === "array") for (let i = 0; i < value.items.length; i++) value.items[i] = restoreStringFormats(value.items[i]!);
  if (value.kind === "dict") for (let i = 0; i < value.entries.length; i++) { const entry = value.entries[i]!; value.entries[i] = { ...entry, value: restoreStringFormats(entry.value) }; }
  return value;
}

/** Mutable COS ownership with fixed caches and caller-backed payloads/indexes.
 * Replacements commit their index pointer only after all bytes are accepted.
 * Existing snapshots remain readable until close; obsolete bytes are reclaimed
 * when the store closes. Structural values are admitted by parser limits. */
export class PdfMutableObjectStore {
  private readonly backing: PagedStorage;
  private readonly index: IntegerTable;
  private readonly controller = new AbortController();
  private readonly signal: AbortSignal;
  private readonly maxObjects: number;
  private readonly maxBytes: number;
  private reserved = 0;
  private highest = 0;
  private pending: Promise<unknown> = Promise.resolve();
  private closing: Promise<void> | undefined;
  constructor(storage: PdfIndexStorage, private readonly options: PdfMutableObjectStoreOptions = {}) {
    this.maxObjects = maximum(options.maxObjects); this.maxBytes = maximum(options.maxStagingBytes);
    this.signal = options.signal ? AbortSignal.any([options.signal, this.controller.signal]) : this.controller.signal;
    this.backing = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal: this.signal }, 4);
    this.index = new IntegerTable({ allocate: length => this.reserve(length), read: this.backing.read.bind(this.backing), write: this.backing.write.bind(this.backing) }, 64);
  }
  private reserve(length: number): number {
    this.signal.throwIfAborted();
    if (!Number.isSafeInteger(length) || length < 0 || length > this.maxBytes - this.reserved) throw new PdfError("E_LIMIT", "PDF mutable backing byte limit exceeded");
    const position = this.backing.allocate(length); this.reserved += length; return position;
  }
  private operation<T>(work: () => Promise<T>): Promise<T> {
    const task = this.pending.then(() => { this.signal.throwIfAborted(); return work(); });
    this.pending = task.catch(() => {}); return task;
  }
  allocate(value: PdfCosNode = { kind: "null" }): Promise<PdfCosRef> {
    return this.operation(async () => { const number = this.highest + 1; await this.save({ objectNumber: number, generationNumber: 0, value }); return cosRef(number); });
  }
  set(object: PdfRetainedOutputObject): Promise<void> { return this.operation(() => this.save(object)); }
  private async save(object: PdfRetainedOutputObject): Promise<void> {
    const number = object.objectNumber, generation = object.generationNumber;
    if (!Number.isSafeInteger(number) || number < 1 || !Number.isSafeInteger(generation) || generation < 0 || generation > 65535) throw new RangeError("Invalid PDF object identity");
    if (number > this.maxObjects) throw new PdfError("E_LIMIT", "PDF mutable object limit exceeded");
    if (object.value.kind === "stream" || (object.stream && object.value.kind !== "dict")) throw new PdfError("E_CAPABILITY", "Mutable PDF streams require a dictionary and chunk source");
    const length = object.stream?.length ?? 0;
    if (!Number.isSafeInteger(length) || length < 0) throw new RangeError("Invalid PDF stream length");
    // Admit the declared payload before traversing or consuming it.
    if (length + 64 > this.maxBytes - this.reserved) throw new PdfError("E_LIMIT", "PDF mutable backing byte limit exceeded");
    const recordAt = this.reserve(64), valueAt = this.reserve(0); let valueLength = 0, work = 0;
    for (const bytes of serializeCosNodeChunks(object.value, { chunkBytes: 16384, maxRecursionDepth: this.options.maxRecursionDepth ?? Infinity, signal: this.signal })) {
      const at = this.reserve(bytes.length); await this.backing.write(at, bytes); valueLength += bytes.length;
      if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    const streamAt = this.reserve(length); let written = 0;
    if (object.stream) for await (const bytes of object.stream.chunks) {
      this.signal.throwIfAborted(); if (bytes.length > length - written) throw new PdfError("E_PARSE", "Excess mutable PDF stream bytes");
      for (let at = 0; at < bytes.length; at += 16384) {
        await this.backing.write(streamAt + written + at, bytes.subarray(at, at + 16384));
        if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      written += bytes.length;
    }
    if (written !== length) throw new PdfError("E_PARSE", "Incomplete mutable PDF stream bytes");
    let outputValueAt = valueAt, outputValueLength = valueLength;
    if (object.stream) {
      outputValueAt = this.reserve(0); outputValueLength = 0;
      for (const bytes of serializeCosNodeChunks(pdfOutputStreamDictionary(object.value, length), { chunkBytes: 16384, maxRecursionDepth: this.options.maxRecursionDepth ?? Infinity, signal: this.signal })) {
        await this.backing.write(this.reserve(bytes.length), bytes); outputValueLength += bytes.length;
        if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    }
    const record = new Uint8Array(64), view = new DataView(record.buffer);
    [generation, valueAt, valueLength, streamAt, length, object.stream ? 1 : 0, outputValueAt, outputValueLength].forEach((value, i) => view.setFloat64(i * 8, value));
    await this.backing.write(recordAt, record); this.signal.throwIfAborted();
    await this.index.set(BigInt(number), BigInt(recordAt)); this.highest = Math.max(this.highest, number);
  }
  get(number: number): Promise<PdfRetainedOutputObject | undefined> {
    return this.operation(async () => {
      if (!Number.isSafeInteger(number) || number < 1) throw new RangeError("Invalid PDF object number");
      const at = await this.index.get(BigInt(number)); return at === undefined ? undefined : this.load(number, Number(at));
    });
  }
  private async load(number: number, at: number): Promise<PdfRetainedOutputObject> {
    const bytes = await this.backing.read(at, 64), record = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    const generation = record.getFloat64(0), valueAt = record.getFloat64(8), valueLength = record.getFloat64(16), streamAt = record.getFloat64(24), length = record.getFloat64(32), hasStream = record.getFloat64(40);
    const backing = this.backing, signal = this.signal;
    const source = { size: valueLength, chunkBytes: 16384, read: async (position: number, count: number, callerSignal?: AbortSignal) => {
      signal.throwIfAborted(); callerSignal?.throwIfAborted(); return backing.read(valueAt + position, Math.min(count, valueLength - position));
    } };
    const parsed = await parseCosRangeValue(source, 0, { ...this.options, signal });
    if (!parsed.value) throw new PdfError("E_PARSE", "Missing mutable PDF value");
    const object = { objectNumber: number, generationNumber: generation, value: restoreStringFormats(parsed.value) };
    if (!hasStream) return object;
    async function* chunks() {
      for (let offset = 0; offset < length; offset += 16384) {
        if (offset > 0 && offset % (16384 * 64) === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
        signal.throwIfAborted(); yield await backing.read(streamAt + offset, Math.min(16384, length - offset));
      }
    }
    return { ...object, stream: { length, chunks: chunks() } };
  }
  async *objects(): AsyncGenerator<PdfRetainedOutputObject, void, void> {
    await this.pending; this.signal.throwIfAborted();
    for await (const [number, position] of this.index.entries()) { this.signal.throwIfAborted(); yield await this.load(Number(number), Number(position)); }
  }
  /** Replay owned serialization directly, without parsing value trees. Returned
   * bodies borrow this store and retain their snapshot across replacements. */
  async *outputObjects(): AsyncGenerator<PdfSerializedOutputObject, void, void> {
    await this.pending; this.signal.throwIfAborted();
    const backing = this.backing, signal = this.signal;
    async function* range(at: number, length: number) {
      for (let offset = 0, work = 0; offset < length; offset += 16384) {
        if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
        signal.throwIfAborted(); yield await backing.read(at + offset, Math.min(16384, length - offset));
      }
    }
    let work = 0;
    for await (const [number, position] of this.index.entries()) {
      if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      this.signal.throwIfAborted();
      const bytes = await backing.read(Number(position), 64), record = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      const generation = record.getFloat64(0), streamAt = record.getFloat64(24), streamLength = record.getFloat64(32), hasStream = record.getFloat64(40);
      const valueAt = record.getFloat64(48), valueLength = record.getFloat64(56);
      async function* chunks() {
        yield* range(valueAt, valueLength);
        if (hasStream) {
          yield new TextEncoder().encode("\nstream\n"); yield* range(streamAt, streamLength); yield new TextEncoder().encode("\nendstream");
        }
      }
      yield { objectNumber: Number(number), generationNumber: generation, body: { length: valueLength + (hasStream ? streamLength + 18 : 0), chunks: chunks() } };
    }
  }
  close(): Promise<void> {
    this.controller.abort(new PdfError("E_CANCELLED", "Mutable PDF store closed"));
    return this.closing ??= (async () => { await this.pending; await this.backing.close(); })();
  }
}
