import { pdfImageCodec } from "../cos/filter-stream.js";
import { assertDecodedByteBudget } from "../cos/limits.js";
import { Jbig2Image, JpegImage, JpxImage } from "../vendor/pdfjs-image-decoders.mjs";
import { DeviceCmykCS } from "../vendor/pdfjs-fonts.mjs";
import { createCalibratedColorSpace, type CalibratedColorSpace } from "../content/calibrated-color.js";
import { PdfError } from "../errors.js";
import {
  dictGet,
  type PdfContentNode,
  type PdfCosArray,
  type PdfCosDict,
  type PdfCosNode,
  type PdfCosStream,
} from "../ast.js";
import { multiplyMatrices } from "../content/evaluator.js";
import { parseContentStream } from "../content/parser.js";
import { evalShadingFunctionToComponents } from "../content/evaluator.js";
import { decodePdfFilter } from "../cos/filters.js";
import { ParsedCosDocument } from "../cos/parser.js";
import type { RgbaBitmap } from "../render/raster.js";
const cmykColorSpace = new DeviceCmykCS();

export interface PdfExtractedImage {
  readonly pageNumber: number;
  readonly imageIndex: number;
  readonly type: "image" | "stencil";
  readonly objectId?: { readonly objNum: number; readonly genNum: number } | undefined;
  readonly inline: boolean;
  readonly width: number;
  readonly height: number;
  readonly colorSpace: "rgb" | "gray" | "cmyk" | "index";
  readonly colorSpaceLabel?:
    | "rgb"
    | "gray"
    | "cmyk"
    | "index"
    | "icc"
    | "lab"
    | "sep"
    | "devn"
    | "cal-gray"
    | "cal-rgb"
    | "-"
    | undefined;
  readonly components: number;
  readonly bitsPerComponent: number;
  readonly encoding: "image" | "jpeg" | "ccitt" | "jbig2" | "jpx";
  readonly interpolate: boolean;
  readonly xPpi: number;
  readonly yPpi: number;
  readonly byteLength: number;
  readonly bitmap: RgbaBitmap;
  readonly rawJpegBytes?: Uint8Array | undefined;
  readonly rawEncodedBytes?: Uint8Array | undefined;
  readonly jbig2GlobalsBytes?: Uint8Array | undefined;
  readonly ccittParams?: {
    readonly k: number;
    readonly blackIs1: boolean;
    readonly byteAlign: boolean;
  } | undefined;
}

type Matrix6 = [number, number, number, number, number, number];

interface PageLeaf {
  readonly pageDict: PdfCosDict;
  readonly inheritedResources?: PdfCosDict | undefined;
}

function *collectPageLeavesSteps(
  doc: ParsedCosDocument,
  node: PdfCosNode | undefined,
  inheritedResources: PdfCosDict | undefined,
  out: PageLeaf[] = [],
  visited = new Set<number>()
): Generator<void, PageLeaf[], void> {
  let work = 0;
  if (!node) return out;
  if (node.kind === "ref") {
    if (visited.has(node.objectNumber)) return out;
    visited.add(node.objectNumber);
  }
  const dict = doc.resolveDict(node);
  if (!dict) return out;
  const ownRes = doc.resolveDict(dictGet(dict, "Resources")) ?? inheritedResources;
  const kids = doc.resolveArray(dictGet(dict, "Kids"));
  if (kids) {
    for (const k of kids.items) {
    if (++work % 16384 === 0) yield;
      (yield* collectPageLeavesSteps(doc, k, ownRes, out, visited));
    }
  } else {
    out.push({ pageDict: dict, inheritedResources: ownRes });
  }
  return out;
}

function *decodeContentBytesSteps(doc: ParsedCosDocument, contentsNode: PdfCosNode | undefined): Generator<void, Uint8Array, void> {
  let work = 0;
  if (!contentsNode) return new Uint8Array(0);
  const resolved = doc.resolve(contentsNode);
  if (!resolved) return new Uint8Array(0);
  if (resolved.kind === "stream") {
    return doc.decodeStream(resolved);
  }
  if (resolved.kind === "array") {
    const parts: Uint8Array[] = [];
    let total = 0;
    for (const item of resolved.items) {
    if (++work % 16384 === 0) yield;
      const st = doc.resolve(item);
      if (st?.kind === "stream") {
        const dec = doc.decodeStream(st);
        parts.push(dec);
        total += dec.byteLength + 1;
      }
    }
    const merged = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
    if (++work % 16384 === 0) yield;
      merged.set(p, off);
      off += p.byteLength;
      merged[off++] = 10;
    }
    return merged;
  }
  return new Uint8Array(0);
}

interface ResolvedColorSpace {
  readonly colorSpace: "rgb" | "gray" | "cmyk" | "index";
  readonly colorSpaceLabel?:
    | "rgb"
    | "gray"
    | "cmyk"
    | "index"
    | "icc"
    | "lab"
    | "sep"
    | "devn"
    | "cal-gray"
    | "cal-rgb"
    | "-"
    | undefined;
  readonly components: number;
  readonly palette?: Uint8Array | undefined;
  readonly baseComponents?: number | undefined;
  readonly isSeparation?: boolean | undefined;
  readonly isDeviceN?: boolean | undefined;
  readonly separationAltSpace?: "rgb" | "gray" | "cmyk" | undefined;
  readonly tintFunctionDoc?: ParsedCosDocument | undefined;
  readonly tintFunctionNode?: PdfCosNode | undefined;
  readonly calibrated?: CalibratedColorSpace | undefined;
  readonly alternateCalibrated?: CalibratedColorSpace | undefined;
}

