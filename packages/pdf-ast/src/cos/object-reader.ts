import { dictGet, type PdfCosDict, type PdfCosNode } from "../ast.js";
import { PdfError } from "../errors.js";
import { PdfFileSource } from "../source.js";
import { decodePdfStreamChunks, type PdfStreamDecodeOptions } from "./filter-stream.js";
import { CosRangeLexer } from "./lexer.js";
import type { PdfIndexStorage, PdfObjectIndex } from "./object-index.js";
import { parseCosRangeObject, parseCosRangeValue, type ParseCosRangeOptions, type PdfRangeObject } from "./range-parser.js";

export interface PdfObjectReaderOptions extends Omit<ParseCosRangeOptions, "resolveLength">, PdfStreamDecodeOptions {
  readonly cacheBytes?: number;
  /** Number of retained decoded object streams; defaults to two. */
  readonly objectStreamCacheEntries?: number;
  /** Aggregate decoded object-stream data and header tape bytes. */
  readonly maxStagingBytes?: number;
  readonly maxObjectStreamMembers?: number;
}
interface ObjectStream {
  readonly data: PdfFileSource;
  readonly header: PdfFileSource;
  readonly count: number;
  readonly first: number;
}
function integer(value: number, name: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || value < minimum) throw new RangeError(`Invalid ${name}`);
  return value;
}
function maximum(value: number | undefined, name: string): number {
  return value === undefined || value === Infinity ? Number.MAX_SAFE_INTEGER : integer(value, name);
}
function field(dict: PdfCosDict, key: string): number {
  const value = dictGet(dict, key);
  if (value?.kind !== "number" || !Number.isSafeInteger(value.value) || value.value < 0) throw new PdfError("E_PARSE", `Invalid object stream /${key}`);
  return value.value;
}

/** Raw indexed COS access. The source and xref index remain caller-owned.
 * Only decoded object streams are cached; each returned AST belongs to its
 * caller. Calls are serialized to bound parsing/decoder working state. This
 * low-level reader does not authenticate or decrypt encrypted documents. */
export class PdfObjectReader {
  private readonly streams = new Map<number, ObjectStream>();
  private readonly options: PdfObjectReaderOptions;
  private readonly capacity: number;
  private readonly stagingLimit: number;
  private stagedBytes = 0;
  private pending: Promise<unknown> = Promise.resolve();
  private closing: Promise<void> | undefined;

  constructor(private readonly source: PdfFileSource, private readonly index: Pick<PdfObjectIndex, "get">,
    private readonly storage: PdfIndexStorage, options: PdfObjectReaderOptions = {}) {
    const chunkBytes = integer(options.chunkBytes ?? 65536, "chunkBytes", 16);
    const cacheBytes = integer(options.cacheBytes ?? 65536, "cacheBytes", chunkBytes);
    this.capacity = integer(options.objectStreamCacheEntries ?? 2, "objectStreamCacheEntries", 1);
    this.stagingLimit = maximum(options.maxStagingBytes, "maxStagingBytes");
    maximum(options.maxObjectStreamMembers, "maxObjectStreamMembers");
    this.options = { maxNodes: 65536, maxTokenBytes: 1048576, maxRecursionDepth: 100,
      ...options, chunkBytes, cacheBytes };
  }

  get(objectNumber: number, generationNumber = 0): Promise<PdfRangeObject | undefined> {
    integer(objectNumber, "objectNumber"); integer(generationNumber, "generationNumber");
    if (this.closing) return Promise.reject(new Error("PDF object reader is closed"));
    const operation = this.pending.then(() => this.load(objectNumber, generationNumber, new Set()));
    this.pending = operation.catch(() => {});
    return operation;
  }

