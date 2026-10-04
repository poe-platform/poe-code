import { listenForAbort } from "@poe-code/safe-fs/contracts";
import { dictGet, type ByteSpan, type PdfCosNode, type PdfCosRef } from "../ast.js";
import { PdfError } from "../errors.js";
import type { PdfFileSource } from "../source.js";
import { CosRangeLexer, isPdfDelimiter, isPdfWhitespace } from "./lexer.js";
import { appendStoredRecord } from "../content/stored-record.js";
import { parseValueSteps, type ValueArrayStorage } from "./value-parser.js";

export interface ParseCosRangeOptions extends ValueArrayStorage {
  /** @internal Distinguish caller storage failures from recoverable PDF syntax. */
  readonly onBackingError?: (error: unknown) => void;
  /** Exclusive direct-value boundary, used for object-stream members. */
  readonly end?: number;
  readonly recovery?: "strict" | "repair";
  readonly maxRecursionDepth?: number;
  readonly maxTokenBytes?: number;
  readonly maxNodes?: number;
  readonly signal?: AbortSignal;
  /** Resolve /Length through the caller's object index, without scanning payloads. */
  readonly resolveLength?: (reference: PdfCosRef, signal?: AbortSignal) => Promise<number | undefined>;
}

export interface PdfRangeObject {
  readonly objectNumber: number;
  readonly generationNumber: number;
  /** Stream objects retain their dictionary here and their payload range below. */
  readonly value: PdfCosNode;
  readonly stream?: ByteSpan;
  readonly span: ByteSpan;
}

function limit(value: number | undefined, name: string): number {
  const result = value ?? Infinity;
  if (result !== Infinity && (!Number.isSafeInteger(result) || result < 0)) throw new RangeError(`Invalid ${name}`);
  return result;
}

async function byteAt(source: PdfFileSource, offset: number, signal?: AbortSignal): Promise<number | undefined> {
  if (offset < 0 || offset >= source.size) return undefined;
  return (await source.read(offset, 1, signal))[0];
}

// Probe only a fixed keyword, rather than lexing an arbitrarily large binary
// token when an incorrect /Length points into the middle of a payload.
async function keywordAt(source: PdfFileSource, offset: number, word: string, signal?: AbortSignal): Promise<number | undefined> {
  const lexer = new CosRangeLexer(source, { start: offset, ...(signal ? { signal } : {}) });
  await lexer.skipWhitespaceAndComments();
  let position = lexer.offset;
  for (let i = 0; i < word.length; i++) {
    if (await byteAt(source, position++, signal) !== word.charCodeAt(i)) return undefined;
  }
  const after = await byteAt(source, position, signal);
  return after === undefined || isPdfWhitespace(after) || isPdfDelimiter(after) ? position : undefined;
}