function *resolveColorSpaceInfoSteps(
  doc: ParsedCosDocument,
  csNode: PdfCosNode | undefined,
  resourcesDict: PdfCosDict | undefined
): Generator<void, ResolvedColorSpace, void> {
  let work = 0;
  if (!csNode) return { colorSpace: "rgb", colorSpaceLabel: "rgb", components: 3 };
  const resolved = doc.resolve(csNode);
  if (!resolved) return { colorSpace: "rgb", colorSpaceLabel: "rgb", components: 3 };

  if (resolved.kind === "name") {
    const name = resolved.decoded;
    if (name === "DeviceGray" || name === "G" || name === "CalGray") {
      return { colorSpace: "gray", colorSpaceLabel: name === "CalGray" ? "cal-gray" : "gray", components: 1 };
    }
    if (name === "DeviceCMYK" || name === "CMYK") {
      return { colorSpace: "cmyk", colorSpaceLabel: "cmyk", components: 4 };
    }
    if (name === "Indexed" || name === "I") {
      return { colorSpace: "index", colorSpaceLabel: "index", components: 1 };
    }
    if (name === "DeviceRGB" || name === "RGB" || name === "CalRGB") {
      return { colorSpace: "rgb", colorSpaceLabel: name === "CalRGB" ? "cal-rgb" : "rgb", components: 3 };
    }
    const csResDict = resourcesDict ? doc.resolveDict(dictGet(resourcesDict, "ColorSpace")) : undefined;
    const mapped = csResDict ? dictGet(csResDict, name) : undefined;
    if (mapped) {
      return (yield* resolveColorSpaceInfoSteps(doc, mapped, resourcesDict));
    }
    return { colorSpace: "rgb", colorSpaceLabel: "rgb", components: 3 };
  }

  if (resolved.kind === "array" && resolved.items.length > 0) {
    const first = doc.resolve(resolved.items[0]);
    const kindName = first?.kind === "name" ? first.decoded : "";
    if (kindName === "Indexed" || kindName === "I") {
      const baseInfo = (yield* resolveColorSpaceInfoSteps(doc, resolved.items[1], resourcesDict));
      const hivalNode = doc.resolve(resolved.items[2]);
      const hival = hivalNode?.kind === "number" ? Math.max(0, Math.min(255, Math.floor(hivalNode.value))) : 255;
      const lookupNode = doc.resolve(resolved.items[3]);
      let palette: Uint8Array | undefined;
      if (lookupNode?.kind === "stream") {
        palette = doc.decodeStream(lookupNode);
      } else if (lookupNode?.kind === "string") {
        palette = lookupNode.bytes;
      }
      let resolvedBaseComp = baseInfo.components;
      if (
        palette &&
        (baseInfo.isSeparation ||
          baseInfo.isDeviceN ||
          baseInfo.calibrated !== undefined)
      ) {
        const numEntries = Math.max(1, Math.min(hival + 1, Math.floor(palette.length / Math.max(1, baseInfo.components))));
        const rgbaPal = (yield* decodeSamplesToRgbaSteps(palette, numEntries, 1, 8, baseInfo));
        const rgbPal = new Uint8Array(numEntries * 3);
        for (let idx = 0; idx < numEntries; idx++) {
    if (++work % 16384 === 0) yield;
          rgbPal[idx * 3] = rgbaPal[idx * 4]!;
          rgbPal[idx * 3 + 1] = rgbaPal[idx * 4 + 1]!;
          rgbPal[idx * 3 + 2] = rgbaPal[idx * 4 + 2]!;
        }
        palette = rgbPal;
        resolvedBaseComp = 3;
      }
      return {
        colorSpace: "index",
        colorSpaceLabel: "index",
        components: 1,
        palette,
        baseComponents: resolvedBaseComp,
      };
    }
    if (kindName === "ICCBased") {
      const profileStream = doc.resolve(resolved.items[1]);
      if (profileStream?.kind === "stream") {
        const nNode = doc.resolve(dictGet(profileStream.dict, "N"));
        const n = nNode?.kind === "number" ? nNode.value : 3;
        if (n === 1) return { colorSpace: "gray", colorSpaceLabel: "icc", components: 1 };
        if (n === 4) return { colorSpace: "cmyk", colorSpaceLabel: "icc", components: 4 };
      }
      return { colorSpace: "rgb", colorSpaceLabel: "icc", components: 3 };
    }
    if (kindName === "CalGray" || kindName === "CalRGB" || kindName === "Lab") {
      const calibrated = createCalibratedColorSpace(doc, kindName, resolved.items[1]);
      return {
        colorSpace: kindName === "CalGray" ? "gray" : "rgb",
        colorSpaceLabel: kindName === "CalGray" ? "cal-gray" : kindName === "CalRGB" ? "cal-rgb" : "lab",
        components: kindName === "CalGray" ? 1 : 3,
        calibrated,
      };
    }
    if (kindName === "Separation" || kindName === "DeviceN") {
      const isDevN = kindName === "DeviceN";
      const namesArr = isDevN ? doc.resolveArray(resolved.items[1]) : undefined;
      const devNComponents = isDevN && namesArr ? Math.max(1, namesArr.items.length) : 1;
      const altInfo = (yield* resolveColorSpaceInfoSteps(doc, resolved.items[2], resourcesDict));
      const altSpace: "rgb" | "gray" | "cmyk" =
        altInfo.colorSpace === "cmyk" ? "cmyk" : altInfo.colorSpace === "gray" ? "gray" : "rgb";
      return {
        colorSpace: altSpace,
        colorSpaceLabel: isDevN ? "devn" : "sep",
        components: devNComponents,
        isSeparation: !isDevN,
        isDeviceN: isDevN,
        separationAltSpace: altSpace,
        alternateCalibrated: altInfo.calibrated,
        tintFunctionDoc: doc,
        tintFunctionNode: resolved.items[3],
      };
    }
  }

  return { colorSpace: "rgb", colorSpaceLabel: "rgb", components: 3 };
}

function *extractStreamFilterListSteps(doc: ParsedCosDocument, dict: PdfCosDict): Generator<void, string[], void> {
  let work = 0;
  const fNode = doc.resolve(dictGet(dict, "Filter") ?? dictGet(dict, "F"));
  if (!fNode) return [];
  if (fNode.kind === "name") return [fNode.decoded];
  if (fNode.kind === "array") {
    const out: string[] = [];
    for (const item of (fNode as PdfCosArray).items) {
    if (++work % 16384 === 0) yield;
      const r = doc.resolve(item);
      if (r?.kind === "name") out.push(r.decoded);
    }
    return out;
  }
  return [];
}

function *resolveEncodingKindSteps(filters: readonly string[]): Generator<void, "image" | "jpeg" | "ccitt" | "jbig2" | "jpx", void> {
  let work = 0;
  for (const f of filters) {
    if (++work % 16384 === 0) yield;
    const codec = pdfImageCodec(f);
    if (codec) return codec;
  }
  return "image";
}

function *extractRawJpegFromStreamSteps(doc: ParsedCosDocument, stream: PdfCosStream, filters: readonly string[]): Generator<void, Uint8Array, void> {
  let work = 0;
  let bytes = stream.rawBytes;
  for (const f of filters) {
    if (++work % 16384 === 0) yield;
    if (pdfImageCodec(f)) return bytes;
    try {
      bytes = decodePdfFilter(f, bytes, undefined, doc.maxDecompressedBytes);
    } catch (error) {
      if (error instanceof PdfError && error.code === "E_LIMIT") throw error;
      return bytes;
    }
  }
  return bytes;
}

export interface JpegDecodeOptions {
  readonly colorTransform?: number | undefined;
  readonly decode?: ReadonlyArray<readonly [number, number]> | undefined;
  readonly isSourcePdf?: boolean | undefined;
}

export function *decodeJpegToRgbaSteps(
  jpegBytes: Uint8Array,
  fallbackWidth = 1,
  fallbackHeight = 1,
  maxDecodedBytes = Infinity,
  options: JpegDecodeOptions = {}
): Generator<void, { width: number; height: number; components: number; data: Uint8Array }, void> {
  let work = 0;
  assertDecodedByteBudget(fallbackWidth * fallbackHeight * 4, maxDecodedBytes);
  // PDF.js JpegStream applies PDF /Decode before JPEG color conversion.
  const decodeTransform = options.decode
    ? Int32Array.from(options.decode.flatMap(([low, high]) => [(high - low) * 256, low * 255]))
    : undefined;
  const decoder = new JpegImage({
    colorTransform: options.colorTransform,
    decodeTransform,
    onImageDimensions: (width, height) => assertDecodedByteBudget(width * height * 4, maxDecodedBytes),
  });
  // PDF.js tolerates padding before SOI, notably in inline images.
  let start = 0;
  while (start + 1 < jpegBytes.length && !(jpegBytes[start] === 0xff && jpegBytes[start + 1] === 0xd8)) { if (++work % 16384 === 0) yield; start++; }
  decoder.parse(jpegBytes.subarray(start));
  const { width, height, numComponents: components } = decoder;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new PdfError("E_PARSE", "Invalid JPEG image dimensions");
  }
  if (![1, 3, 4].includes(components)) throw new PdfError("E_CAPABILITY", "Unsupported JPEG component count");
  assertDecodedByteBudget(width * height * 4, maxDecodedBytes);
  const rgb = decoder.getData({ width, height, forceRGB: true, isSourcePDF: options.isSourcePdf ?? false });
  if (rgb.length !== width * height * 3) throw new PdfError("E_PARSE", "Invalid decoded JPEG sample count");
  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    if (++work % 16384 === 0) yield;
    rgba[p * 4] = rgb[p * 3]!;
    rgba[p * 4 + 1] = rgb[p * 3 + 1]!;
    rgba[p * 4 + 2] = rgb[p * 3 + 2]!;
    rgba[p * 4 + 3] = 255;
  }
  return { width, height, components, data: rgba };
}

export function *decodeJbig2ToRgbaSteps(
  jbig2Bytes: Uint8Array,
  fallbackWidth = 1,
  fallbackHeight = 1,
  globals?: Uint8Array,
  maxDecodedBytes = Infinity
): Generator<void, Uint8Array, void> {
  let work = 0;
  if (jbig2Bytes.length < 11) throw new PdfError("E_PARSE", "Invalid JBIG2 stream");
  assertDecodedByteBudget(fallbackWidth * fallbackHeight * 4, maxDecodedBytes);
  const decoder = new Jbig2Image((width, height) => assertDecodedByteBudget(width * height * 4, maxDecodedBytes));
  const signature = [0x97, 0x4a, 0x42, 0x32, 0x0d, 0x0a, 0x1a, 0x0a];
  const standalone = signature.every((byte, i) => jbig2Bytes[i] === byte);
  let width = fallbackWidth, height = fallbackHeight;
  let pixels: Uint8Array | Uint8ClampedArray;
  if (standalone) {
    pixels = decoder.parse(jbig2Bytes);
    width = decoder.width;
    height = decoder.height;
  } else {
    const chunks = globals ? [{ data: globals, start: 0, end: globals.length }] : [];
    chunks.push({ data: jbig2Bytes, start: 0, end: jbig2Bytes.length });
    const decoded = decoder.parseChunks(chunks);
    if (!decoded) throw new PdfError("E_PARSE", "JBIG2 stream has no page bitmap");
    pixels = decoded;
  }
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 ||
      pixels.length !== (standalone ? width * height : Math.ceil(width / 8) * height)) {
    throw new PdfError("E_PARSE", "JBIG2 bitmap dimensions do not match decoded data");
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    if (++work % 16384 === 0) yield;
    for (let x = 0; x < width; x++) {
    if (++work % 16384 === 0) yield;
      const lum = standalone ? pixels[y * width + x]!
        : (pixels[y * Math.ceil(width / 8) + (x >> 3)]! >> (7 - (x & 7))) & 1 ? 0 : 255;
      const offset = (y * width + x) * 4;
      rgba.set([lum, lum, lum, 255], offset);
    }
  }
  return rgba;
}

