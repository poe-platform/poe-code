import { readStoredRecord } from "./stored-record.js";
import { readStoredCidGlyph } from "../fonts/stored-cid-map.js";
import { appendStoredClip } from "./stored-clips.js";
import { cosNumber, cosName, cosArray, cosDict, type PdfCosDict, type PdfCosNode, type PdfCosRef, type PdfCosStream } from "../ast.js";
import { decodePdfStreamChunks, type PdfStreamDecodeOptions } from "../cos/filter-stream.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import { PdfError } from "../errors.js";
import { convertRetainedContentColor, renderRetainedShading, resolveRetainedMaskParameters } from "../extract/retained-color.js";
import { PdfRetainedDecodedImage } from "../extract/retained-decoded-image.js";
import type { PdfRetainedImage } from "../extract/retained-images.js";
import type { DecodedDisplayImage } from "../extract/images.js";
import { resolveRetainedFont } from "../fonts/retained.js";
import type { ResolvedPageFont } from "../fonts/resolve.js";
import type { PdfRetainedDocument } from "../retained-document.js";
import { PdfStagingStorage } from "../staging-budget.js";
import { StoredPathWriter, readStoredPath } from "./stored-path.js";
import { evaluateContentSteps, transformPathSegment, type PdfContentEvaluationOptions, type PdfEvaluationContentSource, type PdfEvaluationOperation, type PdfEvaluationResult } from "./evaluator.js";
import type { PdfContentEvent } from "./parser.js";
import { parseContentStreamEvents } from "./range-events.js";
import type { ParseContentRangeOptions } from "./range-operator-parser.js";

export interface PdfRetainedEvaluationOptions extends ParseContentRangeOptions {
  /** Conservative cumulative resource admission for this traversal. Path and
   * composite capture arrays and object-reader caches have separate ownership. */
  readonly maxResourceBytes?: number;
  /** Optional caller-owned image and path backing; remains live while operations are used. */
  readonly imageStorage?: import("../ast.js").PdfPixelStorage;
  readonly onAllocation?: (bytes: number) => void;
  readonly maxImageBytes?: number;
  readonly maxCachedFonts?: number;
}
/** Event sources own borrowed ranges until the evaluator advances or closes them. */
export interface PdfRetainedContentEvents { readonly events: AsyncIterable<PdfContentEvent> }
export type PdfRetainedEvaluationParameters = Omit<PdfContentEvaluationOptions, "nodes" | "cosDoc" | "onShadingAllocation">;

/** Drive shared evaluation using retained input and caller-backed staging.
 * Paint operations are pulled on demand. With imageStorage, paths and images
 * use caller backing. Composite captures store replayable operation records there. */