  private async load(objectNumber: number, generationNumber: number, active: Set<number>): Promise<PdfRangeObject | undefined> {
    this.options.signal?.throwIfAborted();
    if (active.has(objectNumber)) throw new PdfError("E_PARSE", "PDF indirect object cycle");
    if (active.size >= this.options.maxRecursionDepth!) throw new PdfError("E_LIMIT", "PDF object resolution depth limit exceeded");
    const entry = await this.index.get(objectNumber, this.options.signal);
    if (!entry || entry.type === "free" || generationNumber !== (entry.generationNumber ?? 0)) return undefined;
    active.add(objectNumber);
    try {
      if (entry.type === "compressed") {
        const container = entry.objectStreamNumber!;
        const streamEntry = await this.index.get(container, this.options.signal);
        if (streamEntry?.type !== "uncompressed") throw new PdfError("E_PARSE", "Object stream must be uncompressed in the xref index");
        const stream = await this.objectStream(container, streamEntry.generationNumber ?? 0, active);
        const ordinal = entry.indexInStream ?? entry.indexInObjectStream!;
        if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= stream.count) throw new PdfError("E_PARSE", "Invalid object stream ordinal");
        const row = await this.headerRow(stream.header, ordinal);
        if (row.number !== objectNumber) throw new PdfError("E_PARSE", "Compressed object identity does not match xref");
        const end = ordinal + 1 === stream.count ? stream.data.size : stream.first + (await this.headerRow(stream.header, ordinal + 1)).offset;
        const start = stream.first + row.offset;
        const parsed = await parseCosRangeValue(stream.data, start, { ...this.options, end });
        if (!parsed.value) throw new PdfError("E_PARSE", "Empty compressed object");
        return { objectNumber, generationNumber, value: parsed.value, span: { start, end: parsed.offset } };
      }
      const object = await parseCosRangeObject(this.source, entry.offset!, {
        ...this.options,
        resolveLength: async reference => {
          const resolved = await this.load(reference.objectNumber, reference.generationNumber, active);
          return resolved?.value.kind === "number" ? resolved.value.value : undefined;
        },
      });
      if (object.objectNumber !== objectNumber || object.generationNumber !== generationNumber) throw new PdfError("E_PARSE", "Indirect object identity does not match xref");
      return object;
    } finally { active.delete(objectNumber); }
  }

  private async headerRow(source: PdfFileSource, ordinal: number): Promise<{ number: number; offset: number }> {
    const bytes = await source.read(ordinal * 16, 16, this.options.signal);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { number: view.getFloat64(0), offset: view.getFloat64(8) };
  }

  private async release(stream: ObjectStream): Promise<void> {
    const results = await Promise.allSettled([stream.header.close(), stream.data.close()]);
    this.stagedBytes -= stream.header.size + stream.data.size;
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }

  private async objectStream(number: number, generation: number, active: Set<number>): Promise<ObjectStream> {
    const cached = this.streams.get(number);
    if (cached) { this.streams.delete(number); this.streams.set(number, cached); return cached; }
    const object = await this.load(number, generation, active);
    if (object?.value.kind !== "dict" || !object.stream || dictGet(object.value, "Type")?.kind !== "name" ||
        (dictGet(object.value, "Type") as { decoded: string }).decoded !== "ObjStm") throw new PdfError("E_PARSE", "Invalid object stream dictionary");
    const count = field(object.value, "N");
    const first = field(object.value, "First");
    if (count > maximum(this.options.maxObjectStreamMembers, "maxObjectStreamMembers") || count > Math.floor(Number.MAX_SAFE_INTEGER / 16)) throw new PdfError("E_LIMIT", "PDF object stream member limit exceeded");
    active.add(number);
    let dict: PdfCosDict;
    try { dict = await this.resolveFilters(object.value, active); } finally { active.delete(number); }
    while (this.streams.size >= this.capacity) {
      const [key, oldest] = this.streams.entries().next().value!;
      this.streams.delete(key); await this.release(oldest);
    }
    const reservedHeader = count * 16;
    if (reservedHeader > this.stagingLimit - this.stagedBytes) throw new PdfError("E_LIMIT", "PDF object stream staging byte limit exceeded");
    // Reserve header space before decoding any payload. No simultaneous decoder
    // or header construction can run through the serialized public entry point.
    const available = this.stagingLimit - this.stagedBytes - reservedHeader;
    const maxDecodedBytes = Math.min(available, maximum(this.options.maxDecodedBytes, "maxDecodedBytes"));
    let data: PdfFileSource | undefined;
    let header: PdfFileSource | undefined;
    try {
      const span = object.stream;
      data = await PdfFileSource.fromStream(this.storage.fs, this.storage.directory,
        decodePdfStreamChunks(dict, () => this.source.stream(span.start, span.end - span.start, this.options.signal), { ...this.options, maxDecodedBytes }),
        { ...this.options, maxInputBytes: maxDecodedBytes });
      if (first > data.size || (count && first === data.size)) throw new PdfError("E_PARSE", "Invalid object stream /First");
      const source = data;
      const options = this.options;
      async function* rows(): AsyncGenerator<Uint8Array> {
        const lexer = new CosRangeLexer(source, { start: 0, end: first, maxTokenBytes: 32, ...(options.signal ? { signal: options.signal } : {}) });
        let previous = -1;
        const chunkBytes = Math.floor(options.chunkBytes! / 16) * 16;
        let bytes = new Uint8Array(chunkBytes);
        let written = 0;
        for (let i = 0; i < count; i++) {
          const id = await lexer.nextToken();
          const offset = await lexer.nextToken();
          if (id?.kind !== "number" || !Number.isSafeInteger(id.value) || id.value < 1 ||
              offset?.kind !== "number" || !Number.isSafeInteger(offset.value) || offset.value <= previous || offset.value >= source.size - first) throw new PdfError("E_PARSE", "Invalid object stream header");
          previous = offset.value;
          const view = new DataView(bytes.buffer, written, 16); view.setFloat64(0, id.value); view.setFloat64(8, offset.value);
          written += 16;
          if (written === bytes.length) { yield bytes; bytes = new Uint8Array(chunkBytes); written = 0; }
        }
        if (written) yield bytes.subarray(0, written);
        if (await lexer.nextToken()) throw new PdfError("E_PARSE", "Extra object stream header entries");
      }
      header = await PdfFileSource.fromStream(this.storage.fs, this.storage.directory, rows(), { ...this.options, maxInputBytes: reservedHeader });
      const result = { data, header, count, first };
      this.stagedBytes += data.size + header.size;
      this.streams.set(number, result);
      return result;
    } catch (error) {
      for (const source of [header, data]) { try { await source?.close(); } catch { /* Preserve the decoding/storage error. */ } }
      throw error;
    }
  }

  private async resolveFilters(dict: PdfCosDict, active: Set<number>): Promise<PdfCosDict> {
    let remaining = this.options.maxNodes!;
    const resolve = async (node: PdfCosNode, depth: number): Promise<PdfCosNode> => {
      if (--remaining < 0 || depth >= this.options.maxRecursionDepth!) throw new PdfError("E_LIMIT", "PDF filter resolution limit exceeded");
      if (node.kind === "ref") {
        if (active.has(node.objectNumber)) throw new PdfError("E_PARSE", "PDF filter reference cycle");
        const object = await this.load(node.objectNumber, node.generationNumber, active);
        if (!object) throw new PdfError("E_PARSE", "Missing PDF filter reference");
        active.add(node.objectNumber);
        try { return await resolve(object.value, depth + 1); } finally { active.delete(node.objectNumber); }
      }
      if (node.kind === "array") {
        const items: PdfCosNode[] = [];
        for (const item of node.items) items.push(await resolve(item, depth + 1));
        return { ...node, items };
      }
      if (node.kind === "dict") {
        const entries = [];
        for (const entry of node.entries) entries.push({ ...entry, value: await resolve(entry.value, depth + 1) });
        return { ...node, entries };
      }
      return node;
    };
    const entries = [];
    for (const entry of dict.entries) entries.push(["Filter", "F", "DecodeParms", "DP"].includes(entry.key.decoded) ? { ...entry, value: await resolve(entry.value, 0) } : entry);
    return { ...dict, entries };
  }

  close(): Promise<void> {
    this.closing ??= this.pending.then(async () => {
      let failure: { error: unknown } | undefined;
      for (const stream of this.streams.values()) { try { await this.release(stream); } catch (error) { failure ??= { error }; } }
      this.streams.clear();
      if (failure) throw failure.error;
    });
    return this.closing;
  }
}