function *decodeJpxSamplesSteps(bytes: Uint8Array, maxDecodedBytes = Infinity): Generator<void, { width: number; height: number; components: number; samples: Uint8Array }, void> {
  let work = 0;
  const decoder = new JpxImage((width, height) => assertDecodedByteBudget(width * height * 4, maxDecodedBytes));
  decoder.failOnCorruptedImage = true;
  decoder.parse(bytes);
  const { width, height, componentsCount: components, tiles } = decoder;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 ||
      !Number.isSafeInteger(components) || components <= 0 || !tiles?.length) {
    throw new PdfError("E_PARSE", "JPEG 2000 stream has no valid image");
  }
  const samples = new Uint8Array(width * height * components);
  for (const tile of tiles) {
    if (++work % 16384 === 0) yield;
    if (tile.left < 0 || tile.top < 0 || tile.left + tile.width > width || tile.top + tile.height > height ||
        tile.items.length !== tile.width * tile.height * components) {
      throw new PdfError("E_PARSE", "Invalid JPEG 2000 tile bounds");
    }
    for (let row = 0; row < tile.height; row++) {
    if (++work % 16384 === 0) yield;
      const start = row * tile.width * components;
      samples.set(tile.items.subarray(start, start + tile.width * components), ((tile.top + row) * width + tile.left) * components);
    }
  }
  return { width, height, components, samples };
}

export function *decodeJpxToRgbaSteps(
  jpxBytes: Uint8Array,
  _fallbackWidth = 1,
  _fallbackHeight = 1,
  maxDecodedBytes = Infinity
): Generator<void, Uint8Array, void> {
  const image = (yield* decodeJpxSamplesSteps(jpxBytes, maxDecodedBytes));
  if (![1, 3, 4].includes(image.components)) throw new PdfError("E_CAPABILITY", "Unsupported JPEG 2000 component count");
  return (yield* decodeSamplesToRgbaSteps(image.samples, image.width, image.height, 8, {
    colorSpace: image.components === 1 ? "gray" : image.components === 4 ? "cmyk" : "rgb",
    components: image.components,
  }));
}

function *parseDecodePairsSteps(
  doc: ParsedCosDocument | undefined,
  dict: PdfCosDict
): Generator<void, ReadonlyArray<readonly [number, number]> | undefined, void> {
  let work = 0;
  const rawDecode = dictGet(dict, "Decode") ?? dictGet(dict, "D");
  const decodeArr = doc ? doc.resolveArray(rawDecode) : rawDecode?.kind === "array" ? rawDecode : undefined;
  if (!decodeArr || decodeArr.items.length < 2) return undefined;
  const pairs: Array<readonly [number, number]> = [];
  for (let i = 0; i + 1 < decodeArr.items.length; i += 2) {
    if (++work % 16384 === 0) yield;
    const n0 = doc ? doc.resolve(decodeArr.items[i]) : decodeArr.items[i];
    const n1 = doc ? doc.resolve(decodeArr.items[i + 1]) : decodeArr.items[i + 1];
    if (n0?.kind === "number" && n1?.kind === "number") {
      pairs.push([n0.value, n1.value]);
    }
  }
  return pairs.length > 0 ? pairs : undefined;
}

function remapUnitSampleWithDecode(
  unitVal: number,
  channelIdx: number,
  decodePairs: ReadonlyArray<readonly [number, number]> | undefined
): number {
  if (!decodePairs || decodePairs.length === 0) return unitVal;
  const pair = decodePairs[channelIdx] ?? decodePairs[0];
  if (!pair) return unitVal;
  const [dMin, dMax] = pair;
  if (dMin === 0 && dMax === 1) return unitVal;
  return Math.max(0, Math.min(1, dMin + unitVal * (dMax - dMin)));
}

