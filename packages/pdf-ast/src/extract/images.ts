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
import { decodePdfFilter, decodeStreamObject } from "../cos/filters.js";
import type { ParsedCosDocument } from "../cos/parser.js";
import type { RgbaBitmap } from "../render/raster.js";

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

function collectPageLeaves(
  doc: ParsedCosDocument,
  node: PdfCosNode | undefined,
  inheritedResources: PdfCosDict | undefined,
  out: PageLeaf[] = [],
  visited = new Set<number>()
): PageLeaf[] {
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
      collectPageLeaves(doc, k, ownRes, out, visited);
    }
  } else {
    out.push({ pageDict: dict, inheritedResources: ownRes });
  }
  return out;
}

function decodeContentBytes(doc: ParsedCosDocument, contentsNode: PdfCosNode | undefined): Uint8Array {
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
  readonly separationC0?: readonly number[] | undefined;
  readonly separationC1?: readonly number[] | undefined;
  readonly separationN?: number | undefined;
  readonly tintFunctionDoc?: ParsedCosDocument | undefined;
  readonly tintFunctionNode?: PdfCosNode | undefined;
  readonly tintFunctionType?: number | undefined;
  readonly isLab?: boolean | undefined;
  readonly labRange?: readonly [number, number, number, number] | undefined;
  readonly calGrayGamma?: number | undefined;
  readonly calRgbGamma?: readonly [number, number, number] | undefined;
  readonly calRgbMatrix?: readonly number[] | undefined;
}

function resolveColorSpaceInfo(
  doc: ParsedCosDocument,
  csNode: PdfCosNode | undefined,
  resourcesDict: PdfCosDict | undefined
): ResolvedColorSpace {
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
      return resolveColorSpaceInfo(doc, mapped, resourcesDict);
    }
    return { colorSpace: "rgb", colorSpaceLabel: "rgb", components: 3 };
  }

  if (resolved.kind === "array" && resolved.items.length > 0) {
    const first = doc.resolve(resolved.items[0]);
    const kindName = first?.kind === "name" ? first.decoded : "";
    if (kindName === "Indexed" || kindName === "I") {
      const baseInfo = resolveColorSpaceInfo(doc, resolved.items[1], resourcesDict);
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
        (baseInfo.isLab ||
          baseInfo.isSeparation ||
          baseInfo.isDeviceN ||
          baseInfo.calRgbGamma !== undefined ||
          baseInfo.calGrayGamma !== undefined)
      ) {
        const numEntries = Math.max(1, Math.min(hival + 1, Math.floor(palette.length / Math.max(1, baseInfo.components))));
        const rgbaPal = decodeSamplesToRgba(palette, numEntries, 1, 8, baseInfo);
        const rgbPal = new Uint8Array(numEntries * 3);
        for (let idx = 0; idx < numEntries; idx++) {
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
    if (kindName === "CalGray") {
      const calDict = doc.resolveDict(resolved.items[1]);
      const gammaNode = calDict ? doc.resolve(dictGet(calDict, "Gamma")) : undefined;
      const gamma = gammaNode?.kind === "number" && gammaNode.value > 0 ? gammaNode.value : 1;
      return { colorSpace: "gray", colorSpaceLabel: "cal-gray", components: 1, calGrayGamma: gamma };
    }
    if (kindName === "CalRGB") {
      const calDict = doc.resolveDict(resolved.items[1]);
      const gammaArr = calDict ? doc.resolveArray(dictGet(calDict, "Gamma")) : undefined;
      let calRgbGamma: [number, number, number] = [1, 1, 1];
      if (gammaArr && gammaArr.items.length >= 3) {
        const gNums = gammaArr.items.slice(0, 3).map(it => {
          const r = doc.resolve(it);
          return r?.kind === "number" && r.value > 0 ? r.value : 1;
        });
        calRgbGamma = [gNums[0]!, gNums[1]!, gNums[2]!];
      }
      const matArr = calDict ? doc.resolveArray(dictGet(calDict, "Matrix")) : undefined;
      let calRgbMatrix: number[] | undefined;
      if (matArr && matArr.items.length >= 9) {
        calRgbMatrix = matArr.items.slice(0, 9).map(it => {
          const r = doc.resolve(it);
          return r?.kind === "number" ? r.value : 0;
        });
      }
      return {
        colorSpace: "rgb",
        colorSpaceLabel: "cal-rgb",
        components: 3,
        calRgbGamma,
        calRgbMatrix,
      };
    }
    if (kindName === "Lab") {
      const labDict = doc.resolveDict(resolved.items[1]);
      const rangeArr = labDict ? doc.resolveArray(dictGet(labDict, "Range")) : undefined;
      let labRange: [number, number, number, number] = [-100, 100, -100, 100];
      if (rangeArr && rangeArr.items.length >= 4) {
        const nums = rangeArr.items.slice(0, 4).map(it => {
          const r = doc.resolve(it);
          return r?.kind === "number" ? r.value : 0;
        });
        labRange = [nums[0]!, nums[1]!, nums[2]!, nums[3]!];
      }
      return { colorSpace: "rgb", colorSpaceLabel: "lab", components: 3, isLab: true, labRange };
    }
    if (kindName === "Separation" || kindName === "DeviceN") {
      const isDevN = kindName === "DeviceN";
      const namesArr = isDevN ? doc.resolveArray(resolved.items[1]) : undefined;
      const devNComponents = isDevN && namesArr ? Math.max(1, namesArr.items.length) : 1;
      const altInfo = resolveColorSpaceInfo(doc, resolved.items[2], resourcesDict);
      const altSpace: "rgb" | "gray" | "cmyk" =
        altInfo.colorSpace === "cmyk" ? "cmyk" : altInfo.colorSpace === "gray" ? "gray" : "rgb";
      const fnResolved = doc.resolve(resolved.items[3]);
      const fnDict = fnResolved?.kind === "stream" ? fnResolved.dict : fnResolved?.kind === "dict" ? fnResolved : undefined;
      const ftNode = fnDict ? doc.resolve(dictGet(fnDict, "FunctionType")) : undefined;
      const tintFunctionType = ftNode?.kind === "number" ? ftNode.value : 2;
      const c0Arr = fnDict ? doc.resolveArray(dictGet(fnDict, "C0")) : undefined;
      const c1Arr = fnDict ? doc.resolveArray(dictGet(fnDict, "C1")) : undefined;
      const nNode = fnDict ? doc.resolve(dictGet(fnDict, "N")) : undefined;
      const c0 = c0Arr
        ? c0Arr.items.map(it => {
            const r = doc.resolve(it);
            return r?.kind === "number" ? r.value : 0;
          })
        : altSpace === "cmyk"
          ? [0, 0, 0, 0]
          : altSpace === "gray"
            ? [1]
            : [1, 1, 1];
      const c1 = c1Arr
        ? c1Arr.items.map(it => {
            const r = doc.resolve(it);
            return r?.kind === "number" ? r.value : 0;
          })
        : altSpace === "cmyk"
          ? [0, 0, 0, 1]
          : altSpace === "gray"
            ? [0]
            : [0, 0, 0];
      const sepN = nNode?.kind === "number" && nNode.value > 0 ? nNode.value : 1;
      return {
        colorSpace: altSpace,
        colorSpaceLabel: isDevN ? "devn" : "sep",
        components: devNComponents,
        isSeparation: !isDevN,
        isDeviceN: isDevN,
        separationAltSpace: altSpace,
        separationC0: c0,
        separationC1: c1,
        separationN: sepN,
        tintFunctionDoc: doc,
        tintFunctionNode: resolved.items[3],
        tintFunctionType,
      };
    }
  }

  return { colorSpace: "rgb", colorSpaceLabel: "rgb", components: 3 };
}

function extractStreamFilterList(doc: ParsedCosDocument, dict: PdfCosDict): string[] {
  const fNode = doc.resolve(dictGet(dict, "Filter") ?? dictGet(dict, "F"));
  if (!fNode) return [];
  if (fNode.kind === "name") return [fNode.decoded];
  if (fNode.kind === "array") {
    const out: string[] = [];
    for (const item of (fNode as PdfCosArray).items) {
      const r = doc.resolve(item);
      if (r?.kind === "name") out.push(r.decoded);
    }
    return out;
  }
  return [];
}

function resolveEncodingKind(filters: readonly string[]): "image" | "jpeg" | "ccitt" | "jbig2" | "jpx" {
  for (const f of filters) {
    if (f === "DCTDecode" || f === "DCT") return "jpeg";
    if (f === "CCITTFaxDecode" || f === "CCF") return "ccitt";
    if (f === "JBIG2Decode") return "jbig2";
    if (f === "JPXDecode") return "jpx";
  }
  return "image";
}

function extractRawJpegFromStream(doc: ParsedCosDocument, stream: PdfCosStream, filters: readonly string[]): Uint8Array {
  let bytes = stream.rawBytes;
  for (const f of filters) {
    if (
      f === "DCTDecode" ||
      f === "DCT" ||
      f === "JPXDecode" ||
      f === "JBIG2Decode" ||
      f === "CCITTFaxDecode" ||
      f === "CCF"
    ) {
      return bytes;
    }
    try {
      bytes = decodePdfFilter(f, bytes);
    } catch {
      return bytes;
    }
  }
  return bytes;
}

const JPEG_ZIGZAG = [
  0,  1,  8, 16,  9,  2,  3, 10,
 17, 24, 32, 25, 18, 11,  4,  5,
 12, 19, 26, 33, 40, 48, 41, 34,
 27, 20, 13,  6,  7, 14, 21, 28,
 35, 42, 49, 56, 57, 50, 43, 36,
 29, 22, 15, 23, 30, 37, 44, 51,
 58, 59, 52, 45, 38, 31, 39, 46,
 53, 60, 61, 54, 47, 55, 62, 63,
];

interface JpegHuffmanTable {
  readonly minCode: Int32Array;
  readonly maxCode: Int32Array;
  readonly valPtr: Int32Array;
  readonly huffVal: Uint8Array;
}

function buildJpegHuffmanTable(counts: Uint8Array, values: Uint8Array): JpegHuffmanTable {
  const minCode = new Int32Array(17);
  const maxCode = new Int32Array(17).fill(-1);
  const valPtr = new Int32Array(17);
  let code = 0;
  let k = 0;
  for (let bits = 1; bits <= 16; bits++) {
    const cnt = counts[bits - 1] ?? 0;
    if (cnt > 0) {
      valPtr[bits] = k;
      minCode[bits] = code;
      code += cnt - 1;
      maxCode[bits] = code;
      k += cnt;
      code++;
    }
    code <<= 1;
  }
  return { minCode, maxCode, valPtr, huffVal: values };
}

function idct8x8(coeffs: Float64Array, outSpatial: Uint8Array): void {
  const INV_SQRT2 = Math.SQRT1_2;
  const tmp = new Float64Array(64);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let sum = 0;
      for (let u = 0; u < 8; u++) {
        const cu = u === 0 ? INV_SQRT2 : 1;
        sum += cu * coeffs[y * 8 + u]! * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
      }
      tmp[y * 8 + x] = sum * 0.5;
    }
  }
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      let sum = 0;
      for (let v = 0; v < 8; v++) {
        const cv = v === 0 ? INV_SQRT2 : 1;
        sum += cv * tmp[v * 8 + x]! * Math.cos(((2 * y + 1) * v * Math.PI) / 16);
      }
      const sample = Math.round(sum * 0.5 + 128);
      outSpatial[y * 8 + x] = sample < 0 ? 0 : sample > 255 ? 255 : sample;
    }
  }
}

