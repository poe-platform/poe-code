import { renderRetainedMesh } from "./retained-mesh.js";
import { readBytes } from "@poe-code/safe-fs/contracts";
import { cosArray, cosDict, cosName, cosNumber, cosStream, dictGet, type PdfCosDict, type PdfCosNode, type PdfCosRef, type PdfCosStream, type PdfEvaluatedImage } from "../ast.js";
import { colorComponentCountSteps, renderShadingDictToImage, type PdfEvaluationShadingRequest, convertContentColorSteps, evalShadingFunctionToComponents, evaluateMaskTransfer, resolveMaskParameterSteps, type PdfMaskParameterRequest } from "../content/evaluator.js";
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
  /** Compose conservative color admission with a containing image owner. */
  readonly onAllocation?: (bytes: number) => void;
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
function createRetainedColorAccess(document: PdfRetainedDocument, storage: PdfIndexStorage, options: PdfRetainedColorOptions) {
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
    options.onAllocation?.(bytes);
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
  function contents(stream: PdfCosStream) {
    const reference = streams.get(stream);
    return reference ? document.objects.decodeStream(reference.objectNumber, reference.generationNumber)
      : decodePdfStreamChunks(stream.dict, async function* () { yield stream.rawBytes; }, { chunkBytes, ...(options.signal ? { signal: options.signal } : {}) });
  }
  async function decode(stream: PdfCosStream, prefix = Infinity, start = 0): Promise<Uint8Array> {
    const input = contents(stream);
    async function* selected() {
      let remaining = prefix, skip = Number.isSafeInteger(start) && start >= 0 ? start : Infinity;
      for await (const chunk of readBytes(input, options.signal)) {
        const offset = Math.min(skip, chunk.length); skip -= offset;
        const length = Math.min(remaining, chunk.length - offset);
        if (length > 0) yield chunk.subarray(offset, offset + length);
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
  async function snapshotNumbers(node: PdfCosNode | undefined): Promise<PdfCosNode | undefined> {
    const value = await resolve(node);
    if (value?.kind !== "array") return value;
    const items: PdfCosNode[] = [];
    for (const item of value.items) {
      const number = await resolve(item);
      items.push(number?.kind === "number" ? number : cosNumber(0));
    }
    return cosArray(items);
  }
  async function snapshotFunction(node: PdfCosNode | undefined, depth = 0): Promise<PdfCosNode | undefined> {
    if (depth > maxDepth) throw new PdfError("E_LIMIT", "PDF function state depth limit exceeded");
    const value = await resolve(node);
    if (value?.kind === "array") {
      const items: PdfCosNode[] = [];
      for (const item of value.items) items.push(await snapshotFunction(item, depth + 1) ?? { kind: "null" });
      return cosArray(items);
    }
    const dict = value?.kind === "stream" ? value.dict : value?.kind === "dict" ? value : undefined;
    if (!dict) return value;
    const type = await resolve(dictGet(dict, "FunctionType"));
    const kind = type?.kind === "number" ? type.value : 2;
    const keys = kind === 0 && value?.kind === "stream" ? ["Domain", "Range", "Size", "BitsPerSample", "Encode", "Decode"]
      : kind === 3 ? ["Domain", "Range", "Functions", "Bounds", "Encode", "C0", "C1", "N"]
        : kind === 4 && value?.kind === "stream" ? ["Domain", "Range"] : ["Domain", "Range", "C0", "C1", "N"];
    const selected = cosDict({ FunctionType: cosNumber(kind) });
    for (const key of keys) {
      const item = dictGet(dict, key);
      if (!item) continue;
      charge(64);
      const field = key === "Functions" ? await snapshotFunction(item, depth + 1) : await snapshotNumbers(item);
      selected.entries.push({ key: cosName(key), value: field ?? { kind: "null" } });
    }
    return value?.kind === "stream" && (kind === 0 || kind === 4) ? cosStream(selected, await decode(value)) : selected;
  }
  async function snapshotCalibrated(node: PdfCosNode | undefined): Promise<PdfCosNode | undefined> {
    const value = await resolve(node);
    const dict = value?.kind === "stream" ? value.dict : value?.kind === "dict" ? value : undefined;
    if (!dict) return undefined;
    const selected = cosDict();
    for (const key of ["WhitePoint", "BlackPoint", "Gamma", "Matrix", "Range"]) {
      const item = dictGet(dict, key);
      if (!item) continue;
      charge(64);
      selected.entries.push({ key: cosName(key), value: await snapshotNumbers(item) ?? { kind: "null" } });
    }
    return selected;
  }
  async function snapshotColor(node: PdfCosNode | undefined, depth = 0): Promise<PdfCosNode | undefined> {
    if (depth > maxDepth) throw new PdfError("E_LIMIT", "PDF color state depth limit exceeded");
    const value = await resolve(node);
    if (value?.kind !== "array") return value;
    const family = await resolve(value.items[0]);
    if (family?.kind !== "name") return cosArray([]);
    if (family.decoded === "ICCBased") {
      const profile = await resolve(value.items[1]);
      const dict = profile?.kind === "stream" ? profile.dict : profile?.kind === "dict" ? profile : undefined;
      if (!dict) return cosArray([family, { kind: "null" }]);
      const entries: PdfCosDict["entries"] = [];
      for (const key of ["N", "Alternate"]) {
        const item = dictGet(dict, key);
        if (!item) continue;
        charge(64);
        const resolved = key === "Alternate" ? await snapshotColor(item, depth + 1) : await resolve(item);
        entries.push({ key: cosName(key), value: resolved ?? { kind: "null" } });
      }
      return cosArray([family, { kind: "dict", entries }]);
    }
    if (family.decoded === "Indexed" && value.items.length >= 4) {
      const high = await resolve(value.items[2]);
      const lookup = await resolve(value.items[3]);
      if (lookup?.kind !== "stream" && lookup?.kind !== "string") return cosArray([family, { kind: "null" }, high ?? { kind: "null" }, { kind: "null" }]);
      const base = await snapshotColor(value.items[1], depth + 1);
      const work = colorComponentCountSteps(true, base);
      let step = work.next();
      while (!step.done) {
        if (step.value.kind !== "resolve") throw new TypeError("Unexpected color component request");
        step = work.next(await resolve(step.value.node));
      }
      const entries = high?.kind === "number" ? Math.max(0, Math.floor(high.value)) + 1 : 256;
      const requested = entries * step.value;
      const length = Number.isNaN(requested) ? 0 : requested > Number.MAX_SAFE_INTEGER ? Infinity : requested;
      let palette = lookup;
      if (lookup?.kind === "stream") palette = cosStream(await decode(lookup, length));
      else if (lookup?.kind === "string") { charge(Math.min(length, lookup.bytes.length)); palette = { ...lookup, bytes: lookup.bytes.slice(0, length) }; }
      return cosArray([family, base ?? { kind: "null" }, high ?? { kind: "null" }, palette ?? { kind: "null" }]);
    }
    if ((family.decoded === "Separation" || family.decoded === "DeviceN") && value.items.length >= 4) {
      return cosArray([family, await snapshot(value.items[1]) ?? { kind: "null" },
        await snapshotColor(value.items[2], depth + 1) ?? { kind: "null" }, await snapshotFunction(value.items[3]) ?? { kind: "null" }]);
    }
    if (["CalGray", "CalRGB", "Lab"].includes(family.decoded)) return cosArray([family, await snapshotCalibrated(value.items[1]) ?? { kind: "null" }]);
    return cosArray([family]);
  }
  const context = new ParsedCosDocument({ version: "1.7", bytes: new Uint8Array(), objects: new Map(), revisions: [],
    rootRef: { kind: "ref", objectNumber: 0, generationNumber: 0 }, maxDecompressedBytes: maximum, maxRecursionDepth: maxDepth });
  options.signal?.throwIfAborted();
  return { resolve, decode, contents, snapshot, snapshotColor, snapshotFunction, charge, context, maxDepth };
}

export async function resolveRetainedImageColor(document: PdfRetainedDocument, node: PdfCosNode | undefined,
  resources: PdfCosDict | undefined, storage: PdfIndexStorage, options: PdfRetainedColorOptions = {}): Promise<ResolvedColorSpace> {
  const { resolve, decode, snapshot, charge, context, maxDepth } = createRetainedColorAccess(document, storage, options);
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


/** Resolve the same vector colors as buffered evaluation using retained reads.
 * Palette/function state is admitted; unrelated resources and ICC payloads are
 * not read. The returned RGB value has no retained source lifetime. */
export async function convertRetainedContentColor(document: PdfRetainedDocument, node: PdfCosNode | undefined,
  name: string, components: readonly number[], resources: PdfCosDict | undefined, storage: PdfIndexStorage,
  options: PdfRetainedColorOptions = {}): Promise<[number, number, number]> {
  return runRetainedColorProgram(document, storage, options, convertContentColorSteps(true, node, name, components, resources));
}

/** Resolve only mask backdrop and transfer state, without decoding the Form. */
export async function resolveRetainedMaskParameters(document: PdfRetainedDocument, mask: PdfCosDict, form: PdfCosStream,
  resources: PdfCosDict | undefined, storage: PdfIndexStorage, options: PdfRetainedColorOptions = {}) {
  return runRetainedColorProgram(document, storage, options, resolveMaskParameterSteps(mask, form, resources));
}

async function runRetainedColorProgram<T>(document: PdfRetainedDocument, storage: PdfIndexStorage, options: PdfRetainedColorOptions,
  work: Generator<PdfMaskParameterRequest, T, unknown>): Promise<T> {
  const { resolve, decode, snapshot, context, charge } = createRetainedColorAccess(document, storage, options);
  try {
    let step = work.next();
    while (!step.done) {
      options.signal?.throwIfAborted();
      const request = step.value;
      let result: unknown;
      if (request.kind === "resolve") result = await resolve(request.node);
      else if (request.kind === "decode") result = await decode(request.stream, request.length, request.start);
      else if (request.kind === "calibrated") result = createCalibratedColorSpace(context, request.family, await snapshot(request.parameters));
      else if (request.kind === "transfer") {
        const transfer = await snapshot(request.node);
        charge(256);
        result = evaluateMaskTransfer(context, transfer!);
      } else result = evalShadingFunctionToComponents(context, await snapshot(request.node), request.components);
      options.signal?.throwIfAborted();
      step = work.next(result);
    }
    return step.value;
  } finally { work.return(undefined as never); }
}

export type PdfRetainedShadingSettings = Omit<PdfEvaluationShadingRequest, "kind" | "dict" | "stream">;

/** Read only selected shading resources through retained access. Resource
 * snapshots, mesh geometry and the result surface are admitted to one owner. */
export async function renderRetainedShading(document: PdfRetainedDocument, node: PdfCosNode,
  settings: PdfRetainedShadingSettings, storage: PdfIndexStorage, options: PdfRetainedColorOptions = {}): Promise<PdfEvaluatedImage | undefined> {
  const { resolve, contents, snapshot, snapshotColor, snapshotFunction, charge, context } = createRetainedColorAccess(document, storage, options);
  const value = await resolve(node);
  const dict = value?.kind === "stream" ? value.dict : value?.kind === "dict" ? value : undefined;
  if (!dict) return undefined;
  const type = await resolve(dictGet(dict, "ShadingType"));
  const mesh = type?.kind === "number" && [4, 5, 6, 7].includes(type.value);
  if (!mesh && (type?.kind !== "number" || ![1, 2, 3].includes(type.value) || !dictGet(dict, "Function"))) return undefined;
  if (mesh && value?.kind !== "stream") return undefined;
  const selected = cosDict({ ShadingType: type! });
  const keys = mesh ? ["BitsPerCoordinate", "BitsPerComponent", "BitsPerFlag", "VerticesPerRow", "Decode", "Function", "ColorSpace"]
    : ["Coords", "Domain", "BBox", "Background", "Matrix", "Extend", "Function", "ColorSpace"];
  for (const key of keys) {
    const item = dictGet(dict, key);
    if (!item) continue;
    charge(64);
    const resolved = key === "ColorSpace" ? await snapshotColor(item) : key === "Function" ? await snapshotFunction(item) : await snapshot(item);
    selected.entries.push({ key: cosName(key), value: resolved ?? { kind: "null" } });
  }
  if (value?.kind === "stream" && type?.kind === "number" && (type.value === 4 || type.value === 5 || type.value === 6 || type.value === 7)) {
    return renderRetainedMesh(context, selected, type.value, contents(value), settings, storage, options, charge);
  }
  options.signal?.throwIfAborted();
  const image = renderShadingDictToImage(context, selected, settings.matrix, settings.bounds, settings.alpha,
    settings.name, settings.clipRect, undefined, settings.blendMode, charge);
  options.signal?.throwIfAborted();
  return image;
}
