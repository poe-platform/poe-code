import { createJpegArithmeticEncoder } from "./jpeg-arithmetic.js";
import {readJpegFrame} from "./jpeg-frame.js";
import {JpegTables} from "./jpeg-tables.js";
import {applyJpegMetadata,type JpegMetadataState} from "./jpeg-metadata.js";
import {jpegCmyk, jpegColor, JpegColorEncoding} from "./jpeg-color.js";
import {createJpegScan} from "./jpeg-decode-kernel.js";
import type { ImageMetadata, RgbaImage, SharpInputOptions } from "../ast.js";
import { buildExifApp1Segment } from "./exif.js";

const ZIGZAG = new Uint8Array([
  0, 1, 8, 16, 9, 2, 3, 10,
  17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34,
  27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36,
  29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46,
  53, 60, 61, 54, 47, 55, 62, 63
]);

const STD_LUMA_QUANT = new Uint8Array([
  16, 11, 10, 16, 24, 40, 51, 61,
  12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77,
  24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99
]);

const STD_CHROMA_QUANT = new Uint8Array([
  17, 18, 24, 47, 99, 99, 99, 99,
  18, 21, 26, 66, 99, 99, 99, 99,
  24, 26, 56, 99, 99, 99, 99, 99,
  47, 66, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99
]);

const STD_DC_LUMA_NRCODES = new Uint8Array([0, 0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0]);
const STD_DC_LUMA_VALUES = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
const STD_DC_CHROMA_NRCODES = new Uint8Array([0, 0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]);
const STD_DC_CHROMA_VALUES = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

const STD_AC_LUMA_NRCODES = new Uint8Array([0, 0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d]);
const STD_AC_LUMA_VALUES = new Uint8Array([
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
  0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
  0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
  0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
  0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa
]);

const STD_AC_CHROMA_NRCODES = new Uint8Array([0, 0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77]);
const STD_AC_CHROMA_VALUES = new Uint8Array([
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
  0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
  0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
  0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
  0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
  0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
  0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
  0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
  0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa
]);

const COS_TABLE = (() => {
  const table = new Float64Array(64);
  for (let u = 0; u < 8; u++) {
    const cu = u === 0 ? Math.SQRT1_2 : 1;
    for (let x = 0; x < 8; x++) {
      table[u * 8 + x] = cu * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
    }
  }
  return table;
})();

export function isJpegBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export function readJpegMetadata(bytes: Uint8Array): ImageMetadata {
  if (!isJpegBytes(bytes)) {
    throw new Error("Invalid JPEG signature");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const state:JpegMetadataState={width:0,height:0,channels:3,isProgressive:false,density:72,orientation:undefined};

  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) {
      pos++;
      continue;
    }
    while (pos < bytes.length && bytes[pos] === 0xff) pos++;
    if (pos >= bytes.length) break;
    const marker = bytes[pos]!;
    pos++;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      if (marker === 0xd9) break;
      continue;
    }
    if (pos + 2 > bytes.length) break;
    const segLen = view.getUint16(pos, false);
    if (segLen < 2 || pos + segLen > bytes.length) break;
    const payload = bytes.subarray(pos + 2, pos + segLen);

    if(applyJpegMetadata(state,marker,payload))break;
    pos += segLen;
  }

  const {width,height,channels,isProgressive,density,orientation}=state;
  if (width <= 0 || height <= 0) {
    throw new Error("Invalid JPEG dimensions");
  }

  return {
    ...(state.properties === undefined ? {} : {properties: state.properties}),
    ...(state.icc === undefined ? {} : {icc: state.icc}),
    ...(state.exif === undefined ? {} : {exif: state.exif}),
    format: "jpeg",
    ...(state.jpegSamplingFactor === undefined ? {} : { jpegSamplingFactor: state.jpegSamplingFactor }),
    width,
    height,
    space: channels === 1 ? "b-w" : channels === 4 ? "cmyk" : "srgb",
    channels,
    depth: "uchar",
    density,
    ...(state.resolution ? {resolution: state.resolution} : {}),
    hasAlpha: false,
    ...(orientation !== undefined ? { orientation } : {}),
    ...(state.quality === undefined ? {} : { quality: state.quality }),
    isProgressive,
    size: bytes.byteLength
  };
}

const IDCT_DEQUANT = new Float64Array(64);
const IDCT_TEMP = new Float64Array(64);

const BOX4_TABLE = (() => {
  const table = new Float64Array(32);
  for (let q = 0; q < 4; q++) {
    for (let u = 0; u < 8; u++) {
      table[q * 8 + u] = 0.25 * (COS_TABLE[u * 8 + 2 * q]! + COS_TABLE[u * 8 + 2 * q + 1]!);
    }
  }
  return table;
})();

const BOX2_TABLE = (() => {
  const table = new Float64Array(16);
  for (let q = 0; q < 2; q++) {
    for (let u = 0; u < 8; u++) {
      table[q * 8 + u] =
        0.125 *
        (COS_TABLE[u * 8 + 4 * q]! +
          COS_TABLE[u * 8 + 4 * q + 1]! +
          COS_TABLE[u * 8 + 4 * q + 2]! +
          COS_TABLE[u * 8 + 4 * q + 3]!);
    }
  }
  return table;
})();

export function idct8x8(coeffs: Int32Array | Int16Array, quant: Uint16Array, out: Uint8Array, maxK = 63): void {
  if (maxK === 0) {
    const dcVal = Math.round(coeffs[0]! * quant[0]! * 0.125 + 128);
    const clamped = dcVal < 0 ? 0 : dcVal > 255 ? 255 : dcVal;
    out.fill(clamped, 0, 64);
    return;
  }
  IDCT_DEQUANT.fill(0);
  for (let i = 0; i <= maxK; i++) {
    const c = coeffs[i]!;
    if (c !== 0) {
      IDCT_DEQUANT[ZIGZAG[i]!] = c * quant[i]!;
    }
  }
  // libjpeg's accurate integer IDCT: 13-bit constants, two retained bits
  // after the column pass, and rounded descaling at each pass boundary.
  for (let pass = 0; pass < 2; pass++) {
    const input = pass === 0 ? IDCT_DEQUANT : IDCT_TEMP;
    const stride = pass === 0 ? 8 : 1;
    const divisor = pass === 0 ? 2048 : 262144;
    for (let line = 0; line < 8; line++) {
      const offset = pass === 0 ? line : line * 8;
      const d0 = input[offset]!;
      const d1 = input[offset + stride]!;
      const d2 = input[offset + 2 * stride]!;
      const d3 = input[offset + 3 * stride]!;
      const d4 = input[offset + 4 * stride]!;
      const d5 = input[offset + 5 * stride]!;
      const d6 = input[offset + 6 * stride]!;
      const d7 = input[offset + 7 * stride]!;
      const z1 = (d2 + d6) * 4433;
      const t2 = z1 - d6 * 15137;
      const t3 = z1 + d2 * 6270;
      const t0 = (d0 + d4) * 8192;
      const t1 = (d0 - d4) * 8192;
      const t10 = t0 + t3, t13 = t0 - t3;
      const t11 = t1 + t2, t12 = t1 - t2;
      const z5 = (d7 + d3 + d5 + d1) * 9633;
      const z3 = (d7 + d3) * -16069 + z5;
      const z4 = (d5 + d1) * -3196 + z5;
      const z12 = (d7 + d1) * -7373;
      const z2 = (d5 + d3) * -20995;
      const o0 = d7 * 2446 + z12 + z3;
      const o1 = d5 * 16819 + z2 + z4;
      const o2 = d3 * 25172 + z2 + z3;
      const o3 = d1 * 12299 + z12 + z4;
      for (let i = 0; i < 8; i++) {
        const value = i === 0 ? t10 + o3 : i === 1 ? t11 + o2 :
          i === 2 ? t12 + o1 : i === 3 ? t13 + o0 :
          i === 4 ? t13 - o0 : i === 5 ? t12 - o1 :
          i === 6 ? t11 - o2 : t10 - o3;
        const sample = Math.floor((value + divisor / 2) / divisor);
        if (pass === 0) IDCT_TEMP[offset + i * stride] = sample;
        else out[offset + i] = Math.max(0, Math.min(255, sample + 128));
      }
    }
  }
}

