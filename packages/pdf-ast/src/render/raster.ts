import { parseCosDocument, type ParsedCosDocument } from "../cos/parser.js";
import { PdfPage } from "../canvas.js";
import { dictGet, type PdfCosDict, type PdfCosNode, type PdfCosRef } from "../ast.js";
import type { PdfDisplayList, PdfPathSegment, PdfRgbColor } from "../ast.js";
import { applyPredictor, decodeFlate, encodeFlate } from "../cos/filters.js";

export interface RgbaBitmap {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export function encodePng(bitmap: RgbaBitmap): Uint8Array {
  return encodeRgbaToPng(bitmap.width, bitmap.height, bitmap.data);
}

export function decodePng(pngBytes: Uint8Array): RgbaBitmap {
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
      const rowStart = y * rowBytes;
      for (let x = 0; x < width; x++) {
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
      const rowStart = y * rowBytes;
      for (let x = 0; x < width; x++) {
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

function bitLengthAndMag(val: number): { size: number; bits: number } {
  if (val === 0) return { size: 0, bits: 0 };
  const absV = Math.abs(val);
  let size = 0;
  let tmp = absV;
  while (tmp > 0) {
    size++;
    tmp >>= 1;
  }
  const bits = val > 0 ? val : val + (1 << size) - 1;
  return { size, bits };
}

export function encodeJpeg(bitmap: RgbaBitmap, quality = 90): Uint8Array {
  const w = Math.max(1, bitmap.width);
  const h = Math.max(1, bitmap.height);
  const qClamp = Math.max(1, Math.min(100, quality));
  const scaleFactor = qClamp < 50 ? 5000 / qClamp : 200 - 2 * qClamp;

  const qZigZag = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
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
    for (let mx = 0; mx < mcusX; mx++) {
      for (let by = 0; by < 8; by++) {
        const py = Math.min(h - 1, my * 8 + by);
        for (let bx = 0; bx < 8; bx++) {
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
    out.set(part, off);
    off += part.length;
  }
  return out;
}

export function encodePpm(bitmap: RgbaBitmap): Uint8Array {
  const w = Math.max(1, bitmap.width);
  const h = Math.max(1, bitmap.height);
  const header = new TextEncoder().encode(`P6\n${w} ${h}\n255\n`);
  const out = new Uint8Array(header.length + w * h * 3);
  out.set(header, 0);
  let dst = header.length;
  for (let i = 0; i < w * h; i++) {
    out[dst++] = bitmap.data[i * 4] ?? 255;
    out[dst++] = bitmap.data[i * 4 + 1] ?? 255;
    out[dst++] = bitmap.data[i * 4 + 2] ?? 255;
  }
  return out;
}

export function encodePgm(bitmap: RgbaBitmap): Uint8Array {
  const w = Math.max(1, bitmap.width);
  const h = Math.max(1, bitmap.height);
  const header = new TextEncoder().encode(`P5\n${w} ${h}\n255\n`);
  const out = new Uint8Array(header.length + w * h);
  out.set(header, 0);
  let dst = header.length;
  for (let i = 0; i < w * h; i++) {
    const r = bitmap.data[i * 4] ?? 255;
    const g = bitmap.data[i * 4 + 1] ?? 255;
    const b = bitmap.data[i * 4 + 2] ?? 255;
    out[dst++] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return out;
}

function encodePackBitsRow(row: Uint8Array): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < row.length) {
    let runLen = 1;
    while (i + runLen < row.length && runLen < 128 && row[i + runLen] === row[i]) {
      runLen++;
    }
    if (runLen >= 2) {
      out.push((257 - runLen) & 0xff, row[i]!);
      i += runLen;
    } else {
      const litStart = i;
      let litLen = 0;
      while (i < row.length && litLen < 128) {
        if (i + 1 < row.length && row[i + 1] === row[i]) break;
        i++;
        litLen++;
      }
      out.push(litLen - 1);
      for (let k = 0; k < litLen; k++) {
        out.push(row[litStart + k]!);
      }
    }
  }
  return out;
}

export type TiffCompressionMode = "none" | "packbits" | "deflate" | "lzw" | "jpeg";

export function encodeTiff(
  bitmap: RgbaBitmap,
  dpi = 72,
  compression: TiffCompressionMode = "none"
): Uint8Array {
  const { width, height, data } = bitmap;
  const rgbByteLength = width * height * 3;
  const rawRgb = new Uint8Array(rgbByteLength);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
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
      const row = rawRgb.subarray(y * rowStride, (y + 1) * rowStride);
      packed.push(...encodePackBitsRow(row));
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

export function encodePbm(bitmap: RgbaBitmap): Uint8Array {
  const w = Math.max(1, bitmap.width);
  const h = Math.max(1, bitmap.height);
  const header = new TextEncoder().encode(`P4\n${w} ${h}\n`);
  const rowBytes = Math.ceil(w / 8);
  const out = new Uint8Array(header.length + rowBytes * h);
  out.set(header, 0);
  let dst = header.length;
  for (let y = 0; y < h; y++) {
    for (let bx = 0; bx < rowBytes; bx++) {
      let byteVal = 0;
      for (let bit = 0; bit < 8; bit++) {
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

export function rotateRgbaBitmapQuarterTurns(bitmap: RgbaBitmap, degrees: number): RgbaBitmap {
  const norm = ((Math.round(degrees / 90) * 90) % 360 + 360) % 360;
  if (norm === 0) return bitmap;
  const srcW = bitmap.width;
  const srcH = bitmap.height;
  if (norm === 180) {
    const out = new Uint8Array(srcW * srcH * 4);
    for (let y = 0; y < srcH; y++) {
      for (let x = 0; x < srcW; x++) {
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
    for (let x = 0; x < srcW; x++) {
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

export function cropRgbaBitmap(bitmap: RgbaBitmap, rect: PdfCropRect): RgbaBitmap {
  const x0 = Math.max(0, Math.min(bitmap.width - 1, Math.round(rect.x)));
  const y0 = Math.max(0, Math.min(bitmap.height - 1, Math.round(rect.y)));
  const maxW = Math.max(1, bitmap.width - x0);
  const maxH = Math.max(1, bitmap.height - y0);
  const w = rect.width > 0 ? Math.max(1, Math.min(maxW, Math.round(rect.width))) : maxW;
  const h = rect.height > 0 ? Math.max(1, Math.min(maxH, Math.round(rect.height))) : maxH;
  const out = new Uint8Array(w * h * 4);
  for (let dy = 0; dy < h; dy++) {
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

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc, false);
  return out;
}

export function encodeRgbaToPng(width: number, height: number, rgba: Uint8Array): Uint8Array {
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
    const rowStart = y * (stride + 1);
    rawScanlines[rowStart] = 0; // Filter type 0 (None)
    rawScanlines.set(rgba.subarray(y * stride, (y + 1) * stride), rowStart + 1);
  }

  const compressed = encodeFlate(rawScanlines);
  const ihdrChunk = makePngChunk("IHDR", ihdr);
  const idatChunk = makePngChunk("IDAT", compressed);
  const iendChunk = makePngChunk("IEND", new Uint8Array(0));

  const total = signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of [signature, ihdrChunk, idatChunk, iendChunk]) {
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
  blendMode?: string
): void {
  if (px < 0 || py < 0 || px >= width || py >= height || alpha <= 0) return;
  const a = Math.min(1, Math.max(0, alpha));
  const idx = (py * width + px) * 4;
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

function drawAntiAliasedSegment(
  rgba: Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  strokeWidth: number,
  color: PdfRgbColor,
  alpha = 1,
  lineCap: 0 | 1 | 2 = 0,
  antialias = true,
  blendMode?: string
): void {
  const halfW = Math.max(0.6, strokeWidth * 0.5);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lenSq = dx * dx + dy * dy;
  const segLen = Math.sqrt(lenSq);
  const pad = lineCap === 2 ? halfW + 2 : halfW + 1;
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - pad));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1) + pad));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - pad));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1) + pad));

  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const cx = px + 0.5;
      const cy = py + 0.5;
      if (segLen > 1e-6 && (lineCap === 0 || lineCap === 2)) {
        const ux = dx / segLen;
        const uy = dy / segLen;
        const along = (cx - x0) * ux + (cy - y0) * uy;
        const perp = Math.abs(-(cx - x0) * uy + (cy - y0) * ux);
        const minAlong = lineCap === 2 ? -halfW : 0;
        const maxAlong = lineCap === 2 ? segLen + halfW : segLen;
        const overAlong = along < minAlong ? minAlong - along : along > maxAlong ? along - maxAlong : 0;
        const dist = overAlong > 0 ? Math.max(perp, halfW + overAlong) : perp;
        if (dist <= halfW + 0.75) {
          const cov = antialias ? Math.max(0, Math.min(1, halfW + 0.5 - dist)) : dist <= halfW + 0.25 ? 1 : 0;
          blendPixel(rgba, width, height, px, py, color, cov * alpha, blendMode);
        }
        continue;
      }
      let t = lenSq > 1e-6 ? ((cx - x0) * dx + (cy - y0) * dy) / lenSq : 0;
      t = Math.max(0, Math.min(1, t));
      const projX = x0 + t * dx;
      const projY = y0 + t * dy;
      const dist = Math.hypot(cx - projX, cy - projY);
      if (dist <= halfW + 0.75) {
        const cov = antialias ? Math.max(0, Math.min(1, halfW + 0.5 - dist)) : dist <= halfW + 0.25 ? 1 : 0;
        blendPixel(rgba, width, height, px, py, color, cov * alpha, blendMode);
      }
    }
  }
}

interface Edge {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function segmentsToScreenEdges(
  segments: readonly PdfPathSegment[],
  pageHeight: number,
  scale: number,
  closeSubpaths = false
): Edge[] {
  const edges: Edge[] = [];
  let curX = 0;
  let curY = 0;
  let startX = 0;
  let startY = 0;
  let hasOpenSubpath = false;

  const toScreen = (x: number, y: number): [number, number] => [x * scale, (pageHeight - y) * scale];

  for (const seg of segments) {
    if (seg.kind === "move") {
      if (closeSubpaths && hasOpenSubpath && (curX !== startX || curY !== startY)) {
        edges.push({ x0: curX, y0: curY, x1: startX, y1: startY });
      }
      [curX, curY] = toScreen(seg.x, seg.y);
      startX = curX;
      startY = curY;
      hasOpenSubpath = false;
    } else if (seg.kind === "line") {
      const [nx, ny] = toScreen(seg.x, seg.y);
      edges.push({ x0: curX, y0: curY, x1: nx, y1: ny });
      curX = nx;
      curY = ny;
      hasOpenSubpath = true;
    } else if (seg.kind === "cubic") {
      const [p1x, p1y] = toScreen(seg.x1, seg.y1);
      const [p2x, p2y] = toScreen(seg.x2, seg.y2);
      const [p3x, p3y] = toScreen(seg.x, seg.y);
      const steps = 12;
      let px = curX;
      let py = curY;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const mt = 1 - t;
        const qx =
          mt * mt * mt * curX +
          3 * mt * mt * t * p1x +
          3 * mt * t * t * p2x +
          t * t * t * p3x;
        const qy =
          mt * mt * mt * curY +
          3 * mt * mt * t * p1y +
          3 * mt * t * t * p2y +
          t * t * t * p3y;
        edges.push({ x0: px, y0: py, x1: qx, y1: qy });
        px = qx;
        py = qy;
      }
      curX = p3x;
      curY = p3y;
      hasOpenSubpath = true;
    } else if (seg.kind === "close") {
      if (curX !== startX || curY !== startY) {
        edges.push({ x0: curX, y0: curY, x1: startX, y1: startY });
        curX = startX;
        curY = startY;
      }
      hasOpenSubpath = false;
    } else if (seg.kind === "rect") {
      if (closeSubpaths && hasOpenSubpath && (curX !== startX || curY !== startY)) {
        edges.push({ x0: curX, y0: curY, x1: startX, y1: startY });
      }
      const [rx0, ry0] = toScreen(seg.x, seg.y + seg.height);
      const [rx1, ry1] = toScreen(seg.x + seg.width, seg.y);
      edges.push(
        { x0: rx0, y0: ry0, x1: rx1, y1: ry0 },
        { x0: rx1, y0: ry0, x1: rx1, y1: ry1 },
        { x0: rx1, y0: ry1, x1: rx0, y1: ry1 },
        { x0: rx0, y0: ry1, x1: rx0, y1: ry0 }
      );
      hasOpenSubpath = false;
    }
  }
  if (closeSubpaths && hasOpenSubpath && (curX !== startX || curY !== startY)) {
    edges.push({ x0: curX, y0: curY, x1: startX, y1: startY });
  }
  return edges;
}

function fillEdgesScanline4x4(
  rgba: Uint8Array,
  width: number,
  height: number,
  edges: readonly Edge[],
  color: PdfRgbColor,
  alpha = 1,
  fillRule: "nonzero" | "evenodd" = "nonzero",
  clipScreen?: readonly [number, number, number, number],
  antialias = true,
  blendMode?: string
): void {
  if (edges.length === 0) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const e of edges) {
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
    const rowCounts = new Uint8Array(width);
    for (const sy of subOffsets) {
      const scanY = py + sy;
      const crossings: Array<{ x: number; dir: number }> = [];
      for (const e of edges) {
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
          intervals.push([crossings[i]!.x, crossings[i + 1]!.x]);
        }
      } else {
        let winding = 0;
        let intervalStart = 0;
        for (const c of crossings) {
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
        const xStart = Math.max(clipMinX, Math.floor(xLeft));
        const xEnd = Math.min(clipMaxX, Math.ceil(xRight));
        for (let px = xStart; px <= xEnd; px++) {
          for (const sx of subOffsets) {
            const sampleX = px + sx;
            if (sampleX >= xLeft && sampleX <= xRight) {
              rowCounts[px] = (rowCounts[px] ?? 0) + 1;
            }
          }
        }
      }
    }
    for (let px = 0; px < width; px++) {
      const count = rowCounts[px]!;
      if (count > 0) {
        const cov = antialias ? count / 16 : count >= 8 ? 1 : 0;
        blendPixel(rgba, width, height, px, py, color, cov * alpha, blendMode);
      }
    }
  }
}

// Minimal clean vector stroke glyph outlines for rendering readable text on PNGs
const VECTOR_GLYPH_STROKES: Readonly<Record<string, ReadonlyArray<readonly [number, number, number, number]>>> = {
  A: [[0.1, 0, 0.5, 0.75], [0.5, 0.75, 0.9, 0], [0.24, 0.28, 0.76, 0.28]],
  B: [[0.15, 0, 0.15, 0.75], [0.15, 0.75, 0.75, 0.75], [0.75, 0.75, 0.75, 0.4], [0.15, 0.4, 0.8, 0.4], [0.8, 0.4, 0.8, 0], [0.15, 0, 0.8, 0]],
  C: [[0.85, 0.65, 0.2, 0.75], [0.2, 0.75, 0.15, 0.1], [0.15, 0.1, 0.85, 0.1]],
  D: [[0.15, 0, 0.15, 0.75], [0.15, 0.75, 0.75, 0.6], [0.75, 0.6, 0.75, 0.15], [0.75, 0.15, 0.15, 0]],
  E: [[0.15, 0, 0.15, 0.75], [0.15, 0.75, 0.85, 0.75], [0.15, 0.38, 0.72, 0.38], [0.15, 0, 0.85, 0]],
  F: [[0.15, 0, 0.15, 0.75], [0.15, 0.75, 0.85, 0.75], [0.15, 0.38, 0.72, 0.38]],
  G: [[0.85, 0.65, 0.2, 0.75], [0.2, 0.75, 0.15, 0.05], [0.15, 0.05, 0.85, 0.05], [0.85, 0.05, 0.85, 0.38], [0.5, 0.38, 0.85, 0.38]],
  H: [[0.15, 0, 0.15, 0.75], [0.85, 0, 0.85, 0.75], [0.15, 0.38, 0.85, 0.38]],
  I: [[0.5, 0, 0.5, 0.75], [0.25, 0.75, 0.75, 0.75], [0.25, 0, 0.75, 0]],
  J: [[0.75, 0.75, 0.75, 0.15], [0.75, 0.15, 0.4, 0], [0.4, 0, 0.15, 0.2]],
  K: [[0.15, 0, 0.15, 0.75], [0.85, 0.75, 0.15, 0.35], [0.35, 0.45, 0.85, 0]],
  L: [[0.15, 0.75, 0.15, 0], [0.15, 0, 0.85, 0]],
  M: [[0.1, 0, 0.1, 0.75], [0.1, 0.75, 0.5, 0.2], [0.5, 0.2, 0.9, 0.75], [0.9, 0.75, 0.9, 0]],
  N: [[0.15, 0, 0.15, 0.75], [0.15, 0.75, 0.85, 0], [0.85, 0, 0.85, 0.75]],
  O: [[0.15, 0.1, 0.15, 0.65], [0.15, 0.65, 0.85, 0.65], [0.85, 0.65, 0.85, 0.1], [0.85, 0.1, 0.15, 0.1]],
  P: [[0.15, 0, 0.15, 0.75], [0.15, 0.75, 0.8, 0.75], [0.8, 0.75, 0.8, 0.38], [0.8, 0.38, 0.15, 0.38]],
  Q: [[0.15, 0.1, 0.15, 0.65], [0.15, 0.65, 0.85, 0.65], [0.85, 0.65, 0.85, 0.1], [0.85, 0.1, 0.15, 0.1], [0.55, 0.25, 0.9, -0.05]],
  R: [[0.15, 0, 0.15, 0.75], [0.15, 0.75, 0.8, 0.75], [0.8, 0.75, 0.8, 0.38], [0.8, 0.38, 0.15, 0.38], [0.45, 0.38, 0.85, 0]],
  S: [[0.85, 0.68, 0.2, 0.72], [0.2, 0.72, 0.2, 0.4], [0.2, 0.4, 0.8, 0.35], [0.8, 0.35, 0.8, 0.05], [0.8, 0.05, 0.15, 0.05]],
  T: [[0.5, 0, 0.5, 0.75], [0.1, 0.75, 0.9, 0.75]],
  U: [[0.15, 0.75, 0.15, 0.1], [0.15, 0.1, 0.85, 0.1], [0.85, 0.1, 0.85, 0.75]],
  V: [[0.1, 0.75, 0.5, 0], [0.5, 0, 0.9, 0.75]],
  W: [[0.08, 0.75, 0.28, 0], [0.28, 0, 0.5, 0.5], [0.5, 0.5, 0.72, 0], [0.72, 0, 0.92, 0.75]],
  X: [[0.15, 0.75, 0.85, 0], [0.85, 0.75, 0.15, 0]],
  Y: [[0.15, 0.75, 0.5, 0.38], [0.85, 0.75, 0.5, 0.38], [0.5, 0.38, 0.5, 0]],
  Z: [[0.15, 0.75, 0.85, 0.75], [0.85, 0.75, 0.15, 0], [0.15, 0, 0.85, 0]],
  "0": [[0.18, 0.05, 0.18, 0.7], [0.18, 0.7, 0.82, 0.7], [0.82, 0.7, 0.82, 0.05], [0.82, 0.05, 0.18, 0.05], [0.22, 0.1, 0.78, 0.65]],
  "1": [[0.25, 0.58, 0.5, 0.75], [0.5, 0.75, 0.5, 0], [0.22, 0, 0.78, 0]],
  "2": [[0.18, 0.6, 0.5, 0.75], [0.5, 0.75, 0.82, 0.55], [0.82, 0.55, 0.15, 0], [0.15, 0, 0.85, 0]],
  "3": [[0.18, 0.72, 0.8, 0.72], [0.8, 0.72, 0.45, 0.4], [0.45, 0.4, 0.82, 0.15], [0.82, 0.15, 0.18, 0.02]],
  "4": [[0.7, 0, 0.7, 0.75], [0.7, 0.75, 0.15, 0.25], [0.15, 0.25, 0.88, 0.25]],
  "5": [[0.82, 0.75, 0.2, 0.75], [0.2, 0.75, 0.2, 0.42], [0.2, 0.42, 0.8, 0.35], [0.8, 0.35, 0.75, 0.03], [0.75, 0.03, 0.18, 0.03]],
  "6": [[0.78, 0.72, 0.2, 0.4], [0.2, 0.4, 0.2, 0.05], [0.2, 0.05, 0.8, 0.05], [0.8, 0.05, 0.8, 0.38], [0.8, 0.38, 0.2, 0.38]],
  "7": [[0.15, 0.75, 0.85, 0.75], [0.85, 0.75, 0.35, 0]],
  "8": [[0.2, 0.05, 0.8, 0.05], [0.8, 0.05, 0.8, 0.7], [0.8, 0.7, 0.2, 0.7], [0.2, 0.7, 0.2, 0.05], [0.2, 0.38, 0.8, 0.38]],
  "9": [[0.8, 0.38, 0.2, 0.38], [0.2, 0.38, 0.2, 0.72], [0.2, 0.72, 0.8, 0.72], [0.8, 0.72, 0.8, 0.05], [0.8, 0.05, 0.25, 0.02]],
  "-": [[0.2, 0.35, 0.8, 0.35]],
  ".": [[0.45, 0, 0.55, 0.08]],
  ":": [[0.45, 0.05, 0.55, 0.12], [0.45, 0.45, 0.55, 0.52]],
  "/": [[0.2, 0, 0.8, 0.75]],
  "%": [[0.2, 0, 0.8, 0.75], [0.2, 0.55, 0.35, 0.7], [0.65, 0.05, 0.8, 0.2]],
  "$": [[0.5, -0.05, 0.5, 0.8], [0.8, 0.65, 0.2, 0.65], [0.2, 0.65, 0.2, 0.4], [0.2, 0.4, 0.8, 0.35], [0.8, 0.35, 0.8, 0.1], [0.8, 0.1, 0.2, 0.1]],
  "[": [[0.65, 0.75, 0.3, 0.75], [0.3, 0.75, 0.3, 0], [0.3, 0, 0.65, 0]],
  "]": [[0.35, 0.75, 0.7, 0.75], [0.7, 0.75, 0.7, 0], [0.7, 0, 0.35, 0]],
  "(": [[0.65, 0.75, 0.35, 0.5], [0.35, 0.5, 0.35, 0.25], [0.35, 0.25, 0.65, 0]],
  ")": [[0.35, 0.75, 0.65, 0.5], [0.65, 0.5, 0.65, 0.25], [0.65, 0.25, 0.35, 0]],
  ",": [[0.5, 0.12, 0.45, 0], [0.45, 0, 0.35, -0.1]],
  ";": [[0.45, 0.45, 0.55, 0.52], [0.5, 0.15, 0.38, -0.08]],
  "&": [[0.75, 0.02, 0.22, 0.6], [0.22, 0.6, 0.5, 0.75], [0.5, 0.75, 0.68, 0.58], [0.68, 0.58, 0.18, 0.22], [0.18, 0.22, 0.45, 0.02], [0.45, 0.02, 0.82, 0.32]],
  "'": [[0.5, 0.75, 0.45, 0.52]],
  "\"": [[0.35, 0.75, 0.35, 0.52], [0.65, 0.75, 0.65, 0.52]],
  "!": [[0.5, 0.75, 0.5, 0.2], [0.48, 0.06, 0.52, 0]],
  "?": [[0.22, 0.6, 0.5, 0.75], [0.5, 0.75, 0.78, 0.58], [0.78, 0.58, 0.5, 0.35], [0.5, 0.35, 0.5, 0.2], [0.48, 0.06, 0.52, 0]],
  "+": [[0.5, 0.12, 0.5, 0.62], [0.2, 0.37, 0.8, 0.37]],
  "=": [[0.2, 0.48, 0.8, 0.48], [0.2, 0.26, 0.8, 0.26]],
  "_": [[0.1, 0, 0.9, 0]],
  "#": [[0.32, 0.05, 0.38, 0.72], [0.62, 0.05, 0.68, 0.72], [0.15, 0.5, 0.85, 0.5], [0.15, 0.26, 0.85, 0.26]],
  "*": [[0.5, 0.15, 0.5, 0.65], [0.22, 0.25, 0.78, 0.55], [0.22, 0.55, 0.78, 0.25]],
};

export function renderDisplayListToBitmap(
  displayList: PdfDisplayList,
  options: RenderToPngOptions = {}
): RgbaBitmap {
  const baseScale = options.scale ?? (options.dpi ? options.dpi / 72 : 1.5);
  const scaleX = options.dpiX !== undefined ? options.dpiX / 72 : baseScale;
  const scaleY = options.dpiY !== undefined ? options.dpiY / 72 : baseScale;
  const scale = scaleX;
  const width = Math.max(1, Math.round(displayList.width * scale));
  const height = Math.max(1, Math.round(displayList.height * scale));
  const rgba = new Uint8Array(width * height * 4);

  const bg = options.background ?? { r: 1, g: 1, b: 1 };
  const bgR = options.transparent ? 0 : Math.round(bg.r * 255);
  const bgG = options.transparent ? 0 : Math.round(bg.g * 255);
  const bgB = options.transparent ? 0 : Math.round(bg.b * 255);
  const bgA = options.transparent ? 0 : 255;
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = bgR;
    rgba[i * 4 + 1] = bgG;
    rgba[i * 4 + 2] = bgB;
    rgba[i * 4 + 3] = bgA;
  }

  // 1. Render vector paths
  const aaVec = options.antialiasVector !== false;
  const aaTxt = options.antialiasText !== false;
  for (const path of displayList.paths) {
    if (path.fillColor) {
      const edges = segmentsToScreenEdges(path.segments, displayList.height, scale, true);
      const clipScreen: [number, number, number, number] | undefined = path.clipRect ? [path.clipRect[0] * scale, (displayList.height - path.clipRect[3]) * scale, path.clipRect[2] * scale, (displayList.height - path.clipRect[1]) * scale] : undefined;
      fillEdgesScanline4x4(rgba, width, height, edges, path.fillColor, path.fillAlpha ?? 1, path.fillRule ?? "nonzero", clipScreen, aaVec, path.blendMode);
    }
    if (path.strokeColor) {
      const edges = segmentsToScreenEdges(path.segments, displayList.height, scale, false);
      const rawSw = path.strokeWidth * scale;
      const sw = Math.max(1, rawSw);
      const strokeAlpha =
        options.thinLineMode === "shape" && rawSw < 1
          ? (path.strokeAlpha ?? 1) * Math.max(0.25, rawSw)
          : path.strokeAlpha ?? 1;
      const dashArr =
        path.dashArray && path.dashArray.length > 0
          ? path.dashArray.map((d) => Math.max(0, d * scale))
          : undefined;
      const dashCycle = dashArr ? dashArr.reduce((a, b) => a + b, 0) : 0;
      let dashDist = ((path.dashPhase ?? 0) * scale) % (dashCycle || 1);
      if (dashDist < 0) dashDist += dashCycle;

      for (const e of edges) {
        if (!dashArr || dashCycle <= 1e-4) {
          drawAntiAliasedSegment(rgba, width, height, e.x0, e.y0, e.x1, e.y1, sw, path.strokeColor, strokeAlpha, path.lineCap ?? 0, aaVec, path.blendMode);
        } else {
          const dx = e.x1 - e.x0;
          const dy = e.y1 - e.y0;
          const edgeLen = Math.hypot(dx, dy);
          if (edgeLen <= 1e-4) continue;
          let pos = 0;
          while (pos < edgeLen) {
            let cycleRem = dashDist % dashCycle;
            let dIdx = 0;
            while (dIdx < dashArr.length - 1 && cycleRem >= dashArr[dIdx]!) {
              cycleRem -= dashArr[dIdx]!;
              dIdx++;
            }
            const segRemainInDash = Math.max(1e-4, dashArr[dIdx]! - cycleRem);
            const step = Math.min(edgeLen - pos, segRemainInDash);
            if (dIdx % 2 === 0) {
              const t0 = pos / edgeLen;
              const t1 = (pos + step) / edgeLen;
              drawAntiAliasedSegment(
                rgba,
                width,
                height,
                e.x0 + dx * t0,
                e.y0 + dy * t0,
                e.x0 + dx * t1,
                e.y0 + dy * t1,
                sw,
                path.strokeColor,
                strokeAlpha,
                path.lineCap ?? 0,
                aaVec,
                path.blendMode
              );
            }
            pos += step;
            dashDist = (dashDist + step) % dashCycle;
          }
        }
      }
    }
  }

  // 2. Render placed images (supports full affine CTM transformations including rotation, mirroring, and shear)
  for (const img of displayList.images) {
    if (!img.decodedRgba) continue;
    const [a, b, c, d, e, f] = img.matrix;
    const det = a * d - b * c;
    if (Math.abs(det) <= 1e-8) continue;
    const cornersPdfX = [e, a + e, a + c + e, c + e];
    const cornersPdfY = [f, b + f, b + d + f, d + f];
    const cornersPx = cornersPdfX.map(cx => cx * scale);
    const cornersPy = cornersPdfY.map(cy => (displayList.height - cy) * scale);
    const clipMinPx = img.clipRect ? Math.floor(img.clipRect[0] * scale) : 0;
    const clipMaxPx = img.clipRect ? Math.ceil(img.clipRect[2] * scale) - 1 : width - 1;
    const clipMinPy = img.clipRect ? Math.floor((displayList.height - img.clipRect[3]) * scale) : 0;
    const clipMaxPy = img.clipRect ? Math.ceil((displayList.height - img.clipRect[1]) * scale) - 1 : height - 1;
    const minPx = Math.max(0, clipMinPx, Math.floor(Math.min(...cornersPx)));
    const maxPx = Math.min(width - 1, clipMaxPx, Math.ceil(Math.max(...cornersPx)) - 1);
    const minPy = Math.max(0, clipMinPy, Math.floor(Math.min(...cornersPy)));
    const maxPy = Math.min(height - 1, clipMaxPy, Math.ceil(Math.max(...cornersPy)) - 1);

    for (let py = minPy; py <= maxPy; py++) {
      const yPdf = displayList.height - (py + 0.5) / scale;
      if (img.clipRect && (yPdf < img.clipRect[1] || yPdf > img.clipRect[3])) continue;
      const dyPdf = yPdf - f;
      for (let px = minPx; px <= maxPx; px++) {
        const xPdf = (px + 0.5) / scale;
        if (img.clipRect && (xPdf < img.clipRect[0] || xPdf > img.clipRect[2])) continue;
        const dxPdf = xPdf - e;
        const u = (d * dxPdf - c * dyPdf) / det;
        const v = (-b * dxPdf + a * dyPdf) / det;
        if (u < 0 || u > 1 || v < 0 || v > 1) continue;
        const sx = Math.min(img.width - 1, Math.max(0, Math.floor(u * img.width)));
        const sy = Math.min(img.height - 1, Math.max(0, Math.floor((1 - v) * img.height)));
        const sIdx = (sy * img.width + sx) * 4;
        blendPixel(
          rgba,
          width,
          height,
          px,
          py,
          {
            r: img.decodedRgba[sIdx]! / 255,
            g: img.decodedRgba[sIdx + 1]! / 255,
            b: img.decodedRgba[sIdx + 2]! / 255,
          },
          img.decodedRgba[sIdx + 3]! / 255,
          img.blendMode
        );
      }
    }
  }

  // 3. Render placed glyphs with clean vector strokes and crisp inter-character separation
  for (const g of displayList.glyphs) {
    if (g.renderMode === 3) continue;
    if (g.clipRect) {
      const cx = (g.bbox[0] + g.bbox[2]) / 2;
      const cy = (g.bbox[1] + g.bbox[3]) / 2;
      if (cx < g.clipRect[0] || cx > g.clipRect[2] || cy < g.clipRect[1] || cy > g.clipRect[3]) {
        continue;
      }
    }
    const raw = g.unicode.trim();
    if (!raw) continue;
    const isLower = raw >= "a" && raw <= "z";
    const ch = raw.toUpperCase();
    const advW = Math.max(4, (g.bbox[2] - g.bbox[0]) * scale);
    const gx0 = g.bbox[0] * scale + advW * 0.08;
    const gyBase = (displayList.height - g.baselineY) * scale;
    const gw = Math.max(3, advW * 0.72);
    const gh = Math.max(5, g.fontSize * scale * (isLower ? 0.76 : 1.0));
    const strokes = VECTOR_GLYPH_STROKES[ch] ?? [[0.2, 0.1, 0.8, 0.1], [0.8, 0.1, 0.8, 0.6], [0.8, 0.6, 0.2, 0.6], [0.2, 0.6, 0.2, 0.1]];
    const sw = Math.max(1.1, g.fontSize * scale * 0.085);
    for (const [sx0, sy0, sx1, sy1] of strokes) {
      drawAntiAliasedSegment(
        rgba,
        width,
        height,
        gx0 + sx0 * gw,
        gyBase - sy0 * gh,
        gx0 + sx1 * gw,
        gyBase - sy1 * gh,
        sw,
        g.color,
        1,
        0,
        aaTxt,
        g.blendMode
      );
    }
  }

  let result: RgbaBitmap = { width, height, data: rgba };
  if (Math.abs(scaleX - scaleY) > 1e-6) {
    const targetW = Math.max(1, Math.round(displayList.width * scaleX));
    const targetH = Math.max(1, Math.round(displayList.height * scaleY));
    const resampled = new Uint8Array(targetW * targetH * 4);
    for (let y = 0; y < targetH; y++) {
      const sy = Math.min(height - 1, Math.floor((y / targetH) * height));
      for (let x = 0; x < targetW; x++) {
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

  if (options.cropRect) {
    result = cropRgbaBitmap(result, options.cropRect);
  }
  return result;
}

export function renderDisplayListToPng(
  displayList: PdfDisplayList,
  options: RenderToPngOptions = {}
): Uint8Array {
  const bmp = renderDisplayListToBitmap(displayList, options);
  return encodeRgbaToPng(bmp.width, bmp.height, bmp.data);
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

function escapeXmlText(str: string): string {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

export function renderDisplayListToSvg(
  displayList: PdfDisplayList,
  options: RenderToPngOptions = {}
): string {
  const baseScale = options.scale ?? (options.dpi ? options.dpi / 72 : 1);
  const scaleX = options.dpiX !== undefined ? options.dpiX / 72 : baseScale;
  const scaleY = options.dpiY !== undefined ? options.dpiY / 72 : baseScale;
  const fullW = Math.max(1, Math.round(displayList.width * scaleX));
  const fullH = Math.max(1, Math.round(displayList.height * scaleY));
  const vbX = options.cropRect ? options.cropRect.x / scaleX : 0;
  const vbY = options.cropRect ? options.cropRect.y / scaleY : 0;
  const vbW =
    options.cropRect && options.cropRect.width > 0
      ? options.cropRect.width / scaleX
      : Math.max(1, displayList.width - vbX);
  const vbH =
    options.cropRect && options.cropRect.height > 0
      ? options.cropRect.height / scaleY
      : Math.max(1, displayList.height - vbY);
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
  for (const p of displayList.paths) {
    const dParts: string[] = [];
    for (const seg of p.segments) {
      if (seg.kind === "move") {
        dParts.push(`M ${seg.x} ${displayList.height - seg.y}`);
      } else if (seg.kind === "line") {
        dParts.push(`L ${seg.x} ${displayList.height - seg.y}`);
      } else if (seg.kind === "cubic") {
        dParts.push(`C ${seg.x1} ${displayList.height - seg.y1} ${seg.x2} ${displayList.height - seg.y2} ${seg.x} ${displayList.height - seg.y}`);
      } else if (seg.kind === "rect") {
        dParts.push(`M ${seg.x} ${displayList.height - seg.y - seg.height} h ${seg.width} v ${seg.height} h ${-seg.width} Z`);
      } else if (seg.kind === "close") {
        dParts.push("Z");
      }
    }
    if (dParts.length > 0) {
      const fill = p.fillColor
        ? `rgb(${Math.round(p.fillColor.r * 255)},${Math.round(p.fillColor.g * 255)},${Math.round(p.fillColor.b * 255)})`
        : "none";
      const stroke = p.strokeColor
        ? `rgb(${Math.round(p.strokeColor.r * 255)},${Math.round(p.strokeColor.g * 255)},${Math.round(p.strokeColor.b * 255)})`
        : "none";
      const fillRuleAttr = p.fillRule === "evenodd" ? ` fill-rule="evenodd"` : "";
      const fillOpacityAttr = p.fillAlpha !== undefined && p.fillAlpha < 1 ? ` fill-opacity="${p.fillAlpha}"` : "";
      const strokeOpacityAttr = p.strokeAlpha !== undefined && p.strokeAlpha < 1 ? ` stroke-opacity="${p.strokeAlpha}"` : "";
      const strokeWidthAttr =
        p.strokeWidth <= 0
          ? ` stroke-width="1" vector-effect="non-scaling-stroke"`
          : ` stroke-width="${p.strokeWidth}"`;
      const lineCapAttr =
        p.lineCap === 1 ? ` stroke-linecap="round"` : p.lineCap === 2 ? ` stroke-linecap="square"` : "";
      const lineJoinAttr =
        p.lineJoin === 1 ? ` stroke-linejoin="round"` : p.lineJoin === 2 ? ` stroke-linejoin="bevel"` : "";
      const miterLimitAttr =
        p.miterLimit !== undefined && p.miterLimit !== 10 ? ` stroke-miterlimit="${p.miterLimit}"` : "";
      const dashArrayAttr = p.dashArray && p.dashArray.length > 0 ? ` stroke-dasharray="${p.dashArray.join(" ")}"` : "";
      const dashOffsetAttr = p.dashPhase ? ` stroke-dashoffset="${p.dashPhase}"` : "";
      parts.push(`  <path d="${dParts.join(" ")}" fill="${fill}"${fillRuleAttr}${fillOpacityAttr} stroke="${stroke}"${strokeOpacityAttr}${strokeWidthAttr}${lineCapAttr}${lineJoinAttr}${miterLimitAttr}${dashArrayAttr}${dashOffsetAttr}/>`);
    }
  }
  for (const img of displayList.images) {
    if (!img.decodedRgba) continue;
    const pngBytes = encodeRgbaToPng(img.width, img.height, img.decodedRgba);
    const b64 = Buffer.from(pngBytes).toString("base64");
    const [a, b, c, d, e, f] = img.matrix;
    const svgTx = e + c;
    const svgTy = displayList.height - f - d;
    parts.push(
      `  <image width="1" height="1" preserveAspectRatio="none" transform="matrix(${a} ${-b} ${-c} ${d} ${svgTx} ${svgTy})" href="data:image/png;base64,${b64}"/>`
    );
  }
  for (const g of displayList.glyphs) {
    if (g.renderMode === 3) continue;
    if (!g.unicode) continue;
    const fill = `rgb(${Math.round(g.color.r * 255)},${Math.round(g.color.g * 255)},${Math.round(g.color.b * 255)})`;
    const x = Number(g.bbox[0].toFixed(2));
    const y = Number((displayList.height - g.baselineY).toFixed(2));
    const fs = Number(g.fontSize.toFixed(2));
    const lowerFont = g.fontName.toLowerCase();
    const weightAttr = lowerFont.includes("bold") ? ` font-weight="bold"` : "";
    const styleAttr = lowerFont.includes("italic") || lowerFont.includes("oblique") ? ` font-style="italic"` : "";
    const [ma, mb] = g.matrix;
    let rotAttr = "";
    if (Math.abs(mb) > 1e-4 || ma < 0) {
      const deg = Number(((-Math.atan2(mb, ma) * 180) / Math.PI).toFixed(2));
      if (Math.abs(deg) > 1e-2) {
        rotAttr = ` transform="rotate(${deg} ${x} ${y})"`;
      }
    }
    parts.push(`  <text x="${x}" y="${y}" font-size="${fs}"${weightAttr}${styleAttr}${rotAttr} fill="${fill}">${escapeXmlText(g.unicode)}</text>`);
  }
  parts.push("</svg>\n");
  return parts.join("\n");
}

function collectLeavesForRaster(
  cosDoc: ReturnType<typeof parseCosDocument>,
  node: PdfCosNode | undefined,
  out: Array<{ ref: PdfCosRef; dict: PdfCosDict }> = [],
  visited = new Set<number>()
): Array<{ ref: PdfCosRef; dict: PdfCosDict }> {
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
    for (const k of kids.items) collectLeavesForRaster(cosDoc, k, out, visited);
  } else {
    out.push({ ref: ref ?? cosDoc.allocateObject(dict), dict });
  }
  return out;
}

function extractBoxArray(cosDoc: ReturnType<typeof parseCosDocument>, dict: PdfCosDict, key: string): [number, number, number, number] | undefined {
  let cur: PdfCosDict | undefined = dict;
  const visited = new Set<PdfCosDict>();
  while (cur && !visited.has(cur)) {
    visited.add(cur);
    const arr = cosDoc.resolveArray(dictGet(cur, key));
    if (arr && arr.items.length >= 4) {
      const nums = arr.items.slice(0, 4).map(item => {
        const r = cosDoc.resolve(item);
        return r?.kind === "number" ? r.value : 0;
      });
      return [nums[0]!, nums[1]!, nums[2]!, nums[3]!];
    }
    cur = cosDoc.resolveDict(dictGet(cur, "Parent"));
  }
  return undefined;
}

export function renderPdfPageToBitmap(
  pdfBytes: Uint8Array | ParsedCosDocument,
  pageIndex = 0,
  options?: RenderToPngOptions
): RgbaBitmap {
  const cos = pdfBytes instanceof Uint8Array ? parseCosDocument(pdfBytes) : pdfBytes;
  const catalog = cos.resolveDict(cos.rootRef);
  const leaves = collectLeavesForRaster(cos, catalog ? dictGet(catalog, "Pages") : undefined);
  const leaf = leaves[pageIndex] ?? (pageIndex >= 1 ? leaves[pageIndex - 1] : undefined);
  if (!leaf) throw new Error(`Page index ${pageIndex} out of bounds`);
  const resolvedIndex = leaves.indexOf(leaf);
  const page = new PdfPage(cos, leaf.ref, leaf.dict, resolvedIndex);
  const { cropRect, ...restOptions } = options ?? {};
  let bitmap = renderDisplayListToBitmap(
    page.evaluateDisplayList({ hideAnnotations: options?.hideAnnotations }),
    restOptions
  );
  if (options?.useCropBox) {
    const cropBox = extractBoxArray(cos, leaf.dict, "CropBox");
    if (cropBox) {
      const mediaBox = extractBoxArray(cos, leaf.dict, "MediaBox") ?? [0, 0, page.getSize().width, page.getSize().height];
      const baseScale = options.scale ?? (options.dpi ? options.dpi / 72 : 1.5);
      const scaleX = options.dpiX !== undefined ? options.dpiX / 72 : baseScale;
      const scaleY = options.dpiY !== undefined ? options.dpiY / 72 : baseScale;
      const mediaH = mediaBox[3] - mediaBox[1];
      const bx = Math.round((cropBox[0] - mediaBox[0]) * scaleX);
      const by = Math.round((mediaH - (cropBox[3] - mediaBox[1])) * scaleY);
      const bw = Math.max(1, Math.round(Math.abs(cropBox[2] - cropBox[0]) * scaleX));
      const bh = Math.max(1, Math.round(Math.abs(cropBox[3] - cropBox[1]) * scaleY));
      bitmap = cropRgbaBitmap(bitmap, { x: bx, y: by, width: bw, height: bh });
    }
  }
  const rotation = page.getRotation();
  if (rotation === 90 || rotation === 180 || rotation === 270) {
    bitmap = rotateRgbaBitmapQuarterTurns(bitmap, rotation);
  }
  if (cropRect) {
    bitmap = cropRgbaBitmap(bitmap, cropRect);
  }
  return bitmap;
}

export function renderPdfPageToPng(
  pdfBytes: Uint8Array | ParsedCosDocument,
  pageIndex = 0,
  options?: RenderToPngOptions
): Uint8Array {
  const bmp = renderPdfPageToBitmap(pdfBytes, pageIndex, options);
  return encodeRgbaToPng(bmp.width, bmp.height, bmp.data);
}
