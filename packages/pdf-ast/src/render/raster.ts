import { getStandardFontOutlines } from "../fonts/standard-outlines.js";
import { encodeToXmlString, PageViewport } from "../vendor/pdfjs-fonts.mjs";
import { parseCosDocument, type ParsedCosDocument } from "../cos/parser.js";
import { PdfPage } from "../canvas.js";
import { dictGet, type PdfCosDict, type PdfCosNode, type PdfCosRef } from "../ast.js";
import type { PdfClipPath, PdfDisplayList, PdfPaintGroup, PdfPaintOperation, PdfPathSegment, PdfRgbColor, PdfPlacedGlyph, PdfEvaluatedPath, PdfEvaluatedImage, PdfSoftMask } from "../ast.js";
import { applyPredictor, decodeFlate, encodeFlate } from "../cos/filters.js";
import { flattenCubic } from "./cubic.js";
import { downscaleImage, sampleImageLinear } from "./image-sampling.js";
import { strokeOutlines, type StrokePoint, type StrokeSubpath } from "./stroke.js";

export interface RgbaBitmap {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export function *encodePngSteps(bitmap: RgbaBitmap): Generator<void, Uint8Array, void> {
  return (yield* encodeRgbaToPngSteps(bitmap.width, bitmap.height, bitmap.data));
}

export function *decodePngSteps(pngBytes: Uint8Array): Generator<void, RgbaBitmap, void> {
  let work = 0;
  if (pngBytes.length < 24 || pngBytes[0] !== 137 || pngBytes[1] !== 80 || pngBytes[2] !== 78 || pngBytes[3] !== 71) {
    throw new Error("Invalid PNG signature");
  }
  const view = new DataView(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);
  let width = 0, height = 0, bitDepth = 8, colorType = 2;
  let plteChunk: Uint8Array | undefined;
  let trnsChunk: Uint8Array | undefined;
  const idatParts: Uint8Array[] = [];
  let pos = 8;
  while (pos + 8 <= pngBytes.length) {
    if (++work % 16384 === 0) yield;
    const len = view.getUint32(pos, false);
    const type = String.fromCharCode(pngBytes[pos + 4]!, pngBytes[pos + 5]!, pngBytes[pos + 6]!, pngBytes[pos + 7]!);
    const chunkData = pngBytes.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = view.getUint32(pos + 8, false);
      height = view.getUint32(pos + 12, false);
      bitDepth = chunkData[8]!;
      colorType = chunkData[9]!;
    } else if (type === "PLTE") {
      plteChunk = chunkData;
    } else if (type === "tRNS") {
      trnsChunk = chunkData;
    } else if (type === "IDAT") {
      idatParts.push(chunkData);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  const totalIdat = idatParts.reduce((s, c) => s + c.length, 0);
  const mergedIdat = new Uint8Array(totalIdat);
  let off = 0;
  for (const part of idatParts) {
    if (++work % 16384 === 0) yield;
    mergedIdat.set(part, off);
    off += part.length;
  }
  const inflated = decodeFlate(mergedIdat);
  const colors = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const unpredicted = applyPredictor(inflated, {
    Predictor: 15,
    Columns: width,
    Colors: colors,
    BitsPerComponent: bitDepth,
  });
  const data = new Uint8Array(width * height * 4);
  const rowBytes = Math.max(1, Math.ceil((width * colors * bitDepth) / 8));
  const readSubByteSample = (rowStart: number, x: number): number => {
    if (bitDepth === 8) return unpredicted[rowStart + x] ?? 0;
    if (bitDepth === 4) {
      const b = unpredicted[rowStart + (x >> 1)] ?? 0;
      return x & 1 ? b & 0x0f : (b >> 4) & 0x0f;
    }
    if (bitDepth === 2) {
      const b = unpredicted[rowStart + (x >> 2)] ?? 0;
      return (b >> (6 - ((x & 3) * 2))) & 0x03;
    }
    if (bitDepth === 1) {
      const b = unpredicted[rowStart + (x >> 3)] ?? 0;
      return (b >> (7 - (x & 7))) & 0x01;
    }
    return unpredicted[rowStart + x * 2] ?? 0;
  };

  if (colorType === 3) {
    for (let y = 0; y < height; y++) {
    if (++work % 16384 === 0) yield;
      const rowStart = y * rowBytes;
      for (let x = 0; x < width; x++) {
    if (++work % 16384 === 0) yield;
        const idx = readSubByteSample(rowStart, x);
        const dst = (y * width + x) * 4;
        if (plteChunk && idx * 3 + 2 < plteChunk.length) {
          data[dst] = plteChunk[idx * 3]!;
          data[dst + 1] = plteChunk[idx * 3 + 1]!;
          data[dst + 2] = plteChunk[idx * 3 + 2]!;
        } else {
          data[dst] = idx;
          data[dst + 1] = idx;
          data[dst + 2] = idx;
        }
        data[dst + 3] = trnsChunk && idx < trnsChunk.length ? trnsChunk[idx]! : 255;
      }
    }
  } else if (colorType === 6) {
    const step = bitDepth === 16 ? 8 : 4;
    const chOff = bitDepth === 16 ? 2 : 1;
    for (let i = 0; i < width * height; i++) {
    if (++work % 16384 === 0) yield;
      data[i * 4] = unpredicted[i * step] ?? 0;
      data[i * 4 + 1] = unpredicted[i * step + chOff] ?? 0;
      data[i * 4 + 2] = unpredicted[i * step + chOff * 2] ?? 0;
      data[i * 4 + 3] = unpredicted[i * step + chOff * 3] ?? 255;
    }
  } else if (colorType === 2) {
    const step = bitDepth === 16 ? 6 : 3;
    const chOff = bitDepth === 16 ? 2 : 1;
    const trnsR = trnsChunk && trnsChunk.length >= 6 ? (bitDepth === 16 ? (trnsChunk[0]! << 8) | trnsChunk[1]! : trnsChunk[1]!) : -1;
    const trnsG = trnsChunk && trnsChunk.length >= 6 ? (bitDepth === 16 ? (trnsChunk[2]! << 8) | trnsChunk[3]! : trnsChunk[3]!) : -1;
    const trnsB = trnsChunk && trnsChunk.length >= 6 ? (bitDepth === 16 ? (trnsChunk[4]! << 8) | trnsChunk[5]! : trnsChunk[5]!) : -1;
    for (let i = 0; i < width * height; i++) {
    if (++work % 16384 === 0) yield;
      const r = unpredicted[i * step] ?? 0;
      const g = unpredicted[i * step + chOff] ?? 0;
      const b = unpredicted[i * step + chOff * 2] ?? 0;
      data[i * 4] = r;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = b;
      const rawR = bitDepth === 16 ? ((unpredicted[i * step] ?? 0) << 8) | (unpredicted[i * step + 1] ?? 0) : r;
      const rawG = bitDepth === 16 ? ((unpredicted[i * step + 2] ?? 0) << 8) | (unpredicted[i * step + 3] ?? 0) : g;
      const rawB = bitDepth === 16 ? ((unpredicted[i * step + 4] ?? 0) << 8) | (unpredicted[i * step + 5] ?? 0) : b;
      data[i * 4 + 3] = trnsR >= 0 && rawR === trnsR && rawG === trnsG && rawB === trnsB ? 0 : 255;
    }
  } else if (colorType === 4) {
    const step = bitDepth === 16 ? 4 : 2;
    const chOff = bitDepth === 16 ? 2 : 1;
    for (let i = 0; i < width * height; i++) {
    if (++work % 16384 === 0) yield;
      const g = unpredicted[i * step] ?? 0;
      data[i * 4] = g;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = g;
      data[i * 4 + 3] = unpredicted[i * step + chOff] ?? 255;
    }
  } else {
    const maxSample = bitDepth < 8 ? (1 << bitDepth) - 1 : 255;
    const trnsGray = trnsChunk && trnsChunk.length >= 2 ? (bitDepth === 16 ? (trnsChunk[0]! << 8) | trnsChunk[1]! : trnsChunk[1]!) : -1;
    for (let y = 0; y < height; y++) {
    if (++work % 16384 === 0) yield;
      const rowStart = y * rowBytes;
      for (let x = 0; x < width; x++) {
    if (++work % 16384 === 0) yield;
        const dst = (y * width + x) * 4;
        if (bitDepth === 16) {
          const s16 = ((unpredicted[rowStart + x * 2] ?? 0) << 8) | (unpredicted[rowStart + x * 2 + 1] ?? 0);
          const g = s16 >>> 8;
          data[dst] = g;
          data[dst + 1] = g;
          data[dst + 2] = g;
          data[dst + 3] = trnsGray >= 0 && s16 === trnsGray ? 0 : 255;
        } else {
          const s = readSubByteSample(rowStart, x);
          const g = bitDepth < 8 ? Math.round((s * 255) / maxSample) : s;
          data[dst] = g;
          data[dst + 1] = g;
          data[dst + 2] = g;
          data[dst + 3] = trnsGray >= 0 && s === trnsGray ? 0 : 255;
        }
      }
    }
  }
  return { width, height, data };
}

export interface PdfCropRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RenderToPngOptions {
  readonly scale?: number | undefined;
  readonly dpi?: number | undefined;
  readonly dpiX?: number | undefined;
  readonly dpiY?: number | undefined;
  readonly useCropBox?: boolean | undefined;
  readonly cropRect?: PdfCropRect | undefined;
  readonly background?: PdfRgbColor | undefined;
  readonly transparent?: boolean | undefined;
  readonly hideAnnotations?: boolean | undefined;
  readonly antialiasText?: boolean | undefined;
  readonly antialiasVector?: boolean | undefined;
  readonly thinLineMode?: "none" | "solid" | "shape" | undefined;
}

const STD_LUMINANCE_QUANT = new Uint8Array([
  16, 11, 10, 16, 24, 40, 51, 61,
  12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77,
  24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
]);

const ZIGZAG_ORDER = new Uint8Array([
  0, 1, 5, 6, 14, 15, 27, 28,
  2, 4, 7, 13, 16, 26, 29, 42,
  3, 8, 12, 17, 25, 30, 41, 43,
  9, 11, 18, 24, 31, 40, 44, 53,
  10, 19, 23, 32, 39, 45, 52, 54,
  20, 22, 33, 38, 46, 51, 55, 60,
  21, 34, 37, 47, 50, 56, 59, 61,
  35, 36, 48, 49, 57, 58, 62, 63,
]);

const STD_DC_LUMA_NRCODES = Uint8Array.from([0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0]);
const STD_DC_LUMA_VALUES = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

const STD_AC_LUMA_NRCODES = Uint8Array.from([0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 125]);
const STD_AC_LUMA_VALUES = Uint8Array.from([
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12,
  0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
  0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
  0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
  0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16,
  0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39,
  0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
  0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79,
  0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98,
  0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
  0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
  0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
  0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4,
  0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea,
  0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
]);

function buildCanonicalEncoderTable(counts: Uint8Array, values: Uint8Array): Map<number, { code: number; len: number }> {
  const map = new Map<number, { code: number; len: number }>();
  let code = 0;
  let k = 0;
  for (let bits = 1; bits <= 16; bits++) {
    const cnt = counts[bits - 1] ?? 0;
    for (let i = 0; i < cnt; i++) {
      const sym = values[k++]!;
      map.set(sym, { code, len: bits });
      code++;
    }
    code <<= 1;
  }
  return map;
}

const DC_ENC_TABLE = buildCanonicalEncoderTable(STD_DC_LUMA_NRCODES, STD_DC_LUMA_VALUES);
const AC_ENC_TABLE = buildCanonicalEncoderTable(STD_AC_LUMA_NRCODES, STD_AC_LUMA_VALUES);

function fdct8x8(spatial: Float64Array, coeffs: Float64Array): void {
  const INV_SQRT2 = Math.SQRT1_2;
  const tmp = new Float64Array(64);
  for (let y = 0; y < 8; y++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0;
      for (let x = 0; x < 8; x++) {
        sum += spatial[y * 8 + x]! * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
      }
      const cu = u === 0 ? INV_SQRT2 : 1;
      tmp[y * 8 + u] = sum * cu * 0.5;
    }
  }
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let sum = 0;
      for (let y = 0; y < 8; y++) {
        sum += tmp[y * 8 + u]! * Math.cos(((2 * y + 1) * v * Math.PI) / 16);
      }
      const cv = v === 0 ? INV_SQRT2 : 1;
      coeffs[v * 8 + u] = sum * cv * 0.5;
    }
  }
}