export function idctScaledBlock(
  coeffs: Int32Array | Int16Array,
  quant: Uint16Array,
  out: Uint8Array,
  maxK: number,
  step: 8 | 4 | 2
): void {
  if (step === 8) {
    idct8x8(coeffs, quant, out, maxK);
    return;
  }
  if (maxK === 0) {
    const dcVal = Math.round(coeffs[0]! * quant[0]! * 0.125 + 128);
    const clamped = dcVal < 0 ? 0 : dcVal > 255 ? 255 : dcVal;
    out.fill(clamped, 0, step * step);
    return;
  }
  IDCT_DEQUANT.fill(0);
  for (let i = 0; i <= maxK; i++) {
    const c = coeffs[i]!;
    if (c !== 0) {
      IDCT_DEQUANT[ZIGZAG[i]!] = c * quant[i]!;
    }
  }
  if (step === 4) {
    for (let y = 0; y < 8; y++) {
      const rowOff = y * 8;
      const d0 = IDCT_DEQUANT[rowOff]!;
      const d1 = IDCT_DEQUANT[rowOff + 1]!;
      const d2 = IDCT_DEQUANT[rowOff + 2]!;
      const d3 = IDCT_DEQUANT[rowOff + 3]!;
      const d4 = IDCT_DEQUANT[rowOff + 4]!;
      const d5 = IDCT_DEQUANT[rowOff + 5]!;
      const d6 = IDCT_DEQUANT[rowOff + 6]!;
      const d7 = IDCT_DEQUANT[rowOff + 7]!;
      const dstOff = y * 4;
      if (d1 === 0 && d2 === 0 && d3 === 0 && d4 === 0 && d5 === 0 && d6 === 0 && d7 === 0) {
        const v = d0 * BOX4_TABLE[0]!;
        IDCT_TEMP[dstOff] = v;
        IDCT_TEMP[dstOff + 1] = v;
        IDCT_TEMP[dstOff + 2] = v;
        IDCT_TEMP[dstOff + 3] = v;
        continue;
      }
      for (let qx = 0; qx < 4; qx++) {
        const bOff = qx * 8;
        IDCT_TEMP[dstOff + qx] =
          d0 * BOX4_TABLE[bOff]! +
          d1 * BOX4_TABLE[bOff + 1]! +
          d2 * BOX4_TABLE[bOff + 2]! +
          d3 * BOX4_TABLE[bOff + 3]! +
          d4 * BOX4_TABLE[bOff + 4]! +
          d5 * BOX4_TABLE[bOff + 5]! +
          d6 * BOX4_TABLE[bOff + 6]! +
          d7 * BOX4_TABLE[bOff + 7]!;
      }
    }
    for (let qx = 0; qx < 4; qx++) {
      const t0 = IDCT_TEMP[qx]!;
      const t1 = IDCT_TEMP[4 + qx]!;
      const t2 = IDCT_TEMP[8 + qx]!;
      const t3 = IDCT_TEMP[12 + qx]!;
      const t4 = IDCT_TEMP[16 + qx]!;
      const t5 = IDCT_TEMP[20 + qx]!;
      const t6 = IDCT_TEMP[24 + qx]!;
      const t7 = IDCT_TEMP[28 + qx]!;
      for (let qy = 0; qy < 4; qy++) {
        const bOff = qy * 8;
        const sum =
          t0 * BOX4_TABLE[bOff]! +
          t1 * BOX4_TABLE[bOff + 1]! +
          t2 * BOX4_TABLE[bOff + 2]! +
          t3 * BOX4_TABLE[bOff + 3]! +
          t4 * BOX4_TABLE[bOff + 4]! +
          t5 * BOX4_TABLE[bOff + 5]! +
          t6 * BOX4_TABLE[bOff + 6]! +
          t7 * BOX4_TABLE[bOff + 7]!;
        const val = Math.round(sum + 128);
        out[qy * 4 + qx] = val < 0 ? 0 : val > 255 ? 255 : val;
      }
    }
  } else {
    for (let y = 0; y < 8; y++) {
      const rowOff = y * 8;
      const d0 = IDCT_DEQUANT[rowOff]!;
      const d1 = IDCT_DEQUANT[rowOff + 1]!;
      const d3 = IDCT_DEQUANT[rowOff + 3]!;
      const d5 = IDCT_DEQUANT[rowOff + 5]!;
      const d7 = IDCT_DEQUANT[rowOff + 7]!;
      const evenTerm = d0 * BOX2_TABLE[0]!;
      const oddTerm =
        d1 * BOX2_TABLE[1]! +
        d3 * BOX2_TABLE[3]! +
        d5 * BOX2_TABLE[5]! +
        d7 * BOX2_TABLE[7]!;
      IDCT_TEMP[y * 2] = evenTerm + oddTerm;
      IDCT_TEMP[y * 2 + 1] = evenTerm - oddTerm;
    }
    for (let qx = 0; qx < 2; qx++) {
      const evenCol =
        (IDCT_TEMP[qx]! +
          IDCT_TEMP[2 + qx]! +
          IDCT_TEMP[4 + qx]! +
          IDCT_TEMP[6 + qx]! +
          IDCT_TEMP[8 + qx]! +
          IDCT_TEMP[10 + qx]! +
          IDCT_TEMP[12 + qx]! +
          IDCT_TEMP[14 + qx]!) *
        BOX2_TABLE[0]!;
      const oddCol =
        (IDCT_TEMP[qx]! - IDCT_TEMP[14 + qx]!) * BOX2_TABLE[1]! +
        (IDCT_TEMP[2 + qx]! - IDCT_TEMP[12 + qx]!) * BOX2_TABLE[3]! +
        (IDCT_TEMP[4 + qx]! - IDCT_TEMP[10 + qx]!) * BOX2_TABLE[5]! +
        (IDCT_TEMP[6 + qx]! - IDCT_TEMP[8 + qx]!) * BOX2_TABLE[7]!;
      const v0 = Math.round(evenCol + oddCol + 128);
      const v1 = Math.round(evenCol - oddCol + 128);
      out[qx] = v0 < 0 ? 0 : v0 > 255 ? 255 : v0;
      out[2 + qx] = v1 < 0 ? 0 : v1 > 255 ? 255 : v1;
    }
  }
}

interface ComponentSpec {
  id: number;
  h: number;
  v: number;
  qId: number;
  dcId: number;
  acId: number;
  dcPred: number;
  blocksX: number;
  blocksY: number;
  blocksFlat?: Int16Array;
  pixels?: Uint8Array;
  stripPixels?: Uint8Array;
}

