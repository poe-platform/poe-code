import { readBytes } from "@poe-code/safe-fs/contracts";
import { cosName, cosNumber, type PdfCosDict, type PdfCosNode, type PdfCosRef, type PdfCosStream } from "../ast.js";
import { createCalibratedColorSpace } from "../content/calibrated-color.js";
import { decodePdfStreamChunks } from "../cos/filter-stream.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import { ParsedCosDocument } from "../cos/parser.js";
import { PdfError } from "../errors.js";
import type { PdfRetainedDocument } from "../retained-document.js";
import { PdfFileSource } from "../source.js";
import { imageColorSpaceProgram, type ResolvedColorSpace } from "./images.js";

export interface PdfRetainedColorOptions {
  /** Admission for retained color metadata, palette/function bytes and palette
   * conversion scratch. Object-reader/parser and I/O caches are additional. */
  readonly maxWorkingBytes?: number;
  readonly maxStagingBytes?: number;
  readonly maxNodes?: number;
  readonly maxDepth?: number;
  readonly chunkBytes?: number;
  readonly signal?: AbortSignal;
}
function limit(value: number | undefined, fallback: number, name: string) {
  const result = value ?? fallback;
  if (result !== Infinity && (!Number.isSafeInteger(result) || result < 0)) throw new RangeError(`Invalid ${name}`);
  return Math.min(result, Number.MAX_SAFE_INTEGER);
}
/** Resolve one color space without following unrelated resources. ICC profiles
 * contribute dictionary metadata only. Palette and tint-function state is
 * admitted before materialization and remains usable after document closure. */