async function findEndstream(source: PdfFileSource, start: number, signal?: AbortSignal): Promise<number> {
  const marker = "endstream";
  let matched = 0;
  let position = start;
  let first = -1;
  let turns = 0;
  for await (const bytes of source.stream(start, source.size - start, signal)) {
    for (const byte of bytes) {
      matched = byte === marker.charCodeAt(matched) ? matched + 1 : byte === marker.charCodeAt(0) ? 1 : 0;
      position++;
      if (matched === marker.length) {
        const offset = position - marker.length;
        if (first < 0) first = offset;
        if (await keywordAt(source, position, "endobj", signal) !== undefined) return offset;
        matched = 0;
      }
    }
    if (++turns % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    signal?.throwIfAborted();
  }
  return first;
}

async function resolveStreamLength(entry: PdfCosNode | undefined, options: ParseCosRangeOptions): Promise<number | undefined> {
  if (entry?.kind === "number") return entry.value;
  const resolve = options.resolveLength;
  if (entry?.kind !== "ref" || !resolve) return undefined;
  const { signal } = options;
  if (!signal) return resolve(entry);
  signal.throwIfAborted();
  let dispose = () => {};
  const cancelled = new Promise<never>((ignored, reject) => {
    dispose = listenForAbort(signal, () => reject(signal.reason));
  });
  const pending = Promise.resolve().then(() => {
    signal.throwIfAborted();
    return resolve(entry, signal);
  });
  try { return await Promise.race([pending, cancelled]); }
  finally { dispose(); }
}

async function readValue(lexer: CosRangeLexer, depth: number, nodes: number, options: ParseCosRangeOptions): Promise<PdfCosNode | undefined> {
  const { signal } = options;
  const work = parseValueSteps(lexer, depth, options.recovery === "repair", nodes, options);
  let value: PdfCosNode | undefined;
  let turns = 0;
  try {
    let step = work.next();
    while (!step.done) {
      signal?.throwIfAborted();
      const request = step.value;
      if (request && request !== "token" && request.kind === "array-append") {
        let position: number;
        try { position = await appendStoredRecord(options.arrayStorage!, request.node, request.previous, signal); }
        catch (error) { options.onBackingError?.(error); throw error; }
        step = work.next(position);
      } else step = request === undefined ? work.next() : work.next(request === "token" ? await lexer.nextToken() : request);
      if (++turns % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    value = step.value;
  } finally { work.return(undefined); }
  signal?.throwIfAborted();
  return value;
}

/** Read a direct COS value (for example a trailer or object-stream member). */
export async function parseCosRangeValue(source: Pick<PdfFileSource, "size" | "chunkBytes" | "read">, offset: number, options: ParseCosRangeOptions = {}): Promise<{ value: PdfCosNode | undefined; offset: number }> {
  const depth = limit(options.maxRecursionDepth, "maxRecursionDepth");
  const nodes = limit(options.maxNodes, "maxNodes");
  const maxTokenBytes = limit(options.maxTokenBytes, "maxTokenBytes");
  const lexer = new CosRangeLexer(source, { start: offset, ...(options.end === undefined ? {} : { end: options.end }), maxTokenBytes, ...(options.signal ? { signal: options.signal } : {}) });
  return { value: await readValue(lexer, depth, nodes, options), offset: lexer.offset };
}

/** Parse one indexed indirect object without retaining the file or its stream
 * payload. Structural nodes are bounded by maxNodes, maxTokenBytes and depth;
 * input windows use the caller's retained source cache. The caller owns source. */
export async function parseCosRangeObject(source: PdfFileSource, offset: number, options: ParseCosRangeOptions = {}): Promise<PdfRangeObject> {
  const depth = limit(options.maxRecursionDepth, "maxRecursionDepth");
  const nodes = limit(options.maxNodes, "maxNodes");
  const tokenBytes = limit(options.maxTokenBytes, "maxTokenBytes");
  const { signal } = options;
  signal?.throwIfAborted();
  const lexer = new CosRangeLexer(source, { start: offset, maxTokenBytes: tokenBytes, ...(signal ? { signal } : {}) });
  const object = await lexer.nextToken();
  const generation = await lexer.nextToken();
  const keyword = await lexer.nextToken();
  if (object?.kind !== "number" || generation?.kind !== "number" || keyword?.kind !== "keyword" || keyword.value !== "obj" ||
      !Number.isSafeInteger(object.value) || object.value < 0 || !Number.isSafeInteger(generation.value) || generation.value < 0) {
    throw new PdfError("E_PARSE", `Malformed indirect object header at byte offset ${offset}`);
  }
  const value = await readValue(lexer, depth, nodes, options);
  signal?.throwIfAborted();
  if (!value) throw new PdfError("E_PARSE", `Empty indirect object ${object.value} at offset ${offset}`);
  let end = lexer.offset;
  let stream: ByteSpan | undefined;
  if (value.kind === "dict") {
    const afterKeyword = await keywordAt(source, end, "stream", signal);
    if (afterKeyword !== undefined) {
      let start = afterKeyword;
      const first = await byteAt(source, start, signal);
      if (first === 13) start += await byteAt(source, start + 1, signal) === 10 ? 2 : 1;
      else if (first === 10) start++;
      const entry = dictGet(value, "Length");
      const length = await resolveStreamLength(entry, options);
      signal?.throwIfAborted();
      if (length !== undefined && Number.isSafeInteger(length) && length >= 0 && length <= source.size - start) {
        const candidate = await keywordAt(source, start + length, "endstream", signal);
        if (candidate !== undefined) { stream = { start, end: start + length }; end = candidate; }
      }
      if (!stream) {
        const marker = await findEndstream(source, start, signal);
        if (marker < 0) throw new PdfError("E_PARSE", "Missing endstream keyword in PDF stream object");
        let dataEnd = marker;
        const last = await byteAt(source, marker - 1, signal);
        if (last === 10 && await byteAt(source, marker - 2, signal) === 13) dataEnd -= 2;
        else if (last === 10 || last === 13) dataEnd--;
        stream = { start, end: Math.max(start, dataEnd) };
        end = marker + 9;
      }
    }
  }
  signal?.throwIfAborted();
  return { objectNumber: object.value, generationNumber: generation.value, value,
    ...(stream ? { stream } : {}), span: { start: object.span.start, end } };
}