export function decodeJpegImage(bytes: Uint8Array, options?: SharpInputOptions): RgbaImage {
  const scratchCoeffs = new Int32Array(64);
  const meta = readJpegMetadata(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const tables=new JpegTables();
  const {quantTables,dcTrees,acTrees}=tables;

  let width = 0;
  let height = 0;
  let scaleDenom: 1 | 2 | 4 = 1;
  let blockStep: 8 | 4 | 2 = 8;
  let outWidth = 0;
  let outHeight = 0;
  let useStripDecode = false;
  const colorEncoding = new JpegColorEncoding();
  let outRgba: Uint8Array | undefined;
  let hueSamples: Float64Array | undefined;
  let maxH = 1;
  let maxV = 1;
  let mcusX = 0;
  let mcusY = 0;
  const components: ComponentSpec[] = [];

  let pos = 2;
  while (pos + 2 <= bytes.length) {
    if (bytes[pos] !== 0xff) {
      pos++;
      continue;
    }
    while (pos < bytes.length && bytes[pos] === 0xff) pos++;
    if (pos >= bytes.length) break;
    const marker = bytes[pos]!;
    pos++;
    if (marker === 0xd9) break;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (pos + 2 > bytes.length) break;
    const segLen = view.getUint16(pos, false);
    if (segLen < 2 || pos + segLen > bytes.length) break;
    const payload = bytes.subarray(pos + 2, pos + segLen);

    colorEncoding.read(marker, payload);
    if (tables.read(marker,payload)) {pos+=segLen;continue;}
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const frame=readJpegFrame(payload,meta.isProgressive??false,options,scaleDenom,blockStep);
      ({width,height,outWidth,outHeight,maxH,maxV,mcusX,mcusY,useStripDecode,scaleDenom,blockStep}=frame);
      components.length=0;components.push(...frame.components);
      for (const comp of components) {
        comp.blocksX = mcusX * comp.h;
        comp.blocksY = mcusY * comp.v;
        if (meta.isProgressive) {
          comp.blocksFlat = new Int16Array(comp.blocksX * comp.blocksY * 64);
        } else if (useStripDecode) {
          comp.stripPixels = new Uint8Array(comp.blocksX * blockStep * comp.v * blockStep);
        } else {
          comp.pixels = new Uint8Array(comp.blocksX * blockStep * comp.blocksY * blockStep);
        }
      }
    } else if (marker === 0xda) {
      // SOS
      const scanCompsCount = payload[0]!;
      const scanComps: ComponentSpec[] = [];
      for (let i = 0; i < scanCompsCount; i++) {
        const compId = payload[1 + i * 2]!;
        const tdta = payload[1 + i * 2 + 1]!;
        const comp = components.find(c => c.id === compId);
        if (!comp) throw new Error("Unknown JPEG scan component");
        comp.dcId = tdta >>> 4;
        comp.acId = tdta & 0x0f;
        scanComps.push(comp);
      }
      if (!meta.isProgressive && scanCompsCount < components.length) {
        useStripDecode = false;
        for (const comp of components) {
          if (!comp.pixels) {
            comp.pixels = new Uint8Array(comp.blocksX * blockStep * comp.blocksY * blockStep);
          }
        }
      }
      if (useStripDecode && !outRgba) {
        outRgba = new Uint8Array(outWidth * outHeight * 4);
        if (meta.space === "cmyk") hueSamples = new Float64Array(outRgba.length);
      }
      const ssPos = 1 + scanCompsCount * 2;
      const spectralStart = payload[ssPos] ?? 0;
      const spectralEnd = payload[ssPos + 1] ?? 63;
      const ahAl = payload[ssPos + 2] ?? 0;
      const approxHigh = ahAl >>> 4;
      const approxLow = ahAl & 0x0f;

      // Decode entropy-coded data starting after SOS segment
      const scan = createJpegScan(position => bytes[position], bytes.length, pos + segLen,
        dcTrees, acTrees, spectralStart, spectralEnd, approxHigh, approxLow);
      const blockOut = new Uint8Array(64);
      const decodeAndStoreBaselineBlock = (comp: ComponentSpec, bx: number, by: number, stripVy: number): void => {
        const maxK = scan.decodeBaseline(comp, scratchCoeffs);
        const quant = quantTables[comp.qId];
        if (!quant) throw new Error("Missing JPEG quantization table");
        idctScaledBlock(scratchCoeffs, quant, blockOut, maxK, blockStep);
        const stride = comp.blocksX * blockStep;
        const dst = useStripDecode ? comp.stripPixels! : comp.pixels!;
        const baseRow = (useStripDecode ? stripVy : by) * blockStep;
        const baseCol = bx * blockStep;
        for (let y = 0; y < blockStep; y++) {
          const dstOff = (baseRow + y) * stride + baseCol;
          const srcOff = y * blockStep;
          for (let x = 0; x < blockStep; x++) {
            dst[dstOff + x] = blockOut[srcOff + x]!;
          }
        }
      };

      let mcuCounter = 0;
      let restartCounter = 0;
      const consumeRestart = (): void => {
        let scanPos = scan.position;
        if (bytes[scanPos++] !== 0xff) throw new Error("Missing JPEG restart marker");
        while (bytes[scanPos] === 0xff) scanPos++;
        if (bytes[scanPos++] !== 0xd0 + restartCounter % 8) throw new Error("Invalid JPEG restart sequence");
        restartCounter++;
        for (const comp of scanComps) comp.dcPred = 0;
        scan.restart(scanPos);
      };
      if (scanComps.length === 1 && (spectralStart > 0 || scanCompsCount === 1 && components.length > 1)) {
        const comp = scanComps[0]!;
        const blocksCols = Math.ceil(width / (8 * (maxH / comp.h)));
        const blocksRows = Math.ceil(height / (8 * (maxV / comp.v)));
        for (let by = 0; by < blocksRows; by++) {
          for (let bx = 0; bx < blocksCols; bx++) {
            if (tables.restartInterval > 0 && mcuCounter > 0 && mcuCounter % tables.restartInterval === 0) {
              consumeRestart();
            }
            if (meta.isProgressive) {
              const off = (by * comp.blocksX + bx) * 64;
              scan.decodeProgressive(comp, comp.blocksFlat!.subarray(off, off + 64));
            } else {
              decodeAndStoreBaselineBlock(comp, bx, by, by % comp.v);
            }
            mcuCounter++;
          }
        }
      } else {
        const mcuRowH = maxV * blockStep;
        for (let my = 0; my < mcusY; my++) {
          for (let mx = 0; mx < mcusX; mx++) {
            if (tables.restartInterval > 0 && mcuCounter > 0 && mcuCounter % tables.restartInterval === 0) {
              consumeRestart();
            }
            for (const comp of scanComps) {
              for (let vy = 0; vy < comp.v; vy++) {
                for (let hx = 0; hx < comp.h; hx++) {
                  const bx = mx * comp.h + hx;
                  const by = my * comp.v + vy;
                  if (meta.isProgressive) {
                    const off = (by * comp.blocksX + bx) * 64;
                    scan.decodeProgressive(comp, comp.blocksFlat!.subarray(off, off + 64));
                  } else {
                    decodeAndStoreBaselineBlock(comp, bx, by, vy);
                  }
                }
              }
            }
            mcuCounter++;
          }
          if (useStripDecode && outRgba) {
            const yStart = my * mcuRowH;
            const yEnd = Math.min(outHeight, yStart + mcuRowH);
            const c0 = components[0]!;
            const s0 = c0.blocksX * blockStep;
            if (components.length === 1) {
              const p0 = c0.stripPixels!;
              for (let y = yStart; y < yEnd; y++) {
                const ly = y - yStart;
                const rowIn = ly * s0;
                let outIdx = y * outWidth * 4;
                for (let x = 0; x < outWidth; x++) {
                  const g = p0[rowIn + x]!;
                  outRgba[outIdx] = g;
                  outRgba[outIdx + 1] = g;
                  outRgba[outIdx + 2] = g;
                  outRgba[outIdx + 3] = 255;
                  outIdx += 4;
                }
              }
            } else if (components.length >= 3) {
              const c1 = components[1]!;
              const c2 = components[2]!;
              const pY = c0.stripPixels!;
              const pCb = c1.stripPixels!;
              const pCr = c2.stripPixels!;
              const sY = s0;
              const sCb = c1.blocksX * blockStep;
              const sCr = c2.blocksX * blockStep;
              const hY = c0.h, vY = c0.v;
              const hCb = c1.h, vCb = c1.v;
              const hCr = c2.h, vCr = c2.v;
              const hasK = components.length === 4;
              const c3 = hasK ? components[3]! : undefined;
              const pK = c3?.stripPixels;
              const sK = c3 ? c3.blocksX * blockStep : 0;
              for (let y = yStart; y < yEnd; y++) {
                const ly = y - yStart;
                const yRow = (vY === maxV ? ly : Math.floor((ly * vY) / maxV)) * sY;
                const cbRow = (vCb === maxV ? ly : Math.floor((ly * vCb) / maxV)) * sCb;
                const crRow = (vCr === maxV ? ly : Math.floor((ly * vCr) / maxV)) * sCr;
                const kRow = c3 ? (c3.v === maxV ? ly : Math.floor((ly * c3.v) / maxV)) * sK : 0;
                let outIdx = y * outWidth * 4;
                for (let x = 0; x < outWidth; x++) {
                  const yVal = pY[yRow + (hY === maxH ? x : Math.floor((x * hY) / maxH))]!;
                  const cbVal = pCb[cbRow + (hCb === maxH ? x : Math.floor((x * hCb) / maxH))]! - 128;
                  const crVal = pCr[crRow + (hCr === maxH ? x : Math.floor((x * hCr) / maxH))]! - 128;
                  const kVal = hasK && pK && c3 ? Number(pK[kRow + (c3.h === maxH ? x : Math.floor((x * c3.h) / maxH))]) : undefined;
                  const rgb=jpegColor(yVal,cbVal,crVal,kVal,true,colorEncoding.rgb, colorEncoding.adobeTransform);
                  if (hueSamples && kVal !== undefined) hueSamples.set(jpegCmyk(yVal, cbVal, crVal, kVal, colorEncoding.adobeTransform), outIdx);
                  outRgba[outIdx] = rgb&255;
                  outRgba[outIdx + 1] = (rgb>>>8)&255;
                  outRgba[outIdx + 2] = rgb>>>16;
                  outRgba[outIdx + 3] = 255;
                  outIdx += 4;
                }
              }
            }
          }
        }
      }

      pos = scan.position;
      continue;
    }
    pos += segLen;
  }

  if (useStripDecode && outRgba) {
    return {
      width: outWidth,
      height: outHeight,
      data: outRgba,
      ...(hueSamples ? { hueSamples } : {}),
      format: "jpeg",
      space: meta.space,
      channels: meta.channels,
      depth: "uchar",
      density: meta.density,
      ...(meta.jpegSamplingFactor === undefined ? {} : { jpegSamplingFactor: meta.jpegSamplingFactor }),
      ...(meta.quality === undefined ? {} : { quality: meta.quality }),
      ...(meta.resolution ? {resolution: meta.resolution} : {}),
      hasAlpha: false,
      ...(meta.properties === undefined ? {} : {properties: meta.properties}),
      ...(meta.icc === undefined ? {} : {icc: meta.icc}),
      ...(meta.exif === undefined ? {} : {exif: meta.exif}),
      ...(meta.orientation !== undefined ? { orientation: meta.orientation } : {}),
      ...(meta.isProgressive !== undefined ? { isProgressive: meta.isProgressive } : {})
    };
  }

  const compPixels = components.map(comp => {
    if (!meta.isProgressive && comp.pixels) {
      return { comp, pixels: comp.pixels, stride: comp.blocksX * blockStep };
    }
    const pixels = new Uint8Array(comp.blocksX * 8 * comp.blocksY * 8);
    const blockOut = new Uint8Array(64);
    const quant = quantTables[comp.qId];
    if (!quant) throw new Error("Missing JPEG quantization table");
    const blocksFlat = comp.blocksFlat!;
    for (let by = 0; by < comp.blocksY; by++) {
      for (let bx = 0; bx < comp.blocksX; bx++) {
        const off = (by * comp.blocksX + bx) * 64;
        idct8x8(blocksFlat.subarray(off, off + 64), quant, blockOut, 63);
        for (let y = 0; y < 8; y++) {
          const dstOffset = (by * 8 + y) * (comp.blocksX * 8) + bx * 8;
          for (let x = 0; x < 8; x++) {
            pixels[dstOffset + x] = blockOut[y * 8 + x]!;
          }
        }
      }
    }
    return { comp, pixels, stride: comp.blocksX * 8 };
  });

  const samplePlane = (
    plane: { readonly comp: ComponentSpec; readonly pixels: Uint8Array; readonly stride: number },
    x: number,
    y: number
  ): number => {
    const h = plane.comp.h;
    const v = plane.comp.v;
    if (h === maxH && v === maxV) {
      return plane.pixels[y * plane.stride + x]!;
    }
    const maxCx = Math.max(0, Math.ceil((width * h) / maxH) - 1);
    const maxCy = Math.max(0, Math.ceil((height * v) / maxV) - 1);
    const sx = ((x + 0.5) * h) / maxH - 0.5;
    const sy = ((y + 0.5) * v) / maxV - 0.5;
    const rawX0 = Math.floor(sx);
    const rawY0 = Math.floor(sy);
    const x0 = Math.max(0, Math.min(maxCx, rawX0));
    const x1 = Math.max(0, Math.min(maxCx, rawX0 + 1));
    const y0 = Math.max(0, Math.min(maxCy, rawY0));
    const y1 = Math.max(0, Math.min(maxCy, rawY0 + 1));
    const fx = Math.max(0, Math.min(1, sx - rawX0));
    const fy = Math.max(0, Math.min(1, sy - rawY0));
    const p00 = plane.pixels[y0 * plane.stride + x0]!;
    const p10 = plane.pixels[y0 * plane.stride + x1]!;
    const p01 = plane.pixels[y1 * plane.stride + x0]!;
    const p11 = plane.pixels[y1 * plane.stride + x1]!;
    const top = p00 + (p10 - p00) * fx;
    const bot = p01 + (p11 - p01) * fx;
    return top + (bot - top) * fy;
  };

  const rgba = new Uint8Array(width * height * 4);
  if (meta.space === "cmyk") hueSamples = new Float64Array(rgba.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const outIdx = (y * width + x) * 4;
      if (compPixels.length === 1) {
        const c0 = compPixels[0]!;
        const g = c0.pixels[y * c0.stride + x]!;
        rgba[outIdx] = g;
        rgba[outIdx + 1] = g;
        rgba[outIdx + 2] = g;
        rgba[outIdx + 3] = 255;
      } else if (compPixels.length >= 3) {
        const cY = compPixels[0]!;
        const cCb = compPixels[1]!;
        const cCr = compPixels[2]!;
        const yVal = samplePlane(cY, x, y);
        const cbVal = samplePlane(cCb, x, y) - 128;
        const crVal = samplePlane(cCr, x, y) - 128;

        const cK=compPixels.length===4?compPixels[3]:undefined;
        const kVal=cK?Number(cK.pixels[Math.floor((y * cK.comp.v) / maxV) * cK.stride + Math.floor((x * cK.comp.h) / maxH)]):undefined;
        const rgb=jpegColor(yVal,cbVal,crVal,kVal,false,colorEncoding.rgb, colorEncoding.adobeTransform);
        if (hueSamples && kVal !== undefined) hueSamples.set(jpegCmyk(yVal, cbVal, crVal, kVal, colorEncoding.adobeTransform), outIdx);
        rgba[outIdx] = rgb&255;
        rgba[outIdx + 1] = (rgb>>>8)&255;
        rgba[outIdx + 2] = rgb>>>16;
        rgba[outIdx + 3] = 255;
      }
    }
  }

  return {
    width,
    height,
    data: rgba,
    ...(hueSamples ? { hueSamples } : {}),
    format: "jpeg",
    space: meta.space,
    channels: meta.channels,
    depth: "uchar",
    density: meta.density,
    ...(meta.jpegSamplingFactor === undefined ? {} : { jpegSamplingFactor: meta.jpegSamplingFactor }),
    ...(meta.quality === undefined ? {} : { quality: meta.quality }),
    ...(meta.resolution ? {resolution: meta.resolution} : {}),
    hasAlpha: false,
    ...(meta.properties === undefined ? {} : {properties: meta.properties}),
    ...(meta.icc === undefined ? {} : {icc: meta.icc}),
    ...(meta.exif === undefined ? {} : {exif: meta.exif}),
    ...(meta.orientation !== undefined ? { orientation: meta.orientation } : {}),
    ...(meta.isProgressive !== undefined ? { isProgressive: meta.isProgressive } : {})
  };
}