function *bitLengthAndMagSteps(val: number): Generator<void, { size: number; bits: number }, void> {
  let work = 0;
  if (val === 0) return { size: 0, bits: 0 };
  const absV = Math.abs(val);
  let size = 0;
  let tmp = absV;
  while (tmp > 0) {
    if (++work % 16384 === 0) yield;
    size++;
    tmp >>= 1;
  }
  const bits = val > 0 ? val : val + (1 << size) - 1;
  return { size, bits };
}

export function *encodeJpegSteps(bitmap: RgbaBitmap, quality = 90): Generator<void, Uint8Array, void> {
  let work = 0;
  const w = Math.max(1, bitmap.width);
  const h = Math.max(1, bitmap.height);
  const qClamp = Math.max(1, Math.min(100, quality));
  const scaleFactor = qClamp < 50 ? 5000 / qClamp : 200 - 2 * qClamp;

  const qZigZag = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    if (++work % 16384 === 0) yield;
    const rawQ = STD_LUMINANCE_QUANT[ZIGZAG_ORDER[i]!]!;
    const scaled = Math.floor((rawQ * scaleFactor + 50) / 100);
    qZigZag[i] = Math.max(1, Math.min(255, scaled));
  }

  const app0 = Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00,
    0x01, 0x01, 0x01,
    0x00, 0x48, 0x00, 0x48,
    0x00, 0x00,
  ]);

  const dqt = new Uint8Array(69);
  dqt[0] = 0xff;
  dqt[1] = 0xdb;
  dqt[2] = 0x00;
  dqt[3] = 67;
  dqt[4] = 0x00;
  dqt.set(qZigZag, 5);

  const dhtLen = 2 + (1 + 16 + STD_DC_LUMA_VALUES.length) + (1 + 16 + STD_AC_LUMA_VALUES.length);
  const dht = new Uint8Array(2 + dhtLen);
  let dPos = 0;
  dht[dPos++] = 0xff;
  dht[dPos++] = 0xc4;
  dht[dPos++] = (dhtLen >> 8) & 0xff;
  dht[dPos++] = dhtLen & 0xff;
  // DC table 0
  dht[dPos++] = 0x00;
  dht.set(STD_DC_LUMA_NRCODES, dPos);
  dPos += 16;
  dht.set(STD_DC_LUMA_VALUES, dPos);
  dPos += STD_DC_LUMA_VALUES.length;
  // AC table 0
  dht[dPos++] = 0x10;
  dht.set(STD_AC_LUMA_NRCODES, dPos);
  dPos += 16;
  dht.set(STD_AC_LUMA_VALUES, dPos);

  const sof0 = Uint8Array.from([
    0xff, 0xc0, 0x00, 17, 8,
    (h >> 8) & 0xff, h & 0xff,
    (w >> 8) & 0xff, w & 0xff,
    3,
    1, 0x11, 0,
    2, 0x11, 0,
    3, 0x11, 0,
  ]);

  const sosHeader = Uint8Array.from([
    0xff, 0xda, 0x00, 12, 3,
    1, 0x00,
    2, 0x00,
    3, 0x00,
    0, 63, 0,
  ]);

  const entropyBytes: number[] = [];
  let bitBuf = 0;
  let bitCnt = 0;

  const writeBits = (bits: number, len: number): void => {
    for (let i = len - 1; i >= 0; i--) {
      bitBuf = (bitBuf << 1) | ((bits >> i) & 1);
      bitCnt++;
      if (bitCnt === 8) {
        entropyBytes.push(bitBuf);
        if (bitBuf === 0xff) entropyBytes.push(0x00);
        bitBuf = 0;
        bitCnt = 0;
      }
    }
  };

  const mcusX = Math.ceil(w / 8);
  const mcusY = Math.ceil(h / 8);
  const blockY = new Float64Array(64);
  const blockCb = new Float64Array(64);
  const blockCr = new Float64Array(64);
  const coeffs = new Float64Array(64);
  const zz = new Int32Array(64);

  const encodeBlock = (spatial: Float64Array, prevDc: number): number => {
    fdct8x8(spatial, coeffs);
    for (let k = 0; k < 64; k++) {
      zz[k] = Math.round(coeffs[ZIGZAG_ORDER[k]!]! / qZigZag[k]!);
    }
    const dcDiff = zz[0]! - prevDc;
    const dcInfo = bitLengthAndMag(dcDiff);
    const dcHuff = DC_ENC_TABLE.get(dcInfo.size)!;
    writeBits(dcHuff.code, dcHuff.len);
    if (dcInfo.size > 0) writeBits(dcInfo.bits, dcInfo.size);

    let zeroRun = 0;
    for (let k = 1; k < 64; k++) {
      const acVal = zz[k]!;
      if (acVal === 0) {
        zeroRun++;
      } else {
        while (zeroRun >= 16) {
          const zrl = AC_ENC_TABLE.get(0xf0)!;
          writeBits(zrl.code, zrl.len);
          zeroRun -= 16;
        }
        const acInfo = bitLengthAndMag(acVal);
        const sym = (zeroRun << 4) | acInfo.size;
        const acHuff = AC_ENC_TABLE.get(sym)!;
        writeBits(acHuff.code, acHuff.len);
        writeBits(acInfo.bits, acInfo.size);
        zeroRun = 0;
      }
    }
    if (zeroRun > 0) {
      const eob = AC_ENC_TABLE.get(0x00)!;
      writeBits(eob.code, eob.len);
    }
    return zz[0]!;
  };

  let dcY = 0;
  let dcCb = 0;
  let dcCr = 0;

  for (let my = 0; my < mcusY; my++) {
    if (++work % 16384 === 0) yield;
    for (let mx = 0; mx < mcusX; mx++) {
    if (++work % 16384 === 0) yield;
      for (let by = 0; by < 8; by++) {
    if (++work % 16384 === 0) yield;
        const py = Math.min(h - 1, my * 8 + by);
        for (let bx = 0; bx < 8; bx++) {
    if (++work % 16384 === 0) yield;
          const px = Math.min(w - 1, mx * 8 + bx);
          const idx = (py * w + px) * 4;
          const r = bitmap.data[idx] ?? 0;
          const g = bitmap.data[idx + 1] ?? 0;
          const b = bitmap.data[idx + 2] ?? 0;
          const k = by * 8 + bx;
          blockY[k] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
          blockCb[k] = -0.168736 * r - 0.331264 * g + 0.5 * b;
          blockCr[k] = 0.5 * r - 0.418688 * g - 0.081312 * b;
        }
      }
      dcY = encodeBlock(blockY, dcY);
      dcCb = encodeBlock(blockCb, dcCb);
      dcCr = encodeBlock(blockCr, dcCr);
    }
  }

  if (bitCnt > 0) {
    writeBits((1 << (8 - bitCnt)) - 1, 8 - bitCnt);
  }

  const eoi = Uint8Array.from([0xff, 0xd9]);
  const entropyArr = Uint8Array.from(entropyBytes);
  const totalLen = app0.length + dqt.length + dht.length + sof0.length + sosHeader.length + entropyArr.length + eoi.length;
  const out = new Uint8Array(totalLen);
  let off = 0;
  for (const part of [app0, dqt, dht, sof0, sosHeader, entropyArr, eoi]) {
    if (++work % 16384 === 0) yield;
    out.set(part, off);
    off += part.length;
  }
  return out;
}

export function *encodePpmSteps(bitmap: RgbaBitmap): Generator<void, Uint8Array, void> {
  let work = 0;
  const w = Math.max(1, bitmap.width);
  const h = Math.max(1, bitmap.height);
  const header = new TextEncoder().encode(`P6\n${w} ${h}\n255\n`);
  const out = new Uint8Array(header.length + w * h * 3);
  out.set(header, 0);
  let dst = header.length;
  for (let i = 0; i < w * h; i++) {
    if (++work % 16384 === 0) yield;
    out[dst++] = bitmap.data[i * 4] ?? 255;
    out[dst++] = bitmap.data[i * 4 + 1] ?? 255;
    out[dst++] = bitmap.data[i * 4 + 2] ?? 255;
  }
  return out;
}

