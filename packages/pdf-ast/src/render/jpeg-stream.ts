import { readBytes } from "@poe-code/safe-fs/contracts";
import { PdfError } from "../errors.js";

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

export function *jpegEncodingProgram(width: number, height: number, quality = 90): Generator<Uint8Array | { rowStart: number; rowCount: number } | undefined, void, Uint8Array | undefined> {
  let work = 0;
  const w = Math.max(1, width);
  const h = Math.max(1, height);
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

  for (const header of [app0, dqt, dht, sof0, sosHeader]) yield header;
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
    const band = (yield { rowStart: my * 8, rowCount: Math.min(8, h - my * 8) })!;
    if (++work % 16384 === 0) yield;
    for (let mx = 0; mx < mcusX; mx++) {
    if (++work % 16384 === 0) yield;
      for (let by = 0; by < 8; by++) {
    if (++work % 16384 === 0) yield;
        const py = Math.min(h - 1, my * 8 + by);
        for (let bx = 0; bx < 8; bx++) {
    if (++work % 16384 === 0) yield;
          const px = Math.min(w - 1, mx * 8 + bx);
          const idx = ((py - my * 8) * w + px) * 4;
          const r = band[idx] ?? 0;
          const g = band[idx + 1] ?? 0;
          const b = band[idx + 2] ?? 0;
          const k = by * 8 + bx;
          blockY[k] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
          blockCb[k] = -0.168736 * r - 0.331264 * g + 0.5 * b;
          blockCr[k] = 0.5 * r - 0.418688 * g - 0.081312 * b;
        }
      }
      dcY = encodeBlock(blockY, dcY);
      dcCb = encodeBlock(blockCb, dcCb);
      dcCr = encodeBlock(blockCr, dcCr);
      if (entropyBytes.length) { yield Uint8Array.from(entropyBytes); entropyBytes.length = 0; }
    }
  }

  if (bitCnt > 0) {
    writeBits((1 << (8 - bitCnt)) - 1, 8 - bitCnt);
  }

  if (entropyBytes.length) yield Uint8Array.from(entropyBytes);
  yield Uint8Array.from([0xff, 0xd9]);
}

function bitLengthAndMag(
  val: number
): { size: number; bits: number } {
  const steps = bitLengthAndMagSteps(val);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export interface PdfJpegChunkOptions {
  readonly quality?: number;
  readonly chunkBytes?: number;
  /** Eight RGBA rows, one output chunk and conservative codec scratch. The
   * caller's current input chunk and shared static tables are additional. */
  readonly maxWorkingBytes?: number;
  readonly maxOutputBytes?: number;
  readonly signal?: AbortSignal;
}
function maximum(value: number | undefined, name: string) {
  if (value === undefined || value === Infinity) return Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid ${name}`);
  return value;
}
/** Sequential JPEG output using one eight-row band and one MCU's entropy.
 * Truncated input is zero-filled, matching the buffered convenience encoder. */
export async function* encodeJpegChunks(width: number, height: number, input: AsyncIterable<Uint8Array>,
  options: PdfJpegChunkOptions = {}): AsyncGenerator<Uint8Array, void, void> {
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 65535)) throw new PdfError("E_LIMIT", "JPEG dimension limit exceeded");
  const chunkBytes = options.chunkBytes ?? 65536;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1) throw new RangeError("Invalid JPEG chunk size");
  const working = maximum(options.maxWorkingBytes, "maxWorkingBytes"), outputLimit = maximum(options.maxOutputBytes, "maxOutputBytes");
  if (width * Math.min(8, height) * 4 + chunkBytes + 65536 > working) throw new PdfError("E_LIMIT", "JPEG working byte limit exceeded");
  if (outputLimit < 328) throw new PdfError("E_LIMIT", "JPEG output byte limit exceeded");
  const { signal } = options; signal?.throwIfAborted();
  const source = readBytes(input, signal)[Symbol.asyncIterator](); const program = jpegEncodingProgram(width, height, options.quality);
  let pending: Uint8Array | undefined; let cursor = 0; let ended = false; let emitted = 0; let failed = false;
  try {
    let step = program.next();
    while (!step.done) {
      signal?.throwIfAborted();
      if (step.value instanceof Uint8Array) {
        if (step.value.length > outputLimit - emitted) throw new PdfError("E_LIMIT", "JPEG output byte limit exceeded");
        emitted += step.value.length;
        for (let at = 0; at < step.value.length; at += chunkBytes) { signal?.throwIfAborted(); yield step.value.slice(at, at + chunkBytes); }
        step = program.next();
      } else if (step.value) {
        const band = new Uint8Array(width * step.value.rowCount * 4); let written = 0;
        while (written < band.length && !ended) {
          signal?.throwIfAborted();
          if (!pending || cursor === pending.length) {
            pending = undefined; const next = await source.next();
            if (next.done) { ended = true; break; }
            pending = next.value; cursor = 0;
          }
          const take = Math.min(pending.length - cursor, band.length - written);
          band.set(pending.subarray(cursor, cursor + take), written); cursor += take; written += take;
        }
        step = program.next(band);
      } else { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted(); step = program.next(); }
    }
  } catch (error) { failed = true; throw error; }
  finally {
    program.return();
    try { await source.return?.(undefined); } catch (error) { if (!failed) await Promise.reject(error); }
  }
}