function buildEncodeTable(nrcodes: Uint8Array, values: Uint8Array): { code: Uint16Array; len: Uint8Array } {
  const code = new Uint16Array(256);
  const len = new Uint8Array(256);
  let p = 0;
  let codeVal = 0;
  for (let l = 1; l <= 16; l++) {
    const count = nrcodes[l]!;
    for (let i = 0; i < count; i++) {
      const sym = values[p++]!;
      code[sym] = codeVal;
      len[sym] = l;
      codeVal++;
    }
    codeVal <<= 1;
  }
  return { code, len };
}

// JPEG Annex K: reserve a dummy symbol so no code consists entirely of ones,
// then redistribute overlong codes to the JPEG limit of 16 bits.
function optimizedTable(histogram: Float64Array) {
  const frequencies = [...histogram, 1];
  const sizes = new Uint16Array(257), next = new Int16Array(257).fill(-1);
  for (;;) {
    let first = -1, second = -1;
    for (let i = 0; i < frequencies.length; i++) {
      if (!frequencies[i]) continue;
      if (first < 0 || frequencies[i]! <= frequencies[first]!) { second = first; first = i; }
      else if (second < 0 || frequencies[i]! <= frequencies[second]!) second = i;
    }
    if (second < 0) break;
    frequencies[first]! += frequencies[second]!;
    frequencies[second] = 0;
    let tail = first;
    sizes[tail]!++;
    while (next[tail] !== -1) { tail = next[tail]!; sizes[tail]!++; }
    next[tail] = second;
    tail = second;
    sizes[tail]!++;
    while (next[tail] !== -1) { tail = next[tail]!; sizes[tail]!++; }
  }
  const counts = new Uint16Array(257);
  for (const size of sizes) if (size) counts[size]!++;
  for (let i = 256; i > 16; i--) while (counts[i]! > 0) {
    let j = i - 2;
    while (!counts[j]) j--;
    counts[i]! -= 2; counts[i - 1]!++; counts[j + 1]! += 2; counts[j]!--;
  }
  let longest = 16;
  while (!counts[longest]) longest--;
  counts[longest]!--; // Remove the dummy symbol's code.
  const values = Uint8Array.from(Array.from({ length: 256 }, (_, i) => i)
    .filter(i => sizes[i]! > 0).sort((a, b) => sizes[a]! - sizes[b]! || a - b));
  return { counts: Uint8Array.from(counts.subarray(0, 17)), values };
}