export function *encodePgmSteps(bitmap: RgbaBitmap): Generator<void, Uint8Array, void> {
  let work = 0;
  const w = Math.max(1, bitmap.width);
  const h = Math.max(1, bitmap.height);
  const header = new TextEncoder().encode(`P5\n${w} ${h}\n255\n`);
  const out = new Uint8Array(header.length + w * h);
  out.set(header, 0);
  let dst = header.length;
  for (let i = 0; i < w * h; i++) {
    if (++work % 16384 === 0) yield;
    const r = bitmap.data[i * 4] ?? 255;
    const g = bitmap.data[i * 4 + 1] ?? 255;
    const b = bitmap.data[i * 4 + 2] ?? 255;
    out[dst++] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return out;
}

function *encodePackBitsRowSteps(row: Uint8Array): Generator<void, number[], void> {
  let work = 0;
  const out: number[] = [];
  let i = 0;
  while (i < row.length) {
    if (++work % 16384 === 0) yield;
    let runLen = 1;
    while (i + runLen < row.length && runLen < 128 && row[i + runLen] === row[i]) {
    if (++work % 16384 === 0) yield;
      runLen++;
    }
    if (runLen >= 2) {
      out.push((257 - runLen) & 0xff, row[i]!);
      i += runLen;
    } else {
      const litStart = i;
      let litLen = 0;
      while (i < row.length && litLen < 128) {
    if (++work % 16384 === 0) yield;
        if (i + 1 < row.length && row[i + 1] === row[i]) break;
        i++;
        litLen++;
      }
      out.push(litLen - 1);
      for (let k = 0; k < litLen; k++) {
    if (++work % 16384 === 0) yield;
        out.push(row[litStart + k]!);
      }
    }
  }
  return out;
}

export type TiffCompressionMode = "none" | "packbits" | "deflate" | "lzw" | "jpeg";

export function *encodeTiffSteps(
  bitmap: RgbaBitmap,
  dpi = 72,
  compression: TiffCompressionMode = "none"
): Generator<void, Uint8Array, void> {
  let work = 0;
  const { width, height, data } = bitmap;
  const rgbByteLength = width * height * 3;
  const rawRgb = new Uint8Array(rgbByteLength);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    if (++work % 16384 === 0) yield;
    rawRgb[j] = data[i]!;
    rawRgb[j + 1] = data[i + 1]!;
    rawRgb[j + 2] = data[i + 2]!;
  }

  let stripBytes: Uint8Array = rawRgb;
  let compressionTag = 1;
  if (compression === "deflate") {
    compressionTag = 8;
    stripBytes = encodeFlate(rawRgb);
  } else if (compression === "packbits") {
    compressionTag = 32773;
    const packed: number[] = [];
    const rowStride = width * 3;
    for (let y = 0; y < height; y++) {
    if (++work % 16384 === 0) yield;
      const row = rawRgb.subarray(y * rowStride, (y + 1) * rowStride);
      packed.push(...(yield* encodePackBitsRowSteps(row)));
    }
    stripBytes = new Uint8Array(packed);
  } else if (compression === "lzw") {
    compressionTag = 5;
  } else if (compression === "jpeg") {
    compressionTag = 7;
  }

  const numEntries = 12;
  const ifdOffset = 8;
  const ifdByteLength = 2 + numEntries * 12 + 4; // 150 bytes
  const bitsPerSampleOffset = ifdOffset + ifdByteLength; // 158 (6 bytes: 8, 8, 8)
  const xResOffset = bitsPerSampleOffset + 6; // 164 (8 bytes: dpi, 1)
  const yResOffset = xResOffset + 8; // 172 (8 bytes: dpi, 1)
  const stripOffset = yResOffset + 8; // 180

  const out = new Uint8Array(stripOffset + stripBytes.byteLength);
  const view = new DataView(out.buffer);

  // Little-endian TIFF 6.0 header ('II' + 42 + IFD offset 8)
  out[0] = 0x49;
  out[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);

  view.setUint16(ifdOffset, numEntries, true);
  let pos = ifdOffset + 2;
  const writeEntry = (tag: number, type: number, count: number, valueOrOffset: number) => {
    view.setUint16(pos, tag, true);
    view.setUint16(pos + 2, type, true);
    view.setUint32(pos + 4, count, true);
    if (type === 3 && count === 1) {
      view.setUint16(pos + 8, valueOrOffset, true);
      view.setUint16(pos + 10, 0, true);
    } else {
      view.setUint32(pos + 8, valueOrOffset, true);
    }
    pos += 12;
  };

  const resolvedDpi = Math.max(1, Math.round(dpi));
  writeEntry(256, 4, 1, width); // ImageWidth
  writeEntry(257, 4, 1, height); // ImageLength
  writeEntry(258, 3, 3, bitsPerSampleOffset); // BitsPerSample -> [8, 8, 8]
  writeEntry(259, 3, 1, compressionTag); // Compression
  writeEntry(262, 3, 1, 2); // PhotometricInterpretation = 2 (RGB)
  writeEntry(273, 4, 1, stripOffset); // StripOffsets
  writeEntry(277, 3, 1, 3); // SamplesPerPixel = 3
  writeEntry(278, 4, 1, height); // RowsPerStrip
  writeEntry(279, 4, 1, stripBytes.byteLength); // StripByteCounts
  writeEntry(282, 5, 1, xResOffset); // XResolution
  writeEntry(283, 5, 1, yResOffset); // YResolution
  writeEntry(296, 3, 1, 2); // ResolutionUnit = 2 (Inch)
  view.setUint32(pos, 0, true); // Next IFD offset = 0

  // BitsPerSample [8, 8, 8]
  view.setUint16(bitsPerSampleOffset, 8, true);
  view.setUint16(bitsPerSampleOffset + 2, 8, true);
  view.setUint16(bitsPerSampleOffset + 4, 8, true);

  // XResolution & YResolution rationals
  view.setUint32(xResOffset, resolvedDpi, true);
  view.setUint32(xResOffset + 4, 1, true);
  view.setUint32(yResOffset, resolvedDpi, true);
  view.setUint32(yResOffset + 4, 1, true);

  out.set(stripBytes, stripOffset);
  return out;
}

export function *encodePbmSteps(bitmap: RgbaBitmap): Generator<void, Uint8Array, void> {
  let work = 0;
  const w = Math.max(1, bitmap.width);
  const h = Math.max(1, bitmap.height);
  const header = new TextEncoder().encode(`P4\n${w} ${h}\n`);
  const rowBytes = Math.ceil(w / 8);
  const out = new Uint8Array(header.length + rowBytes * h);
  out.set(header, 0);
  let dst = header.length;
  for (let y = 0; y < h; y++) {
    if (++work % 16384 === 0) yield;
    for (let bx = 0; bx < rowBytes; bx++) {
    if (++work % 16384 === 0) yield;
      let byteVal = 0;
      for (let bit = 0; bit < 8; bit++) {
    if (++work % 16384 === 0) yield;
        const x = bx * 8 + bit;
        if (x < w) {
          const idx = (y * w + x) * 4;
          const lum =
            0.299 * (bitmap.data[idx] ?? 255) +
            0.587 * (bitmap.data[idx + 1] ?? 255) +
            0.114 * (bitmap.data[idx + 2] ?? 255);
          if (lum < 128) {
            byteVal |= 1 << (7 - bit);
          }
        }
      }
      out[dst++] = byteVal;
    }
  }
  return out;
}

export function *rotateRgbaBitmapQuarterTurnsSteps(bitmap: RgbaBitmap, degrees: number): Generator<void, RgbaBitmap, void> {
  let work = 0;
  const norm = ((Math.round(degrees / 90) * 90) % 360 + 360) % 360;
  if (norm === 0) return bitmap;
  const srcW = bitmap.width;
  const srcH = bitmap.height;
  if (norm === 180) {
    const out = new Uint8Array(srcW * srcH * 4);
    for (let y = 0; y < srcH; y++) {
    if (++work % 16384 === 0) yield;
      for (let x = 0; x < srcW; x++) {
    if (++work % 16384 === 0) yield;
        const sIdx = (y * srcW + x) * 4;
        const dIdx = ((srcH - 1 - y) * srcW + (srcW - 1 - x)) * 4;
        out[dIdx] = bitmap.data[sIdx]!;
        out[dIdx + 1] = bitmap.data[sIdx + 1]!;
        out[dIdx + 2] = bitmap.data[sIdx + 2]!;
        out[dIdx + 3] = bitmap.data[sIdx + 3]!;
      }
    }
    return { width: srcW, height: srcH, data: out };
  }
  const dstW = srcH;
  const dstH = srcW;
  const out = new Uint8Array(dstW * dstH * 4);
  for (let y = 0; y < srcH; y++) {
    if (++work % 16384 === 0) yield;
    for (let x = 0; x < srcW; x++) {
    if (++work % 16384 === 0) yield;
      const sIdx = (y * srcW + x) * 4;
      const dx = norm === 90 ? srcH - 1 - y : y;
      const dy = norm === 90 ? x : srcW - 1 - x;
      const dIdx = (dy * dstW + dx) * 4;
      out[dIdx] = bitmap.data[sIdx]!;
      out[dIdx + 1] = bitmap.data[sIdx + 1]!;
      out[dIdx + 2] = bitmap.data[sIdx + 2]!;
      out[dIdx + 3] = bitmap.data[sIdx + 3]!;
    }
  }
  return { width: dstW, height: dstH, data: out };
}

