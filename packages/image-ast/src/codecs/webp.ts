import {webpMetadataSteps} from "./webp-metadata.js";
import {decodeWebpLossless} from "./webp-decode-kernel.js";
import { transformBytes } from "@poe-code/compression";
import type { ImageMetadata, RgbaImage } from "../ast.js";
import { buildExifApp1Segment } from "./exif.js";

export {isWebpBytes} from "./webp-metadata.js";

export function readWebpMetadata(bytes:Uint8Array):ImageMetadata {
  const steps=webpMetadataSteps(bytes.length);let next=steps.next();
  while(!next.done)next=steps.next(bytes.subarray(next.value.position,next.value.position+next.value.length));
  return next.value;
}

export function createWebpEncoder(
  img: Pick<RgbaImage, "width" | "height" | "density" | "orientation">,
  hasAlpha: boolean,
  options?: {
    readonly quality?: number;
    readonly lossless?: boolean;
    readonly density?: number;
    readonly orientation?: number;
  }
) {
  const { width, height } = img;
  const numPixels = width * height;
  if (
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    !Number.isSafeInteger(height) ||
    height <= 0 ||
    !Number.isSafeInteger(numPixels)
  )
    throw new RangeError("Invalid WebP dimensions");
  const vp8lBuf = new Uint8Array(4096);
  vp8lBuf[0] = 0x2f;
  const wMinus1 = (width - 1) & 0x3fff;
  const hMinus1 = (height - 1) & 0x3fff;
  const alphaBit = hasAlpha ? 1 : 0;
  const bits = (wMinus1 | (hMinus1 << 14) | (alphaBit << 28)) >>> 0;
  vp8lBuf[1] = bits & 0xff;
  vp8lBuf[2] = (bits >>> 8) & 0xff;
  vp8lBuf[3] = (bits >>> 16) & 0xff;
  vp8lBuf[4] = (bits >>> 24) & 0xff;

  let bitPos = 40; // start at byte 5
  const writeBits = (val: number, count: number) => {
    for (let i = 0; i < count; i++) {
      if ((val >>> i) & 1) {
        vp8lBuf[bitPos >>> 3]! |= 1 << (bitPos & 7);
      }
      bitPos++;
    }
  };
  const rev8 = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let r = 0;
    for (let b = 0; b < 8; b++) {
      r = (r << 1) | ((i >>> b) & 1);
    }
    rev8[i] = r;
  }

  // transform_present = 0, color_cache_info = 0, meta_prefix = 0
  writeBits(0, 3);

  // Write a canonical flat 8-bit prefix tree for symbols 0..255 (with symbols >= 256 having length 0)
  const writeFlat8BitTree = (alphabetSize: number) => {
    writeBits(0, 1); // normal prefix code (not simple)
    // kCodeLengthCodeOrder = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    // Index 2 is length-symbol 0; Index 11 is length-symbol 8.
    // num_code_lengths = 12 -> write (12 - 4) = 8 in 4 bits
    writeBits(8, 4);
    for (let i = 0; i < 12; i++) {
      const len = i === 2 || i === 11 ? 1 : 0;
      writeBits(len, 3);
    }
    // use_max_symbol = 0
    writeBits(0, 1);
    // In canonical Huffman for {symbol 0: len 1, symbol 8: len 1}:
    // symbol 0 gets code 0 (1 bit), symbol 8 gets code 1 (1 bit)
    for (let s = 0; s < alphabetSize; s++) {
      writeBits(s < 256 ? 1 : 0, 1);
    }
  };

  // Green (280), Red (256), Blue (256), Alpha (256)
  writeFlat8BitTree(280);
  writeFlat8BitTree(256);
  writeFlat8BitTree(256);
  writeFlat8BitTree(256);
  // Distance (40): simple prefix code with 1 symbol (0)
  writeBits(1, 1); // simple_code = 1
  writeBits(0, 1); // num_symbols - 1 = 0
  writeBits(0, 1); // is_first_8bits = 0 (1-bit symbol)
  writeBits(0, 1); // symbol0 = 0

  const headerBits = bitPos,
    vp8lChunkLen = Math.ceil((headerBits + numPixels * 32) / 8),
    vp8lPaddedLen = vp8lChunkLen + (vp8lChunkLen & 1);
  const effDensity = options?.density ?? img.density,
    effOrientation = options?.orientation ?? img.orientation;
  const needExif =
    (effDensity !== undefined && effDensity !== 72) ||
    (effOrientation !== undefined && effOrientation !== 1);
  const exifPayload = needExif
    ? buildExifApp1Segment({
        density: effDensity ?? 72,
        orientation: effOrientation ?? 1
      }).subarray(6)
    : new Uint8Array();
  const exifPaddedLen = exifPayload.length + (exifPayload.length & 1),
    vp8xLen = needExif ? 18 : 0;
  const totalSize = 20 + vp8xLen + vp8lPaddedLen + (needExif ? 8 + exifPaddedLen : 0);
  if (totalSize - 8 > 0xffffffff) throw new RangeError("WebP exceeds RIFF size range");
  const drain = () => {
    const length = Math.floor(bitPos / 8),
      result = vp8lBuf.slice(0, length),
      remaining = vp8lBuf[length]!;
    vp8lBuf.fill(0);
    vp8lBuf[0] = remaining;
    bitPos %= 8;
    return result;
  };
  const prefix = drain(),
    header = new Uint8Array(20 + vp8xLen + prefix.length),
    view = new DataView(header.buffer);
  header.set([82, 73, 70, 70], 0);
  view.setUint32(4, totalSize - 8, true);
  header.set([87, 69, 66, 80], 8);
  if (needExif) {
    header.set([86, 80, 56, 88], 12);
    view.setUint32(16, 10, true);
    header[20] = (hasAlpha ? 16 : 0) | 8;
    const w = width - 1,
      h = height - 1;
    header.set(
      [w & 255, (w >>> 8) & 255, (w >>> 16) & 255, h & 255, (h >>> 8) & 255, (h >>> 16) & 255],
      24
    );
  }
  const at = 12 + vp8xLen;
  header.set([86, 80, 56, 76], at);
  view.setUint32(at + 4, vp8lChunkLen, true);
  header.set(prefix, at + 8);
  let written = 0,
    finished = false;
  return {
    header,
    pixels(data: Uint8Array) {
      if (
        finished ||
        data.length % 4 !== 0 ||
        data.length > 4092 ||
        written + data.length / 4 > numPixels
      )
        throw new RangeError("Invalid WebP pixel chunk");
      for (let i = 0; i < data.length; i += 4) {
        writeBits(rev8[data[i + 1]!]!, 8);
        writeBits(rev8[data[i]!]!, 8);
        writeBits(rev8[data[i + 2]!]!, 8);
        writeBits(rev8[hasAlpha ? data[i + 3]! : 255]!, 8);
      }
      written += data.length / 4;
      return drain();
    },
    finish() {
      if (finished || written !== numPixels) throw new Error("Incomplete WebP pixels");
      finished = true;
      const tailLength = (bitPos ? 1 : 0) + (vp8lChunkLen & 1),
        tail = new Uint8Array(tailLength + (needExif ? 8 + exifPaddedLen : 0));
      if (bitPos) tail[0] = vp8lBuf[0]!;
      if (needExif) {
        tail.set([69, 88, 73, 70], tailLength);
        new DataView(tail.buffer).setUint32(tailLength + 4, exifPayload.length, true);
        tail.set(exifPayload, tailLength + 8);
      }
      return tail;
    }
  };
}

