import { readPdfDictionaryValue } from "../content/stored-dictionary.js";
import { PdfReferenceSet, type PdfReferencePath } from "./reference-set.js";
import type { ValueArrayStorage } from "./value-parser.js";
import { resolvePdfStreamDictionary } from "./filter-dictionary.js";
import { scanCosRangeObjects } from "./range-repair.js";
import { recoveredBodies, recoverPdfReferences } from "./recovered-reference.js";
import { cosRef, dictGet, type PdfXRefEntry, type PdfCosDict, type PdfCosNode, type PdfCosRef, type PdfEncryptionState } from "../ast.js";
import { PdfError } from "../errors.js";
import { PdfFileSource } from "../source.js";
import { decodePdfStreamChunks, type PdfStreamDecodeOptions } from "./filter-stream.js";
import { openPdfCrossReference, type PdfCrossReference, type PdfCrossReferenceOptions } from "./cross-reference.js";
import { decryptPdfObjectStrings, decodePdfEncryptedStreamChunks, derivePdfEncryptionKey } from "./security.js";
import { CosRangeLexer } from "./lexer.js";
import { PdfObjectIndex, type PdfIndexStorage } from "./object-index.js";
import { parseCosRangeObject, parseCosRangeValue, type ParseCosRangeOptions, type PdfRangeObject } from "./range-parser.js";

export interface PdfObjectReaderOptions extends Omit<ParseCosRangeOptions, "resolveLength" | keyof ValueArrayStorage>, PdfStreamDecodeOptions {
  /** Default backing for selected values in object and stream dictionary lookups.
   * Cross-reference bootstrap remains independently configured. */
  readonly valueArrays?: ValueArrayStorage;
  readonly cacheBytes?: number;
  readonly encryption?: PdfEncryptionState;
  readonly encryptionObjectNumber?: number;
  /** Number of retained decoded object streams; defaults to two. */
  readonly objectStreamCacheEntries?: number;
  /** Aggregate decoded object-stream data and header tape bytes. */
  readonly maxStagingBytes?: number;
  readonly maxObjectStreamMembers?: number;
  /** Live ancestor-index staging for each indirect reference traversal. */
  readonly maxTraversalStagingBytes?: number;
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
 * low-level constructor accepts authenticated security state; use
 * openPdfObjectReader to discover xrefs and authenticate a password. */
export class PdfObjectReader {
  private readonly streams = new Map<number, ObjectStream>();
  // Recursive length/object-stream lookups share one failure identity so an
  // outer recovery pass cannot mistake a caller-storage error for PDF syntax.
  private readonly backingFailures = new WeakMap<Set<number>, { error: unknown }>();
  private readonly referencePaths = new WeakMap<Set<number>, PdfReferencePath>();
  private readonly repairedOffsets = new Map<number, number>();
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
    maximum(options.maxTraversalStagingBytes, "maxTraversalStagingBytes");
    this.options = { maxNodes: 65536, maxTokenBytes: 1048576, maxRecursionDepth: 100,
      ...options, chunkBytes, cacheBytes };
  }