export function *cropRgbaBitmapSteps(bitmap: RgbaBitmap, rect: PdfCropRect): Generator<void, RgbaBitmap, void> {
  let work = 0;
  const x0 = Math.max(0, Math.min(bitmap.width - 1, Math.round(rect.x)));
  const y0 = Math.max(0, Math.min(bitmap.height - 1, Math.round(rect.y)));
  const maxW = Math.max(1, bitmap.width - x0);
  const maxH = Math.max(1, bitmap.height - y0);
  const w = rect.width > 0 ? Math.max(1, Math.min(maxW, Math.round(rect.width))) : maxW;
  const h = rect.height > 0 ? Math.max(1, Math.min(maxH, Math.round(rect.height))) : maxH;
  const out = new Uint8Array(w * h * 4);
  for (let dy = 0; dy < h; dy++) {
    if (++work % 16384 === 0) yield;
    const srcRowStart = ((y0 + dy) * bitmap.width + x0) * 4;
    const dstRowStart = dy * w * 4;
    out.set(bitmap.data.subarray(srcRowStart, srcRowStart + w * 4), dstRowStart);
  }
  return { width: w, height: h, data: out };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function *crc32Steps(bytes: Uint8Array): Generator<void, number, void> {
  let work = 0;
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    if (++work % 16384 === 0) yield;
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function *makePngChunkSteps(type: string, data: Uint8Array): Generator<void, Uint8Array, void> {
  let work = 0;
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) { if (++work % 16384 === 0) yield; out[4 + i] = type.charCodeAt(i); }
  out.set(data, 8);
  const crc = (yield* crc32Steps(out.subarray(4, 8 + data.length)));
  view.setUint32(8 + data.length, crc, false);
  return out;
}

export function *encodeRgbaToPngSteps(width: number, height: number, rgba: Uint8Array): Generator<void, Uint8Array, void> {
  let work = 0;
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth 8
  ihdr[9] = 6; // color type 6 (RGBA)
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const rawScanlines = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    if (++work % 16384 === 0) yield;
    const rowStart = y * (stride + 1);
    rawScanlines[rowStart] = 0; // Filter type 0 (None)
    rawScanlines.set(rgba.subarray(y * stride, (y + 1) * stride), rowStart + 1);
  }

  const compressed = encodeFlate(rawScanlines);
  const ihdrChunk = (yield* makePngChunkSteps("IHDR", ihdr));
  const idatChunk = (yield* makePngChunkSteps("IDAT", compressed));
  const iendChunk = (yield* makePngChunkSteps("IEND", new Uint8Array(0)));

  const total = signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of [signature, ihdrChunk, idatChunk, iendChunk]) {
    if (++work % 16384 === 0) yield;
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function blendChannelSeparable(cb: number, cs: number, mode: string): number {
  switch (mode) {
    case "Multiply":
      return cb * cs;
    case "Screen":
      return cb + cs - cb * cs;
    case "Overlay":
      return cb <= 0.5 ? 2 * cb * cs : 1 - 2 * (1 - cb) * (1 - cs);
    case "Darken":
      return Math.min(cb, cs);
    case "Lighten":
      return Math.max(cb, cs);
    case "ColorDodge":
      return cb === 0 ? 0 : cs >= 1 ? 1 : Math.min(1, cb / (1 - cs));
    case "ColorBurn":
      return cb === 1 ? 1 : cs <= 0 ? 0 : 1 - Math.min(1, (1 - cb) / cs);
    case "HardLight":
      return cs <= 0.5 ? 2 * cb * cs : 1 - 2 * (1 - cb) * (1 - cs);
    case "SoftLight": {
      if (cs <= 0.5) {
        return cb - (1 - 2 * cs) * cb * (1 - cb);
      }
      const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
      return cb + (2 * cs - 1) * (d - cb);
    }
    case "Difference":
      return Math.abs(cb - cs);
    case "Exclusion":
      return cb + cs - 2 * cb * cs;
    default:
      return cs;
  }
}

function pdfLum(r: number, g: number, b: number): number {
  return 0.3 * r + 0.59 * g + 0.11 * b;
}

function pdfClipColor(r: number, g: number, b: number): [number, number, number] {
  const l = pdfLum(r, g, b);
  const n = Math.min(r, g, b);
  const x = Math.max(r, g, b);
  let cr = r, cg = g, cb = b;
  if (n < 0 && l - n > 1e-7) {
    cr = l + ((cr - l) * l) / (l - n);
    cg = l + ((cg - l) * l) / (l - n);
    cb = l + ((cb - l) * l) / (l - n);
  }
  if (x > 1 && x - l > 1e-7) {
    cr = l + ((cr - l) * (1 - l)) / (x - l);
    cg = l + ((cg - l) * (1 - l)) / (x - l);
    cb = l + ((cb - l) * (1 - l)) / (x - l);
  }
  return [Math.max(0, Math.min(1, cr)), Math.max(0, Math.min(1, cg)), Math.max(0, Math.min(1, cb))];
}

function pdfSetLum(r: number, g: number, b: number, l: number): [number, number, number] {
  const d = l - pdfLum(r, g, b);
  return pdfClipColor(r + d, g + d, b + d);
}

function pdfSat(r: number, g: number, b: number): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function pdfSetSat(r: number, g: number, b: number, s: number): [number, number, number] {
  const arr: Array<{ idx: number; val: number }> = [
    { idx: 0, val: r },
    { idx: 1, val: g },
    { idx: 2, val: b },
  ].sort((a, b2) => a.val - b2.val);
  const cMin = arr[0]!.val;
  const cMid = arr[1]!.val;
  const cMax = arr[2]!.val;
  const out = [0, 0, 0];
  if (cMax > cMin) {
    out[arr[1]!.idx] = ((cMid - cMin) * s) / (cMax - cMin);
    out[arr[2]!.idx] = s;
  }
  out[arr[0]!.idx] = 0;
  return [out[0]!, out[1]!, out[2]!];
}

function computePdfBlendRgb(
  cbR: number,
  cbG: number,
  cbB: number,
  csR: number,
  csG: number,
  csB: number,
  mode?: string
): [number, number, number] {
  if (!mode || mode === "Normal" || mode === "Compatible") {
    return [csR, csG, csB];
  }
  if (mode === "Hue") {
    const [sr, sg, sb] = pdfSetSat(csR, csG, csB, pdfSat(cbR, cbG, cbB));
    return pdfSetLum(sr, sg, sb, pdfLum(cbR, cbG, cbB));
  }
  if (mode === "Saturation") {
    const [sr, sg, sb] = pdfSetSat(cbR, cbG, cbB, pdfSat(csR, csG, csB));
    return pdfSetLum(sr, sg, sb, pdfLum(cbR, cbG, cbB));
  }
  if (mode === "Color") {
    return pdfSetLum(csR, csG, csB, pdfLum(cbR, cbG, cbB));
  }
  if (mode === "Luminosity") {
    return pdfSetLum(cbR, cbG, cbB, pdfLum(csR, csG, csB));
  }
  return [
    blendChannelSeparable(cbR, csR, mode),
    blendChannelSeparable(cbG, csG, mode),
    blendChannelSeparable(cbB, csB, mode),
  ];
}

function blendPixel(
  rgba: Uint8Array,
  width: number,
  height: number,
  px: number,
  py: number,
  color: PdfRgbColor,
  alpha: number,
  blendMode?: string,
  clipMask?: Uint8Array,
  groupAlpha?: Float32Array
): void {
  if (px < 0 || py < 0 || px >= width || py >= height || alpha <= 0) return;
  const a = Math.min(1, Math.max(0, alpha)) * (clipMask ? clipMask[(py * width + px) * 4 + 3]! / 255 : 1);
  const idx = (py * width + px) * 4;
  if (groupAlpha) {
    const pixel = py * width + px;
    groupAlpha[pixel] = a + groupAlpha[pixel]! * (1 - a);
  }
  const csR = Math.min(1, Math.max(0, color.r));
  const csG = Math.min(1, Math.max(0, color.g));
  const csB = Math.min(1, Math.max(0, color.b));
  const dstA = rgba[idx + 3]! / 255;
  const outA = a + dstA * (1 - a);
  if (outA <= 0) return;
  const cbR = rgba[idx]! / 255;
  const cbG = rgba[idx + 1]! / 255;
  const cbB = rgba[idx + 2]! / 255;
  const [bR, bG, bB] = computePdfBlendRgb(cbR, cbG, cbB, csR, csG, csB, blendMode);
  const effR = (1 - dstA) * csR + dstA * bR;
  const effG = (1 - dstA) * csG + dstA * bG;
  const effB = (1 - dstA) * csB + dstA * bB;
  rgba[idx] = Math.round(((effR * a + cbR * dstA * (1 - a)) / outA) * 255);
  rgba[idx + 1] = Math.round(((effG * a + cbG * dstA * (1 - a)) / outA) * 255);
  rgba[idx + 2] = Math.round(((effB * a + cbB * dstA * (1 - a)) / outA) * 255);
  rgba[idx + 3] = Math.round(outA * 255);
}

interface Edge {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function *segmentsToScreenPathsSteps(segments: readonly PdfPathSegment[], pageHeight: number, scale: number,
  toScreen = (x: number, y: number): StrokePoint => [x * scale, (pageHeight - y) * scale]
): Generator<void, StrokeSubpath[], void> {
  let work = 0;
  const paths: StrokeSubpath[] = [];
  let points: StrokePoint[] = [];
  let current: StrokePoint = [0, 0];
  for (const segment of segments) {
    if (++work % 16384 === 0) yield;
    if (segment.kind === "move") {
      if (points.length) paths.push({ points, closed: false });
      current = toScreen(segment.x, segment.y);
      points = [current];
    } else if (segment.kind === "line") {
      if (!points.length) points = [current];
      current = toScreen(segment.x, segment.y);
      points.push(current);
    } else if (segment.kind === "cubic") {
      if (!points.length) points = [current];
      const a = toScreen(segment.x1, segment.y1), b = toScreen(segment.x2, segment.y2);
      const end = toScreen(segment.x, segment.y);
      const curve = flattenCubic(current[0], current[1], a[0], a[1], b[0], b[1], end[0], end[1]);
      for (let i = 1; i < curve.length; i++) { if (++work % 16384 === 0) yield; points.push(curve[i]!); }
      current = end;
    } else if (segment.kind === "close") {
      if (points.length) {
        paths.push({ points, closed: true });
        current = points[0]!;
        points = [];
      }
    } else if (segment.kind === "rect") {
      if (points.length) paths.push({ points, closed: false });
      const first = toScreen(segment.x, segment.y);
      paths.push({ points: [first, toScreen(segment.x + segment.width, segment.y),
        toScreen(segment.x + segment.width, segment.y + segment.height), toScreen(segment.x, segment.y + segment.height)], closed: true });
      current = first;
      points = [];
    }
  }
  if (points.length) paths.push({ points, closed: false });
  return paths;
}

function inverseStrokeMatrix(matrix: NonNullable<PdfEvaluatedPath["strokeMatrix"]>): number[] | undefined {
  const [a, b, c, d, e, f] = matrix;
  const det = a * d - b * c;
  if (!Number.isFinite(det) || det === 0) return undefined;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

// Adapted from PDF.js CanvasGraphics.getScaleForStroking/rescaleAndStroke.
// See THIRD_PARTY_NOTICES.md (Mozilla Foundation, Apache-2.0).
function prepareStroke(path: PdfEvaluatedPath, scale: number) {
  const matrix: [number, number, number, number, number, number] = path.strokeMatrix
    ? [...path.strokeMatrix] : [1, 0, 0, 1, 0, 0];
  const [a, b, c, d] = matrix;
  const area = Math.abs(a * d - b * c) * scale * scale;
  if (!(area > 0) || !Number.isFinite(area)) return undefined;
  const normX = Math.hypot(a, b) * scale, normY = Math.hypot(c, d) * scale;
  let width = path.strokeWidth || 1;
  const scaleX = path.strokeWidth === 0 ? normY / area : Math.max(1, normY / (width * area));
  const scaleY = path.strokeWidth === 0 ? normX / area : Math.max(1, normX / (width * area));
  let dashArray = path.dashArray, dashPhase = path.dashPhase ?? 0;
  if (scaleX === scaleY) {
    width *= scaleX;
  } else {
    matrix[0] *= scaleX;
    matrix[1] *= scaleX;
    matrix[2] *= scaleY;
    matrix[3] *= scaleY;
    if (dashArray?.length) {
      // PDF.js uses the larger correction when minimum thickness changes the
      // two axes differently. This also covers transformed zero-width lines.
      const dashScale = Math.max(scaleX, scaleY);
      dashArray = dashArray.map(value => value / dashScale);
      dashPhase /= dashScale;
    }
  }
  return { matrix, width, dashArray, dashPhase };
}

function *strokeContoursSteps(path: PdfEvaluatedPath, pageHeight: number, scale: number, originX = 0, originY = 0): Generator<void, StrokePoint[][], void> {
  const stroke = prepareStroke(path, scale);
  if (!stroke) return [];
  const inverse = inverseStrokeMatrix(stroke.matrix);
  if (!inverse) return [];
  const [a, b, c, d, e, f] = stroke.matrix;
  // The Frobenius norm bounds the largest device stretch, retaining AGG's
  // device-pixel flatness for curves and round caps even under shear.
  const strokeScale = scale * Math.hypot(a, b, c, d);
  const project = (x: number, y: number): StrokePoint => [
    (inverse[0]! * x + inverse[2]! * y + inverse[4]!) * strokeScale,
    (inverse[1]! * x + inverse[3]! * y + inverse[5]!) * strokeScale,
  ];
  const toScreen = ([x, y]: StrokePoint): StrokePoint => [
    (a * x / strokeScale + c * y / strokeScale + e - originX) * scale,
    (pageHeight + originY - b * x / strokeScale - d * y / strokeScale - f) * scale,
  ];
  const contours = strokeOutlines((yield* segmentsToScreenPathsSteps(path.segments, pageHeight, scale, project)),
    stroke.width * strokeScale, path.lineCap ?? 0, path.lineJoin ?? 0, path.miterLimit ?? 10,
    stroke.dashArray?.map(value => Math.max(0, value * strokeScale)), stroke.dashPhase * strokeScale);
  return contours.map(points => points.map(toScreen));
}

function *pathsToEdgesSteps(paths: readonly StrokeSubpath[], closeSubpaths = false): Generator<void, Edge[], void> {
  let work = 0;
  const edges: Edge[] = [];
  for (const { points, closed } of paths) {
    if (++work % 16384 === 0) yield;
    for (let i = 1; i < points.length; i++) {
    if (++work % 16384 === 0) yield;
      const a = points[i - 1]!, b = points[i]!;
      edges.push({ x0: a[0], y0: a[1], x1: b[0], y1: b[1] });
    }
    if ((closed || closeSubpaths) && points.length > 1) {
      const a = points[points.length - 1]!, b = points[0]!;
      edges.push({ x0: a[0], y0: a[1], x1: b[0], y1: b[1] });
    }
  }
  return edges;
}

function *fillEdgesScanline4x4Steps(
  rgba: Uint8Array,
  width: number,
  height: number,
  edges: readonly Edge[],
  color: PdfRgbColor,
  alpha = 1,
  fillRule: "nonzero" | "evenodd" = "nonzero",
  clipScreen?: readonly [number, number, number, number],
  antialias = true,
  blendMode?: string,
  clipMask?: Uint8Array,
  groupAlpha?: Float32Array
): Generator<void, void, void> {
  let work = 0;
  if (edges.length === 0) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const e of edges) {
    if (++work % 16384 === 0) yield;
    minY = Math.min(minY, e.y0, e.y1);
    maxY = Math.max(maxY, e.y0, e.y1);
  }
  const clipMinX = clipScreen ? Math.max(0, Math.floor(clipScreen[0])) : 0;
  const clipMinY = clipScreen ? Math.max(0, Math.floor(clipScreen[1])) : 0;
  const clipMaxX = clipScreen ? Math.min(width - 1, Math.ceil(clipScreen[2]) - 1) : width - 1;
  const clipMaxY = clipScreen ? Math.min(height - 1, Math.ceil(clipScreen[3]) - 1) : height - 1;
  const startRow = Math.max(clipMinY, Math.floor(minY));
  const endRow = Math.min(clipMaxY, Math.ceil(maxY));

  const subOffsets = [0.125, 0.375, 0.625, 0.875];
  for (let py = startRow; py <= endRow; py++) {
    if (++work % 16384 === 0) yield;
    const rowCounts = new Uint8Array(width);
    for (const sy of subOffsets) {
    if (++work % 16384 === 0) yield;
      const scanY = py + sy;
      const crossings: Array<{ x: number; dir: number }> = [];
      for (const e of edges) {
    if (++work % 16384 === 0) yield;
        if ((e.y0 <= scanY && e.y1 > scanY) || (e.y1 <= scanY && e.y0 > scanY)) {
          const t = (scanY - e.y0) / (e.y1 - e.y0);
          crossings.push({
            x: e.x0 + t * (e.x1 - e.x0),
            dir: e.y0 < e.y1 ? 1 : -1,
          });
        }
      }
      if (crossings.length < 2) continue;
      crossings.sort((a, b) => a.x - b.x);
      const intervals: Array<[number, number]> = [];
      if (fillRule === "evenodd") {
        for (let i = 0; i + 1 < crossings.length; i += 2) {
    if (++work % 16384 === 0) yield;
          intervals.push([crossings[i]!.x, crossings[i + 1]!.x]);
        }
      } else {
        let winding = 0;
        let intervalStart = 0;
        for (const c of crossings) {
    if (++work % 16384 === 0) yield;
          const prevWinding = winding;
          winding += c.dir;
          if (prevWinding === 0 && winding !== 0) {
            intervalStart = c.x;
          } else if (prevWinding !== 0 && winding === 0) {
            intervals.push([intervalStart, c.x]);
          }
        }
      }
      for (const [xLeft, xRight] of intervals) {
    if (++work % 16384 === 0) yield;
        const xStart = Math.max(clipMinX, Math.floor(xLeft));
        const xEnd = Math.min(clipMaxX, Math.ceil(xRight));
        for (let px = xStart; px <= xEnd; px++) {
    if (++work % 16384 === 0) yield;
          for (const sx of subOffsets) {
    if (++work % 16384 === 0) yield;
            const sampleX = px + sx;
            if (sampleX >= xLeft && sampleX <= xRight) {
              rowCounts[px] = (rowCounts[px] ?? 0) + 1;
            }
          }
        }
      }
    }
    for (let px = 0; px < width; px++) {
    if (++work % 16384 === 0) yield;
      const count = rowCounts[px]!;
      if (count > 0) {
        const cov = antialias ? count / 16 : count >= 8 ? 1 : 0;
        blendPixel(rgba, width, height, px, py, color, cov * alpha, blendMode, clipMask, groupAlpha);
      }
    }
  }
}

function glyphPaint(glyph: PdfPlacedGlyph): PdfEvaluatedPath {
  if (glyph.outline) return { ...glyph.outline, ...(glyph.clipPaths ? { clipPaths: glyph.clipPaths } : {}) };
  const cp = glyph.unicode.codePointAt(0);
  const outline = cp === undefined ? [] : getStandardFontOutlines(glyph.fontName).getGlyphOutline(cp);
  const [a, b, c, d, e, f] = glyph.matrix;
  const fontSize = glyph.fontSize / (Math.hypot(a, b) || 1);
  const point = (x: number, y: number): [number, number] => [fontSize * (a * x + c * y) + e, fontSize * (b * x + d * y) + f];
  const segments: PdfPathSegment[] = outline.map(seg => {
    if (seg.kind === "move" || seg.kind === "line") {
      const [x, y] = point(seg.x, seg.y); return { kind: seg.kind, x, y };
    }
    if (seg.kind === "cubic") {
      const [x1, y1] = point(seg.x1, seg.y1), [x2, y2] = point(seg.x2, seg.y2), [x, y] = point(seg.x, seg.y);
      return { kind: "cubic", x1, y1, x2, y2, x, y };
    }
    return seg;
  });
  const mode = glyph.renderMode ?? 0;
  return {
    segments, strokeWidth: mode === 1 || mode === 2 ? 1 : 0,
    ...(mode !== 1 ? { fillColor: glyph.color } : {}),
    ...(mode === 1 || mode === 2 ? { strokeColor: glyph.color } : {}),
    ...(glyph.clipPaths ? { clipPaths: glyph.clipPaths } : {}),
    ...(glyph.clipRect ? { clipRect: glyph.clipRect } : {}),
    ...(glyph.blendMode ? { blendMode: glyph.blendMode } : {}),
  };
}

// Keep manually constructed legacy display lists renderable.
function paintOperations(displayList: PdfDisplayList): readonly PdfPaintOperation[] {
  return displayList.operations ?? [
    ...displayList.paths.map(value => ({ kind: "path" as const, value })),
    ...displayList.images.map(value => ({ kind: "image" as const, value })),
    ...displayList.glyphs.map(value => ({ kind: "glyph" as const, value })),
  ];
}

// PDF.js _prepareSMaskCanvas/_bakeSMaskCanvas: composite the group's backdrop
// before converting luminosity, then apply the 256-entry transfer function.
function *renderSoftMaskSteps(mask: PdfSoftMask, displayList: PdfDisplayList, scale: number): Generator<void, RgbaBitmap, void> {
  let work = 0;
  const bitmap = (yield* renderDisplayListToBitmapSteps({
    ...displayList, rotation: 0, glyphs: [], paths: [], images: [], operations: mask.operations,
  }, { scale, transparent: true }));
  const { data } = bitmap;
  for (let i = 0; i < data.length; i += 4) {
    if (++work % 16384 === 0) yield;
    let value = data[i + 3]!;
    if (mask.subtype === "Luminosity") {
      const alpha = value / 255;
      const r = Math.round(data[i]! * alpha + mask.backdrop.r * 255 * (1 - alpha));
      const g = Math.round(data[i + 1]! * alpha + mask.backdrop.g * 255 * (1 - alpha));
      const b = Math.round(data[i + 2]! * alpha + mask.backdrop.b * 255 * (1 - alpha));
      value = Math.round(pdfLum(r, g, b));
    }
    data[i] = data[i + 1] = data[i + 2] = 0;
    data[i + 3] = mask.transferMap?.[value] ?? value;
  }
  return bitmap;
}

// PDF.js Page.view: visible bounds are the normalized CropBox/MediaBox
// intersection. An empty or malformed crop falls back to the full media box.
export function getDisplayListCropBox(list: PdfDisplayList): [number, number, number, number] {
  const full: [number, number, number, number] = [0, 0, list.width, list.height];
  const box = list.cropBox;
  if (!box || !box.every(Number.isFinite)) return full;
  const x0 = Math.max(0, Math.min(box[0], box[2]));
  const y0 = Math.max(0, Math.min(box[1], box[3]));
  const x1 = Math.min(list.width, Math.max(box[0], box[2]));
  const y1 = Math.min(list.height, Math.max(box[1], box[3]));
  return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : full;
}

function hasCompositingEffects(operations: readonly PdfPaintOperation[], includeSoftMasks = false): boolean {
  return operations.some(operation =>
    (includeSoftMasks && !!operation.value.softMask) ||
    (!!operation.value.blendMode && operation.value.blendMode !== "Normal" && operation.value.blendMode !== "Compatible") ||
    (operation.kind === "group" && hasCompositingEffects(operation.value.operations, includeSoftMasks)));
}

// PDFBox PageDrawer: inner blends in a non-isolated group see its parent.
// Normal-only groups can use transparent intermediates without a backdrop.
function needsGroupBackdrop(group: PdfPaintGroup): boolean {
  return group.isolated === false && hasCompositingEffects(group.operations, true);
}

function containsBackdropGroup(operations: readonly PdfPaintOperation[]): boolean {
  return operations.some(operation => operation.kind === "group" &&
    (needsGroupBackdrop(operation.value) || containsBackdropGroup(operation.value.operations)));
}

function *renderDisplayListLayerSteps(
  displayList: PdfDisplayList,
  options: RenderToPngOptions,
  scale: number,
  backdrop?: Uint8Array
): Generator<void, RgbaBitmap, void> {
  let work = 0;
  const [originX, originY] = displayList.origin ?? [0, 0];
  const pageTop = originY + displayList.height;
  const toScreen = (x: number, y: number): StrokePoint => [(x - originX) * scale, (pageTop - y) * scale];
  const width = Math.max(1, Math.round(displayList.width * scale));
  const height = Math.max(1, Math.round(displayList.height * scale));
  const rgba = backdrop ? backdrop.slice() : new Uint8Array(width * height * 4);
  // PDFBox GroupGraphics keeps the group's alpha separate from its backdrop.
  const groupAlpha = backdrop ? new Float32Array(width * height) : undefined;

  // PDF.js beginDrawing: blend modes see the page's transparent backdrop,
  // never the viewer's white/custom background. Composite that background last.
  const deferBackground = !options.transparent && hasCompositingEffects(paintOperations(displayList));
  const transparent = options.transparent || deferBackground;
  const bg = options.background ?? { r: 1, g: 1, b: 1 };
  const bgR = transparent ? 0 : Math.round(bg.r * 255);
  const bgG = transparent ? 0 : Math.round(bg.g * 255);
  const bgB = transparent ? 0 : Math.round(bg.b * 255);
  const bgA = transparent ? 0 : 255;
  for (let i = 0; !backdrop && i < width * height; i++) {
    if (++work % 16384 === 0) yield;
    rgba[i * 4] = bgR;
    rgba[i * 4 + 1] = bgG;
    rgba[i * 4 + 2] = bgB;
    rgba[i * 4 + 3] = bgA;
  }

  const aaVec = options.antialiasVector !== false;
  const aaTxt = options.antialiasText !== false;
  // Reuse adjacent paints without retaining a page-sized mask for every clip.
  let cachedClips: readonly PdfClipPath[] | undefined;
  let cachedClipMask: Uint8Array | undefined;
  let cachedSoftMask: PdfSoftMask | undefined;
  let cachedSoftMaskPixels: Uint8Array | undefined;
  const imageClipMasks = new Map<readonly PdfEvaluatedImage[], Uint8Array>();
  for (const original of paintOperations(displayList)) {
    if (++work % 16384 === 0) yield;
    if (original.kind === "glyph" && (original.value.renderMode === 3 || (!original.value.outline && !original.value.unicode.trim()))) continue;
    let operation = original.kind === "glyph" ? { kind: "path" as const, value: glyphPaint(original.value) } : original;
    if (operation.kind === "group") {
      const group = operation.value;
      const bitmap = (yield* renderDisplayListLayerSteps(
        { ...displayList, operations: group.operations },
        { ...options, transparent: true }, scale, needsGroupBackdrop(group) ? rgba : undefined
      ));
      for (let i = 3; i < bitmap.data.length; i += 4) { if (++work % 16384 === 0) yield; bitmap.data[i] = Math.round(bitmap.data[i]! * group.alpha); }
      operation = { kind: "image", value: {
        name: "TransparencyGroup", width: bitmap.width, height: bitmap.height, decodedRgba: bitmap.data,
        matrix: [bitmap.width / scale, 0, 0, bitmap.height / scale, originX, pageTop - bitmap.height / scale],
        colorSpace: "DeviceRGB", bitsPerComponent: 8, blendMode: group.blendMode, clipRect: group.clipRect,
      } };
    }
    const clips = original.value.clipPaths;
    let clipMask = clips && clips === cachedClips ? cachedClipMask : undefined;
    if (clips && !clipMask) {
      clipMask = new Uint8Array(width * height * 4).fill(255);
      for (const clip of clips) {
    if (++work % 16384 === 0) yield;
        const { segments, fillRule } = "segments" in clip ? clip : { segments: clip, fillRule: "nonzero" as const };
        const layer = new Uint8Array(width * height * 4);
        (yield* fillEdgesScanline4x4Steps(layer, width, height, (yield* pathsToEdgesSteps((yield* segmentsToScreenPathsSteps(segments, displayList.height, scale, toScreen)), true)), { r: 1, g: 1, b: 1 }, 1, fillRule));
        for (let i = 3; i < layer.length; i += 4) { if (++work % 16384 === 0) yield; clipMask[i] = Math.round(clipMask[i]! * layer[i]! / 255); }
      }
      cachedClips = clips;
      cachedClipMask = clipMask;
    }
    const softMask = original.value.softMask;
    if (softMask) {
      if (softMask !== cachedSoftMask) {
        cachedSoftMaskPixels = (yield* renderSoftMaskSteps(softMask, displayList, scale)).data;
        cachedSoftMask = softMask;
      }
      if (clipMask) {
        clipMask = clipMask.slice();
        for (let i = 3; i < clipMask.length; i += 4) { if (++work % 16384 === 0) yield; clipMask[i] = Math.round(clipMask[i]! * cachedSoftMaskPixels![i]! / 255); }
      } else {
        clipMask = cachedSoftMaskPixels;
      }
    }
    const imageClips = original.value.clipImages;
    if (imageClips) {
      let imageMask = imageClipMasks.get(imageClips);
      if (!imageMask) {
        imageMask = new Uint8Array(width * height * 4).fill(255);
        for (const image of imageClips) {
    if (++work % 16384 === 0) yield;
          const layer = (yield* renderDisplayListToBitmapSteps({
            ...displayList, rotation: 0, paths: [], glyphs: [], images: [image], operations: [{ kind: "image", value: image }],
          }, { scale, transparent: true })).data;
          for (let i = 3; i < layer.length; i += 4) { if (++work % 16384 === 0) yield; imageMask[i] = Math.round(imageMask[i]! * layer[i]! / 255); }
        }
        imageClipMasks.set(imageClips, imageMask);
      }
      if (clipMask) {
        clipMask = clipMask.slice();
        for (let i = 3; i < clipMask.length; i += 4) { if (++work % 16384 === 0) yield; clipMask[i] = Math.round(clipMask[i]! * imageMask[i]! / 255); }
      } else {
        clipMask = imageMask;
      }
    }
    if (operation.kind === "path") {
      const path = operation.value;
      if (path.fillColor) {
        const edges = (yield* pathsToEdgesSteps((yield* segmentsToScreenPathsSteps(path.segments, displayList.height, scale, toScreen)), true));
        const clipScreen: [number, number, number, number] | undefined = path.clipRect ? [(path.clipRect[0] - originX) * scale, (pageTop - path.clipRect[3]) * scale, (path.clipRect[2] - originX) * scale, (pageTop - path.clipRect[1]) * scale] : undefined;
        (yield* fillEdgesScanline4x4Steps(rgba, width, height, edges, path.fillColor, path.fillAlpha ?? 1, path.fillRule ?? "nonzero", clipScreen, (original.kind === "glyph" ? aaTxt : aaVec), path.blendMode, clipMask, groupAlpha));
      }
      if (path.strokeColor) {
        const rawSw = path.strokeWidth * scale * (path.strokeMatrix ? Math.hypot(path.strokeMatrix[0], path.strokeMatrix[1]) : 1);
        const strokeAlpha = options.thinLineMode === "shape" && rawSw < 1
          ? (path.strokeAlpha ?? 1) * Math.max(0.25, rawSw) : path.strokeAlpha ?? 1;
        const edges = (yield* pathsToEdgesSteps((yield* strokeContoursSteps(path, displayList.height, scale, originX, originY)).map(points => ({ points, closed: true }))));
        const clipScreen: [number, number, number, number] | undefined = path.clipRect
          ? [(path.clipRect[0] - originX) * scale, (pageTop - path.clipRect[3]) * scale, (path.clipRect[2] - originX) * scale, (pageTop - path.clipRect[1]) * scale] : undefined;
        (yield* fillEdgesScanline4x4Steps(rgba, width, height, edges, path.strokeColor, strokeAlpha, "nonzero", clipScreen,
          original.kind === "glyph" ? aaTxt : aaVec, path.blendMode, clipMask, groupAlpha));
      }
    } else if (operation.kind === "image") {
      const img = operation.value;
      if (!img.decodedRgba) continue;
      const [a, b, c, d, e, f] = img.matrix;
      const det = a * d - b * c;
      if (Math.abs(det) <= 1e-8) continue;
      const cornersPdfX = [e, a + e, a + c + e, c + e];
      const cornersPdfY = [f, b + f, b + d + f, d + f];
      const cornersPx = cornersPdfX.map(cx => (cx - originX) * scale);
      const cornersPy = cornersPdfY.map(cy => (pageTop - cy) * scale);
      const clipMinPx = img.clipRect ? Math.floor((img.clipRect[0] - originX) * scale) : 0;
      const clipMaxPx = img.clipRect ? Math.ceil((img.clipRect[2] - originX) * scale) - 1 : width - 1;
      const clipMinPy = img.clipRect ? Math.floor((pageTop - img.clipRect[3]) * scale) : 0;
      const clipMaxPy = img.clipRect ? Math.ceil((pageTop - img.clipRect[1]) * scale) - 1 : height - 1;
      const minPx = Math.max(0, clipMinPx, Math.floor(Math.min(...cornersPx)));
      const maxPx = Math.min(width - 1, clipMaxPx, Math.ceil(Math.max(...cornersPx)) - 1);
      const minPy = Math.max(0, clipMinPy, Math.floor(Math.min(...cornersPy)));
      const maxPy = Math.min(height - 1, clipMaxPy, Math.ceil(Math.max(...cornersPy)) - 1);
      if (minPx > maxPx || minPy > maxPy) continue;

      // Measure source-pixel footprints through the inverse transform so that
      // rotations/reflections reduce the appropriate source axis.
      const source = downscaleImage({ width: img.width, height: img.height, data: img.decodedRgba },
        Math.hypot(d, c) * img.width / Math.abs(det * scale),
        Math.hypot(b, a) * img.height / Math.abs(det * scale));
      // As in PDF.js getImageSmoothingEnabled, smooth downscaling even when
      // Interpolate is absent. The largest singular value detects enlargement
      // under skew as well as ordinary axis-aligned scaling.
      const ax = a * scale / img.width, ay = b * scale / img.width;
      const bx = c * scale / img.height, by = d * scale / img.height;
      const s1 = ax * ax + ay * ay, s2 = bx * bx + by * by, cross = ax * bx + ay * by;
      const smooth = Math.fround((s1 + s2 + Math.hypot(s1 - s2, 2 * cross)) / 2) <= 1;
      const sample = new Float64Array(4);

      for (let py = minPy; py <= maxPy; py++) {
    if (++work % 16384 === 0) yield;
        const yPdf = pageTop - (py + 0.5) / scale;
        if (img.clipRect && (yPdf < img.clipRect[1] || yPdf > img.clipRect[3])) continue;
        const dyPdf = yPdf - f;
        for (let px = minPx; px <= maxPx; px++) {
    if (++work % 16384 === 0) yield;
          const xPdf = originX + (px + 0.5) / scale;
          if (img.clipRect && (xPdf < img.clipRect[0] || xPdf > img.clipRect[2])) continue;
          const dxPdf = xPdf - e;
          const u = (d * dxPdf - c * dyPdf) / det;
          const v = (-b * dxPdf + a * dyPdf) / det;
          if (u < 0 || u > 1 || v < 0 || v > 1) continue;
          if (smooth) {
            sampleImageLinear(source, u * source.width - 0.5, (1 - v) * source.height - 0.5, sample);
          } else {
            const sx = Math.min(source.width - 1, Math.max(0, Math.floor(u * source.width)));
            const sy = Math.min(source.height - 1, Math.max(0, Math.floor((1 - v) * source.height)));
            const sIdx = (sy * source.width + sx) * 4;
            for (let c = 0; c < 4; c++) { if (++work % 16384 === 0) yield; sample[c] = source.data[sIdx + c]!; }
          }
          blendPixel(
            rgba,
            width,
            height,
            px,
            py,
            {
              r: sample[0]! / 255,
              g: sample[1]! / 255,
              b: sample[2]! / 255,
            },
            sample[3]! / 255,
            img.blendMode, clipMask, groupAlpha
          );
        }
      }
    }
  }

  if (backdrop && groupAlpha) {
    // PDFBox GroupGraphics.removeBackdrop:
    // C = Cn + (Cn - C0) * (alpha0 / alphagn - alpha0).
    // This retains inner blending without compositing the backdrop twice.
    for (let i = 0; i < rgba.length; i += 4) {
    if (++work % 16384 === 0) yield;
      const alpha = groupAlpha[i / 4]!;
      if (alpha === 0) {
        rgba.fill(0, i, i + 4);
        continue;
      }
      const factor = backdrop[i + 3]! / 255 * (1 / alpha - 1);
      for (let channel = 0; channel < 3; channel++) {
    if (++work % 16384 === 0) yield;
        const color = rgba[i + channel]!;
        rgba[i + channel] = Math.max(0, Math.min(255,
          Math.round(color + (color - backdrop[i + channel]!) * factor)));
      }
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }

  if (deferBackground) {
    for (let i = 0; i < rgba.length; i += 4) {
    if (++work % 16384 === 0) yield;
      const alpha = rgba[i + 3]! / 255;
      rgba[i] = Math.round(rgba[i]! * alpha + bg.r * 255 * (1 - alpha));
      rgba[i + 1] = Math.round(rgba[i + 1]! * alpha + bg.g * 255 * (1 - alpha));
      rgba[i + 2] = Math.round(rgba[i + 2]! * alpha + bg.b * 255 * (1 - alpha));
      rgba[i + 3] = 255;
    }
  }
  return { width, height, data: rgba };
}

export function *renderDisplayListToBitmapSteps(
  displayList: PdfDisplayList,
  options: RenderToPngOptions = {}
): Generator<void, RgbaBitmap, void> {
  let work = 0;
  const baseScale = options.scale ?? (options.dpi ? options.dpi / 72 : 1.5);
  const scaleX = options.dpiX !== undefined ? options.dpiX / 72 : baseScale;
  const scaleY = options.dpiY !== undefined ? options.dpiY / 72 : baseScale;
  let result = (yield* renderDisplayListLayerSteps(displayList, options, scaleX));
  const { width, height, data: rgba } = result;
  if (Math.abs(scaleX - scaleY) > 1e-6) {
    const targetW = Math.max(1, Math.round(displayList.width * scaleX));
    const targetH = Math.max(1, Math.round(displayList.height * scaleY));
    const resampled = new Uint8Array(targetW * targetH * 4);
    for (let y = 0; y < targetH; y++) {
    if (++work % 16384 === 0) yield;
      const sy = Math.min(height - 1, Math.floor((y / targetH) * height));
      for (let x = 0; x < targetW; x++) {
    if (++work % 16384 === 0) yield;
        const sx = Math.min(width - 1, Math.floor((x / targetW) * width));
        const sIdx = (sy * width + sx) * 4;
        const dIdx = (y * targetW + x) * 4;
        resampled[dIdx] = rgba[sIdx]!;
        resampled[dIdx + 1] = rgba[sIdx + 1]!;
        resampled[dIdx + 2] = rgba[sIdx + 2]!;
        resampled[dIdx + 3] = rgba[sIdx + 3]!;
      }
    }
    result = { width: targetW, height: targetH, data: resampled };
  }

  if (options.useCropBox) {
    const box = getDisplayListCropBox(displayList);
    result = (yield* cropRgbaBitmapSteps(result, {
      x: box[0] * scaleX, y: (displayList.height - box[3]) * scaleY,
      width: (box[2] - box[0]) * scaleX, height: (box[3] - box[1]) * scaleY,
    }));
  }
  result = (yield* rotateRgbaBitmapQuarterTurnsSteps(result, displayList.rotation ?? 0));
  if (options.cropRect) {
    result = (yield* cropRgbaBitmapSteps(result, options.cropRect));
  }
  return result;
}

export function *renderDisplayListToPngSteps(
  displayList: PdfDisplayList,
  options: RenderToPngOptions = {}
): Generator<void, Uint8Array, void> {
  const bmp = (yield* renderDisplayListToBitmapSteps(displayList, options));
  return (yield* encodeRgbaToPngSteps(bmp.width, bmp.height, bmp.data));
}

function pdfBlendModeToCss(mode?: string): string | undefined {
  if (!mode || mode === "Normal" || mode === "Compatible") return undefined;
  const map: Record<string, string> = {
    Multiply: "multiply",
    Screen: "screen",
    Overlay: "overlay",
    Darken: "darken",
    Lighten: "lighten",
    ColorDodge: "color-dodge",
    ColorBurn: "color-burn",
    HardLight: "hard-light",
    SoftLight: "soft-light",
    Difference: "difference",
    Exclusion: "exclusion",
    Hue: "hue",
    Saturation: "saturation",
    Color: "color",
    Luminosity: "luminosity",
  };
  return map[mode];
}

function *escapeXmlTextSteps(str: string): Generator<void, string, void> {
  let work = 0;
  let valid = "";
  for (const char of str) {
    if (++work % 16384 === 0) yield;
    const cp = char.codePointAt(0)!;
    // XML 1.0's Char production excludes controls, lone surrogates, FFFE and
    // FFFF even when written as numeric entities. Keep the glyph shape intact.
    if (cp === 9 || cp === 10 || cp === 13 || (cp >= 0x20 && cp <= 0xd7ff) ||
        (cp >= 0xe000 && cp <= 0xfffd) || cp >= 0x10000) valid += char;
  }
  return encodeToXmlString(valid);
}

function *svgImageSteps(image: PdfEvaluatedImage, pageHeight: number): Generator<void, string, void> {
  let work = 0;
  if (!image.decodedRgba) return "";
  const png = (yield* encodeRgbaToPngSteps(image.width, image.height, image.decodedRgba));
  const chunks: string[] = [];
  for (let offset = 0; offset < png.length; offset += 8192)
    { if (++work % 16384 === 0) yield; chunks.push(String.fromCharCode(...png.subarray(offset, offset + 8192))); }
  const [a, b, c, d, e, f] = image.matrix;
  return `<image width="1" height="1" preserveAspectRatio="none" transform="matrix(${a} ${-b} ${-c} ${d} ${e + c} ${pageHeight - f - d})" href="data:image/png;base64,${btoa(chunks.join(""))}"/>`;
}

function *svgPathDataSteps(segments: readonly PdfPathSegment[], height: number, matrix?: readonly number[]): Generator<void, string, void> {
  let work = 0;
  const dParts: string[] = [];
  const point = (x: number, y: number) => matrix
    ? `${matrix[0]! * x + matrix[2]! * y + matrix[4]!} ${height - matrix[1]! * x - matrix[3]! * y - matrix[5]!}`
    : `${x} ${height - y}`;
  for (const seg of segments) {
    if (++work % 16384 === 0) yield;
    if (seg.kind === "move") {
      dParts.push(`M ${point(seg.x, seg.y)}`);
    } else if (seg.kind === "line") {
      dParts.push(`L ${point(seg.x, seg.y)}`);
    } else if (seg.kind === "cubic") {
      dParts.push(`C ${point(seg.x1, seg.y1)} ${point(seg.x2, seg.y2)} ${point(seg.x, seg.y)}`);
    } else if (seg.kind === "rect") {
      if (matrix) dParts.push(`M ${point(seg.x, seg.y)} L ${point(seg.x + seg.width, seg.y)} L ${point(seg.x + seg.width, seg.y + seg.height)} L ${point(seg.x, seg.y + seg.height)} Z`);
      else dParts.push(`M ${seg.x} ${height - seg.y} h ${seg.width} v ${-seg.height} h ${-seg.width} Z`);
    } else if (seg.kind === "close") {
      dParts.push("Z");
    }
  }
  return dParts.join(" ");
}

export function *renderDisplayListToSvgSteps(
  displayList: PdfDisplayList,
  options: RenderToPngOptions = {}
): Generator<void, string, void> {
  const baseScale = options.scale ?? (options.dpi ? options.dpi / 72 : 1);
  if (containsBackdropGroup(paintOperations(displayList))) {
    // SVG opacity/mask groups cannot reproduce PDF backdrop removal. Use the
    // bitmap compositor when non-isolated inner blends need the parent page.
    const bitmap = (yield* renderDisplayListToBitmapSteps(displayList, { ...options, scale: baseScale }));
    const embedded = (yield* svgImageSteps({
      name: "PageComposite", width: bitmap.width, height: bitmap.height, decodedRgba: bitmap.data,
      matrix: [bitmap.width, 0, 0, bitmap.height, 0, 0], colorSpace: "DeviceRGB", bitsPerComponent: 8,
    }, bitmap.height));
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${bitmap.width}" height="${bitmap.height}" viewBox="0 0 ${bitmap.width} ${bitmap.height}">${embedded}</svg>\n`;
  }
  const scaleX = options.dpiX !== undefined ? options.dpiX / 72 : baseScale;
  const scaleY = options.dpiY !== undefined ? options.dpiY / 72 : baseScale;
  const [originX, originY] = displayList.origin ?? [0, 0];
  const viewport = new PageViewport({ viewBox: [originX, originY, originX + displayList.width, originY + displayList.height], userUnit: 1, scale: 1, rotation: displayList.rotation ?? 0 });
  const quarterTurn = displayList.rotation === 90 || displayList.rotation === 270;
  const outputScaleX = quarterTurn ? scaleY : scaleX;
  const outputScaleY = quarterTurn ? scaleX : scaleY;
  let bounds = [0, 0, viewport.width, viewport.height];
  if (options.useCropBox) {
    // PDF.js PageViewport.convertToViewportRectangle transforms both corners.
    const box = getDisplayListCropBox(displayList);
    const [x0, y0, x1, y1] = [box[0] + originX, box[1] + originY, box[2] + originX, box[3] + originY];
    const [a, b, c, d, e, f] = viewport.transform;
    bounds = [a * x0 + c * y0 + e, b * x0 + d * y0 + f, a * x1 + c * y1 + e, b * x1 + d * y1 + f];
  }
  const viewX = Math.min(bounds[0]!, bounds[2]!), viewY = Math.min(bounds[1]!, bounds[3]!);
  const viewWidth = Math.abs(bounds[2]! - bounds[0]!), viewHeight = Math.abs(bounds[3]! - bounds[1]!);
  const fullW = Math.max(1, Math.round(viewWidth * outputScaleX));
  const fullH = Math.max(1, Math.round(viewHeight * outputScaleY));
  const cropX = options.cropRect ? options.cropRect.x / outputScaleX : 0;
  const vbX = viewX + cropX;
  const cropY = options.cropRect ? options.cropRect.y / outputScaleY : 0;
  const vbY = viewY + cropY;
  const vbW =
    options.cropRect && options.cropRect.width > 0
      ? options.cropRect.width / outputScaleX
      : Math.max(1, viewWidth - cropX);
  const vbH =
    options.cropRect && options.cropRect.height > 0
      ? options.cropRect.height / outputScaleY
      : Math.max(1, viewHeight - cropY);
  const outW =
    options.cropRect && options.cropRect.width > 0
      ? Math.round(options.cropRect.width)
      : Math.max(1, fullW - Math.round(options.cropRect?.x ?? 0));
  const outH =
    options.cropRect && options.cropRect.height > 0
      ? Math.round(options.cropRect.height)
      : Math.max(1, fullH - Math.round(options.cropRect?.y ?? 0));
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="${vbX} ${vbY} ${vbW} ${vbH}">`,
  ];
  if (!options.transparent) {
    parts.push(`  <rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="#ffffff"/>`);
  }
  parts.push('<g style="isolation:isolate">');
  if (displayList.rotation || originX || originY) {
    // Paths and images below already flip PDF y coordinates. Compose that
    // inverse flip with PDF.js's viewport transform to rotate every paint.
    const [a, b, c, d, e, f] = viewport.transform;
    parts.push(`<g transform="matrix(${a} ${b} ${-c} ${-d} ${e + c * displayList.height} ${f + d * displayList.height})">`);
  }
  let clipId = 0;
  const softMaskIds = new Map<PdfSoftMask, string>();
  const appendOperations = (operations: readonly PdfPaintOperation[]): void => {
    for (const original of operations) {
      if (original.kind === "glyph" && (original.value.renderMode === 3 || (!original.value.outline && !original.value.unicode.trim()))) continue;
      const operation = original.kind === "glyph" ? { kind: "path" as const, value: glyphPaint(original.value) } : original;
      const clips = original.value.clipPaths ?? [];
      const imageClips = original.value.clipImages ?? [];
      // Blend the finished masked/clipped paint with its parent backdrop.
      // A blend inside a mask group only sees that group's transparent buffer.
      const blend = pdfBlendModeToCss(original.value.blendMode);
      if (blend) parts.push(`<g style="mix-blend-mode:${blend}">`);
      const softMask = original.value.softMask;
      if (softMask) {
        let id = softMaskIds.get(softMask);
        if (!id) {
          id = `soft-mask-${clipId++}`;
          softMaskIds.set(softMask, id);
          const bitmap = renderSoftMask(softMask, displayList, Math.max(scaleX, scaleY));
          const image: PdfEvaluatedImage = {
            name: id, width: bitmap.width, height: bitmap.height, decodedRgba: bitmap.data,
            matrix: [displayList.width, 0, 0, displayList.height, originX, originY], colorSpace: "DeviceGray", bitsPerComponent: 8,
          };
          parts.push(`<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="${originX}" y="${-originY}" width="${displayList.width}" height="${displayList.height}" style="mask-type:alpha">${svgImage(image, displayList.height)}</mask></defs>`);
        }
        parts.push(`<g mask="url(#${id})">`);
      }
      for (const clip of clips) {
        const { segments, fillRule } = "segments" in clip ? clip : { segments: clip, fillRule: "nonzero" as const };
        const id = `text-clip-${clipId++}`;
        const path = `<path d="${svgPathData(segments, displayList.height)}" clip-rule="${fillRule}"/>`;
        parts.push(`<defs><clipPath id="${id}" clipPathUnits="userSpaceOnUse">${path}</clipPath></defs><g clip-path="url(#${id})">`);
      }
      for (const image of imageClips) {
        const id = `image-clip-${clipId++}`;
        parts.push(`<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="${originX}" y="${-originY}" width="${displayList.width}" height="${displayList.height}" style="mask-type:alpha">${svgImage(image, displayList.height)}</mask></defs><g mask="url(#${id})">`);
      }
      if (operation.kind === "group") {
        parts.push(`<g opacity="${operation.value.alpha}" style="isolation:isolate">`);
        appendOperations(operation.value.operations);
        parts.push("</g>");
      } else if (operation.kind === "path") {
        const p = operation.value;
        const prepared = p.strokeColor ? prepareStroke(p, Math.max(scaleX, scaleY)) : undefined;
        // SVG's native zero-length dash endpoints differ from PDF. Reuse the
        // PDF stroke contours, keeping the complete stroke as one vector fill.
        const outlineStroke = prepared && p.dashArray?.includes(0);
        const matrix = prepared && (prepared.matrix[0] !== 1 || prepared.matrix[1] !== 0 || prepared.matrix[2] !== 0 || prepared.matrix[3] !== 1)
          ? prepared.matrix : undefined;
        const inverse = matrix ? inverseStrokeMatrix(matrix) : undefined;
        const pathData = svgPathData(p.segments, inverse ? 0 : displayList.height, inverse);
        const transformAttr = inverse && matrix
          ? ` transform="matrix(${matrix[0]} ${-matrix[1]} ${-matrix[2]} ${matrix[3]} ${matrix[4]} ${displayList.height - matrix[5]})"` : "";
        if (pathData) {
          const fill = p.fillColor
            ? `rgb(${Math.round(p.fillColor.r * 255)},${Math.round(p.fillColor.g * 255)},${Math.round(p.fillColor.b * 255)})`
            : "none";
          const stroke = p.strokeColor && prepared
            ? `rgb(${Math.round(p.strokeColor.r * 255)},${Math.round(p.strokeColor.g * 255)},${Math.round(p.strokeColor.b * 255)})`
            : "none";
          const fillRuleAttr = p.fillRule === "evenodd" ? ` fill-rule="evenodd"` : "";
          const fillOpacityAttr = p.fillAlpha !== undefined && p.fillAlpha < 1 ? ` fill-opacity="${p.fillAlpha}"` : "";
          const strokeOpacityAttr = p.strokeAlpha !== undefined && p.strokeAlpha < 1 ? ` stroke-opacity="${p.strokeAlpha}"` : "";
          const strokeWidthAttr =
            p.strokeWidth <= 0 && !matrix && !p.dashArray?.length
              ? ` stroke-width="1" vector-effect="non-scaling-stroke"`
              : ` stroke-width="${prepared?.width ?? p.strokeWidth}"`;
          const lineCapAttr =
            p.lineCap === 1 ? ` stroke-linecap="round"` : p.lineCap === 2 ? ` stroke-linecap="square"` : "";
          const lineJoinAttr =
            p.lineJoin === 1 ? ` stroke-linejoin="round"` : p.lineJoin === 2 ? ` stroke-linejoin="bevel"` : "";
          const miterLimitAttr =
            p.miterLimit !== undefined && p.miterLimit !== 10 ? ` stroke-miterlimit="${p.miterLimit}"` : "";
          const dashArrayAttr = !outlineStroke && prepared?.dashArray?.length ? ` stroke-dasharray="${prepared.dashArray.join(" ")}"` : "";
          const dashOffsetAttr = !outlineStroke && prepared?.dashPhase ? ` stroke-dashoffset="${prepared.dashPhase}"` : "";
          const labelAttr = original.kind === "glyph" ? ` aria-label="${escapeXmlText(original.value.unicode)}"` : "";
          if (!outlineStroke || p.fillColor) {
            parts.push(`  <path${labelAttr}${transformAttr} d="${pathData}" fill="${fill}"${fillRuleAttr}${fillOpacityAttr} stroke="${outlineStroke ? "none" : stroke}"${strokeOpacityAttr}${strokeWidthAttr}${lineCapAttr}${lineJoinAttr}${miterLimitAttr}${dashArrayAttr}${dashOffsetAttr}/>`);
          }
          if (outlineStroke) {
            const outlineScale = Math.max(scaleX, scaleY);
            const contours = strokeContours(p, displayList.height, outlineScale);
            const outlineData = contours.map(points => points.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x / outlineScale} ${y / outlineScale}`).join(" ") + " Z").join(" ");
            if (outlineData) parts.push(`  <path${labelAttr} d="${outlineData}" fill="${stroke}" fill-opacity="${p.strokeAlpha ?? 1}"/>`);
          }
        }
      } else if (operation.kind === "image") {
        parts.push(`  ${svgImage(operation.value, displayList.height)}`);
      }
      for (let i = 0; i < clips.length + imageClips.length + (softMask ? 1 : 0) + (blend ? 1 : 0); i++) parts.push("</g>");
    }
  };
  appendOperations(paintOperations(displayList));
  if (displayList.rotation || originX || originY) parts.push("</g>");
  parts.push("</g>");
  parts.push("</svg>\n");
  return parts.join("\n");
}