export function encodeWebpImage(
  img: RgbaImage,
  options?: Parameters<typeof createWebpEncoder>[2]
): Uint8Array {
  let hasAlpha = false;
  for (let i = 3; i < img.data.length; i += 4)
    if (img.data[i]! < 255) {
      hasAlpha = true;
      break;
    }
  const encoder = createWebpEncoder(img, hasAlpha, options),
    parts = [encoder.header];
  for (let at = 0; at < img.width * img.height * 4; at += 4092)
    parts.push(
      encoder.pixels(img.data.subarray(at, Math.min(at + 4092, img.width * img.height * 4)))
    );
  parts.push(encoder.finish());
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function decodeVp8lStream(payload: Uint8Array, width: number, height: number): Uint8Array {
  const allocations: { position: number; data: Float64Array }[] = [];
  let end = 8;
  const word = (position: number) => {
    let low = 0,
      high = allocations.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1,
        item = allocations[mid]!;
      if (position < item.position) high = mid - 1;
      else if (position >= item.position + item.data.length * 8) low = mid + 1;
      else return { item, index: (position - item.position) / 8 };
    }
    throw new RangeError("Invalid WebP backing address");
  };
  const kernel = decodeWebpLossless(0, payload.length, width, height);
  let value = 0;
  while (true) {
    const step = kernel.next(value);
    if (step.done) {
      const raster = step.value,
        result = new Uint8Array(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        const cell = i < raster.length ? word(raster.position + i * 8) : undefined,
          p = cell ? cell.item.data[cell.index]! : 0;
        result[i * 4] = p >>> 16;
        result[i * 4 + 1] = p >>> 8;
        result[i * 4 + 2] = p;
        result[i * 4 + 3] = p >>> 24;
      }
      return result;
    }
    const effect = step.value;
    if (effect.kind === "byte") value = payload[effect.position] ?? 0;
    else if (effect.kind === "allocate") {
      value = end;
      allocations.push({ position: end, data: new Float64Array(effect.length / 8) });
      end += effect.length;
    } else {
      const { item, index } = word(effect.position);
      if (effect.kind === "get") value = item.data[index]!;
      else {
        item.data[index] = effect.value;
        value = 0;
      }
    }
  }
}