const INV_ZIGZAG = (() => {
  const inv = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    inv[ZIGZAG[i]!] = i;
  }
  return inv;
})();

const FDCT_TEMP = new Int32Array(64);

// IJG's fast integer DCT, used by ImageMagick's default JPEG encoder.
// Multiplications truncate at eight fractional bits in both passes.
const AAN_SCALES = new Int32Array([
  16384,22725,21407,19266,16384,12873,8867,4520,
  22725,31521,29692,26722,22725,17855,12299,6270,
  21407,29692,27969,25172,21407,16819,11585,5906,
  19266,26722,25172,22654,19266,15137,10426,5315,
  16384,22725,21407,19266,16384,12873,8867,4520,
  12873,17855,16819,15137,12873,10114,6967,3552,
  8867,12299,11585,10426,8867,6967,4799,2446,
  4520,6270,5906,5315,4520,3552,2446,1247
]);
function fdct8x8(block: Float64Array, quant: Uint8Array, outZigZag: Int32Array): void {
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < 8; i++) {
      const at = (j: number) => pass === 0 ? i * 8 + j : j * 8 + i;
      const input = pass === 0 ? block : FDCT_TEMP;
      const t0 = input[at(0)]! + input[at(7)]!, t7 = input[at(0)]! - input[at(7)]!;
      const t1 = input[at(1)]! + input[at(6)]!, t6 = input[at(1)]! - input[at(6)]!;
      const t2 = input[at(2)]! + input[at(5)]!, t5 = input[at(2)]! - input[at(5)]!;
      const t3 = input[at(3)]! + input[at(4)]!, t4 = input[at(3)]! - input[at(4)]!;
      const t10 = t0 + t3, t13 = t0 - t3, t11 = t1 + t2, t12 = t1 - t2;
      FDCT_TEMP[at(0)] = t10 + t11;
      FDCT_TEMP[at(4)] = t10 - t11;
      const z1 = ((t12 + t13) * 181) >> 8;
      FDCT_TEMP[at(2)] = t13 + z1;
      FDCT_TEMP[at(6)] = t13 - z1;
      const o10 = t4 + t5, o11 = t5 + t6, o12 = t6 + t7;
      const z5 = ((o10 - o12) * 98) >> 8;
      const z2 = ((o10 * 139) >> 8) + z5;
      const z4 = ((o12 * 334) >> 8) + z5;
      const z3 = (o11 * 181) >> 8;
      const z11 = t7 + z3, z13 = t7 - z3;
      FDCT_TEMP[at(5)] = z13 + z2;
      FDCT_TEMP[at(3)] = z13 - z2;
      FDCT_TEMP[at(1)] = z11 + z4;
      FDCT_TEMP[at(7)] = z11 - z4;
    }
  }
  for (let i = 0; i < 64; i++) {
    const zig = INV_ZIGZAG[i]!, value = FDCT_TEMP[i]!;
    const divisor = (quant[zig]! * AAN_SCALES[i]! + 1024) >> 11;
    const magnitude = Math.floor((Math.abs(value) + Math.floor(divisor / 2)) / divisor);
    outZigZag[zig] = value < 0 ? -magnitude : magnitude;
  }
}