function *collectLeavesForRasterSteps(
  cosDoc: ReturnType<typeof parseCosDocument>,
  node: PdfCosNode | undefined,
  out: Array<{ ref: PdfCosRef; dict: PdfCosDict }> = [],
  visited = new Set<number>()
): Generator<void, Array<{ ref: PdfCosRef; dict: PdfCosDict }>, void> {
  let work = 0;
  if (!node) return out;
  let ref: PdfCosRef | undefined;
  if (node.kind === "ref") {
    if (visited.has(node.objectNumber)) return out;
    visited.add(node.objectNumber);
    ref = node;
  }
  const dict = cosDoc.resolveDict(node);
  if (!dict) return out;
  const kids = cosDoc.resolveArray(dictGet(dict, "Kids"));
  if (kids) {
    for (const k of kids.items) { if (++work % 16384 === 0) yield; yield* collectLeavesForRasterSteps(cosDoc, k, out, visited); }
  } else {
    out.push({ ref: ref ?? cosDoc.allocateObject(dict), dict });
  }
  return out;
}

export function *renderPdfPageToBitmapSteps(
  pdfBytes: Uint8Array | ParsedCosDocument,
  pageIndex = 0,
  options?: RenderToPngOptions
): Generator<void, RgbaBitmap, void> {
  const cos = pdfBytes instanceof Uint8Array ? parseCosDocument(pdfBytes) : pdfBytes;
  const catalog = cos.resolveDict(cos.rootRef);
  const leaves = (yield* collectLeavesForRasterSteps(cos, catalog ? dictGet(catalog, "Pages") : undefined));
  const leaf = leaves[pageIndex] ?? (pageIndex >= 1 ? leaves[pageIndex - 1] : undefined);
  if (!leaf) throw new Error(`Page index ${pageIndex} out of bounds`);
  const resolvedIndex = leaves.indexOf(leaf);
  const page = new PdfPage(cos, leaf.ref, leaf.dict, resolvedIndex);
  return page.renderToBitmap(options);
}