function *decodeSamplesToRgbaSteps(
  rawSamples: Uint8Array,
  width: number,
  height: number,
  bpc: number,
  csInfo: ResolvedColorSpace,
  alphaSamples?: Uint8Array,
  decodePairs?: ReadonlyArray<readonly [number, number]>
): Generator<void, Uint8Array, void> {
  let work = 0;
  const rgba = new Uint8Array(width * height * 4);
  const pixelCount = width * height;

  if (csInfo.isSeparation || csInfo.isDeviceN) {
    const alt = csInfo.separationAltSpace ?? "rgb";
    const numCh = Math.max(1, csInfo.components);
    const step = bpc === 16 ? 2 : 1;
    for (let p = 0; p < pixelCount; p++) {
    if (++work % 16384 === 0) yield;
      const chVals: number[] = [];
      for (let ch = 0; ch < numCh; ch++) {
    if (++work % 16384 === 0) yield;
        const sRaw = (rawSamples[(p * numCh + ch) * step] ?? 0) / 255;
        chVals.push(remapUnitSampleWithDecode(sRaw, ch, decodePairs));
      }
      const outComps = evalShadingFunctionToComponents(
        csInfo.tintFunctionDoc!,
        csInfo.tintFunctionNode,
        chVals
      );
      if (csInfo.alternateCalibrated) {
        rgba.set(csInfo.alternateCalibrated.getRgb(outComps, 0), p * 4);
      } else if (alt === "cmyk") {
        rgba.set(cmykColorSpace.getRgb([outComps[0] ?? 0, outComps[1] ?? 0, outComps[2] ?? 0, outComps[3] ?? 0], 0), p * 4);
      } else if (alt === "gray") {
        const gByte = Math.round(Math.max(0, Math.min(1, outComps[0] ?? 0)) * 255);
        rgba[p * 4] = gByte;
        rgba[p * 4 + 1] = gByte;
        rgba[p * 4 + 2] = gByte;
      } else {
        rgba[p * 4] = Math.round(Math.max(0, Math.min(1, outComps[0] ?? 0)) * 255);
        rgba[p * 4 + 1] = Math.round(Math.max(0, Math.min(1, outComps[1] ?? 0)) * 255);
        rgba[p * 4 + 2] = Math.round(Math.max(0, Math.min(1, outComps[2] ?? 0)) * 255);
      }
      rgba[p * 4 + 3] = 255;
    }
  } else if (csInfo.calibrated?.name === "Lab") {
    const { amin, amax, bmin, bmax } = csInfo.calibrated;
    const step = bpc === 16 ? 2 : 1;
    for (let p = 0; p < pixelCount; p++) {
    if (++work % 16384 === 0) yield;
      const L = (rawSamples[p * 3 * step] ?? 0) / 255 * 100;
      const a = amin + (rawSamples[(p * 3 + 1) * step] ?? 128) / 255 * (amax - amin);
      const b = bmin + (rawSamples[(p * 3 + 2) * step] ?? 128) / 255 * (bmax - bmin);
      rgba.set(csInfo.calibrated.getRgb([L, a, b], 0), p * 4);
      rgba[p * 4 + 3] = 255;
    }
  } else if (csInfo.colorSpace === "rgb") {
    const writeRgbPixel = (p: number, rByte: number, gByte: number, bByte: number) => {
      const rU = remapUnitSampleWithDecode(rByte / 255, 0, decodePairs);
      const gU = remapUnitSampleWithDecode(gByte / 255, 1, decodePairs);
      const bU = remapUnitSampleWithDecode(bByte / 255, 2, decodePairs);
      if (csInfo.calibrated) {
        rgba.set(csInfo.calibrated.getRgb([rU, gU, bU], 0), p * 4);
        rgba[p * 4 + 3] = 255;
        return;
      }
      rgba[p * 4] = Math.round(rU * 255);
      rgba[p * 4 + 1] = Math.round(gU * 255);
      rgba[p * 4 + 2] = Math.round(bU * 255);
      rgba[p * 4 + 3] = 255;
    };
    if (bpc === 16 && rawSamples.length >= pixelCount * 6) {
      for (let p = 0; p < pixelCount; p++) {
    if (++work % 16384 === 0) yield;
        writeRgbPixel(p, rawSamples[p * 6]!, rawSamples[p * 6 + 2]!, rawSamples[p * 6 + 4]!);
      }
    } else if (rawSamples.length >= pixelCount * 3) {
      for (let p = 0; p < pixelCount; p++) {
    if (++work % 16384 === 0) yield;
        writeRgbPixel(p, rawSamples[p * 3]!, rawSamples[p * 3 + 1]!, rawSamples[p * 3 + 2]!);
      }
    } else {
      for (let p = 0; p < pixelCount; p++) { if (++work % 16384 === 0) yield; rgba[p * 4 + 3] = 255; }
    }
  } else if (csInfo.colorSpace === "gray") {
    const writeGrayPixel = (p: number, gByte: number) => {
      const gU = remapUnitSampleWithDecode(gByte / 255, 0, decodePairs);
      if (csInfo.calibrated) {
        rgba.set(csInfo.calibrated.getRgb([gU], 0), p * 4);
        rgba[p * 4 + 3] = 255;
        return;
      }
      const outG = Math.round(Math.max(0, Math.min(1, gU)) * 255);
      rgba[p * 4] = outG;
      rgba[p * 4 + 1] = outG;
      rgba[p * 4 + 2] = outG;
      rgba[p * 4 + 3] = 255;
    };
    if (bpc === 16 && rawSamples.length >= pixelCount * 2) {
      for (let p = 0; p < pixelCount; p++) {
    if (++work % 16384 === 0) yield;
        writeGrayPixel(p, rawSamples[p * 2] ?? 0);
      }
    } else if (bpc === 1) {
      const rowBytes = Math.ceil(width / 8);
      for (let y = 0; y < height; y++) {
    if (++work % 16384 === 0) yield;
        for (let x = 0; x < width; x++) {
    if (++work % 16384 === 0) yield;
          const byteIdx = y * rowBytes + (x >> 3);
          const bit = ((rawSamples[byteIdx] ?? 0) >> (7 - (x & 7))) & 1;
          const p = y * width + x;
          writeGrayPixel(p, bit ? 255 : 0);
        }
      }
    } else if (bpc === 2) {
      const rowBytes = Math.ceil(width / 4);
      for (let y = 0; y < height; y++) {
    if (++work % 16384 === 0) yield;
        for (let x = 0; x < width; x++) {
    if (++work % 16384 === 0) yield;
          const byteIdx = y * rowBytes + (x >> 2);
          const shift = 6 - ((x & 3) * 2);
          const val2 = ((rawSamples[byteIdx] ?? 0) >> shift) & 0x03;
          const p = y * width + x;
          writeGrayPixel(p, val2 * 85);
        }
      }
    } else if (bpc === 4) {
      const rowBytes = Math.ceil(width / 2);
      for (let y = 0; y < height; y++) {
    if (++work % 16384 === 0) yield;
        for (let x = 0; x < width; x++) {
    if (++work % 16384 === 0) yield;
          const byteIdx = y * rowBytes + (x >> 1);
          const nibble = x & 1 ? (rawSamples[byteIdx] ?? 0) & 0x0f : ((rawSamples[byteIdx] ?? 0) >> 4) & 0x0f;
          const p = y * width + x;
          writeGrayPixel(p, nibble * 17);
        }
      }
    } else {
      for (let p = 0; p < pixelCount; p++) {
    if (++work % 16384 === 0) yield;
        writeGrayPixel(p, rawSamples[p] ?? 0);
      }
    }
  } else if (csInfo.colorSpace === "cmyk") {
    const stride = bpc === 16 ? 8 : 4;
    const chStep = bpc === 16 ? 2 : 1;
    for (let p = 0; p < pixelCount; p++) {
    if (++work % 16384 === 0) yield;
      const c = remapUnitSampleWithDecode((rawSamples[p * stride] ?? 0) / 255, 0, decodePairs);
      const m = remapUnitSampleWithDecode((rawSamples[p * stride + chStep] ?? 0) / 255, 1, decodePairs);
      const y = remapUnitSampleWithDecode((rawSamples[p * stride + chStep * 2] ?? 0) / 255, 2, decodePairs);
      const k = remapUnitSampleWithDecode((rawSamples[p * stride + chStep * 3] ?? 0) / 255, 3, decodePairs);
      rgba.set(cmykColorSpace.getRgb([c, m, y, k], 0), p * 4);
      rgba[p * 4 + 3] = 255;
    }
  } else if (csInfo.colorSpace === "index") {
    const pal = csInfo.palette;
    const baseComp = csInfo.baseComponents ?? 3;
    const rowBits = width * bpc;
    const rowBytes = Math.max(1, Math.ceil(rowBits / 8));
    for (let y = 0; y < height; y++) {
    if (++work % 16384 === 0) yield;
      const rowStart = y * rowBytes;
      for (let x = 0; x < width; x++) {
    if (++work % 16384 === 0) yield;
        let idx = 0;
        if (bpc === 8) {
          idx = rawSamples[rowStart + x] ?? 0;
        } else if (bpc === 4) {
          const b = rawSamples[rowStart + (x >> 1)] ?? 0;
          idx = x & 1 ? b & 0x0f : (b >> 4) & 0x0f;
        } else if (bpc === 2) {
          const b = rawSamples[rowStart + (x >> 2)] ?? 0;
          const shift = 6 - ((x & 3) * 2);
          idx = (b >> shift) & 0x03;
        } else if (bpc === 1) {
          const b = rawSamples[rowStart + (x >> 3)] ?? 0;
          const shift = 7 - (x & 7);
          idx = (b >> shift) & 0x01;
        }
        const p = y * width + x;
        if (pal && idx * baseComp + (baseComp - 1) < pal.length) {
          if (baseComp === 1) {
            const g = pal[idx]!;
            rgba[p * 4] = g;
            rgba[p * 4 + 1] = g;
            rgba[p * 4 + 2] = g;
          } else if (baseComp === 4) {
            const c = pal[idx * 4]! / 255;
            const m = pal[idx * 4 + 1]! / 255;
            const yel = pal[idx * 4 + 2]! / 255;
            const k = pal[idx * 4 + 3]! / 255;
            rgba.set(cmykColorSpace.getRgb([c, m, yel, k], 0), p * 4);
          } else {
            rgba[p * 4] = pal[idx * baseComp]!;
            rgba[p * 4 + 1] = pal[idx * baseComp + 1]!;
            rgba[p * 4 + 2] = pal[idx * baseComp + 2]!;
          }
        } else {
          rgba[p * 4] = idx;
          rgba[p * 4 + 1] = idx;
          rgba[p * 4 + 2] = idx;
        }
        rgba[p * 4 + 3] = 255;
      }
    }
  }

  if (alphaSamples && alphaSamples.length >= pixelCount) {
    for (let p = 0; p < pixelCount; p++) {
    if (++work % 16384 === 0) yield;
      rgba[p * 4 + 3] = alphaSamples[p]!;
    }
  }

  return rgba;
}

function computePpiFromCtm(width: number, height: number, ctm: Matrix6): { xPpi: number; yPpi: number } {
  const dispW = Math.hypot(ctm[0], ctm[1]);
  const dispH = Math.hypot(ctm[2], ctm[3]);
  const xPpi = dispW > 1e-6 ? Math.max(1, Math.round((width * 72) / dispW)) : 72;
  const yPpi = dispH > 1e-6 ? Math.max(1, Math.round((height * 72) / dispH)) : 72;
  return { xPpi, yPpi };
}

export interface DecodedDisplayImage {
  readonly width: number;
  readonly height: number;
  readonly bitsPerComponent: number;
  readonly colorSpace: string;
  readonly rgba: Uint8Array;
}

function *applyStencilFillColorSteps(
  rgba: Uint8Array,
  width: number,
  height: number,
  fillColor: { readonly r: number; readonly g: number; readonly b: number; readonly alpha: number }
): Generator<void, void, void> {
  let work = 0;
  const rByte = Math.max(0, Math.min(255, Math.round(fillColor.r * 255)));
  const gByte = Math.max(0, Math.min(255, Math.round(fillColor.g * 255)));
  const bByte = Math.max(0, Math.min(255, Math.round(fillColor.b * 255)));
  const aByte = Math.max(0, Math.min(255, Math.round(fillColor.alpha * 255)));
  const pixelCount = width * height;
  for (let p = 0; p < pixelCount; p++) {
    if (++work % 16384 === 0) yield;
    if (rgba[p * 4] === 0) {
      rgba[p * 4] = rByte;
      rgba[p * 4 + 1] = gByte;
      rgba[p * 4 + 2] = bByte;
      rgba[p * 4 + 3] = aByte;
    } else {
      rgba[p * 4 + 3] = 0;
    }
  }
}