export async function resolveRetainedImageColor(document: PdfRetainedDocument, node: PdfCosNode | undefined,
  resources: PdfCosDict | undefined, storage: PdfIndexStorage, options: PdfRetainedColorOptions = {}): Promise<ResolvedColorSpace> {
  const maximum = limit(options.maxWorkingBytes, Infinity, "maxWorkingBytes");
  const maxStaging = limit(options.maxStagingBytes, Infinity, "maxStagingBytes");
  const maxNodes = limit(options.maxNodes, 65536, "maxNodes");
  const maxDepth = limit(options.maxDepth, document.depthLimit, "maxDepth");
  const chunkBytes = options.chunkBytes ?? 4096;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) throw new RangeError("Invalid chunkBytes");
  let used = 0; let nodes = 0;
  const streams = new WeakMap<PdfCosStream, PdfCosRef>();
  function charge(bytes: number) {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maximum - used) throw new PdfError("E_LIMIT", "PDF color working byte limit exceeded");
    used += bytes;
  }
  async function resolve(value: PdfCosNode | undefined): Promise<PdfCosNode | undefined> {
    options.signal?.throwIfAborted();
    if (++nodes > maxNodes) throw new PdfError("E_LIMIT", "PDF color node limit exceeded");
    charge(64);
    const resolved = await document.lookup(value);
    options.signal?.throwIfAborted();
    if (!resolved) return undefined;
    if (resolved.stream && resolved.reference && resolved.value.kind === "dict") {
      const stream: PdfCosStream = { kind: "stream", dict: resolved.value, rawBytes: new Uint8Array() };
      streams.set(stream, resolved.reference); return stream;
    }
    if (resolved.value.kind === "name") charge(resolved.value.decoded.length * 2);
    return resolved.value;
  }
  async function decode(stream: PdfCosStream, prefix = Infinity): Promise<Uint8Array> {
    const reference = streams.get(stream);
    const input = reference ? document.objects.decodeStream(reference.objectNumber, reference.generationNumber)
      : decodePdfStreamChunks(stream.dict, async function* () { yield stream.rawBytes; }, { chunkBytes, ...(options.signal ? { signal: options.signal } : {}) });
    async function* selected() {
      let remaining = prefix;
      for await (const chunk of readBytes(input, options.signal)) {
        const length = Math.min(remaining, chunk.length);
        if (length > 0) yield chunk.subarray(0, length);
        remaining -= length;
      }
    }
    const source = await PdfFileSource.fromStream(storage.fs, storage.directory, selected(), {
      chunkBytes, cacheBytes: chunkBytes, maxInputBytes: Math.min(maxStaging, maximum - used), ...(options.signal ? { signal: options.signal } : {}),
    });
    let failed = false;
    try {
      charge(source.size);
      const bytes = new Uint8Array(source.size); let offset = 0;
      for await (const chunk of source.stream(0, source.size, options.signal)) { bytes.set(chunk, offset); offset += chunk.length; }
      return bytes;
    } catch (error) { failed = true; throw error; }
    finally { await source.close().catch(error => { if (!failed) throw error; }); }
  }
  async function snapshot(node: PdfCosNode | undefined, depth = 0, active = new Set<number>()): Promise<PdfCosNode | undefined> {
    if (depth > maxDepth) throw new PdfError("E_LIMIT", "PDF color state depth limit exceeded");
    const ref = node?.kind === "ref" ? node.objectNumber : undefined;
    if (ref !== undefined && active.has(ref)) throw new PdfError("E_PARSE", "Circular PDF color state");
    if (ref !== undefined) active.add(ref);
    try {
      const value = await resolve(node);
      if (!value) return undefined;
      if (value.kind === "string") charge(value.bytes.length);
      if (value.kind === "array") {
        const items: PdfCosNode[] = [];
        for (const item of value.items) items.push(await snapshot(item, depth + 1, active) ?? { kind: "null" });
        return { kind: "array", items };
      }
      if (value.kind === "dict" || value.kind === "stream") {
        const entries: PdfCosDict["entries"] = [];
        for (const entry of (value.kind === "dict" ? value : value.dict).entries) {
          if (value.kind === "stream" && ["Filter", "F", "DecodeParms", "DP", "Length"].includes(entry.key.decoded)) continue;
          charge(32 + entry.key.decoded.length * 2);
          entries.push({ key: entry.key, value: await snapshot(entry.value, depth + 1, active) ?? { kind: "null" } });
        }
        const dict: PdfCosDict = { kind: "dict", entries };
        if (value.kind === "dict") return dict;
        const bytes = await decode(value);
        dict.entries.push({ key: cosName("Length"), value: cosNumber(bytes.length) });
        return { kind: "stream", dict, rawBytes: bytes };
      }
      return value;
    } finally { if (ref !== undefined) active.delete(ref); }
  }
  const context = new ParsedCosDocument({ version: "1.7", bytes: new Uint8Array(), objects: new Map(), revisions: [],
    rootRef: { kind: "ref", objectNumber: 0, generationNumber: 0 }, maxDecompressedBytes: maximum, maxRecursionDepth: maxDepth });
  options.signal?.throwIfAborted();
  const work = imageColorSpaceProgram(node, resources, maxDepth);
  try {
    let step = work.next();
    while (!step.done) {
      options.signal?.throwIfAborted();
      const request = step.value; let result: unknown;
      switch (request?.kind) {
        case "resolve": result = await resolve(request.node); break;
        case "palette": {
          if (!Number.isSafeInteger(request.maxBytes) || request.maxBytes < 0) throw new PdfError("E_LIMIT", "PDF palette size limit exceeded");
          if (request.node.kind === "stream") result = await decode(request.node, request.maxBytes);
          else {
            const length = Math.min(request.node.bytes.length, request.maxBytes); charge(length);
            result = request.node.bytes.slice(0, length);
          }
          break;
        }
        case "calibrated": result = createCalibratedColorSpace(context, request.family, await snapshot(request.parameters)); break;
        case "tint": result = { doc: context, node: await snapshot(request.node) }; break;
        case "admit": charge(request.bytes); break;
      }
      step = work.next(result);
    }
    return step.value;
  } finally { work.return(undefined as never); }
}