// IJG's accurate integer transform retains two bits between passes and
// rounds fixed-point products only after each complete one-dimensional DCT.
function fdctInteger(block: Float64Array, quant: Uint8Array, out: Int32Array): void {
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < 8; i++) {
    const at = (j: number) => pass === 0 ? i * 8 + j : j * 8 + i;
    const input = pass === 0 ? block : FDCT_TEMP;
    const t0 = input[at(0)]! + input[at(7)]!, t7 = input[at(0)]! - input[at(7)]!;
    const t1 = input[at(1)]! + input[at(6)]!, t6 = input[at(1)]! - input[at(6)]!;
    const t2 = input[at(2)]! + input[at(5)]!, t5 = input[at(2)]! - input[at(5)]!;
    const t3 = input[at(3)]! + input[at(4)]!, t4 = input[at(3)]! - input[at(4)]!;
    const t10 = t0 + t3, t13 = t0 - t3, t11 = t1 + t2, t12 = t1 - t2;
    const shift = pass === 0 ? 11 : 15;
    const descale = (v: number) => Math.floor((v + 2 ** (shift - 1)) / 2 ** shift);
    FDCT_TEMP[at(0)] = pass === 0 ? (t10 + t11) * 4 : (t10 + t11 + 2) >> 2;
    FDCT_TEMP[at(4)] = pass === 0 ? (t10 - t11) * 4 : (t10 - t11 + 2) >> 2;
    const z1 = (t12 + t13) * 4433;
    FDCT_TEMP[at(2)] = descale(z1 + t13 * 6270);
    FDCT_TEMP[at(6)] = descale(z1 - t12 * 15137);
    const z5 = (t4 + t6 + t5 + t7) * 9633;
    const z3 = (t4 + t6) * -16069 + z5, z4 = (t5 + t7) * -3196 + z5;
    const z11 = (t4 + t7) * -7373, z2 = (t5 + t6) * -20995;
    FDCT_TEMP[at(7)] = descale(t4 * 2446 + z11 + z3);
    FDCT_TEMP[at(5)] = descale(t5 * 16819 + z2 + z4);
    FDCT_TEMP[at(3)] = descale(t6 * 25172 + z2 + z3);
    FDCT_TEMP[at(1)] = descale(t7 * 12299 + z11 + z4);
  }
  for (let i = 0; i < 64; i++) {
    const zig = INV_ZIGZAG[i]!, value = FDCT_TEMP[i]!, divisor = quant[zig]! * 8;
    const magnitude = Math.floor((Math.abs(value) + divisor / 2) / divisor);
    out[zig] = value < 0 ? -magnitude : magnitude;
  }
}

const FDCT_FLOAT = new Float32Array(64);
const AAN_FLOAT = [1, 1.387039845, 1.306562965, 1.175875602, 1, 0.785694958, 0.541196100, 0.275899379];
function fdctFloat(block: Float64Array, quant: Uint8Array, out: Int32Array): void {
  const f = Math.fround;
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < 8; i++) {
    const at = (j: number) => pass === 0 ? i * 8 + j : j * 8 + i;
    const input = pass === 0 ? block : FDCT_FLOAT;
    const t0 = f(input[at(0)]! + input[at(7)]!), t7 = f(input[at(0)]! - input[at(7)]!);
    const t1 = f(input[at(1)]! + input[at(6)]!), t6 = f(input[at(1)]! - input[at(6)]!);
    const t2 = f(input[at(2)]! + input[at(5)]!), t5 = f(input[at(2)]! - input[at(5)]!);
    const t3 = f(input[at(3)]! + input[at(4)]!), t4 = f(input[at(3)]! - input[at(4)]!);
    const t10 = f(t0 + t3), t13 = f(t0 - t3), t11 = f(t1 + t2), t12 = f(t1 - t2);
    FDCT_FLOAT[at(0)] = t10 + t11;
    FDCT_FLOAT[at(4)] = t10 - t11;
    const z1 = f(f(t12 + t13) * f(0.707106781));
    FDCT_FLOAT[at(2)] = t13 + z1;
    FDCT_FLOAT[at(6)] = t13 - z1;
    const o10 = f(t4 + t5), o11 = f(t5 + t6), o12 = f(t6 + t7);
    const z5 = f(f(o10 - o12) * f(0.382683433));
    const z2 = f(f(o10 * f(0.541196100)) + z5), z4 = f(f(o12 * f(1.306562965)) + z5);
    const z3 = f(o11 * f(0.707106781)), z11 = f(t7 + z3), z13 = f(t7 - z3);
    FDCT_FLOAT[at(5)] = z13 + z2;
    FDCT_FLOAT[at(3)] = z13 - z2;
    FDCT_FLOAT[at(1)] = z11 + z4;
    FDCT_FLOAT[at(7)] = z11 - z4;
  }
  for (let i = 0; i < 64; i++) {
    const zig = INV_ZIGZAG[i]!;
    const reciprocal = f(1 / (quant[zig]! * AAN_FLOAT[i >> 3]! * AAN_FLOAT[i & 7]! * 8));
    out[zig] = Math.trunc(f(f(FDCT_FLOAT[i]! * reciprocal) + f(16384.5))) - 16384;
  }
}

function scaleQuantTable(base: Uint8Array, quality: number): Uint8Array {
  const q = Math.max(1, Math.min(100, Math.round(quality)));
  const scale = q < 50 ? Math.floor(5000 / q) : 200 - q * 2;
  const out = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    const zIdx = ZIGZAG[i]!;
    const v = Math.floor((base[zIdx]! * scale + 50) / 100);
    out[i] = v < 1 ? 1 : v > 255 ? 255 : v;
  }
  return out;
}