function *applySmaskStreamToRgbaSteps(
  doc: ParsedCosDocument,
  smaskStream: PdfCosStream,
  rgba: Uint8Array,
  width: number,
  height: number,
  activeRes: PdfCosDict | undefined
): Generator<void, void, void> {
  let work = 0;
  const smaskDecoded = (yield* decodeXObjectImageToRgbaSteps(doc, smaskStream, activeRes));
  const sw = smaskDecoded.width;
  const sh = smaskDecoded.height;
  const matteArr = doc.resolveArray(dictGet(smaskStream.dict, "Matte"));
  let matteRgb: [number, number, number] | undefined;
  if (matteArr && matteArr.items.length > 0) {
    const nums = matteArr.items.map(it => {
      const r = doc.resolve(it);
      return r?.kind === "number" ? r.value : 0;
    });
    if (nums.length >= 4) {
      const c = nums[0]!, m = nums[1]!, y = nums[2]!, k = nums[3]!;
      matteRgb = [
        Math.round((1 - c) * (1 - k) * 255),
        Math.round((1 - m) * (1 - k) * 255),
        Math.round((1 - y) * (1 - k) * 255),
      ];
    } else if (nums.length >= 3) {
      matteRgb = [
        Math.round(nums[0]! * 255),
        Math.round(nums[1]! * 255),
        Math.round(nums[2]! * 255),
      ];
    } else if (nums.length >= 1) {
      const g = Math.round(nums[0]! * 255);
      matteRgb = [g, g, g];
    }
  }
  for (let y = 0; y < height; y++) {
    if (++work % 16384 === 0) yield;
    const sy = Math.min(sh - 1, Math.floor((y * sh) / height));
    for (let x = 0; x < width; x++) {
    if (++work % 16384 === 0) yield;
      const sx = Math.min(sw - 1, Math.floor((x * sw) / width));
      const aByte = smaskDecoded.rgba[(sy * sw + sx) * 4]!;
      const dstIdx = (y * width + x) * 4;
      if (matteRgb && aByte > 0 && aByte < 255) {
        const aNorm = aByte / 255;
        for (let ch = 0; ch < 3; ch++) {
    if (++work % 16384 === 0) yield;
          const mVal = matteRgb[ch]!;
          const cPrime = rgba[dstIdx + ch]!;
          const unmatted = Math.round(mVal + (cPrime - mVal) / aNorm);
          rgba[dstIdx + ch] = Math.max(0, Math.min(255, unmatted));
        }
      }
      rgba[dstIdx + 3] = aByte;
    }
  }
}

function *applyExplicitMaskStreamToRgbaSteps(
  doc: ParsedCosDocument,
  maskStream: PdfCosStream,
  rgba: Uint8Array,
  width: number,
  height: number,
  activeRes: PdfCosDict | undefined
): Generator<void, void, void> {
  let work = 0;
  const maskDecoded = (yield* decodeXObjectImageToRgbaSteps(doc, maskStream, activeRes));
  const mw = maskDecoded.width;
  const mh = maskDecoded.height;
  for (let y = 0; y < height; y++) {
    if (++work % 16384 === 0) yield;
    const my = Math.min(mh - 1, Math.floor((y * mh) / height));
    for (let x = 0; x < width; x++) {
    if (++work % 16384 === 0) yield;
      const mx = Math.min(mw - 1, Math.floor((x * mw) / width));
      const maskLuma = maskDecoded.rgba[(my * mw + mx) * 4]!;
      if (maskLuma > 127) {
        rgba[(y * width + x) * 4 + 3] = 0;
      }
    }
  }
}

export function *decodeXObjectImageToRgbaSteps(
  doc: ParsedCosDocument,
  xobjStream: PdfCosStream,
  activeRes: PdfCosDict | undefined,
  fillColor?: { readonly r: number; readonly g: number; readonly b: number; readonly alpha: number }
): Generator<void, DecodedDisplayImage, void> {
  let work = 0;
  const dict = xobjStream.dict;
  const wNode = doc.resolve(dictGet(dict, "Width") ?? dictGet(dict, "W"));
  const hNode = doc.resolve(dictGet(dict, "Height") ?? dictGet(dict, "H"));
  const bpcNode = doc.resolve(dictGet(dict, "BitsPerComponent") ?? dictGet(dict, "BPC"));
  const imageMaskNode = doc.resolve(dictGet(dict, "ImageMask") ?? dictGet(dict, "IM"));
  const isMask = imageMaskNode?.kind === "boolean" && imageMaskNode.value;

  let width = wNode?.kind === "number" ? Math.max(1, Math.round(wNode.value)) : 1;
  let height = hNode?.kind === "number" ? Math.max(1, Math.round(hNode.value)) : 1;
  let bitsPerComponent = bpcNode?.kind === "number" ? bpcNode.value : isMask ? 1 : 8;

  assertDecodedByteBudget(width * height * 4, doc.maxDecompressedBytes);

  const csNode = dictGet(dict, "ColorSpace") ?? dictGet(dict, "CS");
  let csInfo: ResolvedColorSpace = isMask
    ? { colorSpace: "gray", components: 1 }
    : (yield* resolveColorSpaceInfoSteps(doc, csNode, activeRes));

  const filters = (yield* extractStreamFilterListSteps(doc, dict));
  const encoding = (yield* resolveEncodingKindSteps(filters));

  let alphaSamples: Uint8Array | undefined;
  const smaskNode = doc.resolve(dictGet(dict, "SMask"));
  if (smaskNode?.kind === "stream") {
    const smaskFilters = (yield* extractStreamFilterListSteps(doc, smaskNode.dict));
    const smaskEncoding = (yield* resolveEncodingKindSteps(smaskFilters));
    if (smaskEncoding === "jpeg") {
      const smaskJpeg = (yield* extractRawJpegFromStreamSteps(doc, smaskNode, smaskFilters));
      const smaskRgba = (yield* decodeJpegToRgbaSteps(smaskJpeg, width, height, doc.maxDecompressedBytes)).data;
      alphaSamples = new Uint8Array(width * height);
      for (let p = 0; p < width * height; p++) {
    if (++work % 16384 === 0) yield;
        alphaSamples[p] = smaskRgba[p * 4]!;
      }
    } else {
      try {
        alphaSamples = doc.decodeStream(smaskNode);
      } catch (error) {
        if (error instanceof PdfError && error.code === "E_LIMIT") throw error;
        alphaSamples = undefined;
      }
    }
  }

  let rgba: Uint8Array;
  if (encoding === "jpeg" || encoding === "jbig2" || encoding === "jpx") {
    const rawEncBytes = (yield* extractRawJpegFromStreamSteps(doc, xobjStream, filters));
    if (encoding === "jbig2") {
      const params = doc.resolve(dictGet(dict, "DecodeParms") ?? dictGet(dict, "DP"));
      const decodeParms = params?.kind === "array"
        ? doc.resolveDict(params.items[filters.findIndex(filter => filter === "JBIG2Decode")])
        : doc.resolveDict(params);
      const globals = decodeParms ? doc.resolve(dictGet(decodeParms, "JBIG2Globals")) : undefined;
      rgba = (yield* decodeJbig2ToRgbaSteps(rawEncBytes, width, height, globals?.kind === "stream" ? doc.decodeStream(globals) : undefined, doc.maxDecompressedBytes));
    } else if (encoding === "jpx") {
      const decoded = (yield* decodeJpxSamplesSteps(rawEncBytes, doc.maxDecompressedBytes));
      width = decoded.width;
      height = decoded.height;
      bitsPerComponent = 8;
      if (!csNode) {
        if (![1, 3, 4].includes(decoded.components)) throw new PdfError("E_CAPABILITY", "Unsupported JPEG 2000 component count");
        csInfo = {
          colorSpace: decoded.components === 1 ? "gray" : decoded.components === 4 ? "cmyk" : "rgb",
          components: decoded.components,
        };
      }
      if (csInfo.components !== decoded.components) throw new PdfError("E_PARSE", "JPEG 2000 component count does not match ColorSpace");
      rgba = (yield* decodeSamplesToRgbaSteps(decoded.samples, width, height, 8, csInfo));
    } else {
      const params = doc.resolve(dictGet(dict, "DecodeParms") ?? dictGet(dict, "DP"));
      const decodeParms = params?.kind === "array"
        ? doc.resolveDict(params.items[filters.findIndex(filter => filter === "DCTDecode" || filter === "DCT")])
        : doc.resolveDict(params);
      const colorTransform = decodeParms ? doc.resolve(dictGet(decodeParms, "ColorTransform")) : undefined;
      const decoded = (yield* decodeJpegToRgbaSteps(rawEncBytes, width, height, doc.maxDecompressedBytes, {
        isSourcePdf: true,
        decode: (yield* parseDecodePairsSteps(doc, dict)),
        colorTransform: colorTransform?.kind === "number" ? colorTransform.value : undefined,
      }));
      width = decoded.width;
      height = decoded.height;
      bitsPerComponent = 8;
      rgba = decoded.data;
    }
    if (smaskNode?.kind === "stream") {
      (yield* applySmaskStreamToRgbaSteps(doc, smaskNode, rgba, width, height, activeRes));
    }
    const maskResolvedJpg = doc.resolve(dictGet(dict, "Mask"));
    if (maskResolvedJpg?.kind === "stream") {
      (yield* applyExplicitMaskStreamToRgbaSteps(doc, maskResolvedJpg, rgba, width, height, activeRes));
    }
    if (fillColor && fillColor.alpha < 1) {
      for (let p = 0; p < width * height; p++) {
    if (++work % 16384 === 0) yield;
        rgba[p * 4 + 3] = Math.round(rgba[p * 4 + 3]! * fillColor.alpha);
      }
    }
  } else {
    let decodedSamples: Uint8Array;
    try {
      decodedSamples = doc.decodeStream(xobjStream);
    } catch (error) {
      if (error instanceof PdfError && error.code === "E_LIMIT") throw error;
      decodedSamples = xobjStream.rawBytes;
    }
    const decodePairs = (yield* parseDecodePairsSteps(doc, dict));
    rgba = (yield* decodeSamplesToRgbaSteps(decodedSamples, width, height, bitsPerComponent, csInfo, alphaSamples, decodePairs));
    if (smaskNode?.kind === "stream") {
      (yield* applySmaskStreamToRgbaSteps(doc, smaskNode, rgba, width, height, activeRes));
    }

    if (isMask && fillColor) {
      (yield* applyStencilFillColorSteps(rgba, width, height, fillColor));
    } else {
      const maskResolved = doc.resolve(dictGet(dict, "Mask"));
      if (maskResolved?.kind === "stream") {
        (yield* applyExplicitMaskStreamToRgbaSteps(doc, maskResolved, rgba, width, height, activeRes));
      }
      const maskArr = doc.resolveArray(dictGet(dict, "Mask"));
      if (maskArr && maskArr.items.length >= 2) {
        const bounds = maskArr.items.map(it => {
          const r = doc.resolve(it);
          return r?.kind === "number" ? r.value : 0;
        });
        if (csInfo.colorSpace === "rgb" && bounds.length >= 6) {
          for (let p = 0; p < width * height; p++) {
    if (++work % 16384 === 0) yield;
            const r = rgba[p * 4]!;
            const g = rgba[p * 4 + 1]!;
            const b = rgba[p * 4 + 2]!;
            if (
              r >= bounds[0]! && r <= bounds[1]! &&
              g >= bounds[2]! && g <= bounds[3]! &&
              b >= bounds[4]! && b <= bounds[5]!
            ) {
              rgba[p * 4 + 3] = 0;
            }
          }
        } else if (bounds.length >= 2) {
          for (let p = 0; p < width * height; p++) {
    if (++work % 16384 === 0) yield;
            const v = csInfo.colorSpace === "index" ? (decodedSamples[p] ?? 0) : rgba[p * 4]!;
            if (v >= bounds[0]! && v <= bounds[1]!) {
              rgba[p * 4 + 3] = 0;
            }
          }
        }
      }
      if (fillColor && fillColor.alpha < 1) {
        for (let p = 0; p < width * height; p++) {
    if (++work % 16384 === 0) yield;
          rgba[p * 4 + 3] = Math.round(rgba[p * 4 + 3]! * fillColor.alpha);
        }
      }
    }
  }

  return {
    width,
    height,
    bitsPerComponent,
    colorSpace: csInfo.colorSpace,
    rgba,
  };
}