  get(objectNumber: number, generationNumber = 0, arrays: ValueArrayStorage = this.options.valueArrays ?? {}): Promise<PdfRangeObject | undefined> {
    integer(objectNumber, "objectNumber"); integer(generationNumber, "generationNumber");
    return this.enqueue(() => this.load(objectNumber, generationNumber, new Set(), arrays));
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error("PDF object reader is closed"));
    const operation = this.pending.then(work);
    this.pending = operation.then(() => {}, () => {});
    return operation;
  }

  /** Decode one retained stream under consumer backpressure. The caller owns
   * the source and must keep it open until iteration finishes. */
  async *decodeStream(objectNumber: number, generationNumber = 0, options: Pick<PdfStreamDecodeOptions, "stopBeforeImageCodec" | "raw"> = {}): AsyncGenerator<Uint8Array, void, void> {
    integer(objectNumber, "objectNumber"); integer(generationNumber, "generationNumber");
    const { object, dict } = await this.enqueue(async () => {
      const arrays = this.options.valueArrays;
      const object = await this.load(objectNumber, generationNumber, new Set(), arrays?.dictionaryStorage ? {...arrays, storeRootDictionary:true} : arrays);
      if (object?.value.kind !== "dict" || !object.stream) throw new PdfError("E_PARSE", "Expected an indexed PDF stream");
      const active = new Set([objectNumber]);
      return { object, dict: await this.resolveStreamDictionary(object.value, active) };
    });
    const span = object.stream!;
    const input = () => this.source.stream(span.start, span.end - span.start, this.options.signal);
    const security = this.options.encryption;
    const decodeOptions = { ...this.options, stopBeforeImageCodec: options.stopBeforeImageCodec ?? false, raw: options.raw ?? false };
    yield* security ? decodePdfEncryptedStreamChunks(security, objectNumber, generationNumber, dict, input, decodeOptions)
      : decodePdfStreamChunks(dict, input, decodeOptions);
  }

  private resolveStreamDictionary(dict: PdfCosDict, active: Set<number>): Promise<PdfCosDict> {
    return resolvePdfStreamDictionary(dict, async (ref, path) => {
      const parent = this.referencePaths.get(active);
      this.referencePaths.set(active, path);
      try { return await this.load(ref.objectNumber, ref.generationNumber, active); }
      finally { if (parent) this.referencePaths.set(active, parent); else this.referencePaths.delete(active); }
    }, active, { ...this.options, referenceStorage: this.storage, referencePath: this.referencePaths.get(active),
      onBackingError: error => { this.backingFailures.set(active, { error }); this.options.onBackingError?.(error); } });
  }

  /** A stream-valued /Length is invalid as a length, but its references still
   * need cycle, admission and backing-error validation. Walk those discarded
   * values in source order instead of retaining one parser and AST per link. */
  private async resolveLength(reference: PdfCosRef, active: Set<number>): Promise<number | undefined> {
    const path: PdfReferencePath = { seen: new PdfReferenceSet(this.storage, this.options.maxTraversalStagingBytes, this.options.signal),
      parent: this.referencePaths.get(active), depth: 0 };
    this.referencePaths.set(active, path);
    let next: PdfCosRef | undefined = reference, result: number | undefined, failed = false;
    try {
      while (next) {
        const current = next;
        next = undefined;
        const object = await this.load(current.objectNumber, current.generationNumber, active, this.options.valueArrays ?? {},
          async child => { next = child; return undefined; });
        if (path.depth === 0 && object?.value.kind === "number") result = object.value.value;
        // Keep ancestor identities for nested compressed-object/filter lookups,
        // even though the corresponding discarded ASTs have been released.
        try { await path.seen.add(current.objectNumber); }
        catch (error) { this.backingFailures.set(active, { error }); this.options.onBackingError?.(error); throw error; }
        path.depth++;
      }
      return result;
    } catch (error) { failed = true; throw error; }
    finally {
      if (path.parent) this.referencePaths.set(active, path.parent); else this.referencePaths.delete(active);
      try { await path.seen.close(); } catch (error) {
        if (!failed) { this.backingFailures.set(active, { error }); this.options.onBackingError?.(error); await Promise.reject(error); }
      }
    }
  }

  private async load(objectNumber: number, generationNumber: number, active: Set<number>, arrays: ValueArrayStorage = this.options.valueArrays ?? {}, resolveLength?: ParseCosRangeOptions["resolveLength"]): Promise<PdfRangeObject | undefined> {
    this.options.signal?.throwIfAborted();
    if (active.has(objectNumber)) throw new PdfError("E_PARSE", "PDF indirect object cycle");
    let depth = active.size;
    for (let path = this.referencePaths.get(active); path; path = path.parent) {
      let seen: boolean;
      try { seen = await path.seen.has(objectNumber); }
      catch (error) { this.backingFailures.set(active, { error }); this.options.onBackingError?.(error); throw error; }
      if (seen) throw new PdfError("E_PARSE", "PDF indirect object cycle");
      depth += path.depth;
    }
    if (depth >= this.options.maxRecursionDepth!) throw new PdfError("E_LIMIT", "PDF object resolution depth limit exceeded");
    const entry = await this.index.get(objectNumber, this.options.signal);
    if (!entry || entry.type === "free" || generationNumber !== (entry.generationNumber ?? 0)) return undefined;
    active.add(objectNumber);
    const onBackingError = (error: unknown) => { this.backingFailures.set(active, { error }); this.options.onBackingError?.(error); };
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
        const parsed = await parseCosRangeValue(stream.data, start, { ...this.options, ...arrays, end, onBackingError });
        if (!parsed.value) throw new PdfError("E_PARSE", "Empty compressed object");
        return { objectNumber, generationNumber, value: parsed.value, span: { start, end: parsed.offset } };
      }
      let object: PdfRangeObject;
      let pendingLength: Promise<number | undefined> | undefined;
      try {
        object = await parseCosRangeObject(this.source, this.repairedOffsets.get(objectNumber) ?? entry.offset!, {
          ...this.options, ...arrays, onBackingError,
          resolveLength: reference => pendingLength = resolveLength ? resolveLength(reference) : this.resolveLength(reference, active),
        });
        if (object.objectNumber !== objectNumber || object.generationNumber !== generationNumber) throw new PdfError("E_PARSE", "Indirect object identity does not match xref");
      } catch (error) {
        // The parser races cancellation against its resolver. This resolver is
        // reader-owned, so drain its staging cleanup before publishing failure.
        await pendingLength?.catch(() => {});
        this.options.signal?.throwIfAborted();
        const backingFailure = this.backingFailures.get(active);
        if (backingFailure && Object.is(backingFailure.error, error)) throw error;
        if (this.options.recovery !== "repair" || !(error instanceof PdfError) || error.code !== "E_PARSE") throw error;
        let recovered: PdfRangeObject | undefined;
        for await (const event of scanCosRangeObjects(this.source, { ...this.options, ...arrays, onBackingError })) {
          if (event.kind === "object" && event.object.objectNumber === objectNumber && event.object.generationNumber === generationNumber) recovered = event.object;
        }
        if (!recovered) throw error;
        object = recovered;
        if (this.repairedOffsets.size >= 64) this.repairedOffsets.delete(this.repairedOffsets.keys().next().value!);
        this.repairedOffsets.set(objectNumber, object.span.start);
      }
      if (this.options.encryption && objectNumber !== this.options.encryptionObjectNumber) {
        let type: PdfCosNode | undefined;
        if(object.stream && object.value.kind==="dict"){
          try{type=object.value.storedEntries ? await readPdfDictionaryValue(object.value,"Type",this.options.signal,{preserveDeferred:true}) : dictGet(object.value,"Type");}
          catch(error){onBackingError(error);throw error;}
        }
        if (type?.kind === "ref") type = (await this.load(type.objectNumber, type.generationNumber, active))?.value;
        const value = await decryptPdfObjectStrings(this.options.encryption, objectNumber, generationNumber, object.value,
          { ...(type?.kind === "name" ? { streamType: type.decoded } : {}), ...(this.options.signal ? { signal: this.options.signal } : {}) });
        return { ...object, value };
      }
      return object;
    } finally { active.delete(objectNumber); }
  }

  /** Discover compressed members after authentication, without retaining a
   * member array. Each pull re-enters the serialized cache before reading. */
  async *objectStreamEntries(objectNumber: number, generationNumber = 0): AsyncGenerator<PdfXRefEntry, void> {
    integer(objectNumber, "objectNumber"); integer(generationNumber, "generationNumber");
    for (let ordinal = 0; ; ordinal++) {
      const entry = await this.enqueue(async () => {
        const stream = await this.objectStream(objectNumber, generationNumber, new Set());
        if (ordinal >= stream.count) return undefined;
        const row = await this.headerRow(stream.header, ordinal);
        return { objectNumber: row.number, type: "compressed" as const, objectStreamNumber: objectNumber, indexInStream: ordinal };
      });
      if (!entry) return;
      yield entry;
    }
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
    try { dict = await this.resolveStreamDictionary(object.value, active); } finally { active.delete(number); }
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
      const input = () => this.source.stream(span.start, span.end - span.start, this.options.signal);
      const decodeOptions = { ...this.options, maxDecodedBytes };
      const decoded = this.options.encryption
        ? decodePdfEncryptedStreamChunks(this.options.encryption, number, generation, dict, input, decodeOptions)
        : decodePdfStreamChunks(dict, input, decodeOptions);
      data = await PdfFileSource.fromStream(this.storage.fs, this.storage.directory, decoded,
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

  close(): Promise<void> {
    this.closing ??= this.pending.then(async () => {
      let failure: { error: unknown } | undefined;
      for (const stream of this.streams.values()) { try { await this.release(stream); } catch (error) { failure ??= { error }; } }
      this.streams.clear();
      this.repairedOffsets.clear();
      if (failure) throw failure.error;
    });
    return this.closing;
  }
}

export interface OpenPdfObjectReaderOptions extends Omit<PdfObjectReaderOptions, "encryption" | "encryptionObjectNumber"> {
  readonly password?: string;
  readonly xref?: PdfCrossReferenceOptions;
}
export interface PdfOpenedObjectReader {
  readonly crossReference: PdfCrossReference;
  readonly reader: Pick<PdfObjectReader, "get" | "decodeStream" | "objectStreamEntries" | "close">;
  readonly encryption?: PdfEncryptionState;
  /** Close the reader and owned xref index. The source remains caller-owned. */
  close(): Promise<void>;
}

/** Discover a retained document's index and authenticate its security dictionary
 * before any encrypted object streams are loaded. Only the intrinsically bounded
 * encryption dictionary reference graph is retained during authentication. */
export async function openPdfObjectReader(source: PdfFileSource, storage: PdfIndexStorage,
  options: OpenPdfObjectReaderOptions = {}): Promise<PdfOpenedObjectReader> {
  // Storage can throw syntax-shaped errors. Carry their identity across all
  // bootstrap readers so repair never turns a failed capability into a retry.
  let backingFailure: { error: unknown } | undefined;
  const callerBackingError = options.onBackingError;
  const xrefBackingError = options.xref?.onBackingError;
  const onBackingError = (error: unknown) => {
    backingFailure = { error };
    callerBackingError?.(error);
  };
  options = { ...options, onBackingError };
  const canRepair = (error: unknown): boolean =>
    !(backingFailure && Object.is(backingFailure.error, error)) && error instanceof PdfError && error.code === "E_PARSE";
  const xrefOptions = { maxNodes: 65536, maxTokenBytes: 1048576, maxRecursionDepth: 100, ...options, ...options.xref,
    onBackingError(error: unknown) { onBackingError(error); if (xrefBackingError !== callerBackingError) xrefBackingError?.(error); } };
  let crossReference: PdfCrossReference;
  let repaired = false;
  try { crossReference = await openPdfCrossReference(source, storage, xrefOptions); }
  catch (error) {
    options.signal?.throwIfAborted();
    if (options.recovery !== "repair" || !canRepair(error)) throw error;
    crossReference = await recoverPdfReferences(source, storage, xrefOptions); repaired = true;
  }
  let reader: PdfObjectReader | undefined;
  let previousIndex: PdfObjectIndex | undefined;
  try {
    reader = new PdfObjectReader(source, crossReference.index, storage, options);
    // A syntactically readable xref can still name a non-catalog root. Recover
    // unencrypted inputs before trusting that root, as the buffered scan does.
    // Encrypted compressed roots require authentication before inspection.
    if (!repaired && options.recovery === "repair" && !crossReference.encryptNode) {
      let valid = false;
      try {
        const root = await reader.get(crossReference.rootRef.objectNumber, crossReference.rootRef.generationNumber);
        const pages = root?.value.kind === "dict" && !root.stream ? dictGet(root.value, "Pages") : undefined;
        valid = pages?.kind === "ref" || pages?.kind === "dict";
      } catch (error) { if (!canRepair(error)) throw error; }
      if (!valid) {
        await reader.close();
        await crossReference.index.close();
        crossReference = await recoverPdfReferences(source, storage, xrefOptions);
        reader = new PdfObjectReader(source, crossReference.index, storage, options);
        repaired = true;
      }
    }
    let encryption: PdfEncryptionState | undefined;
    const encrypt = crossReference.encryptNode;
    if (encrypt) {
      const nodes = new Map<string, PdfCosNode>();
      const key = (node: { objectNumber: number; generationNumber: number }) => `${node.objectNumber}:${node.generationNumber}`;
      const depthLimit = options.maxRecursionDepth ?? 100;
      let remaining = options.maxNodes ?? 65536;
      async function collect(node: PdfCosNode, depth: number): Promise<void> {
        options.signal?.throwIfAborted();
        if (--remaining < 0 || depth > depthLimit) throw new PdfError("E_LIMIT", "PDF encryption dictionary limit exceeded");
        if (node.kind === "ref") {
          const id = key(node);
          if (nodes.has(id)) return;
          const object = await reader!.get(node.objectNumber, node.generationNumber);
          if (!object || object.stream) throw new PdfError("E_PARSE", "Invalid encryption dictionary reference");
          nodes.set(id, object.value);
          await collect(object.value, depth + 1);
        } else if (node.kind === "dict") {
          for (const entry of node.entries) await collect(entry.value, depth + 1);
        } else if (node.kind === "array") {
          for (const item of node.items) await collect(item, depth + 1);
        }
      }
      await collect(encrypt, 0);
      const dict = encrypt.kind === "ref" ? nodes.get(key(encrypt)) : encrypt;
      if (dict?.kind !== "dict") throw new PdfError("E_PARSE", "Missing /Encrypt dictionary object");
      const id = crossReference.idArray?.items[0];
      encryption = derivePdfEncryptionKey(dict, id?.kind === "string" ? id.bytes : new Uint8Array(16), options.password ?? "",
        { resolve: node => node.kind === "ref" ? nodes.get(key(node)) : node, maxRecursionDepth: depthLimit });
      options.signal?.throwIfAborted();
      await reader.close();
      reader = new PdfObjectReader(source, crossReference.index, storage,
        { ...options, encryption, ...(encrypt.kind === "ref" ? { encryptionObjectNumber: encrypt.objectNumber } : {}) });
    }
    if (repaired) {
      const direct = crossReference.index;
      const currentReader = reader;
      async function* recoveredEntries(): AsyncGenerator<PdfXRefEntry> {
        yield* direct.entries(options.signal);
        for await (const object of recoveredBodies(source, direct, storage, xrefOptions)) {
          const type = object?.value.kind === "dict" && dictGet(object.value, "Type");
          if (!object?.stream || !type || type.kind !== "name" || type.decoded !== "ObjStm") continue;
          try { yield* currentReader.objectStreamEntries(object.objectNumber, object.generationNumber); }
          catch (error) { if (!canRepair(error)) throw error; }
        }
      }
      const recovered = await PdfObjectIndex.build(recoveredEntries(), storage, { ...options.xref?.index, maxEntries: Math.min(options.xref?.maxEntries ?? Infinity, options.xref?.index?.maxEntries ?? Infinity), duplicate: "first", ...(options.signal ? { signal: options.signal } : {}) });
      previousIndex = direct;
      crossReference = { ...crossReference, index: recovered };
      await reader.close();
      await direct.close();
      previousIndex = undefined;
      reader = new PdfObjectReader(source, recovered, storage, { ...options, ...(encryption ? { encryption } : {}),
        ...(encrypt?.kind === "ref" ? { encryptionObjectNumber: encrypt.objectNumber } : {}),
      });
      if (crossReference.rootRef.objectNumber === 0 || !crossReference.infoRef) {
        let root = crossReference.rootRef; let info = crossReference.infoRef;
        for await (const entry of recovered.entries(options.signal)) {
          let object: PdfRangeObject | undefined;
          try { object = await reader.get(entry.objectNumber, entry.generationNumber ?? 0); }
          catch (error) { if (canRepair(error)) continue; throw error; }
          if (object?.value.kind !== "dict") continue;
          const type = dictGet(object.value, "Type");
          if (crossReference.rootRef.objectNumber === 0 && type?.kind === "name" && type.decoded === "Catalog") root = cosRef(object.objectNumber, object.generationNumber);
          if (!crossReference.infoRef && ["Title", "Producer", "Author"].some(key => dictGet(object.value as PdfCosDict, key))) info = cosRef(object.objectNumber, object.generationNumber);
        }
        crossReference = { ...crossReference, rootRef: root, ...(info ? { infoRef: info } : {}) };
      }
      if (crossReference.rootRef.objectNumber === 0) throw new PdfError("E_PARSE", "Unable to repair PDF: no /Type /Catalog object found");
    }
    const ownedReader = reader;
    let closing: Promise<void> | undefined;
    return { crossReference, reader: ownedReader, ...(encryption ? { encryption } : {}), close() {
      closing ??= (async () => {
        let failure: { error: unknown } | undefined;
        try { await ownedReader.close(); } catch (error) { failure = { error }; }
        try { await crossReference.index.close(); } catch (error) { failure ??= { error }; }
        if (failure) throw failure.error;
      })();
      return closing;
    } };
  } catch (error) {
    for (const close of [() => reader?.close(), () => crossReference.index.close(), () => previousIndex?.close()]) { try { await close(); } catch { /* Preserve authentication/parse failure. */ } }
    throw error;
  }
}