export function *renderPdfPageToPngSteps(
  pdfBytes: Uint8Array | ParsedCosDocument,
  pageIndex = 0,
  options?: RenderToPngOptions
): Generator<void, Uint8Array, void> {
  const bmp = (yield* renderPdfPageToBitmapSteps(pdfBytes, pageIndex, options));
  return (yield* encodeRgbaToPngSteps(bmp.width, bmp.height, bmp.data));
}

export function encodePng(
  bitmap: RgbaBitmap
): Uint8Array {
  const steps = encodePngSteps(bitmap);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function decodePng(
  pngBytes: Uint8Array
): RgbaBitmap {
  const steps = decodePngSteps(pngBytes);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

function bitLengthAndMag(
  val: number
): { size: number; bits: number } {
  const steps = bitLengthAndMagSteps(val);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function encodeJpeg(
  bitmap: RgbaBitmap,
  quality = 90
): Uint8Array {
  const steps = encodeJpegSteps(bitmap, quality);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function encodePpm(
  bitmap: RgbaBitmap
): Uint8Array {
  const steps = encodePpmSteps(bitmap);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function encodePgm(
  bitmap: RgbaBitmap
): Uint8Array {
  const steps = encodePgmSteps(bitmap);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function encodeTiff(
  bitmap: RgbaBitmap,
  dpi = 72,
  compression: TiffCompressionMode = "none"
): Uint8Array {
  const steps = encodeTiffSteps(bitmap, dpi, compression);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function encodePbm(
  bitmap: RgbaBitmap
): Uint8Array {
  const steps = encodePbmSteps(bitmap);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function rotateRgbaBitmapQuarterTurns(
  bitmap: RgbaBitmap,
  degrees: number
): RgbaBitmap {
  const steps = rotateRgbaBitmapQuarterTurnsSteps(bitmap, degrees);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function cropRgbaBitmap(
  bitmap: RgbaBitmap,
  rect: PdfCropRect
): RgbaBitmap {
  const steps = cropRgbaBitmapSteps(bitmap, rect);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function encodeRgbaToPng(
  width: number,
  height: number,
  rgba: Uint8Array
): Uint8Array {
  const steps = encodeRgbaToPngSteps(width, height, rgba);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

function strokeContours(
  path: PdfEvaluatedPath,
  pageHeight: number,
  scale: number,
  originX = 0,
  originY = 0
): StrokePoint[][] {
  const steps = strokeContoursSteps(path, pageHeight, scale, originX, originY);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

function renderSoftMask(
  mask: PdfSoftMask,
  displayList: PdfDisplayList,
  scale: number
): RgbaBitmap {
  const steps = renderSoftMaskSteps(mask, displayList, scale);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function renderDisplayListToBitmap(
  displayList: PdfDisplayList,
  options: RenderToPngOptions = {}
): RgbaBitmap {
  const steps = renderDisplayListToBitmapSteps(displayList, options);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function renderDisplayListToPng(
  displayList: PdfDisplayList,
  options: RenderToPngOptions = {}
): Uint8Array {
  const steps = renderDisplayListToPngSteps(displayList, options);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

function escapeXmlText(
  str: string
): string {
  const steps = escapeXmlTextSteps(str);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

function svgImage(
  image: PdfEvaluatedImage,
  pageHeight: number
): string {
  const steps = svgImageSteps(image, pageHeight);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

function svgPathData(
  segments: readonly PdfPathSegment[],
  height: number,
  matrix?: readonly number[]
): string {
  const steps = svgPathDataSteps(segments, height, matrix);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function renderDisplayListToSvg(
  displayList: PdfDisplayList,
  options: RenderToPngOptions = {}
): string {
  const steps = renderDisplayListToSvgSteps(displayList, options);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function renderPdfPageToBitmap(
  pdfBytes: Uint8Array | ParsedCosDocument,
  pageIndex = 0,
  options?: RenderToPngOptions
): RgbaBitmap {
  const steps = renderPdfPageToBitmapSteps(pdfBytes, pageIndex, options);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function renderPdfPageToPng(
  pdfBytes: Uint8Array | ParsedCosDocument,
  pageIndex = 0,
  options?: RenderToPngOptions
): Uint8Array {
  const steps = renderPdfPageToPngSteps(pdfBytes, pageIndex, options);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}