export function *decodeInlineImageNodeToRgbaSteps(
  doc: ParsedCosDocument | undefined,
  dict: PdfCosDict,
  rawData: Uint8Array,
  activeRes: PdfCosDict | undefined,
  fillColor?: { readonly r: number; readonly g: number; readonly b: number; readonly alpha: number }
): Generator<void, DecodedDisplayImage, void> {
  const context = doc ?? new ParsedCosDocument({
    version: "1.7", bytes: new Uint8Array(), objects: new Map(), revisions: [],
    rootRef: { kind: "ref", objectNumber: 0, generationNumber: 0 },
  });
  return (yield* decodeXObjectImageToRgbaSteps(context, { kind: "stream", dict, rawBytes: rawData }, activeRes, fillColor));
}

export function* extractDocumentImagesSteps(doc: ParsedCosDocument, options: {
    readonly firstPage?: number;
    readonly lastPage?: number;
    readonly signal?: AbortSignal | undefined;
} = {}): Generator<void, PdfExtractedImage[], void> {
    let work = 0;
    const catalog = doc.resolveDict(doc.rootRef);
    const leaves = (yield* collectPageLeavesSteps(doc, catalog ? dictGet(catalog, "Pages") : undefined, undefined));
    const totalPages = leaves.length;
    const startPage = Math.max(1, options.firstPage ?? 1);
    const endPage = options.lastPage && options.lastPage > 0 ? Math.min(totalPages, options.lastPage) : totalPages;
    const extracted: PdfExtractedImage[] = [];
    let imageIndex = 0;
    for (let pageNumber = startPage; pageNumber <= endPage; pageNumber++) {
        yield;
        if (++work % 16384 === 0)
            yield;
        const leaf = leaves[pageNumber - 1];
        if (!leaf)
            continue;
        const pageResources = doc.resolveDict(dictGet(leaf.pageDict, "Resources")) ?? leaf.inheritedResources;
        const contentBytes = (yield* decodeContentBytesSteps(doc, dictGet(leaf.pageDict, "Contents")));
        const rootAst = parseContentStream(contentBytes);
        const referencedImageKeysOnPage = new Set<string>();
        const extractFromXObjectStreamSteps = function* (xobjStream: PdfCosStream, objectId: {
            readonly objNum: number;
            readonly genNum: number;
        } | undefined, ctm: Matrix6, activeRes: PdfCosDict | undefined): Generator<void, void, void> {
            const dict = xobjStream.dict;
            const interpNode = doc.resolve(dictGet(dict, "Interpolate") ?? dictGet(dict, "I"));
            const imageMaskNode = doc.resolve(dictGet(dict, "ImageMask") ?? dictGet(dict, "IM"));
            const isMask = imageMaskNode?.kind === "boolean" && imageMaskNode.value;
            const { width, height, bitsPerComponent, rgba, colorSpace } = (yield* decodeXObjectImageToRgbaSteps(doc, xobjStream, activeRes));
            const interpolate = interpNode?.kind === "boolean" ? interpNode.value : false;
            const csNode = dictGet(dict, "ColorSpace") ?? dictGet(dict, "CS");
            const csInfo: ResolvedColorSpace = isMask
                ? { colorSpace: "gray", colorSpaceLabel: "-", components: 1 }
                : csNode ? (yield* resolveColorSpaceInfoSteps(doc, csNode, activeRes)) : { colorSpace: colorSpace as ResolvedColorSpace["colorSpace"], components: colorSpace === "gray" ? 1 : colorSpace === "cmyk" ? 4 : 3 };
            const filters = (yield* extractStreamFilterListSteps(doc, dict));
            const encoding = (yield* resolveEncodingKindSteps(filters));
            const { xPpi, yPpi } = computePpiFromCtm(width, height, ctm);
            let rawJpegBytes: Uint8Array | undefined;
            let rawEncodedBytes: Uint8Array | undefined;
            let jbig2GlobalsBytes: Uint8Array | undefined;
            let ccittParams: {
                readonly k: number;
                readonly blackIs1: boolean;
                readonly byteAlign: boolean;
            } | undefined;
            if (encoding === "jpx" || encoding === "jbig2" || encoding === "ccitt") {
                rawEncodedBytes = (yield* extractRawJpegFromStreamSteps(doc, xobjStream, filters));
                const dpNode = dictGet(dict, "DecodeParms") ?? dictGet(dict, "DP");
                const dpArr = doc.resolveArray(dpNode);
                const dpDict = dpArr
                    ? doc.resolveDict(dpArr.items[filters.findIndex(filter => resolveEncodingKind([filter]) === encoding)])
                    : doc.resolveDict(dpNode);
                if (encoding === "jbig2" && dpDict) {
                    const globalsStream = doc.resolve(dictGet(dpDict, "JBIG2Globals"));
                    if (globalsStream?.kind === "stream") {
                        try {
                            jbig2GlobalsBytes = doc.decodeStream(globalsStream);
                        }
                        catch (error) {
                            if (options.signal?.aborted)
                                throw options.signal.reason;
                            if (error instanceof PdfError && error.code === "E_LIMIT")
                                throw error;
                            jbig2GlobalsBytes = globalsStream.rawBytes;
                        }
                    }
                }
                if (encoding === "ccitt") {
                    const kNode = dpDict ? doc.resolve(dictGet(dpDict, "K")) : undefined;
                    const biNode = dpDict ? doc.resolve(dictGet(dpDict, "BlackIs1")) : undefined;
                    const baNode = dpDict ? doc.resolve(dictGet(dpDict, "EncodedByteAlign")) : undefined;
                    ccittParams = {
                        k: kNode?.kind === "number" ? kNode.value : 0,
                        blackIs1: biNode?.kind === "boolean" ? biNode.value : false,
                        byteAlign: baNode?.kind === "boolean" ? baNode.value : false,
                    };
                }
            }
            for (const key of ["SMask", "Mask"]) {
                yield;
                const mask = dictGet(dict, key);
                if (mask?.kind === "ref") {
                    referencedImageKeysOnPage.add(`${mask.objectNumber}:${mask.generationNumber}`);
                }
            }
            if (encoding === "jpeg")
                rawJpegBytes = (yield* extractRawJpegFromStreamSteps(doc, xobjStream, filters));
            extracted.push({
                pageNumber,
                imageIndex: imageIndex++,
                type: isMask ? "stencil" : "image",
                objectId,
                inline: false,
                width,
                height,
                colorSpace: csInfo.colorSpace,
                colorSpaceLabel: csInfo.colorSpaceLabel ?? csInfo.colorSpace,
                components: csInfo.components,
                bitsPerComponent,
                encoding,
                interpolate,
                xPpi,
                yPpi,
                byteLength: xobjStream.rawBytes.byteLength,
                bitmap: { width, height, data: rgba },
                ...(rawJpegBytes !== undefined ? { rawJpegBytes } : {}),
                ...(rawEncodedBytes !== undefined ? { rawEncodedBytes } : {}),
                ...(jbig2GlobalsBytes !== undefined ? { jbig2GlobalsBytes } : {}),
                ...(ccittParams !== undefined ? { ccittParams } : {}),
            });
        };
        const ctmStack: Matrix6[] = [[1, 0, 0, 1, 0, 0]];
        const currentCtm = (): Matrix6 => ctmStack[ctmStack.length - 1]!;
        const walkAstSteps = function* (nodes: readonly PdfContentNode[], activeRes: PdfCosDict | undefined, visitedForms: ReadonlySet<string>): Generator<void, void, void> {
            for (const node of nodes) {
                yield;
                switch (node.kind) {
                    case "graphics-group": {
                        ctmStack.push([...currentCtm()] as Matrix6);
                        (yield* walkAstSteps(node.ops, activeRes, visitedForms));
                        if (ctmStack.length > 1)
                            ctmStack.pop();
                        break;
                    }
                    case "marked-content": {
                        (yield* walkAstSteps(node.children, activeRes, visitedForms));
                        break;
                    }
                    case "state-op": {
                        if (node.operator === "cm" && node.operands.length >= 6) {
                            const nums = node.operands.map(o => (o.kind === "number" ? o.value : 0));
                            const m: Matrix6 = [nums[0]!, nums[1]!, nums[2]!, nums[3]!, nums[4]!, nums[5]!];
                            ctmStack[ctmStack.length - 1] = multiplyMatrices(m, currentCtm());
                        }
                        break;
                    }
                    case "xobject": {
                        const xobjDict = activeRes ? doc.resolveDict(dictGet(activeRes, "XObject")) : undefined;
                        const rawTarget = xobjDict ? dictGet(xobjDict, node.name) : undefined;
                        if (!rawTarget)
                            break;
                        const objectId = rawTarget.kind === "ref"
                            ? { objNum: rawTarget.objectNumber, genNum: rawTarget.generationNumber }
                            : undefined;
                        const targetStream = doc.resolve(rawTarget);
                        if (targetStream?.kind !== "stream")
                            break;
                        const subtypeNode = doc.resolve(dictGet(targetStream.dict, "Subtype"));
                        const subtype = subtypeNode?.kind === "name" ? subtypeNode.decoded : "";
                        if (subtype === "Image") {
                            if (objectId) {
                                referencedImageKeysOnPage.add(`${objectId.objNum}:${objectId.genNum}`);
                            }
                            (yield* extractFromXObjectStreamSteps(targetStream, objectId, currentCtm(), activeRes));
                        }
                        else if (subtype === "Form") {
                            const formKey = objectId ? `${objectId.objNum}:${objectId.genNum}` : `inline-form:${node.name}`;
                            if (visitedForms.has(formKey)) {
                                break;
                            }
                            const nextVisited = new Set(visitedForms);
                            nextVisited.add(formKey);
                            let formCtm: Matrix6 = [...currentCtm()] as Matrix6;
                            const matArr = doc.resolveArray(dictGet(targetStream.dict, "Matrix"));
                            if (matArr && matArr.items.length >= 6) {
                                const mn = (idx: number, fb = 0) => {
                                    const r = doc.resolve(matArr.items[idx]);
                                    return r?.kind === "number" ? r.value : fb;
                                };
                                const fm: Matrix6 = [mn(0, 1), mn(1, 0), mn(2, 0), mn(3, 1), mn(4, 0), mn(5, 0)];
                                formCtm = multiplyMatrices(fm, formCtm);
                            }
                            const formRes = doc.resolveDict(dictGet(targetStream.dict, "Resources")) ?? activeRes;
                            let formBytes: Uint8Array;
                            try {
                                formBytes = doc.decodeStream(targetStream);
                            }
                            catch (error) {
                                if (options.signal?.aborted)
                                    throw options.signal.reason;
                                if (error instanceof PdfError && error.code === "E_LIMIT")
                                    throw error;
                                formBytes = targetStream.rawBytes;
                            }
                            const formAst = parseContentStream(formBytes);
                            ctmStack.push(formCtm);
                            (yield* walkAstSteps(formAst, formRes, nextVisited));
                            if (ctmStack.length > 1)
                                ctmStack.pop();
                        }
                        break;
                    }
                    case "inline-image": {
                        const dict = node.dict;
                        const inlineIm = dictGet(dict, "IM") ?? dictGet(dict, "ImageMask");
                        const isInlineMask = inlineIm?.kind === "boolean" && inlineIm.value;
                        const interpNode = dictGet(dict, "I") ?? dictGet(dict, "Interpolate");
                        const csNode = dictGet(dict, "CS") ?? dictGet(dict, "ColorSpace");
                        const { width, height, bitsPerComponent, rgba, colorSpace } = (yield* decodeInlineImageNodeToRgbaSteps(doc, dict, node.data, activeRes));
                        const interpolate = interpNode?.kind === "boolean" ? interpNode.value : false;
                        const csInfo: ResolvedColorSpace = isInlineMask
                            ? { colorSpace: "gray", colorSpaceLabel: "-", components: 1 }
                            : csNode ? (yield* resolveColorSpaceInfoSteps(doc, csNode, activeRes)) : { colorSpace: colorSpace as ResolvedColorSpace["colorSpace"], components: colorSpace === "gray" ? 1 : colorSpace === "cmyk" ? 4 : 3 };
                        const filters = (yield* extractStreamFilterListSteps(doc, dict));
                        const encoding = (yield* resolveEncodingKindSteps(filters));
                        const { xPpi, yPpi } = computePpiFromCtm(width, height, currentCtm());
                        const encodedBytes = encoding === "image" ? undefined
                            : (yield* extractRawJpegFromStreamSteps(doc, { kind: "stream", dict, rawBytes: node.data }, filters));
                        extracted.push({
                            pageNumber,
                            imageIndex: imageIndex++,
                            type: isInlineMask ? "stencil" : "image",
                            objectId: undefined,
                            inline: true,
                            width,
                            height,
                            colorSpace: csInfo.colorSpace,
                            colorSpaceLabel: csInfo.colorSpaceLabel ?? csInfo.colorSpace,
                            components: csInfo.components,
                            bitsPerComponent,
                            encoding,
                            interpolate,
                            xPpi,
                            yPpi,
                            byteLength: node.data.byteLength,
                            bitmap: { width, height, data: rgba },
                            ...(encoding === "jpeg" ? { rawJpegBytes: encodedBytes } : {}),
                            ...(["jpx", "jbig2", "ccitt"].includes(encoding) ? { rawEncodedBytes: encodedBytes } : {}),
                        });
                        break;
                    }
                    default:
                        break;
                }
            }
        };
        const visitedForms = new Set<string>();
        (yield* walkAstSteps(rootAst, pageResources, visitedForms));
        // Also walk /Resources /Pattern tiling pattern streams and Type 3 /CharProcs streams
        if (pageResources) {
            const patMap = doc.resolveDict(dictGet(pageResources, "Pattern"));
            if (patMap) {
                for (const pEntry of patMap.entries) {
                    yield;
                    if (++work % 16384 === 0)
                        yield;
                    const patStream = doc.resolve(pEntry.value);
                    if (patStream?.kind === "stream") {
                        const patRes = doc.resolveDict(dictGet(patStream.dict, "Resources")) ?? pageResources;
                        try {
                            (yield* walkAstSteps(parseContentStream(doc.decodeStream(patStream)), patRes, visitedForms));
                        }
                        catch (error) {
                            if (options.signal?.aborted)
                                throw options.signal.reason;
                            if (error instanceof PdfError && error.code === "E_LIMIT")
                                throw error;
                        }
                    }
                }
            }
            const fontMap = doc.resolveDict(dictGet(pageResources, "Font"));
            if (fontMap) {
                for (const fEntry of fontMap.entries) {
                    yield;
                    if (++work % 16384 === 0)
                        yield;
                    const fDict = doc.resolveDict(fEntry.value);
                    const sub = fDict ? doc.resolve(dictGet(fDict, "Subtype")) : undefined;
                    if (fDict && sub?.kind === "name" && sub.decoded === "Type3") {
                        const fRes = doc.resolveDict(dictGet(fDict, "Resources")) ?? pageResources;
                        const charProcs = doc.resolveDict(dictGet(fDict, "CharProcs"));
                        if (charProcs) {
                            for (const cpEntry of charProcs.entries) {
                                yield;
                                if (++work % 16384 === 0)
                                    yield;
                                const cpStream = doc.resolve(cpEntry.value);
                                if (cpStream?.kind === "stream") {
                                    try {
                                        (yield* walkAstSteps(parseContentStream(doc.decodeStream(cpStream)), fRes, visitedForms));
                                    }
                                    catch (error) {
                                        if (options.signal?.aborted)
                                            throw options.signal.reason;
                                        if (error instanceof PdfError && error.code === "E_LIMIT")
                                            throw error;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        // Also walk page /Annots /AP /N Form XObject appearance streams
        const annotsArr = doc.resolveArray(dictGet(leaf.pageDict, "Annots"));
        if (annotsArr) {
            const walkApNodeSteps = function* (apNode: PdfCosNode | undefined): Generator<void, void, void> {
                const resolved = doc.resolve(apNode);
                if (!resolved)
                    return;
                if (resolved.kind === "stream") {
                    const apRes = doc.resolveDict(dictGet(resolved.dict, "Resources")) ?? pageResources;
                    try {
                        (yield* walkAstSteps(parseContentStream(doc.decodeStream(resolved)), apRes, visitedForms));
                    }
                    catch (error) {
                        if (options.signal?.aborted)
                            throw options.signal.reason;
                        if (error instanceof PdfError && error.code === "E_LIMIT")
                            throw error;
                    }
                }
                else if (resolved.kind === "dict") {
                    for (const entry of resolved.entries) {
                        yield;
                        (yield* walkApNodeSteps(entry.value));
                    }
                }
            };
            for (const item of annotsArr.items) {
                yield;
                if (++work % 16384 === 0)
                    yield;
                const aDict = doc.resolveDict(item);
                const apDict = aDict ? doc.resolveDict(dictGet(aDict, "AP")) : undefined;
                if (apDict) {
                    (yield* walkApNodeSteps(dictGet(apDict, "N")));
                }
            }
        }
        const xobjDict = pageResources ? doc.resolveDict(dictGet(pageResources, "XObject")) : undefined;
        if (xobjDict) {
            for (const entry of xobjDict.entries) {
                yield;
                if (++work % 16384 === 0)
                    yield;
                const rawVal = entry.value;
                const objectId = rawVal.kind === "ref"
                    ? { objNum: rawVal.objectNumber, genNum: rawVal.generationNumber }
                    : undefined;
                if (objectId && referencedImageKeysOnPage.has(`${objectId.objNum}:${objectId.genNum}`)) {
                    continue;
                }
                const resolved = doc.resolve(rawVal);
                if (resolved?.kind === "stream") {
                    const sub = doc.resolve(dictGet(resolved.dict, "Subtype"));
                    if (sub?.kind === "name" && sub.decoded === "Image") {
                        const wNode = doc.resolve(dictGet(resolved.dict, "Width") ?? dictGet(resolved.dict, "W"));
                        const hNode = doc.resolve(dictGet(resolved.dict, "Height") ?? dictGet(resolved.dict, "H"));
                        const w = wNode?.kind === "number" ? wNode.value : 1;
                        const h = hNode?.kind === "number" ? hNode.value : 1;
                        (yield* extractFromXObjectStreamSteps(resolved, objectId, [w, 0, 0, h, 0, 0], pageResources));
                    }
                }
            }
        }
    }
    return extracted;
}

function resolveEncodingKind(
  filters: readonly string[]
): "image" | "jpeg" | "ccitt" | "jbig2" | "jpx" {
  const steps = resolveEncodingKindSteps(filters);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function decodeJpegToRgba(
  jpegBytes: Uint8Array,
  fallbackWidth = 1,
  fallbackHeight = 1,
  maxDecodedBytes = Infinity,
  options: JpegDecodeOptions = {}
): { width: number; height: number; components: number; data: Uint8Array } {
  const steps = decodeJpegToRgbaSteps(jpegBytes, fallbackWidth, fallbackHeight, maxDecodedBytes, options);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function decodeJbig2ToRgba(
  jbig2Bytes: Uint8Array,
  fallbackWidth = 1,
  fallbackHeight = 1,
  globals?: Uint8Array,
  maxDecodedBytes = Infinity
): Uint8Array {
  const steps = decodeJbig2ToRgbaSteps(jbig2Bytes, fallbackWidth, fallbackHeight, globals, maxDecodedBytes);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function decodeJpxToRgba(
  jpxBytes: Uint8Array,
  _fallbackWidth = 1,
  _fallbackHeight = 1,
  maxDecodedBytes = Infinity
): Uint8Array {
  const steps = decodeJpxToRgbaSteps(jpxBytes, _fallbackWidth, _fallbackHeight, maxDecodedBytes);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function decodeXObjectImageToRgba(
  doc: ParsedCosDocument,
  xobjStream: PdfCosStream,
  activeRes: PdfCosDict | undefined,
  fillColor?: { readonly r: number; readonly g: number; readonly b: number; readonly alpha: number }
): DecodedDisplayImage {
  const steps = decodeXObjectImageToRgbaSteps(doc, xobjStream, activeRes, fillColor);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function decodeInlineImageNodeToRgba(
  doc: ParsedCosDocument | undefined,
  dict: PdfCosDict,
  rawData: Uint8Array,
  activeRes: PdfCosDict | undefined,
  fillColor?: { readonly r: number; readonly g: number; readonly b: number; readonly alpha: number }
): DecodedDisplayImage {
  const steps = decodeInlineImageNodeToRgbaSteps(doc, dict, rawData, activeRes, fillColor);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function extractDocumentImages(
  doc: ParsedCosDocument,
  options: { readonly firstPage?: number; readonly lastPage?: number } = {}
): PdfExtractedImage[] {
  const steps = extractDocumentImagesSteps(doc, options);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}