export async function* evaluateRetainedContentSteps(document: PdfRetainedDocument, content: AsyncIterable<Uint8Array> | Iterable<Uint8Array> | PdfRetainedContentEvents,
  params: PdfRetainedEvaluationParameters, storage: PdfIndexStorage, options: PdfRetainedEvaluationOptions = {}): AsyncGenerator<PdfEvaluationOperation, void, void> {
  const maximum = options.maxResourceBytes ?? Infinity, chunkBytes = options.chunkBytes ?? 4096, maxCachedFonts = options.maxCachedFonts ?? 16;
  if (maximum !== Infinity && (!Number.isSafeInteger(maximum) || maximum < 0)) throw new RangeError("Invalid maxResourceBytes");
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 8) throw new RangeError("chunkBytes must be at least 8");
  if (!Number.isSafeInteger(maxCachedFonts) || maxCachedFonts < 0) throw new RangeError("Invalid maxCachedFonts");
  const shared = new PdfStagingStorage(storage, options.maxStagingBytes);
  const { signal } = options;
  let admitted = 0;
  function charge(bytes: number) {
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > Math.min(maximum, Number.MAX_SAFE_INTEGER) - admitted) throw new PdfError("E_LIMIT", "PDF evaluation resource byte limit exceeded");
    options.onAllocation?.(bytes); admitted += bytes;
  }
  const identities = new WeakMap<PdfCosStream, PdfCosRef>();
  async function resolve(node: PdfCosNode | undefined): Promise<PdfCosNode | undefined> {
    charge(64);
    const value = await document.lookup(node);
    signal?.throwIfAborted();
    if (value?.stream && value.reference && value.value.kind === "dict") {
      charge(128);
      const stream: PdfCosStream = { kind: "stream", dict: value.value, rawBytes: new Uint8Array() };
      identities.set(stream, value.reference); return stream;
    }
    return value?.value;
  }
  function streamContents(stream: PdfCosStream, selection: PdfStreamDecodeOptions = {}): AsyncGenerator<Uint8Array, void, void> {
    const reference = identities.get(stream);
    return reference ? document.objects.decodeStream(reference.objectNumber, reference.generationNumber, selection)
      : decodePdfStreamChunks(stream.dict, async function* () { yield stream.rawBytes; }, { ...selection, chunkBytes, ...(signal ? { signal } : {}) });
  }
  function cursor(chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>) {
    charge(chunkBytes * 5);
    return parseContentStreamEvents(chunks, shared, { ...options, chunkBytes, ...(options.imageStorage ? {pathStorage:options.imageStorage} : {}) });
  }
  async function decodeImage(image: Pick<PdfRetainedImage, "dict" | "resources" | "contents">,
    fillColor: { r: number; g: number; b: number; alpha: number } | undefined): Promise<DecodedDisplayImage | (Omit<DecodedDisplayImage, "rgba"> & {readonly storedRgba: import("../ast.js").PdfStoredPixels})> {
    const owner = await PdfRetainedDecodedImage.open(document, image, shared, {
      chunkBytes, maxOutputBytes: options.maxImageBytes ?? Infinity, maxStagingBytes: options.maxStagingBytes ?? Infinity,
      onAllocation: charge, fillColor, ...(signal ? { signal } : {}),
    });
    let failed = false;
    try {
      if (options.imageStorage) {
        const storage = options.imageStorage, length = owner.width * owner.height * 4;
        const position = storage.allocate(length);
        if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(position + length)) throw new RangeError("Invalid PDF pixel allocation");
        let written = 0;
        for await (const row of owner.rows()) {
          if (row.length > length - written) throw new PdfError("E_PARSE", "Excess retained image rows");
          for (let offset = 0; offset < row.length; offset += chunkBytes) {
            signal?.throwIfAborted();
            await storage.write(position + written + offset, row.subarray(offset, offset + chunkBytes), signal ? {signal} : undefined);
          }
          written += row.length;
        }
        signal?.throwIfAborted();
        if (written !== length) throw new PdfError("E_PARSE", "Incomplete retained image rows");
        return {width:owner.width,height:owner.height,bitsPerComponent:owner.bitsPerComponent,colorSpace:owner.color.colorSpace,storedRgba:{storage,position}};
      }
      charge(owner.width * owner.height * 4);
      const rgba = new Uint8Array(owner.width * owner.height * 4); let offset = 0;
      for await (const row of owner.rows()) { signal?.throwIfAborted(); rgba.set(row, offset); offset += row.length; }
      if (offset !== rgba.length) throw new PdfError("E_PARSE", "Incomplete retained image rows");
      return { width: owner.width, height: owner.height, bitsPerComponent: owner.bitsPerComponent, colorSpace: owner.color.colorSpace, rgba };
    } catch (error) { failed = true; throw error; }
    finally { await owner.close().catch(error => { if (!failed) throw error; }); }
  }
  const input = "events" in content ? (async function* () { yield* content.events; })() : cursor(content);
  const work = evaluateContentSteps({...params,geometryStorage:options.imageStorage ?? options.pathStorage,geometrySignal:options.signal});
  const nested = new Map<PdfEvaluationContentSource, AsyncGenerator<PdfContentEvent, void, void>>();
  const fonts: { resources: PdfCosDict | undefined; name: string; font: ResolvedPageFont | undefined }[] = [];
  const resourceOptions = { chunkBytes, maxStagingBytes: options.maxStagingBytes ?? Infinity, onAllocation: charge, ...(signal ? { signal } : {}) };
  let failed = false;
  try {
    let step = work.next();
    while (!step.done) {
      signal?.throwIfAborted();
      const request = step.value; let reply: PdfEvaluationResult;
      switch (request.kind) {
        case "frame-push": await request.stack.push(request.frame); break;
        case "frame-pop": reply={kind:"frame",value:await request.stack.pop()}; break;
        case "capture-append": await request.writer.append(request.operation); break;
        case "append-clip": reply = await appendStoredClip(request.storage,request.previous,request.clip,signal); break;
        case "path-append": if(request.storedSegments)for await(const segment of readStoredPath(request.storedSegments,signal))await request.writer.append(segment); for (const segment of request.segments) { signal?.throwIfAborted(); await request.writer.append(segment); } break;
        case "path-finish": reply = await request.writer.finish(); break;
        case "transform-path": {
          const writer = new StoredPathWriter(request.path.storage, signal);
          let last: import("../ast.js").PdfPathSegment | undefined;
          for await (const segment of readStoredPath(request.path, signal)) {
            for (const transformed of transformPathSegment(segment, request.matrix)) { await writer.append(transformed); last = transformed; }
          }
          if (request.close && last && last.kind !== "close" && last.kind !== "rect") await writer.append({kind:"close"});
          reply = await writer.finish(); break;
        }
        case "node": {
          const source = request.source;
          let selected = source ? nested.get(source) : input;
          if (!selected) { selected = cursor(streamContents(source!.stream)); nested.set(source!, selected); }
          const next = await selected.next();
          if (next.done && source) nested.delete(source);
          reply = next.done ? undefined : next.value;
          break;
        }
        case "close-content": {
          const selected = nested.get(request.source); nested.delete(request.source);
          await selected?.return(); break;
        }
        case "resolve": case "catalog": reply = { kind: "resolved", node: await resolve(request.kind === "catalog" ? document.crossReference.rootRef : request.node) }; break;
        case "array-item": {
          const record = await readStoredRecord<PdfCosNode>(request.items.storage, request.position, signal);
          reply = { kind: "resolved", node: cosArray([cosNumber(record.next), record.value]) }; break;
        }
        case "string-bytes": {
          const bytes = await request.value.storage.read(request.value.position + request.offset, request.length, signal ? { signal } : undefined);
          signal?.throwIfAborted();
          reply = { kind: "resolved", node: { kind: "string", bytes: bytes.slice() } }; break;
        }
        case "font-width": {const value=await request.widths.get(request.code);reply={kind:"resolved",node:value===undefined?undefined:cosNumber(value)};break;}
        case "font-unicode": {const value=await request.lookup(request.code);reply={kind:"resolved",node:value===undefined?undefined:cosName(value)};break;}
        case "cmap-lookup": {const value=await request.map.lookup(request.code);reply={kind:"resolved",node:typeof value==="number"?cosNumber(value):typeof value==="string"?cosName(value):undefined};break;}
        case "cmap-character": {const value=await request.map.readCharCode(request.bytes,request.offset);reply={kind:"resolved",node:cosArray([cosNumber(value.charcode),cosNumber(value.length)])};break;}
        case "truetype-number": reply={kind:"resolved",node:cosNumber(request.operation==="id"?await request.font.getGlyphId(request.code):await request.font.getAdvanceWidthUnits(request.code))};break;
        case "truetype-path": {
          const writer=new StoredPathWriter(request.storage,signal);
          for await(const segment of (request.font.storedSegments?.(request.glyphId,request.storage,signal)??request.font.glyphSegments(request.glyphId)))await writer.append(segment);
          reply=await writer.finish();break;
        }
        case "cid-gid": reply={kind:"resolved",node:cosNumber(await readStoredCidGlyph(request.map,request.code,signal))};break;
        case "font": {
          const index = fonts.findIndex(entry => entry.resources === request.resources && entry.name === request.name);
          if (index >= 0) { const entry = fonts.splice(index, 1)[0]!; fonts.push(entry); reply = entry.font; }
          else {
            reply = await resolveRetainedFont(document, shared, request.resources, request.name, {...resourceOptions,...((options.imageStorage??options.pathStorage)?{resourceStorage:options.imageStorage??options.pathStorage}:{})});
            if (maxCachedFonts) { charge(128); if (fonts.length >= maxCachedFonts) fonts.shift(); fonts.push({ resources: request.resources, name: request.name, font: reply }); }
          }
          break;
        }
        case "color": reply = { kind: "color", value: await convertRetainedContentColor(document, undefined, request.name, request.components, request.resources, shared, resourceOptions) }; break;
        case "mask-parameters": reply = { kind: "mask-parameters", value: await resolveRetainedMaskParameters(document, request.mask, request.form, request.resources, shared, resourceOptions) }; break;
        case "shading": reply = { kind: "shading", image: await renderRetainedShading(document, request.stream ? identities.get(request.stream) ?? request.stream : request.dict, request, shared, resourceOptions) }; break;
        case "image": reply = { kind: "decoded-image", image: await decodeImage({ dict: request.stream.dict, resources: request.resources ?? cosDict(),
          contents: selected => streamContents(request.stream, { raw: selected?.raw ?? false, stopBeforeImageCodec: selected?.native ?? false }) }, request.fillColor) }; break;
        case "inline-image": {
          const data = request.data;
          const raw = async function* () {
            if (data instanceof Uint8Array) { for (let offset = 0; offset < data.length; offset += chunkBytes) yield data.subarray(offset, offset + chunkBytes); }
            else yield* data.source.stream(data.start, data.end - data.start, signal);
          };
          reply = { kind: "decoded-image", image: await decodeImage({ dict: request.dict, resources: request.resources ?? cosDict(),
            contents: selected => decodePdfStreamChunks(request.dict, raw, { chunkBytes, raw: selected?.raw ?? false, stopBeforeImageCodec: selected?.native ?? false, ...(signal ? { signal } : {}) }) }, request.fillColor) };
          break;
        }
        case "paint": yield request; break;
      }
      step = work.next(reply);
    }
  } catch (error) { failed = true; throw error; }
  finally {
    let cleanupFailure: { error: unknown } | undefined;
    try { work.return(); } catch (error) { cleanupFailure = { error }; }
    for (const selected of [...nested.values(), input]) {
      try { await selected.return(); } catch (error) { cleanupFailure ??= { error }; }
    }
    if (!failed && cleanupFailure) await Promise.reject(cleanupFailure.error);
  }
}