export function decodeJpegToRgba(
  jpegBytes: Uint8Array,
  fallbackWidth = 1,
  fallbackHeight = 1
): { width: number; height: number; components: number; data: Uint8Array } {
  let width = Math.max(1, fallbackWidth);
  let height = Math.max(1, fallbackHeight);
  let numComponents = 3;

  const qTables: Float64Array[] = [
    new Float64Array(64).fill(16),
    new Float64Array(64).fill(16),
    new Float64Array(64).fill(16),
    new Float64Array(64).fill(16),
  ];
  const dcTables = new Map<number, JpegHuffmanTable>();
  const acTables = new Map<number, JpegHuffmanTable>();
  let restartInterval = 0;

  interface JpegCompSpec {
    id: number;
    hSamp: number;
    vSamp: number;
    qTableId: number;
    dcTableId: number;
    acTableId: number;
    dcPred: number;
  }
  const comps: JpegCompSpec[] = [];
  let scanDataOffset = -1;

  let pos = 0;
  if (jpegBytes.length >= 2 && jpegBytes[0] === 0xff && jpegBytes[1] === 0xd8) {
    pos = 2;
  }

  while (pos + 1 < jpegBytes.length) {
    if (jpegBytes[pos] !== 0xff) {
      pos++;
      continue;
    }
    while (pos < jpegBytes.length && jpegBytes[pos] === 0xff) pos++;
    if (pos >= jpegBytes.length) break;
    const marker = jpegBytes[pos++]!;
    if (marker === 0xd9 || marker === 0x00) break;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      continue;
    }
    if (pos + 1 >= jpegBytes.length) break;
    const segLen = ((jpegBytes[pos]! << 8) | jpegBytes[pos + 1]!) - 2;
    pos += 2;
    if (segLen < 0 || pos + segLen > jpegBytes.length) break;

    if (marker === 0xdb) {
      // DQT
      let qPos = pos;
      const qEnd = pos + segLen;
      while (qPos < qEnd) {
        const pqTq = jpegBytes[qPos++]!;
        const precision = pqTq >> 4;
        const tableId = pqTq & 0x0f;
        const table = new Float64Array(64);
        for (let k = 0; k < 64 && qPos < qEnd; k++) {
          if (precision === 0) {
            table[k] = jpegBytes[qPos++]!;
          } else {
            table[k] = (jpegBytes[qPos]! << 8) | (jpegBytes[qPos + 1] ?? 0);
            qPos += 2;
          }
        }
        qTables[tableId] = table;
      }
    } else if (marker === 0xc4) {
      // DHT
      let hPos = pos;
      const hEnd = pos + segLen;
      while (hPos + 17 <= hEnd) {
        const tcTh = jpegBytes[hPos++]!;
        const tc = tcTh >> 4;
        const th = tcTh & 0x0f;
        const counts = jpegBytes.subarray(hPos, hPos + 16);
        hPos += 16;
        let totalSyms = 0;
        for (let b = 0; b < 16; b++) totalSyms += counts[b]!;
        const values = jpegBytes.subarray(hPos, Math.min(hEnd, hPos + totalSyms));
        hPos += totalSyms;
        const tbl = buildJpegHuffmanTable(counts, values);
        if (tc === 0) dcTables.set(th, tbl);
        else acTables.set(th, tbl);
      }
    } else if (marker === 0xdd) {
      // DRI
      if (segLen >= 2) {
        restartInterval = (jpegBytes[pos]! << 8) | jpegBytes[pos + 1]!;
      }
    } else if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      // SOF0 / SOF1 / SOF2
      if (segLen >= 6) {
        const sofH = (jpegBytes[pos + 1]! << 8) | jpegBytes[pos + 2]!;
        const sofW = (jpegBytes[pos + 3]! << 8) | jpegBytes[pos + 4]!;
        if (sofW > 0) width = sofW;
        if (sofH > 0) height = sofH;
        numComponents = jpegBytes[pos + 5]!;
        comps.length = 0;
        for (let c = 0; c < numComponents && 6 + c * 3 + 2 < segLen; c++) {
          const id = jpegBytes[pos + 6 + c * 3]!;
          const samp = jpegBytes[pos + 7 + c * 3]!;
          const qId = jpegBytes[pos + 8 + c * 3]!;
          comps.push({
            id,
            hSamp: Math.max(1, samp >> 4),
            vSamp: Math.max(1, samp & 0x0f),
            qTableId: qId & 0x03,
            dcTableId: c === 0 ? 0 : 1,
            acTableId: c === 0 ? 0 : 1,
            dcPred: 0,
          });
        }
      }
    } else if (marker === 0xda) {
      // SOS
      if (segLen >= 1) {
        const ns = jpegBytes[pos]!;
        for (let s = 0; s < ns && 1 + s * 2 + 1 < segLen; s++) {
          const csId = jpegBytes[pos + 1 + s * 2]!;
          const tdTa = jpegBytes[pos + 2 + s * 2]!;
          const comp = comps.find(c => c.id === csId) ?? comps[s];
          if (comp) {
            comp.dcTableId = tdTa >> 4;
            comp.acTableId = tdTa & 0x0f;
          }
        }
      }
      scanDataOffset = pos + segLen;
      break;
    }

    pos += segLen;
  }

  const rgba = new Uint8Array(width * height * 4);
  if (scanDataOffset < 0 || comps.length === 0 || dcTables.size === 0) {
    // Fallback fill if JPEG has no entropy scan or custom non-Huffman markers
    let fillR = 180;
    let fillG = 180;
    let fillB = 180;
    if (scanDataOffset >= 0 && scanDataOffset < jpegBytes.length) {
      fillR = jpegBytes[scanDataOffset] ?? 180;
      fillG = jpegBytes[scanDataOffset + 1] ?? fillR;
      fillB = jpegBytes[scanDataOffset + 2] ?? fillG;
    }
    for (let p = 0; p < width * height; p++) {
      rgba[p * 4] = fillR;
      rgba[p * 4 + 1] = fillG;
      rgba[p * 4 + 2] = fillB;
      rgba[p * 4 + 3] = 255;
    }
    return { width, height, components: numComponents, data: rgba };
  }

  let bitPos = scanDataOffset;
  let bitBuf = 0;
  let bitCnt = 0;

  const readNextEntropyByte = (): number => {
    if (bitPos >= jpegBytes.length) return 0;
    const b = jpegBytes[bitPos++]!;
    if (b === 0xff) {
      while (bitPos < jpegBytes.length && jpegBytes[bitPos] === 0xff) {
        bitPos++;
      }
      if (bitPos >= jpegBytes.length) return 0;
      const next = jpegBytes[bitPos++]!;
      if (next === 0x00) {
        return 0xff;
      }
      if (next >= 0xd0 && next <= 0xd7) {
        for (const c of comps) c.dcPred = 0;
        return readNextEntropyByte();
      }
      return 0;
    }
    return b;
  };

  const readBits = (n: number): number => {
    let val = 0;
    for (let i = 0; i < n; i++) {
      if (bitCnt === 0) {
        bitBuf = readNextEntropyByte();
        bitCnt = 8;
      }
      val = (val << 1) | ((bitBuf >> (bitCnt - 1)) & 1);
      bitCnt--;
    }
    return val;
  };

  const decodeHuff = (tbl: JpegHuffmanTable | undefined): number => {
    if (!tbl) return 0;
    let code = 0;
    for (let len = 1; len <= 16; len++) {
      code = (code << 1) | readBits(1);
      const maxC = tbl.maxCode[len]!;
      if (maxC >= 0 && code <= maxC) {
        const idx = tbl.valPtr[len]! + (code - tbl.minCode[len]!);
        return tbl.huffVal[idx] ?? 0;
      }
    }
    return 0;
  };

  const receiveExtend = (s: number): number => {
    if (s <= 0) return 0;
    const v = readBits(s);
    const vt = 1 << (s - 1);
    return v < vt ? v - ((1 << s) - 1) : v;
  };

  let maxH = 1;
  let maxV = 1;
  for (const c of comps) {
    if (c.hSamp > maxH) maxH = c.hSamp;
    if (c.vSamp > maxV) maxV = c.vSamp;
  }
  const mcuW = maxH * 8;
  const mcuH = maxV * 8;
  const mcusX = Math.ceil(width / mcuW);
  const mcusY = Math.ceil(height / mcuH);

  const compPlanes = comps.map(c => new Uint8Array(mcusX * c.hSamp * 8 * mcusY * c.vSamp * 8));
  const blockCoeffs = new Float64Array(64);
  const blockSpatial = new Uint8Array(64);

  let mcuCounter = 0;
  for (let my = 0; my < mcusY; my++) {
    for (let mx = 0; mx < mcusX; mx++) {
      if (restartInterval > 0 && mcuCounter > 0 && mcuCounter % restartInterval === 0) {
        bitCnt = 0;
        bitBuf = 0;
        if (bitPos + 1 < jpegBytes.length && jpegBytes[bitPos] === 0xff && jpegBytes[bitPos + 1]! >= 0xd0 && jpegBytes[bitPos + 1]! <= 0xd7) {
          bitPos += 2;
        }
        for (const c of comps) c.dcPred = 0;
      }
      mcuCounter++;

      for (let ci = 0; ci < comps.length; ci++) {
        const comp = comps[ci]!;
        const dcTbl = dcTables.get(comp.dcTableId) ?? dcTables.get(0);
        const acTbl = acTables.get(comp.acTableId) ?? acTables.get(0);
        const qTbl = qTables[comp.qTableId] ?? qTables[0]!;
        const plane = compPlanes[ci]!;
        const planeStride = mcusX * comp.hSamp * 8;

        for (let vy = 0; vy < comp.vSamp; vy++) {
          for (let hx = 0; hx < comp.hSamp; hx++) {
            blockCoeffs.fill(0);
            const s = decodeHuff(dcTbl);
            const diff = receiveExtend(s);
            comp.dcPred += diff;
            blockCoeffs[0] = comp.dcPred * qTbl[0]!;

            let k = 1;
            while (k < 64) {
              const rs = decodeHuff(acTbl);
              const sAc = rs & 0x0f;
              const rAc = rs >> 4;
              if (sAc === 0) {
                if (rAc === 15) {
                  k += 16;
                  continue;
                }
                break;
              }
              k += rAc;
              if (k < 64) {
                const naturalIdx = JPEG_ZIGZAG[k] ?? k;
                blockCoeffs[naturalIdx] = receiveExtend(sAc) * qTbl[k]!;
              }
              k++;
            }

            idct8x8(blockCoeffs, blockSpatial);
            const baseX = (mx * comp.hSamp + hx) * 8;
            const baseY = (my * comp.vSamp + vy) * 8;
            for (let by = 0; by < 8; by++) {
              const dstRow = (baseY + by) * planeStride + baseX;
              for (let bx = 0; bx < 8; bx++) {
                plane[dstRow + bx] = blockSpatial[by * 8 + bx]!;
              }
            }
          }
        }
      }
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dstIdx = (y * width + x) * 4;
      if (comps.length === 1) {
        const c0 = comps[0]!;
        const stride0 = mcusX * c0.hSamp * 8;
        const g = compPlanes[0]![y * stride0 + x]!;
        rgba[dstIdx] = g;
        rgba[dstIdx + 1] = g;
        rgba[dstIdx + 2] = g;
        rgba[dstIdx + 3] = 255;
      } else {
        const c0 = comps[0]!;
        const c1 = comps[1] ?? c0;
        const c2 = comps[2] ?? c0;
        const sx0 = Math.floor((x * c0.hSamp) / maxH);
        const sy0 = Math.floor((y * c0.vSamp) / maxV);
        const sx1 = Math.floor((x * c1.hSamp) / maxH);
        const sy1 = Math.floor((y * c1.vSamp) / maxV);
        const sx2 = Math.floor((x * c2.hSamp) / maxH);
        const sy2 = Math.floor((y * c2.vSamp) / maxV);

        const yVal = compPlanes[0]![sy0 * (mcusX * c0.hSamp * 8) + sx0]!;
        const cbVal = compPlanes[1]![sy1 * (mcusX * c1.hSamp * 8) + sx1]! - 128;
        const crVal = compPlanes[2]![sy2 * (mcusX * c2.hSamp * 8) + sx2]! - 128;

        const r = Math.round(yVal + 1.402 * crVal);
        const g = Math.round(yVal - 0.344136 * cbVal - 0.714136 * crVal);
        const b = Math.round(yVal + 1.772 * cbVal);

        rgba[dstIdx] = r < 0 ? 0 : r > 255 ? 255 : r;
        rgba[dstIdx + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
        rgba[dstIdx + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
        rgba[dstIdx + 3] = 255;
      }
    }
  }

  return { width, height, components: numComponents, data: rgba };
}

function decodeJpegFallbackRgba(jpegBytes: Uint8Array, width: number, height: number): Uint8Array {
  return decodeJpegToRgba(jpegBytes, width, height).data;
}

function parseDecodePairs(
  doc: ParsedCosDocument | undefined,
  dict: PdfCosDict
): ReadonlyArray<readonly [number, number]> | undefined {
  const rawDecode = dictGet(dict, "Decode") ?? dictGet(dict, "D");
  const decodeArr = doc ? doc.resolveArray(rawDecode) : rawDecode?.kind === "array" ? rawDecode : undefined;
  if (!decodeArr || decodeArr.items.length < 2) return undefined;
  const pairs: Array<readonly [number, number]> = [];
  for (let i = 0; i + 1 < decodeArr.items.length; i += 2) {
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

function decodeSamplesToRgba(
  rawSamples: Uint8Array,
  width: number,
  height: number,
  bpc: number,
  csInfo: ResolvedColorSpace,
  alphaSamples?: Uint8Array,
  decodePairs?: ReadonlyArray<readonly [number, number]>
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  const pixelCount = width * height;

  if (csInfo.isSeparation || csInfo.isDeviceN) {
    const c0 = csInfo.separationC0 ?? [1, 1, 1];
    const c1 = csInfo.separationC1 ?? [0, 0, 0];
    const expN = csInfo.separationN ?? 1;
    const alt = csInfo.separationAltSpace ?? "rgb";
    const numCh = Math.max(1, csInfo.components);
    const step = bpc === 16 ? 2 : 1;
    const useGenericTintFn =
      csInfo.tintFunctionDoc !== undefined &&
      csInfo.tintFunctionNode !== undefined &&
      (csInfo.tintFunctionType === 0 || csInfo.tintFunctionType === 3 || csInfo.tintFunctionType === 4);
    for (let p = 0; p < pixelCount; p++) {
      const chVals: number[] = [];
      let wSum = 0;
      for (let ch = 0; ch < numCh; ch++) {
        const sRaw = (rawSamples[(p * numCh + ch) * step] ?? 0) / 255;
        const tRemapped = remapUnitSampleWithDecode(sRaw, ch, decodePairs);
        chVals.push(tRemapped);
        wSum += Math.pow(Math.max(0, Math.min(1, tRemapped)), expN);
      }
      if (useGenericTintFn) {
        const outComps = evalShadingFunctionToComponents(
          csInfo.tintFunctionDoc!,
          csInfo.tintFunctionNode,
          chVals
        );
        if (alt === "cmyk") {
          const c = outComps[0] ?? 0;
          const m = outComps[1] ?? 0;
          const y = outComps[2] ?? 0;
          const k = outComps[3] ?? 0;
          rgba[p * 4] = Math.round(Math.max(0, Math.min(1, (1 - c) * (1 - k))) * 255);
          rgba[p * 4 + 1] = Math.round(Math.max(0, Math.min(1, (1 - m) * (1 - k))) * 255);
          rgba[p * 4 + 2] = Math.round(Math.max(0, Math.min(1, (1 - y) * (1 - k))) * 255);
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
        continue;
      }
      const w = Math.max(0, Math.min(1, wSum));
      if (alt === "cmyk") {
        const c = (c0[0] ?? 0) + w * ((c1[0] ?? 0) - (c0[0] ?? 0));
        const m = (c0[1] ?? 0) + w * ((c1[1] ?? 0) - (c0[1] ?? 0));
        const y = (c0[2] ?? 0) + w * ((c1[2] ?? 0) - (c0[2] ?? 0));
        const k = (c0[3] ?? 0) + w * ((c1[3] ?? 1) - (c0[3] ?? 0));
        rgba[p * 4] = Math.round(Math.max(0, Math.min(1, (1 - c) * (1 - k))) * 255);
        rgba[p * 4 + 1] = Math.round(Math.max(0, Math.min(1, (1 - m) * (1 - k))) * 255);
        rgba[p * 4 + 2] = Math.round(Math.max(0, Math.min(1, (1 - y) * (1 - k))) * 255);
      } else if (alt === "gray") {
        const gVal = (c0[0] ?? 1) + w * ((c1[0] ?? 0) - (c0[0] ?? 1));
        const gByte = Math.round(Math.max(0, Math.min(1, gVal)) * 255);
        rgba[p * 4] = gByte;
        rgba[p * 4 + 1] = gByte;
        rgba[p * 4 + 2] = gByte;
      } else {
        const rVal = (c0[0] ?? 1) + w * ((c1[0] ?? 0) - (c0[0] ?? 1));
        const gVal = (c0[1] ?? 1) + w * ((c1[1] ?? 0) - (c0[1] ?? 1));
        const bVal = (c0[2] ?? 1) + w * ((c1[2] ?? 0) - (c0[2] ?? 1));
        rgba[p * 4] = Math.round(Math.max(0, Math.min(1, rVal)) * 255);
        rgba[p * 4 + 1] = Math.round(Math.max(0, Math.min(1, gVal)) * 255);
        rgba[p * 4 + 2] = Math.round(Math.max(0, Math.min(1, bVal)) * 255);
      }
      rgba[p * 4 + 3] = 255;
    }
  } else if (csInfo.isLab) {
    const [amin, amax, bmin, bmax] = csInfo.labRange ?? [-100, 100, -100, 100];
    const invF = (t: number) => (t > 6 / 29 ? t * t * t : (3 * (6 / 29) * (6 / 29)) * (t - 4 / 29));
    const toSrgb = (u: number) => {
      const c = u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(u, 1 / 2.4) - 0.055;
      return Math.round(Math.max(0, Math.min(1, c)) * 255);
    };
    for (let p = 0; p < pixelCount; p++) {
      const s0 = (rawSamples[p * 3] ?? 0) / 255;
      const s1 = (rawSamples[p * 3 + 1] ?? 128) / 255;
      const s2 = (rawSamples[p * 3 + 2] ?? 128) / 255;
      const L = s0 * 100;
      if (L <= 0.01) {
        rgba[p * 4] = 0;
        rgba[p * 4 + 1] = 0;
        rgba[p * 4 + 2] = 0;
        rgba[p * 4 + 3] = 255;
        continue;
      }
      const a = amin + s1 * (amax - amin);
      const b = bmin + s2 * (bmax - bmin);
      const fy = (L + 16) / 116;
      const fx = fy + a / 500;
      const fz = fy - b / 200;
      const X = 0.95047 * invF(fx);
      const Y = 1.0 * invF(fy);
      const Z = 1.08883 * invF(fz);
      const linR = X * 3.2406 + Y * -1.5372 + Z * -0.4986;
      const linG = X * -0.9689 + Y * 1.8758 + Z * 0.0415;
      const linB = X * 0.0557 + Y * -0.2040 + Z * 1.0570;
      rgba[p * 4] = toSrgb(linR);
      rgba[p * 4 + 1] = toSrgb(linG);
      rgba[p * 4 + 2] = toSrgb(linB);
      rgba[p * 4 + 3] = 255;
    }
  } else if (csInfo.colorSpace === "rgb") {
    const hasCalRgb = Boolean(csInfo.calRgbGamma || csInfo.calRgbMatrix);
    const toSrgbByte = (u: number) => {
      const c = u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(u, 1 / 2.4) - 0.055;
      return Math.round(Math.max(0, Math.min(1, c)) * 255);
    };
    const writeRgbPixel = (p: number, rByte: number, gByte: number, bByte: number) => {
      let rU = remapUnitSampleWithDecode(rByte / 255, 0, decodePairs);
      let gU = remapUnitSampleWithDecode(gByte / 255, 1, decodePairs);
      let bU = remapUnitSampleWithDecode(bByte / 255, 2, decodePairs);
      if (hasCalRgb) {
        const [gr, gg, gb] = csInfo.calRgbGamma ?? [1, 1, 1];
        const ag = Math.pow(rU, gr);
        const bg = Math.pow(gU, gg);
        const cg = Math.pow(bU, gb);
        if (csInfo.calRgbMatrix && csInfo.calRgbMatrix.length >= 9) {
          const m = csInfo.calRgbMatrix;
          const X = m[0]! * ag + m[3]! * bg + m[6]! * cg;
          const Y = m[1]! * ag + m[4]! * bg + m[7]! * cg;
          const Z = m[2]! * ag + m[5]! * bg + m[8]! * cg;
          const linR = X * 3.2406 + Y * -1.5372 + Z * -0.4986;
          const linG = X * -0.9689 + Y * 1.8758 + Z * 0.0415;
          const linB = X * 0.0557 + Y * -0.2040 + Z * 1.0570;
          rgba[p * 4] = toSrgbByte(linR);
          rgba[p * 4 + 1] = toSrgbByte(linG);
          rgba[p * 4 + 2] = toSrgbByte(linB);
          rgba[p * 4 + 3] = 255;
          return;
        }
        rU = ag;
        gU = bg;
        bU = cg;
      }
      rgba[p * 4] = Math.round(rU * 255);
      rgba[p * 4 + 1] = Math.round(gU * 255);
      rgba[p * 4 + 2] = Math.round(bU * 255);
      rgba[p * 4 + 3] = 255;
    };
    if (bpc === 16 && rawSamples.length >= pixelCount * 6) {
      for (let p = 0; p < pixelCount; p++) {
        writeRgbPixel(p, rawSamples[p * 6]!, rawSamples[p * 6 + 2]!, rawSamples[p * 6 + 4]!);
      }
    } else if (rawSamples.length >= pixelCount * 3) {
      for (let p = 0; p < pixelCount; p++) {
        writeRgbPixel(p, rawSamples[p * 3]!, rawSamples[p * 3 + 1]!, rawSamples[p * 3 + 2]!);
      }
    } else {
      for (let p = 0; p < pixelCount; p++) rgba[p * 4 + 3] = 255;
    }
  } else if (csInfo.colorSpace === "gray") {
    const writeGrayPixel = (p: number, gByte: number) => {
      let gU = remapUnitSampleWithDecode(gByte / 255, 0, decodePairs);
      if (csInfo.calGrayGamma && csInfo.calGrayGamma !== 1) {
        const lin = Math.pow(gU, csInfo.calGrayGamma);
        gU = lin <= 0.0031308 ? 12.92 * lin : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055;
      }
      const outG = Math.round(Math.max(0, Math.min(1, gU)) * 255);
      rgba[p * 4] = outG;
      rgba[p * 4 + 1] = outG;
      rgba[p * 4 + 2] = outG;
      rgba[p * 4 + 3] = 255;
    };
    if (bpc === 16 && rawSamples.length >= pixelCount * 2) {
      for (let p = 0; p < pixelCount; p++) {
        writeGrayPixel(p, rawSamples[p * 2] ?? 0);
      }
    } else if (bpc === 1) {
      const rowBytes = Math.ceil(width / 8);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const byteIdx = y * rowBytes + (x >> 3);
          const bit = ((rawSamples[byteIdx] ?? 0) >> (7 - (x & 7))) & 1;
          const p = y * width + x;
          writeGrayPixel(p, bit ? 255 : 0);
        }
      }
    } else if (bpc === 2) {
      const rowBytes = Math.ceil(width / 4);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
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
        for (let x = 0; x < width; x++) {
          const byteIdx = y * rowBytes + (x >> 1);
          const nibble = x & 1 ? (rawSamples[byteIdx] ?? 0) & 0x0f : ((rawSamples[byteIdx] ?? 0) >> 4) & 0x0f;
          const p = y * width + x;
          writeGrayPixel(p, nibble * 17);
        }
      }
    } else {
      for (let p = 0; p < pixelCount; p++) {
        writeGrayPixel(p, rawSamples[p] ?? 0);
      }
    }
  } else if (csInfo.colorSpace === "cmyk") {
    const stride = bpc === 16 ? 8 : 4;
    const chStep = bpc === 16 ? 2 : 1;
    for (let p = 0; p < pixelCount; p++) {
      const c = remapUnitSampleWithDecode((rawSamples[p * stride] ?? 0) / 255, 0, decodePairs);
      const m = remapUnitSampleWithDecode((rawSamples[p * stride + chStep] ?? 0) / 255, 1, decodePairs);
      const y = remapUnitSampleWithDecode((rawSamples[p * stride + chStep * 2] ?? 0) / 255, 2, decodePairs);
      const k = remapUnitSampleWithDecode((rawSamples[p * stride + chStep * 3] ?? 0) / 255, 3, decodePairs);
      rgba[p * 4] = Math.round((1 - c) * (1 - k) * 255);
      rgba[p * 4 + 1] = Math.round((1 - m) * (1 - k) * 255);
      rgba[p * 4 + 2] = Math.round((1 - y) * (1 - k) * 255);
      rgba[p * 4 + 3] = 255;
    }
  } else if (csInfo.colorSpace === "index") {
    const pal = csInfo.palette;
    const baseComp = csInfo.baseComponents ?? 3;
    const rowBits = width * bpc;
    const rowBytes = Math.max(1, Math.ceil(rowBits / 8));
    for (let y = 0; y < height; y++) {
      const rowStart = y * rowBytes;
      for (let x = 0; x < width; x++) {
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
            rgba[p * 4] = Math.round((1 - c) * (1 - k) * 255);
            rgba[p * 4 + 1] = Math.round((1 - m) * (1 - k) * 255);
            rgba[p * 4 + 2] = Math.round((1 - yel) * (1 - k) * 255);
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

function applyStencilFillColor(
  rgba: Uint8Array,
  width: number,
  height: number,
  fillColor: { readonly r: number; readonly g: number; readonly b: number; readonly alpha: number }
): void {
  const rByte = Math.max(0, Math.min(255, Math.round(fillColor.r * 255)));
  const gByte = Math.max(0, Math.min(255, Math.round(fillColor.g * 255)));
  const bByte = Math.max(0, Math.min(255, Math.round(fillColor.b * 255)));
  const aByte = Math.max(0, Math.min(255, Math.round(fillColor.alpha * 255)));
  const pixelCount = width * height;
  for (let p = 0; p < pixelCount; p++) {
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

function applySmaskStreamToRgba(
  doc: ParsedCosDocument,
  smaskStream: PdfCosStream,
  rgba: Uint8Array,
  width: number,
  height: number,
  activeRes: PdfCosDict | undefined
): void {
  const smaskDecoded = decodeXObjectImageToRgba(doc, smaskStream, activeRes);
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
    const sy = Math.min(sh - 1, Math.floor((y * sh) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / width));
      const aByte = smaskDecoded.rgba[(sy * sw + sx) * 4]!;
      const dstIdx = (y * width + x) * 4;
      if (matteRgb && aByte > 0 && aByte < 255) {
        const aNorm = aByte / 255;
        for (let ch = 0; ch < 3; ch++) {
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

function applyExplicitMaskStreamToRgba(
  doc: ParsedCosDocument,
  maskStream: PdfCosStream,
  rgba: Uint8Array,
  width: number,
  height: number,
  activeRes: PdfCosDict | undefined
): void {
  const maskDecoded = decodeXObjectImageToRgba(doc, maskStream, activeRes);
  const mw = maskDecoded.width;
  const mh = maskDecoded.height;
  for (let y = 0; y < height; y++) {
    const my = Math.min(mh - 1, Math.floor((y * mh) / height));
    for (let x = 0; x < width; x++) {
      const mx = Math.min(mw - 1, Math.floor((x * mw) / width));
      const maskLuma = maskDecoded.rgba[(my * mw + mx) * 4]!;
      if (maskLuma > 127) {
        rgba[(y * width + x) * 4 + 3] = 0;
      }
    }
  }
}

export function decodeXObjectImageToRgba(
  doc: ParsedCosDocument,
  xobjStream: PdfCosStream,
  activeRes: PdfCosDict | undefined,
  fillColor?: { readonly r: number; readonly g: number; readonly b: number; readonly alpha: number }
): DecodedDisplayImage {
  const dict = xobjStream.dict;
  const wNode = doc.resolve(dictGet(dict, "Width") ?? dictGet(dict, "W"));
  const hNode = doc.resolve(dictGet(dict, "Height") ?? dictGet(dict, "H"));
  const bpcNode = doc.resolve(dictGet(dict, "BitsPerComponent") ?? dictGet(dict, "BPC"));
  const imageMaskNode = doc.resolve(dictGet(dict, "ImageMask") ?? dictGet(dict, "IM"));
  const isMask = imageMaskNode?.kind === "boolean" && imageMaskNode.value;

  const width = wNode?.kind === "number" ? Math.max(1, Math.round(wNode.value)) : 1;
  const height = hNode?.kind === "number" ? Math.max(1, Math.round(hNode.value)) : 1;
  const bitsPerComponent = bpcNode?.kind === "number" ? bpcNode.value : isMask ? 1 : 8;

  const csNode = dictGet(dict, "ColorSpace") ?? dictGet(dict, "CS");
  const csInfo: ResolvedColorSpace = isMask
    ? { colorSpace: "gray", components: 1 }
    : resolveColorSpaceInfo(doc, csNode, activeRes);

  const filters = extractStreamFilterList(doc, dict);
  const encoding = resolveEncodingKind(filters);

  let alphaSamples: Uint8Array | undefined;
  const smaskNode = doc.resolve(dictGet(dict, "SMask"));
  if (smaskNode?.kind === "stream") {
    const smaskFilters = extractStreamFilterList(doc, smaskNode.dict);
    const smaskEncoding = resolveEncodingKind(smaskFilters);
    if (smaskEncoding === "jpeg") {
      const smaskJpeg = extractRawJpegFromStream(doc, smaskNode, smaskFilters);
      const smaskRgba = decodeJpegFallbackRgba(smaskJpeg, width, height);
      alphaSamples = new Uint8Array(width * height);
      for (let p = 0; p < width * height; p++) {
        alphaSamples[p] = smaskRgba[p * 4]!;
      }
    } else {
      try {
        alphaSamples = doc.decodeStream(smaskNode);
      } catch {
        alphaSamples = undefined;
      }
    }
  }

  let rgba: Uint8Array;
  if (encoding === "jpeg") {
    const rawJpegBytes = extractRawJpegFromStream(doc, xobjStream, filters);
    rgba = decodeJpegFallbackRgba(rawJpegBytes, width, height);
    if (smaskNode?.kind === "stream") {
      applySmaskStreamToRgba(doc, smaskNode, rgba, width, height, activeRes);
    }
    const maskResolvedJpg = doc.resolve(dictGet(dict, "Mask"));
    if (maskResolvedJpg?.kind === "stream") {
      applyExplicitMaskStreamToRgba(doc, maskResolvedJpg, rgba, width, height, activeRes);
    }
    if (fillColor && fillColor.alpha < 1) {
      for (let p = 0; p < width * height; p++) {
        rgba[p * 4 + 3] = Math.round(rgba[p * 4 + 3]! * fillColor.alpha);
      }
    }
  } else {
    let decodedSamples: Uint8Array;
    try {
      decodedSamples = doc.decodeStream(xobjStream);
    } catch {
      decodedSamples = xobjStream.rawBytes;
    }
    const decodePairs = parseDecodePairs(doc, dict);
    rgba = decodeSamplesToRgba(decodedSamples, width, height, bitsPerComponent, csInfo, alphaSamples, decodePairs);
    if (smaskNode?.kind === "stream") {
      applySmaskStreamToRgba(doc, smaskNode, rgba, width, height, activeRes);
    }

    if (isMask && fillColor) {
      applyStencilFillColor(rgba, width, height, fillColor);
    } else {
      const maskResolved = doc.resolve(dictGet(dict, "Mask"));
      if (maskResolved?.kind === "stream") {
        applyExplicitMaskStreamToRgba(doc, maskResolved, rgba, width, height, activeRes);
      }
      const maskArr = doc.resolveArray(dictGet(dict, "Mask"));
      if (maskArr && maskArr.items.length >= 2) {
        const bounds = maskArr.items.map(it => {
          const r = doc.resolve(it);
          return r?.kind === "number" ? r.value : 0;
        });
        if (csInfo.colorSpace === "rgb" && bounds.length >= 6) {
          for (let p = 0; p < width * height; p++) {
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
            const v = csInfo.colorSpace === "index" ? (decodedSamples[p] ?? 0) : rgba[p * 4]!;
            if (v >= bounds[0]! && v <= bounds[1]!) {
              rgba[p * 4 + 3] = 0;
            }
          }
        }
      }
      if (fillColor && fillColor.alpha < 1) {
        for (let p = 0; p < width * height; p++) {
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

export function decodeInlineImageNodeToRgba(
  doc: ParsedCosDocument | undefined,
  dict: PdfCosDict,
  rawData: Uint8Array,
  activeRes: PdfCosDict | undefined,
  fillColor?: { readonly r: number; readonly g: number; readonly b: number; readonly alpha: number }
): DecodedDisplayImage {
  const inlineIm = dictGet(dict, "IM") ?? dictGet(dict, "ImageMask");
  const isInlineMask = inlineIm?.kind === "boolean" && inlineIm.value;
  const wNode = dictGet(dict, "W") ?? dictGet(dict, "Width");
  const hNode = dictGet(dict, "H") ?? dictGet(dict, "Height");
  const bpcNode = dictGet(dict, "BPC") ?? dictGet(dict, "BitsPerComponent");
  const csNode = dictGet(dict, "CS") ?? dictGet(dict, "ColorSpace");

  const width = wNode?.kind === "number" ? Math.max(1, Math.round(wNode.value)) : 1;
  const height = hNode?.kind === "number" ? Math.max(1, Math.round(hNode.value)) : 1;
  const bitsPerComponent = bpcNode?.kind === "number" ? bpcNode.value : isInlineMask ? 1 : 8;
  const csInfo: ResolvedColorSpace =
    csNode && doc
      ? resolveColorSpaceInfo(doc, csNode, activeRes)
      : isInlineMask
        ? { colorSpace: "gray", components: 1 }
        : csNode?.kind === "name" && (csNode.decoded === "G" || csNode.decoded === "DeviceGray")
          ? { colorSpace: "gray", components: 1 }
          : csNode?.kind === "name" && (csNode.decoded === "CMYK" || csNode.decoded === "DeviceCMYK")
            ? { colorSpace: "cmyk", components: 4 }
            : { colorSpace: "rgb", components: 3 };

  const filters = doc ? extractStreamFilterList(doc, dict) : [];
  if (!doc) {
    const fNode = dictGet(dict, "F") ?? dictGet(dict, "Filter");
    if (fNode?.kind === "name") filters.push(fNode.decoded);
  }
  const encoding = resolveEncodingKind(filters);
  let decodedSamples = rawData;
  if (encoding === "jpeg") {
    decodedSamples = extractRawJpegFromStream(
      doc ?? ({} as ParsedCosDocument),
      { kind: "stream", dict, rawBytes: rawData },
      filters
    );
  } else if (filters.length > 0) {
    try {
      decodedSamples = decodeStreamObject(
        { kind: "stream", dict, rawBytes: rawData },
        undefined,
        n => (doc ? doc.resolve(n) : n)
      );
    } catch {
      // Keep raw bytes on filter error
    }
  }

  const rgba =
    encoding === "jpeg"
      ? decodeJpegFallbackRgba(decodedSamples, width, height)
      : decodeSamplesToRgba(
          decodedSamples,
          width,
          height,
          bitsPerComponent,
          csInfo,
          undefined,
          parseDecodePairs(doc, dict)
        );

  if (isInlineMask && fillColor) {
    applyStencilFillColor(rgba, width, height, fillColor);
  } else if (fillColor && fillColor.alpha < 1) {
    for (let p = 0; p < width * height; p++) {
      rgba[p * 4 + 3] = Math.round(rgba[p * 4 + 3]! * fillColor.alpha);
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

export function extractDocumentImages(
  doc: ParsedCosDocument,
  options: { readonly firstPage?: number; readonly lastPage?: number } = {}
): PdfExtractedImage[] {
  const catalog = doc.resolveDict(doc.rootRef);
  const leaves = collectPageLeaves(doc, catalog ? dictGet(catalog, "Pages") : undefined, undefined);
  const totalPages = leaves.length;
  const startPage = Math.max(1, options.firstPage ?? 1);
  const endPage = options.lastPage && options.lastPage > 0 ? Math.min(totalPages, options.lastPage) : totalPages;

  const extracted: PdfExtractedImage[] = [];
  let imageIndex = 0;

  for (let pageNumber = startPage; pageNumber <= endPage; pageNumber++) {
    const leaf = leaves[pageNumber - 1];
    if (!leaf) continue;

    const pageResources =
      doc.resolveDict(dictGet(leaf.pageDict, "Resources")) ?? leaf.inheritedResources;
    const contentBytes = decodeContentBytes(doc, dictGet(leaf.pageDict, "Contents"));
    const rootAst = parseContentStream(contentBytes);

    const referencedImageKeysOnPage = new Set<string>();

    const extractFromXObjectStream = (
      xobjStream: PdfCosStream,
      objectId: { readonly objNum: number; readonly genNum: number } | undefined,
      ctm: Matrix6,
      activeRes: PdfCosDict | undefined
    ) => {
      const dict = xobjStream.dict;
      const wNode = doc.resolve(dictGet(dict, "Width") ?? dictGet(dict, "W"));
      const hNode = doc.resolve(dictGet(dict, "Height") ?? dictGet(dict, "H"));
      const bpcNode = doc.resolve(dictGet(dict, "BitsPerComponent") ?? dictGet(dict, "BPC"));
      const interpNode = doc.resolve(dictGet(dict, "Interpolate") ?? dictGet(dict, "I"));
      const imageMaskNode = doc.resolve(dictGet(dict, "ImageMask") ?? dictGet(dict, "IM"));
      const isMask = imageMaskNode?.kind === "boolean" && imageMaskNode.value;

      const width = wNode?.kind === "number" ? Math.max(1, Math.round(wNode.value)) : 1;
      const height = hNode?.kind === "number" ? Math.max(1, Math.round(hNode.value)) : 1;
      const bitsPerComponent = bpcNode?.kind === "number" ? bpcNode.value : isMask ? 1 : 8;
      const interpolate = interpNode?.kind === "boolean" ? interpNode.value : false;

      const csNode = dictGet(dict, "ColorSpace") ?? dictGet(dict, "CS");
      const csInfo: ResolvedColorSpace = isMask
        ? { colorSpace: "gray", colorSpaceLabel: "-", components: 1 }
        : resolveColorSpaceInfo(doc, csNode, activeRes);

      const filters = extractStreamFilterList(doc, dict);
      const encoding = resolveEncodingKind(filters);
      const { xPpi, yPpi } = computePpiFromCtm(width, height, ctm);

      let rawJpegBytes: Uint8Array | undefined;
      let rawEncodedBytes: Uint8Array | undefined;
      let jbig2GlobalsBytes: Uint8Array | undefined;
      let ccittParams: { readonly k: number; readonly blackIs1: boolean; readonly byteAlign: boolean } | undefined;
      if (encoding === "jpx" || encoding === "jbig2" || encoding === "ccitt") {
        rawEncodedBytes = extractRawJpegFromStream(doc, xobjStream, filters);
        const dpNode = dictGet(dict, "DecodeParms") ?? dictGet(dict, "DP");
        const dpArr = doc.resolveArray(dpNode);
        const dpDict = dpArr
          ? dpArr.items.map(it => doc.resolveDict(it)).find((d): d is PdfCosDict => d !== undefined)
          : doc.resolveDict(dpNode);
        if (encoding === "jbig2" && dpDict) {
          const globalsStream = doc.resolve(dictGet(dpDict, "JBIG2Globals"));
          if (globalsStream?.kind === "stream") {
            try {
              jbig2GlobalsBytes = doc.decodeStream(globalsStream);
            } catch {
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
      let rgba: Uint8Array;
      let alphaSamples: Uint8Array | undefined;
      const rawSmask = dictGet(dict, "SMask");
      if (rawSmask?.kind === "ref") {
        referencedImageKeysOnPage.add(`${rawSmask.objectNumber}:${rawSmask.generationNumber}`);
      }
      const rawMaskRef = dictGet(dict, "Mask");
      if (rawMaskRef?.kind === "ref") {
        referencedImageKeysOnPage.add(`${rawMaskRef.objectNumber}:${rawMaskRef.generationNumber}`);
      }
      const smaskNode = doc.resolve(rawSmask);
      if (smaskNode?.kind === "stream") {
        try {
          alphaSamples = doc.decodeStream(smaskNode);
        } catch {
          alphaSamples = undefined;
        }
      }

      if (encoding === "jpeg") {
        rawJpegBytes = extractRawJpegFromStream(doc, xobjStream, filters);
        rgba = decodeJpegFallbackRgba(rawJpegBytes, width, height);
        if (smaskNode?.kind === "stream") {
          applySmaskStreamToRgba(doc, smaskNode, rgba, width, height, activeRes);
        }
        const maskResolvedJpg = doc.resolve(rawMaskRef);
        if (maskResolvedJpg?.kind === "stream") {
          applyExplicitMaskStreamToRgba(doc, maskResolvedJpg, rgba, width, height, activeRes);
        }
      } else {
        let decodedSamples: Uint8Array;
        try {
          decodedSamples = doc.decodeStream(xobjStream);
        } catch {
          decodedSamples = xobjStream.rawBytes;
        }
        const decodePairs = parseDecodePairs(doc, dict);
        rgba = decodeSamplesToRgba(decodedSamples, width, height, bitsPerComponent, csInfo, alphaSamples, decodePairs);
        if (smaskNode?.kind === "stream") {
          applySmaskStreamToRgba(doc, smaskNode, rgba, width, height, activeRes);
        }

        const rawMask = dictGet(dict, "Mask");
        if (rawMask?.kind === "ref") {
          referencedImageKeysOnPage.add(`${rawMask.objectNumber}:${rawMask.generationNumber}`);
        }
        const maskResolved = doc.resolve(rawMask);
        if (maskResolved?.kind === "stream") {
          applyExplicitMaskStreamToRgba(doc, maskResolved, rgba, width, height, activeRes);
        }
        // Apply /Mask [min0 max0 ...] color-key transparency
        const maskArr = doc.resolveArray(rawMask);
        if (maskArr && maskArr.items.length >= 2) {
          const bounds = maskArr.items.map(it => {
            const r = doc.resolve(it);
            return r?.kind === "number" ? r.value : 0;
          });
          if (csInfo.colorSpace === "rgb" && bounds.length >= 6) {
            for (let p = 0; p < width * height; p++) {
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
              const v = csInfo.colorSpace === "index" ? (decodedSamples[p] ?? 0) : rgba[p * 4]!;
              if (v >= bounds[0]! && v <= bounds[1]!) {
                rgba[p * 4 + 3] = 0;
              }
            }
          }
        }
      }

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

    const walkAst = (
      nodes: readonly PdfContentNode[],
      activeRes: PdfCosDict | undefined,
      visitedForms: ReadonlySet<string>
    ) => {
      for (const node of nodes) {
        switch (node.kind) {
          case "graphics-group": {
            ctmStack.push([...currentCtm()] as Matrix6);
            walkAst(node.ops, activeRes, visitedForms);
            if (ctmStack.length > 1) ctmStack.pop();
            break;
          }
          case "marked-content": {
            walkAst(node.children, activeRes, visitedForms);
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
            if (!rawTarget) break;
            const objectId =
              rawTarget.kind === "ref"
                ? { objNum: rawTarget.objectNumber, genNum: rawTarget.generationNumber }
                : undefined;
            const targetStream = doc.resolve(rawTarget);
            if (targetStream?.kind !== "stream") break;

            const subtypeNode = doc.resolve(dictGet(targetStream.dict, "Subtype"));
            const subtype = subtypeNode?.kind === "name" ? subtypeNode.decoded : "";
            if (subtype === "Image") {
              if (objectId) {
                referencedImageKeysOnPage.add(`${objectId.objNum}:${objectId.genNum}`);
              }
              extractFromXObjectStream(targetStream, objectId, currentCtm(), activeRes);
            } else if (subtype === "Form") {
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

              const formRes =
                doc.resolveDict(dictGet(targetStream.dict, "Resources")) ?? activeRes;
              let formBytes: Uint8Array;
              try {
                formBytes = doc.decodeStream(targetStream);
              } catch {
                formBytes = targetStream.rawBytes;
              }
              const formAst = parseContentStream(formBytes);
              ctmStack.push(formCtm);
              walkAst(formAst, formRes, nextVisited);
              if (ctmStack.length > 1) ctmStack.pop();
            }
            break;
          }
          case "inline-image": {
            const dict = node.dict;
            const inlineIm = dictGet(dict, "IM") ?? dictGet(dict, "ImageMask");
            const isInlineMask = inlineIm?.kind === "boolean" && inlineIm.value;
            const wNode = dictGet(dict, "W") ?? dictGet(dict, "Width");
            const hNode = dictGet(dict, "H") ?? dictGet(dict, "Height");
            const bpcNode = dictGet(dict, "BPC") ?? dictGet(dict, "BitsPerComponent");
            const interpNode = dictGet(dict, "I") ?? dictGet(dict, "Interpolate");
            const csNode = dictGet(dict, "CS") ?? dictGet(dict, "ColorSpace");

            const width = wNode?.kind === "number" ? Math.max(1, Math.round(wNode.value)) : 1;
            const height = hNode?.kind === "number" ? Math.max(1, Math.round(hNode.value)) : 1;
            const bitsPerComponent =
              bpcNode?.kind === "number" ? bpcNode.value : isInlineMask ? 1 : 8;
            const interpolate = interpNode?.kind === "boolean" ? interpNode.value : false;
            const csInfo = csNode
              ? resolveColorSpaceInfo(doc, csNode, activeRes)
              : isInlineMask
                ? { colorSpace: "gray" as const, colorSpaceLabel: "-" as const, components: 1 }
                : { colorSpace: "rgb" as const, colorSpaceLabel: "rgb" as const, components: 3 };
            const filters = extractStreamFilterList(doc, dict);
            const encoding = resolveEncodingKind(filters);
            const { xPpi, yPpi } = computePpiFromCtm(width, height, currentCtm());

            let decodedSamples = node.data;
            if (encoding !== "jpeg" && filters.length > 0) {
              try {
                decodedSamples = decodeStreamObject(
                  { kind: "stream", dict, rawBytes: node.data },
                  undefined,
                  n => doc.resolve(n)
                );
              } catch {
                // Keep raw bytes on filter error
              }
            }
            const rgba =
              encoding === "jpeg"
                ? decodeJpegFallbackRgba(decodedSamples, width, height)
                : decodeSamplesToRgba(
                    decodedSamples,
                    width,
                    height,
                    bitsPerComponent,
                    csInfo,
                    undefined,
                    parseDecodePairs(doc, dict)
                  );
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
              ...(encoding === "jpeg" ? { rawJpegBytes: decodedSamples } : {}),
            });
            break;
          }
          default:
            break;
        }
      }
    };

    const visitedForms = new Set<string>();
    walkAst(rootAst, pageResources, visitedForms);

    // Also walk /Resources /Pattern tiling pattern streams and Type 3 /CharProcs streams
    if (pageResources) {
      const patMap = doc.resolveDict(dictGet(pageResources, "Pattern"));
      if (patMap) {
        for (const pEntry of patMap.entries) {
          const patStream = doc.resolve(pEntry.value);
          if (patStream?.kind === "stream") {
            const patRes = doc.resolveDict(dictGet(patStream.dict, "Resources")) ?? pageResources;
            try {
              walkAst(parseContentStream(doc.decodeStream(patStream)), patRes, visitedForms);
            } catch {
              // ignore malformed pattern stream
            }
          }
        }
      }
      const fontMap = doc.resolveDict(dictGet(pageResources, "Font"));
      if (fontMap) {
        for (const fEntry of fontMap.entries) {
          const fDict = doc.resolveDict(fEntry.value);
          const sub = fDict ? doc.resolve(dictGet(fDict, "Subtype")) : undefined;
          if (fDict && sub?.kind === "name" && sub.decoded === "Type3") {
            const fRes = doc.resolveDict(dictGet(fDict, "Resources")) ?? pageResources;
            const charProcs = doc.resolveDict(dictGet(fDict, "CharProcs"));
            if (charProcs) {
              for (const cpEntry of charProcs.entries) {
                const cpStream = doc.resolve(cpEntry.value);
                if (cpStream?.kind === "stream") {
                  try {
                    walkAst(parseContentStream(doc.decodeStream(cpStream)), fRes, visitedForms);
                  } catch {
                    // ignore malformed charproc
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
      const walkApNode = (apNode: PdfCosNode | undefined) => {
        const resolved = doc.resolve(apNode);
        if (!resolved) return;
        if (resolved.kind === "stream") {
          const apRes = doc.resolveDict(dictGet(resolved.dict, "Resources")) ?? pageResources;
          try {
            walkAst(parseContentStream(doc.decodeStream(resolved)), apRes, visitedForms);
          } catch {
            // ignore malformed appearance stream
          }
        } else if (resolved.kind === "dict") {
          for (const entry of resolved.entries) {
            walkApNode(entry.value);
          }
        }
      };
      for (const item of annotsArr.items) {
        const aDict = doc.resolveDict(item);
        const apDict = aDict ? doc.resolveDict(dictGet(aDict, "AP")) : undefined;
        if (apDict) {
          walkApNode(dictGet(apDict, "N"));
        }
      }
    }

    const xobjDict = pageResources ? doc.resolveDict(dictGet(pageResources, "XObject")) : undefined;
    if (xobjDict) {
      for (const entry of xobjDict.entries) {
        const rawVal = entry.value;
        const objectId =
          rawVal.kind === "ref"
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
            extractFromXObjectStream(resolved, objectId, [w, 0, 0, h, 0, 0], pageResources);
          }
        }
      }
    }
  }

  return extracted;
}