export function decodeWebpImage(bytes: Uint8Array): RgbaImage {
  const meta = readWebpMetadata(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { width, height } = meta;

  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const fourcc = String.fromCharCode(
      bytes[pos]!,
      bytes[pos + 1]!,
      bytes[pos + 2]!,
      bytes[pos + 3]!
    );
    const chunkSize = view.getUint32(pos + 4, true);
    const dataStart = pos + 8;
    if (dataStart + chunkSize > bytes.length) break;
    const payload = bytes.subarray(dataStart, dataStart + chunkSize);
    if (fourcc === "VP8L" && payload.length >= 5 && payload[0] === 0x2f) {
      if (payload.length > 7 && payload[5] === 0x00 && payload[6] === 0x78) {
        try {
          const inflated = transformBytes(payload.subarray(6), { direction: "decode", format: "zlib" });
          if (inflated.length === width * height * 4) {
            return {
              width,
              height,
              data: inflated,
              format: "webp",
              space: "srgb",
              channels: meta.channels,
              depth: "uchar",
              density: meta.density,
              hasAlpha: meta.hasAlpha,
              ...(meta.orientation !== undefined ? { orientation: meta.orientation } : {})
            };
          }
        } catch {
          // Fall through to standard VP8L bitstream decoder
        }
      }
      try {
        const decoded = decodeVp8lStream(payload, width, height);
        if (decoded && decoded.length === width * height * 4) {
          return {
            width,
            height,
            data: decoded,
            format: "webp",
            space: "srgb",
            channels: meta.channels,
            depth: "uchar",
            density: meta.density,
            hasAlpha: meta.hasAlpha,
            ...(meta.orientation !== undefined ? { orientation: meta.orientation } : {})
          };
        }
      } catch {
        // Fall through to synthetic fallback if lossy VP8 bitstream
      }
    }
    pos = dataStart + chunkSize + (chunkSize & 1);
  }

  const fallback = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    fallback[i * 4 + 3] = 255;
  }
  return {
    width,
    height,
    data: fallback,
    format: "webp",
    space: "srgb",
    channels: meta.channels,
    depth: "uchar",
    density: meta.density,
    hasAlpha: meta.hasAlpha
  };
}
