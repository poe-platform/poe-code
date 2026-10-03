import { cosDict, dictGet, type PdfCosDict, type PdfCosNode } from "../ast.js";
import { decodePdfStreamChunks, pdfImageCodec } from "../cos/filter-stream.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import { PdfError } from "../errors.js";
import type { PdfRetainedDocument } from "../retained-document.js";
import { PdfFileSource } from "../source.js";
import type { ResolvedColorSpace } from "./images.js";
import { resolveRetainedImageColor } from "./retained-color.js";
import type { PdfRetainedImage } from "./retained-images.js";
import { PdfRetainedJpeg } from "./retained-jpeg.js";
import { PdfRetainedJpx } from "./retained-jpx.js";
import { PdfRetainedJbig2 } from "./retained-jbig2.js";
import { applyRetainedImageMask } from "./retained-mask.js";
import { decodeRetainedSampleRows } from "./retained-samples.js";

type Input = Pick<PdfRetainedImage, "dict" | "resources" | "contents">;
export interface PdfRetainedImageDecodeOptions {
  readonly maxWorkingBytes?: number;
  /** Compose decoder and color allocations with a containing resource owner. */
  readonly onAllocation?: (bytes: number) => void;
  readonly maxStagingBytes?: number;
  readonly maxOutputBytes?: number;
  readonly maxDepth?: number;
  readonly chunkBytes?: number;
  readonly signal?: AbortSignal;
  readonly fillColor?: { readonly r: number; readonly g: number; readonly b: number; readonly alpha: number } | undefined;
}
function maximum(value: number | undefined, name: string) {
  if (value === undefined || value === Infinity) return Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid ${name}`);
  return value;
}
interface Budget { working: number; staged: number }
/** One owned image: admitted codec/color state and caller-backed sample/mask
 * storage. Consume rows once and close; no whole RGBA plane is collected. */
export class PdfRetainedDecodedImage {
  private iterator: AsyncGenerator<Uint8Array, void, void> | undefined;
  private released: Promise<void> | undefined;
  private controller: AbortController | undefined;
  private constructor(readonly width: number, readonly height: number, readonly bitsPerComponent: number,
    readonly color: ResolvedColorSpace, readonly encoding: "image" | "jpeg" | "jpx" | "jbig2" | "ccitt",
    private readonly produce: () => AsyncGenerator<Uint8Array, void, void>, private readonly dispose: () => Promise<void>,
    private readonly nativeSource: PdfFileSource | undefined, private readonly globalsSource: PdfFileSource | undefined) {}
  get nativeByteLength(): number | undefined { return this.nativeSource?.size; }
  get globalsByteLength(): number | undefined { return this.globalsSource?.size; }
  /** Read before rows finish or close releases this owner's staging. */
  async *nativeContents(kind: "image" | "globals" = "image"): AsyncGenerator<Uint8Array, void, void> {
    if (this.released) throw new PdfError("E_CAPABILITY", "Retained image is closed");
    const source = kind === "globals" ? this.globalsSource : this.nativeSource;
    if (!source) throw new PdfError("E_CAPABILITY", "Retained image has no native payload");
    yield* source.stream();
  }
  static async open(document: PdfRetainedDocument, image: Input, storage: PdfIndexStorage, options: PdfRetainedImageDecodeOptions = {}): Promise<PdfRetainedDecodedImage> {
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const owner = await this.decode(document, image, storage, { ...options, signal }, { working: 0, staged: 0 }, 0);
    owner.controller = controller; return owner;
  }
  private static async decode(document: PdfRetainedDocument, image: Input, storage: PdfIndexStorage, options: PdfRetainedImageDecodeOptions,
    budget: Budget, depth: number): Promise<PdfRetainedDecodedImage> {
    const workingLimit = maximum(options.maxWorkingBytes, "maxWorkingBytes"), stagingLimit = maximum(options.maxStagingBytes, "maxStagingBytes"), outputLimit = maximum(options.maxOutputBytes, "maxOutputBytes");
    const maxDepth = options.maxDepth ?? document.depthLimit, chunkBytes = options.chunkBytes ?? 4096;
    if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || !Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) throw new RangeError("Invalid image decoder limits");
    if (depth > maxDepth) throw new PdfError("E_LIMIT", "PDF image mask depth limit exceeded");
    const { signal } = options; signal?.throwIfAborted(); const sources = new Set<PdfFileSource>(); let owned = 0;
    let codec: PdfRetainedJpeg | PdfRetainedJpx | PdfRetainedJbig2 | undefined;
    function charge(bytes: number) {
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > workingLimit - budget.working) throw new PdfError("E_LIMIT", "PDF image working byte limit exceeded");
      options.onAllocation?.(bytes);
      budget.working += bytes; owned += bytes;
    }
    async function release(source: PdfFileSource) {
      if (!sources.delete(source)) return;
      budget.staged -= source.size; budget.working -= chunkBytes * 4; owned -= chunkBytes * 4; await source.close();
    }
    async function cleanup() {
      codec?.close(); codec = undefined; const results = await Promise.allSettled([...sources].map(release)); budget.working -= owned; owned = 0;
      for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason);
    }
    async function stage(input: AsyncIterable<Uint8Array>) {
      charge(chunkBytes * 4); let written = 0;
      async function* admitted() { for await (const bytes of input) { if (bytes.length > stagingLimit - budget.staged) throw new PdfError("E_LIMIT", "PDF image staging byte limit exceeded"); budget.staged += bytes.length; written += bytes.length; yield bytes; } }
      try {
        const source = await PdfFileSource.fromStream(storage.fs, storage.directory, admitted(), { chunkBytes, cacheBytes: chunkBytes, maxInputBytes: stagingLimit, ...(signal ? { signal } : {}) }); sources.add(source); return source;
      } catch (error) { budget.staged -= written; budget.working -= chunkBytes * 4; owned -= chunkBytes * 4; throw error; }
    }
    async function resolve(node: PdfCosNode | undefined) { signal?.throwIfAborted(); return (await document.lookup(node))?.value; }
    async function number(node: PdfCosNode | undefined, fallback: number) { const value = await resolve(node); return value?.kind === "number" ? value.value : fallback; }
    async function pairs(dict: PdfCosDict) {
      const value = await resolve(dictGet(dict, "Decode") ?? dictGet(dict, "D")); if (value?.kind !== "array") return undefined;
      charge(value.items.length * 16); const result: [number, number][] = [];
      for (let i = 0; i + 1 < value.items.length; i += 2) { const low = await resolve(value.items[i]), high = await resolve(value.items[i + 1]); if (low?.kind === "number" && high?.kind === "number") result.push([low.value, high.value]); }
      return result.length ? result : undefined;
    }
    try {
      const dict = image.dict; let width = Math.max(1, Math.round(await number(dictGet(dict, "Width") ?? dictGet(dict, "W"), 1)));
      let height = Math.max(1, Math.round(await number(dictGet(dict, "Height") ?? dictGet(dict, "H"), 1)));
      function admitOutput() { if (!Number.isSafeInteger(width * height) || width * height > Math.floor(outputLimit / 4)) throw new PdfError("E_LIMIT", "PDF image output byte limit exceeded"); }
      admitOutput();
      const maskNode = await resolve(dictGet(dict, "ImageMask") ?? dictGet(dict, "IM")); const stencil = maskNode?.kind === "boolean" && maskNode.value;
      let bitsPerComponent = await number(dictGet(dict, "BitsPerComponent") ?? dictGet(dict, "BPC"), stencil ? 1 : 8);
      const filterNode = await resolve(dictGet(dict, "Filter") ?? dictGet(dict, "F")); const filters: string[] = [];
      for (const node of filterNode?.kind === "array" ? filterNode.items : filterNode ? [filterNode] : []) { const value = await resolve(node); if (value?.kind === "name") { charge(value.decoded.length * 2 + 32); filters.push(value.decoded); } }
      const index = filters.findIndex(filter => pdfImageCodec(filter)); const encoding = index < 0 ? "image" : pdfImageCodec(filters[index]!)!;
      const native = encoding !== "image" && encoding !== "ccitt";
      const parameters = await resolve(dictGet(dict, "DecodeParms") ?? dictGet(dict, "DP"));
      const parameter = parameters?.kind === "array" ? await resolve(parameters.items[index]) : parameters;
      const masks: { source: PdfFileSource; width: number; height: number; mode: "soft" | "explicit"; matte?: [number, number, number] }[] = [];
      for (const key of ["SMask", "Mask"] as const) {
        if (key === "Mask" && !native && stencil && options.fillColor) continue;
        const value = await document.lookup(dictGet(dict, key)); if (!value?.stream || value.value.kind !== "dict" || !value.reference) continue;
        const ref = value.reference;
        const child = await this.decode(document, { dict: value.value, resources: image.resources, contents: selected => document.objects.decodeStream(ref.objectNumber, ref.generationNumber, { raw: selected?.raw ?? false, stopBeforeImageCodec: selected?.native ?? false }) }, storage,
          { ...options, fillColor: undefined }, budget, depth + 1);
        let source: PdfFileSource;
        try { source = await stage(child.rows()); } catch (error) { try { await child.close(); } catch { /* Preserve staging failure. */ } throw error; }
        await child.close();
        let matte: [number, number, number] | undefined;
        const matteNode = key === "SMask" ? await resolve(dictGet(value.value, "Matte")) : undefined;
        if (matteNode?.kind === "array" && matteNode.items.length) {
          const nums: number[] = []; for (const item of matteNode.items.slice(0, 4)) nums.push(await number(item, 0));
          matte = nums.length >= 4 ? [Math.round((1 - nums[0]!) * (1 - nums[3]!) * 255), Math.round((1 - nums[1]!) * (1 - nums[3]!) * 255), Math.round((1 - nums[2]!) * (1 - nums[3]!) * 255)]
            : nums.length >= 3 ? [Math.round(nums[0]! * 255), Math.round(nums[1]! * 255), Math.round(nums[2]! * 255)] : [Math.round(nums[0]! * 255), Math.round(nums[0]! * 255), Math.round(nums[0]! * 255)];
        }
        masks.push({ source, width: child.width, height: child.height, mode: key === "SMask" ? "soft" : "explicit", ...(matte ? { matte } : {}) });
      }
      const colorNode = dictGet(dict, "ColorSpace") ?? dictGet(dict, "CS");
      let color: ResolvedColorSpace = stencil ? { colorSpace: "gray", components: 1 } : await resolveRetainedImageColor(document, colorNode, image.resources, storage,
        { maxWorkingBytes: workingLimit - budget.working, maxStagingBytes: stagingLimit - budget.staged, chunkBytes, onAllocation: charge, ...(signal ? { signal } : {}) });
      const raw = await stage(image.contents({ raw: true }));
      let samples = raw;
      let nativeSource: PdfFileSource | undefined, globals: PdfFileSource | undefined;
      let first = 0; if (document.encryption) for (let i = 0; i < filters.length; i++) if (filters[i] === "Crypt") first = i + 1;
      for (let i = first; i < filters.length && !(native && pdfImageCodec(filters[i]!)); i++) {
        let decodeError: unknown, readError: unknown; const previous = samples;
        if (i === index) nativeSource = samples;
        async function* input() { try { yield* previous.stream(0, previous.size, signal); } catch (error) { readError = error; throw error; } }
        const parms = parameters?.kind === "array" ? await resolve(parameters.items[i]) : parameters;
        const filter = filters[i]!;
        const flate = filter === "FlateDecode" || filter === "Fl";
        const lzw = filter === "LZWDecode" || filter === "LZW";
        const ccitt = pdfImageCodec(filter) === "ccitt";
        const parameterNumber = (key: string, fallback: number) => number(parms?.kind === "dict" ? dictGet(parms, key) : undefined, fallback);
        let rowBytes = 0;
        if (ccitt) rowBytes = Math.ceil(Math.max(1, await parameterNumber("Columns", 1728)) / 8);
        else if ((flate || lzw) && await parameterNumber("Predictor", 1) > 1) rowBytes = Math.ceil(await parameterNumber("Colors", 1) * await parameterNumber("Columns", 1) * await parameterNumber("BitsPerComponent", 8) / 8);
        // Conservative Flate history/Huffman/codec allowance; LZW has a fixed
        // 4096-entry prefix, suffix and expansion stack. Predictors own two rows.
        const filterWorking = (flate ? 512 * 1024 : lzw ? 16384 : 0) + Math.max(0, rowBytes) * 2 + chunkBytes * 8;
        charge(filterWorking);
        async function* decode() {
          try {
            yield* decodePdfStreamChunks(cosDict({ Filter: { kind: "name", decoded: filters[i]!, rawBytes: new TextEncoder().encode(filters[i]!) }, ...(parms ? { DecodeParms: parms } : {}) }), input,
              { chunkBytes, maxRowBytes: Math.max(0, rowBytes), maxDecodedBytes: stagingLimit, ...(signal ? { signal } : {}) });
          } catch (error) { decodeError = error; throw error; }
        }
        try { samples = await stage(decode()); if (previous !== raw && previous !== nativeSource) await release(previous); }
        catch (error) {
          signal?.throwIfAborted();
          if (readError !== undefined) throw readError;
          if (error !== decodeError || !(error instanceof PdfError) || !["E_CAPABILITY", "E_PARSE"].includes(error.code)) throw error;
          if (encoding !== "image") nativeSource ??= samples;
          if (!native) { if (samples !== raw && samples !== nativeSource) await release(samples); samples = raw; }
          break;
        } finally { budget.working -= filterWorking; owned -= filterWorking; }
      }
      if (native) nativeSource = samples;
      if (samples !== raw && raw !== nativeSource) await release(raw);
      const decode = await pairs(dict);
      const colorTransform = parameter?.kind === "dict" ? await resolve(dictGet(parameter, "ColorTransform")) : undefined;
      const codecOptions = { onDecoderAllocation: charge, maxWorkingBytes: workingLimit - budget.working, maxOutputBytes: outputLimit, ...(signal ? { signal } : {}) };
      if (encoding === "jpeg") codec = await PdfRetainedJpeg.open(samples, { ...codecOptions, isSourcePdf: true, decode, colorTransform: colorTransform?.kind === "number" ? colorTransform.value : undefined });
      else if (encoding === "jpx") codec = await PdfRetainedJpx.open(samples, { ...codecOptions, ...(colorNode ? { color } : {}) });
      else if (encoding === "jbig2") {
        const globalsValue = parameter?.kind === "dict" ? await document.lookup(dictGet(parameter, "JBIG2Globals")) : undefined;
        if (globalsValue?.stream && globalsValue.reference) globals = await stage(document.objects.decodeStream(globalsValue.reference.objectNumber, globalsValue.reference.generationNumber));
        codec = await PdfRetainedJbig2.open(samples, width, height, { ...codecOptions, maxWorkingBytes: workingLimit - budget.working, ...(globals ? { globals } : {}) });
      }
      if (codec) { width = codec.width; height = codec.height; bitsPerComponent = encoding === "jbig2" ? bitsPerComponent : 8;
        if (encoding === "jpx" && !colorNode) { const components = (codec as PdfRetainedJpx).components; color = { colorSpace: components === 1 ? "gray" : components === 4 ? "cmyk" : "rgb", components }; } }
      admitOutput();
      const maskScratch = masks.reduce((sum, mask) => sum + width * 8 + mask.width * 4 + Math.min(chunkBytes, mask.width * 4), 0);
      const pixelScratch = codec ? width * 12 + 32 : width * (color.components * 2 + 4) + chunkBytes + color.components * 8;
      charge(maskScratch + pixelScratch + (color.colorSpace === "index" ? width : 0));
      let bounds: number[] | undefined; const key = await resolve(dictGet(dict, "Mask"));
      if (!native && !(stencil && options.fillColor) && key?.kind === "array" && key.items.length >= 2) { bounds = []; charge(48); for (const node of key.items.slice(0, 6)) bounds.push(await number(node, 0)); }
      const currentCodec = codec;
      async function* produce(): AsyncGenerator<Uint8Array> {
        let rows: AsyncIterable<Uint8Array> = currentCodec ? currentCodec.rows() : decodeRetainedSampleRows(samples, width, height, bitsPerComponent, color, { maxWorkingBytes: pixelScratch, maxOutputBytes: outputLimit, ...(decode ? { decode } : {}), ...(signal ? { signal } : {}) });
        for (const mask of masks) rows = applyRetainedImageMask(rows, width, height, mask, { mode: mask.mode, ...(mask.matte ? { matte: mask.matte } : {}), maxWorkingBytes: maskScratch, maxOutputBytes: outputLimit, ...(signal ? { signal } : {}) });
        let y = 0;
        for await (const row of rows) {
          signal?.throwIfAborted();
          let indices: Uint8Array | undefined;
          if (bounds && color.colorSpace === "index") {
            indices = new Uint8Array(width);
            const length = Math.min(width, Math.max(0, samples.size - y * width));
            for (let offset = 0; offset < length; offset += chunkBytes) indices.set(await samples.read(y * width + offset, Math.min(chunkBytes, length - offset), signal), offset);
          }
          for (let x = 0; x < width; x++) {
            if (x > 0 && x % 16384 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted(); }
            const at = x * 4, fill = options.fillColor;
            if (!native && stencil && fill) {
              if (row[at] === 0) { row[at] = Math.max(0, Math.min(255, Math.round(fill.r * 255))); row[at + 1] = Math.max(0, Math.min(255, Math.round(fill.g * 255))); row[at + 2] = Math.max(0, Math.min(255, Math.round(fill.b * 255))); row[at + 3] = Math.max(0, Math.min(255, Math.round(fill.alpha * 255))); } else row[at + 3] = 0;
            } else {
              if (bounds) {
                const sample = color.colorSpace === "index" ? (indices?.[x] ?? 0) : row[at]!;
                const match = color.colorSpace === "rgb" && bounds.length >= 6 ? row[at]! >= bounds[0]! && row[at]! <= bounds[1]! && row[at + 1]! >= bounds[2]! && row[at + 1]! <= bounds[3]! && row[at + 2]! >= bounds[4]! && row[at + 2]! <= bounds[5]! : sample >= bounds[0]! && sample <= bounds[1]!;
                if (match) row[at + 3] = 0;
              }
              if (fill && fill.alpha < 1) row[at + 3] = Math.round(row[at + 3]! * fill.alpha);
            }
          }
          y++; yield row;
        }
      }
      return new PdfRetainedDecodedImage(width, height, bitsPerComponent, color, encoding, produce, cleanup, nativeSource, globals);
    } catch (error) { try { await cleanup(); } catch { /* Preserve the primary failure. */ } throw error; }
  }
  rows(): AsyncGenerator<Uint8Array, void, void> {
    if (this.iterator || this.released) throw new PdfError("E_CAPABILITY", "Retained image rows are consumed or closed");
    this.iterator = this.consume();
    return this.iterator;
  }
  private async *consume(): AsyncGenerator<Uint8Array, void, void> {
    let failed = false;
    try { yield* this.produce(); } catch (error) { failed = true; throw error; }
    finally { try { await this.release(); } catch (error) { if (!failed) await Promise.reject(error); } }
  }
  private release(): Promise<void> { return this.released ??= this.dispose(); }
  async close(): Promise<void> { this.controller?.abort(); try { await this.iterator?.return(); } finally { await this.release(); } }
}