export function createJpegEncoder(
  img: Pick<RgbaImage,"space"|"width"|"height"|"density"|"resolution"|"orientation"|"exif"|"icc"|"properties">,
  options?: {
    readonly synthesizeExif?: boolean;
    readonly jpegProgressive?: boolean;
    readonly jpegArithmeticCoding?: boolean;
    readonly jpegOptimizeCoding?: boolean;
    readonly jpegDctMethod?: "integer" | "float" | "fastest";
    readonly jpegRestartInterval?: number;
    readonly quality?: number;
    readonly samplingFactor?: string;
    readonly chromaSubsampling?: "4:2:0" | "4:4:4";
    readonly density?: number;
    readonly orientation?: number;
  }
){
  const { width, height } = img;
  if(!Number.isSafeInteger(width)||width<=0||width>65535||!Number.isSafeInteger(height)||height<=0||height>65535)throw new RangeError("JPEG dimensions exceed 16-bit frame fields");
  const aliases: Record<string, string> = { "4:4:4": "1x1", "4:2:2": "2x1", "4:2:0": "2x2", "4:1:1": "4x1" };
  const grayscale = img.space === "b-w" || img.space === "grey16";
  const cmyk = img.space === "cmyk";
  const components = grayscale ? 1 : cmyk ? 4 : 3;
  const spec = options?.samplingFactor ?? (cmyk ? "1x1" : options?.chromaSubsampling) ?? "1x1";
  const factors = (aliases[spec] ?? spec).split(",").map(value => value.split("x").map(Number));
  while (factors.length < components) factors.push([1, 1]);
  if (grayscale) factors.splice(0, factors.length, [1, 1]);
  const maxH = Math.max(...factors.map(value => value[0]!));
  const maxV = Math.max(...factors.map(value => value[1]!));
  if (factors.length !== components || factors.some(value => value.length !== 2 || value.some(n => !Number.isInteger(n) || n < 1 || n > 4) || maxH % value[0]! !== 0 || maxV % value[1]! !== 0) || factors.reduce((sum, value) => sum + value[0]! * value[1]!, 0) > 10) {
    throw new RangeError(`Invalid JPEG sampling factor: ${spec}`);
  }
  let blockWidth = maxH * 8, blockHeight = maxV * 8;
  let scan = 0;
  const progressive = options?.jpegProgressive === true;
  const transform = options?.jpegDctMethod === "integer" ? fdctInteger : options?.jpegDctMethod === "float" ? fdctFloat : fdct8x8;
  const arithmetic = options?.jpegArithmeticCoding === true;
  let gathering = !arithmetic && options?.jpegOptimizeCoding === true;
  const tables = [
    [STD_DC_LUMA_NRCODES, STD_DC_LUMA_VALUES],
    [STD_AC_LUMA_NRCODES, STD_AC_LUMA_VALUES],
    [STD_DC_CHROMA_NRCODES, STD_DC_CHROMA_VALUES],
    [STD_AC_CHROMA_NRCODES, STD_AC_CHROMA_VALUES]
  ].slice(0, grayscale ? 2 : 4).map(([counts, values]) => ({ counts: counts!, values: values!, ...buildEncodeTable(counts!, values!), histogram: new Float64Array(256) }));
  const restartInterval = options?.jpegRestartInterval ?? 0;
  if (!Number.isInteger(restartInterval) || restartInterval < 0 || restartInterval > 65535) throw new RangeError("JPEG restart interval must be an integer from 0 to 65535");
  let mcuCount = 0, restartCount = 0;
  const quality = options?.quality ?? 85;
  const density = Math.max(1, Math.round(options?.density ?? img.density ?? 72));
  const resolution = options?.density === undefined ? img.resolution : undefined;
  const scale = resolution?.unit === "meter" ? 100 : 1;
  const xDensity = resolution ? Math.round(resolution.x / scale) : options?.density === undefined ? 1 : density;
  const yDensity = resolution ? Math.round(resolution.y / scale) : options?.density === undefined ? 1 : density;
  const orientation = options?.orientation ?? img.orientation;

  const lumaQ = scaleQuantTable(STD_LUMA_QUANT, quality);
  const chromaQ = scaleQuantTable(STD_CHROMA_QUANT, quality);

  const bytes: number[] = [];
  const arithmeticEncoder = arithmetic ? createJpegArithmeticEncoder(bytes) : undefined;
  const writeU16 = (v: number) => {
    bytes.push((v >>> 8) & 0xff, v & 0xff);
  };
  const writeSegment = (marker: number, payload: Uint8Array) => {
    if (payload.length > 65533) throw new Error("JPEG segment exceeds 65533 bytes");
    bytes.push(0xff, marker);
    writeU16(payload.length + 2);
    for (let i = 0; i < payload.length; i++) bytes.push(payload[i]!);
  };

  // SOI
  bytes.push(0xff, 0xd8);

  // APP0 JFIF
  const app0 = new Uint8Array([
    0x4a, 0x46, 0x49, 0x46, 0x00,
    0x01, 0x01,
    resolution?.unit === "meter" || resolution?.unit === "cm" ? 2 : resolution?.unit === "inch" || options?.density !== undefined ? 1 : 0, // density units
    (xDensity >>> 8) & 0xff, xDensity & 0xff,
    (yDensity >>> 8) & 0xff, yDensity & 0xff,
    0x00, 0x00
  ]);
  if (cmyk) writeSegment(0xee, new Uint8Array([65, 100, 111, 98, 101, 0, 100, 0, 0, 0, 0, 0]));
  else writeSegment(0xe0, app0);

  if (img.properties?.comment !== undefined) {
    const comment = new TextEncoder().encode(img.properties.comment);
    for (let offset = 0; offset < comment.length;) {
      let end = Math.min(comment.length, offset + 65533);
      while (end < comment.length && (comment[end]! & 0xc0) === 0x80) end--;
      writeSegment(0xfe, comment.subarray(offset, end)); offset = end;
    }
  }
  if (img.icc) {
    const count = Math.ceil(img.icc.length / 65519);
    if (count > 255) throw new Error("ICC profile exceeds JPEG segment limit");
    for (let index = 0; index < count; index++) {
      const part = img.icc.subarray(index * 65519, (index + 1) * 65519);
      const payload = new Uint8Array(14 + part.length);
      payload.set(new TextEncoder().encode("ICC_PROFILE\0"));
      payload[12] = index + 1; payload[13] = count; payload.set(part, 14);
      writeSegment(0xe2, payload);
    }
  }

  // Optional APP1 Exif
  if (img.exif || (options?.synthesizeExif !== false && orientation !== undefined && orientation >= 1 && orientation <= 8)) {
    writeSegment(0xe1, buildExifApp1Segment({ exif: img.exif, orientation, density, resolution }));
  }

  // DQT
  const dqt = new Uint8Array(grayscale ? 65 : 130);
  dqt[0] = 0x00;
  dqt.set(lumaQ, 1);
  if (!grayscale) {
    dqt[65] = 0x01;
    dqt.set(chromaQ, 66);
  }
  writeSegment(0xdb, dqt);

  // SOF0 (baseline) or SOF2 (progressive DCT)
  const sof0 = new Uint8Array([
    8,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    components,
    ...factors.flatMap(([h, v], index) => [index + 1, (h! << 4) | v!, index === 0 ? 0 : 1])
  ]);
  writeSegment(arithmetic ? (progressive ? 0xca : 0xc9) : (progressive ? 0xc2 : 0xc0), sof0);

  const headerPrefix = bytes.splice(0);
  const writeScanHeaders = () => {
    for (const byte of headerPrefix) bytes.push(byte);
    // DHT
    const dhtParts: number[] = [];
    const appendDht = (tcTh: number, nrcodes: Uint8Array, values: Uint8Array) => {
      dhtParts.push(tcTh);
      for (let i = 1; i <= 16; i++) dhtParts.push(nrcodes[i]!);
      for (let i = 0; i < values.length; i++) dhtParts.push(values[i]!);
    };
    for (const [index, table] of tables.entries()) appendDht([0x00, 0x10, 0x01, 0x11][index]!, table.counts, table.values);
    if (arithmetic) writeSegment(0xcc, new Uint8Array([0, 0x10, 1, 0x10, 0x10, 5, 0x11, 5]));
    else writeSegment(0xc4, new Uint8Array(dhtParts));

    if (restartInterval > 0) writeSegment(0xdd, new Uint8Array([restartInterval >>> 8, restartInterval & 255]));

    // SOS
    const sos = new Uint8Array([
      components,
      ...factors.flatMap((_, index) => [index + 1, index === 0 ? 0 : 0x11]),
      0, progressive ? 0 : 63, 0
    ]);
    writeSegment(0xda, sos);
  };
  if (!gathering) writeScanHeaders();

  let bitBuf = 0;
  let bitCnt = 0;
  const writeBits = (code: number, len: number) => {
    if (gathering) return;
    bitBuf = (bitBuf << len) | (code & ((1 << len) - 1));
    bitCnt += len;
    while (bitCnt >= 8) {
      bitCnt -= 8;
      const b = (bitBuf >>> bitCnt) & 0xff;
      bytes.push(b);
      if (b === 0xff) bytes.push(0x00);
    }
  };

  const writeSymbol = (table: typeof tables[number], symbol: number) => {
    if (gathering) table.histogram[symbol]!++;
    else writeBits(table.code[symbol]!, table.len[symbol]!);
  };
  const encodeBlock = (
    zz: Int32Array,
    prevDc: number,
    dcTab: typeof tables[number],
    acTab: typeof tables[number]
  ): number => {
    if (scan === 0) {
      const diff = zz[0]! - prevDc;
      if (diff === 0) {
        writeSymbol(dcTab, 0);
      } else {
        const abs = diff < 0 ? -diff : diff;
        const cat = 32 - Math.clz32(abs);
        const bits = diff > 0 ? diff : (1 << cat) - 1 + diff;
        writeSymbol(dcTab, cat);
        writeBits(bits, cat);
      }
    }
    if (progressive && scan === 0) return zz[0]!;
    let zeroRun = 0;
    for (let k = 1; k < 64; k++) {
      const v = zz[k]!;
      if (v === 0) {
        zeroRun++;
      } else {
        while (zeroRun >= 16) {
          writeSymbol(acTab, 0xf0);
          zeroRun -= 16;
        }
        const abs = v < 0 ? -v : v;
        const cat = 32 - Math.clz32(abs);
        const bits = v > 0 ? v : (1 << cat) - 1 + v;
        const sym = (zeroRun << 4) | cat;
        writeSymbol(acTab, sym);
        writeBits(bits, cat);
        zeroRun = 0;
      }
    }
    if (zeroRun > 0) {
      writeSymbol(acTab, 0x00);
    }
    return zz[0]!;
  };

  const samples = new Float64Array(64);
  const zzOut = new Int32Array(64);
  const dc = new Array<number>(components).fill(0);
  const take=()=>{const chunk=gathering ? new Uint8Array() : Uint8Array.from(bytes);bytes.length=0;return chunk;};
  return {
    get blockWidth() { return blockWidth; },
    get blockHeight() { return blockHeight; },
    scanCount: (progressive ? components + 1 : 1) * (gathering ? 2 : 1),
    // DC is interleaved; each AC scan traverses one component in block-row order.
    nextScan() {
      arithmeticEncoder?.finish();
      arithmeticEncoder?.reset();
      if (bitCnt > 0) writeBits((1 << (8 - bitCnt)) - 1, 8 - bitCnt);
      bitBuf = 0; bitCnt = 0;
      mcuCount = 0; restartCount = 0; dc.fill(0);
      scan++;
      if (gathering && scan === (progressive ? components + 1 : 1)) {
        for (const table of tables) {
          const optimized = optimizedTable(table.histogram);
          Object.assign(table, optimized, buildEncodeTable(optimized.counts, optimized.values));
        }
        gathering = false;
        scan = 0; blockWidth = maxH * 8; blockHeight = maxV * 8;
        writeScanHeaders();
        return take();
      }
      const component = scan - 1;
      blockWidth = 8 * maxH / factors[component]![0]!;
      blockHeight = 8 * maxV / factors[component]![1]!;
      writeSegment(0xda, new Uint8Array([1, component + 1, component === 0 ? 0 : 0x11, 1, 63, 0]));
      return take();
    },
    header:take(),
    block(data:Uint8Array) {
      if(data.length!==blockWidth*blockHeight*4)throw new RangeError(`JPEG block must contain ${blockWidth * blockHeight} RGBA pixels`);
      if (restartInterval > 0 && mcuCount > 0 && mcuCount % restartInterval === 0) {
        arithmeticEncoder?.finish();
        arithmeticEncoder?.reset();
        if (bitCnt > 0) writeBits((1 << (8 - bitCnt)) - 1, 8 - bitCnt);
        bitBuf = 0; bitCnt = 0;
        bytes.push(0xff, 0xd0 + restartCount % 8);
        restartCount++;
        dc.fill(0);
      }
      mcuCount++;
      for (let component = 0; component < components; component++) {
        if (scan > 0 && component !== scan - 1) continue;
        const [h, v] = factors[component]!;
        const scaleX = maxH / h!, scaleY = maxV / v!;
        for (let by = 0; by < (scan > 0 ? 1 : v!); by++) for (let bx = 0; bx < (scan > 0 ? 1 : h!); bx++) {
          for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
            let sum = 0;
            for (let dy = 0; dy < scaleY; dy++) for (let dx = 0; dx < scaleX; dx++) {
              const idx = (((by * 8 + y) * scaleY + dy) * blockWidth + (bx * 8 + x) * scaleX + dx) * 4;
              const a = data[idx + 3]! / 255;
              const r = data[idx]! * a + 255 * (1 - a);
              const g = data[idx + 1]! * a + 255 * (1 - a);
              const b = data[idx + 2]! * a + 255 * (1 - a);
              if (cmyk) {
                // Adobe transform 0 stores inverted CMYK; backing pixels remain RGBA.
                const black = Math.max(r, g, b);
                sum += (component === 3 ? Math.round(black) : black === 0 ? 255 : Math.round((component === 0 ? r : component === 1 ? g : b) * 255 / black)) - 128;
                continue;
              }
              // libjpeg rounds RGB to 8-bit YCbCr before the forward DCT.
              sum += component === 0
                ? Math.floor((19595 * r + 38470 * g + 7471 * b + 32768) / 65536) - 128
                : component === 1
                  ? Math.floor((-11059 * r - 21709 * g + 32768 * b + 32767) / 65536)
                  : Math.floor((32768 * r - 27439 * g - 5329 * b + 32767) / 65536);
            }
            samples[y * 8 + x] = sum / (scaleX * scaleY);
          }
          transform(samples, component === 0 ? lumaQ : chromaQ, zzOut);
          if (arithmeticEncoder) {
            arithmeticEncoder.block(zzOut, dc[component]!, component, scan === 0, !progressive || scan > 0);
            dc[component] = zzOut[0]!;
          } else dc[component] = encodeBlock(zzOut, dc[component]!, tables[component === 0 ? 0 : 2]!, tables[component === 0 ? 1 : 3]!);
        }
      }
      return take();
    },
    finish(){
  arithmeticEncoder?.finish();
  if (bitCnt > 0) {
    writeBits((1 << (8 - bitCnt)) - 1, 8 - bitCnt);
  }

  // EOI
  bytes.push(0xff, 0xd9);
  return take();
    }
  };
}

/** Explicit in-memory convenience; file output uses caller-backed blocks. */
export function encodeJpegImage(image:RgbaImage,options?:Parameters<typeof createJpegEncoder>[1]):Uint8Array {
 const encoder = createJpegEncoder(image, options), chunks = [encoder.header];
 for (let scan = 0; scan < encoder.scanCount; scan++) {
   if (scan > 0) chunks.push(encoder.nextScan());
   const block = new Uint8Array(encoder.blockWidth * encoder.blockHeight * 4);
   const { width, height, data } = image;
   for (let by = 0; by < height; by += encoder.blockHeight) for (let bx = 0; bx < width; bx += encoder.blockWidth) {
     for (let y = 0; y < encoder.blockHeight; y++) for (let x = 0; x < encoder.blockWidth; x++) {
       const at = (Math.min(height - 1, by + y) * width + Math.min(width - 1, bx + x)) * 4;
       block.set(data.subarray(at, at + 4), (y * encoder.blockWidth + x) * 4);
     }
     chunks.push(encoder.block(block));
   }
 }
 chunks.push(encoder.finish());
 const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
 let offset = 0;
 for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
 return output;
}
