import { inflate } from "pako";
import type { ImageFormat, ImageMetadata, RgbaImage } from "../ast.js";

export function isNetpbmBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 7 || bytes[0] !== 0x50) return false; // 'P'
  const m = bytes[1]!;
  if (m < 0x31 || m > 0x36) return false; // '1'..'6'
  const ws = bytes[2]!;
  return ws === 0x20 || ws === 0x0a || ws === 0x0d || ws === 0x09;
}

export function isBmpBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d;
}

export function isTiffBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a))
  );
}

function parseNetpbmHeader(bytes: Uint8Array): {
  magic: string;
  format: ImageFormat;
  width: number;
  height: number;
  maxval: number;
  dataOffset: number;
} {
  const magic = String.fromCharCode(bytes[0]!, bytes[1]!);
  const format: ImageFormat =
    magic === "P1" || magic === "P4"
      ? "pbm"
      : magic === "P2" || magic === "P5"
        ? "pgm"
        : "ppm";
  let pos = 2;
  const tokens: number[] = [];
  const needed = format === "pbm" ? 2 : 3;

  while (pos < bytes.length && tokens.length < needed) {
    while (pos < bytes.length) {
      const c = bytes[pos]!;
      if (c === 0x23) {
        // '#' comment
        while (pos < bytes.length && bytes[pos] !== 0x0a && bytes[pos] !== 0x0d) pos++;
      } else if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) {
        pos++;
      } else {
        break;
      }
    }
    let num = 0;
    let hasDigit = false;
    while (pos < bytes.length && bytes[pos]! >= 0x30 && bytes[pos]! <= 0x39) {
      num = num * 10 + (bytes[pos]! - 0x30);
      hasDigit = true;
      pos++;
    }
    if (!hasDigit) break;
    tokens.push(num);
  }
  // If there is horizontal whitespace followed by a # comment on the final header line, skip to newline
  let look = pos;
  while (look < bytes.length && (bytes[look] === 0x20 || bytes[look] === 0x09)) look++;
  if (look < bytes.length && bytes[look] === 0x23) {
    pos = look;
    while (pos < bytes.length && bytes[pos] !== 0x0a && bytes[pos] !== 0x0d) pos++;
  }
  // Skip the single terminating whitespace/newline character after header
  if (
    pos < bytes.length &&
    (bytes[pos] === 0x20 || bytes[pos] === 0x09 || bytes[pos] === 0x0a || bytes[pos] === 0x0d)
  ) {
    if (bytes[pos] === 0x0d && bytes[pos + 1] === 0x0a) pos += 2;
    else pos++;
  }

  return {
    magic,
    format,
    width: tokens[0] ?? 0,
    height: tokens[1] ?? 0,
    maxval: format === "pbm" ? 1 : (tokens[2] ?? 255),
    dataOffset: pos
  };
}

export function readNetpbmMetadata(bytes: Uint8Array): ImageMetadata {
  const hdr = parseNetpbmHeader(bytes);
  return {
    format: hdr.format,
    width: hdr.width,
    height: hdr.height,
    space: hdr.format === "ppm" ? "srgb" : "b-w",
    channels: hdr.format === "ppm" ? 3 : 1,
    depth: hdr.format === "pbm" ? "bit" : hdr.maxval > 255 ? "ushort" : "uchar",
    density: 72,
    hasAlpha: false,
    size: bytes.byteLength
  };
}

export function decodeNetpbmImage(bytes: Uint8Array): RgbaImage {
  const hdr = parseNetpbmHeader(bytes);
  const { width, height, maxval, magic, format } = hdr;
  const rgba = new Uint8Array(width * height * 4);
  let pos = hdr.dataOffset;

  const readNextAsciiInt = (): number => {
    while (pos < bytes.length) {
      const c = bytes[pos]!;
      if (c === 0x23) {
        while (pos < bytes.length && bytes[pos] !== 0x0a) pos++;
      } else if (c <= 0x20) {
        pos++;
      } else {
        break;
      }
    }
    let val = 0;
    while (pos < bytes.length && bytes[pos]! >= 0x30 && bytes[pos]! <= 0x39) {
      val = val * 10 + (bytes[pos]! - 0x30);
      pos++;
    }
    return val;
  };

  if (magic === "P6") {
    const readSample =
      maxval > 255
        ? () => {
            const hi = bytes[pos++] ?? 0;
            const lo = bytes[pos++] ?? 0;
            return (hi << 8) | lo;
          }
        : () => bytes[pos++] ?? 0;
    for (let i = 0; i < width * height; i++) {
      rgba[i * 4] = Math.round((readSample() * 255) / maxval);
      rgba[i * 4 + 1] = Math.round((readSample() * 255) / maxval);
      rgba[i * 4 + 2] = Math.round((readSample() * 255) / maxval);
      rgba[i * 4 + 3] = 255;
    }
  } else if (magic === "P5") {
    const readSample =
      maxval > 255
        ? () => {
            const hi = bytes[pos++] ?? 0;
            const lo = bytes[pos++] ?? 0;
            return (hi << 8) | lo;
          }
        : () => bytes[pos++] ?? 0;
    for (let i = 0; i < width * height; i++) {
      const g = Math.round((readSample() * 255) / maxval);
      rgba[i * 4] = g;
      rgba[i * 4 + 1] = g;
      rgba[i * 4 + 2] = g;
      rgba[i * 4 + 3] = 255;
    }
  } else if (magic === "P4") {
    const rowBytes = Math.ceil(width / 8);
    for (let y = 0; y < height; y++) {
      const rowStart = pos + y * rowBytes;
      for (let x = 0; x < width; x++) {
        const bit = (bytes[rowStart + (x >>> 3)]! >>> (7 - (x & 7))) & 1;
        const g = bit === 1 ? 0 : 255; // PBM: 1 = black, 0 = white
        const idx = (y * width + x) * 4;
        rgba[idx] = g;
        rgba[idx + 1] = g;
        rgba[idx + 2] = g;
        rgba[idx + 3] = 255;
      }
    }
  } else if (magic === "P3") {
    for (let i = 0; i < width * height; i++) {
      rgba[i * 4] = Math.round((readNextAsciiInt() * 255) / maxval);
      rgba[i * 4 + 1] = Math.round((readNextAsciiInt() * 255) / maxval);
      rgba[i * 4 + 2] = Math.round((readNextAsciiInt() * 255) / maxval);
      rgba[i * 4 + 3] = 255;
    }
  } else if (magic === "P2") {
    for (let i = 0; i < width * height; i++) {
      const g = Math.round((readNextAsciiInt() * 255) / maxval);
      rgba[i * 4] = g;
      rgba[i * 4 + 1] = g;
      rgba[i * 4 + 2] = g;
      rgba[i * 4 + 3] = 255;
    }
  } else if (magic === "P1") {
    for (let i = 0; i < width * height; i++) {
      const bit = readNextAsciiInt();
      const g = bit === 1 ? 0 : 255;
      rgba[i * 4] = g;
      rgba[i * 4 + 1] = g;
      rgba[i * 4 + 2] = g;
      rgba[i * 4 + 3] = 255;
    }
  }

  return {
    width,
    height,
    data: rgba,
    format,
    space: format === "ppm" ? "srgb" : "b-w",
    channels: format === "ppm" ? 3 : 1,
    depth: format === "pbm" ? "bit" : maxval > 255 ? "ushort" : "uchar",
    density: 72,
    hasAlpha: false
  };
}

export function encodePpm(img: RgbaImage): Uint8Array {
  const header = new TextEncoder().encode(`P6\n${img.width} ${img.height}\n255\n`);
  const out = new Uint8Array(header.length + img.width * img.height * 3);
  out.set(header, 0);
  let dst = header.length;
  for (let i = 0; i < img.width * img.height; i++) {
    out[dst++] = img.data[i * 4]!;
    out[dst++] = img.data[i * 4 + 1]!;
    out[dst++] = img.data[i * 4 + 2]!;
  }
  return out;
}

export function encodePgm(img: RgbaImage): Uint8Array {
  const header = new TextEncoder().encode(`P5\n${img.width} ${img.height}\n255\n`);
  const out = new Uint8Array(header.length + img.width * img.height);
  out.set(header, 0);
  let dst = header.length;
  for (let i = 0; i < img.width * img.height; i++) {
    const r = img.data[i * 4]!;
    const g = img.data[i * 4 + 1]!;
    const b = img.data[i * 4 + 2]!;
    out[dst++] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return out;
}

export function encodePbm(img: RgbaImage): Uint8Array {
  const header = new TextEncoder().encode(`P4\n${img.width} ${img.height}\n`);
  const rowBytes = Math.ceil(img.width / 8);
  const out = new Uint8Array(header.length + rowBytes * img.height);
  out.set(header, 0);
  for (let y = 0; y < img.height; y++) {
    const rowOffset = header.length + y * rowBytes;
    for (let x = 0; x < img.width; x++) {
      const idx = (y * img.width + x) * 4;
      const luma = 0.299 * img.data[idx]! + 0.587 * img.data[idx + 1]! + 0.114 * img.data[idx + 2]!;
      const bit = luma < 128 ? 1 : 0; // 1 = black
      if (bit) {
        const bIdx = rowOffset + (x >>> 3);
        out[bIdx] = (out[bIdx] ?? 0) | (1 << (7 - (x & 7)));
      }
    }
  }
  return out;
}

export function readBmpMetadata(bytes: Uint8Array): ImageMetadata {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = Math.abs(view.getInt32(18, true));
  const height = Math.abs(view.getInt32(22, true));
  const bpp = view.getUint16(28, true);
  const ppmX = view.getInt32(38, true);
  const density = ppmX > 0 ? Math.max(1, Math.round(ppmX * 0.0254)) : 72;
  return {
    format: "bmp",
    width,
    height,
    space: "srgb",
    channels: bpp === 32 ? 4 : 3,
    depth: "uchar",
    density,
    hasAlpha: bpp === 32,
    size: bytes.byteLength
  };
}

export function decodeBmpImage(bytes: Uint8Array): RgbaImage {
  const meta = readBmpMetadata(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dataOffset = view.getUint32(10, true);
  const dibHeaderSize = view.getUint32(14, true);
  const rawHeight = view.getInt32(22, true);
  const topDown = rawHeight < 0;
  const bpp = view.getUint16(28, true);
  const rowStride = Math.floor((meta.width * bpp + 31) / 32) * 4;
  const rgba = new Uint8Array(meta.width * meta.height * 4);
  const paletteOffset = 14 + dibHeaderSize;
  const paletteStep = dibHeaderSize === 12 ? 3 : 4;

  for (let y = 0; y < meta.height; y++) {
    const srcY = topDown ? y : meta.height - 1 - y;
    const rowStart = dataOffset + srcY * rowStride;
    for (let x = 0; x < meta.width; x++) {
      const dstIdx = (y * meta.width + x) * 4;
      if (bpp <= 8) {
        let pIdx = 0;
        if (bpp === 8) {
          pIdx = bytes[rowStart + x] ?? 0;
        } else if (bpp === 4) {
          const b = bytes[rowStart + (x >>> 1)] ?? 0;
          pIdx = (x & 1) === 0 ? (b >>> 4) & 0x0f : b & 0x0f;
        } else if (bpp === 1) {
          const b = bytes[rowStart + (x >>> 3)] ?? 0;
          pIdx = (b >>> (7 - (x & 7))) & 1;
        }
        const pOff = paletteOffset + pIdx * paletteStep;
        rgba[dstIdx] = bytes[pOff + 2] ?? 0;
        rgba[dstIdx + 1] = bytes[pOff + 1] ?? 0;
        rgba[dstIdx + 2] = bytes[pOff] ?? 0;
        rgba[dstIdx + 3] = 255;
      } else {
        const bytesPerPixel = bpp >>> 3;
        const srcIdx = rowStart + x * bytesPerPixel;
        rgba[dstIdx] = bytes[srcIdx + 2] ?? 0;
        rgba[dstIdx + 1] = bytes[srcIdx + 1] ?? 0;
        rgba[dstIdx + 2] = bytes[srcIdx] ?? 0;
        rgba[dstIdx + 3] = bytesPerPixel === 4 ? (bytes[srcIdx + 3] ?? 255) : 255;
      }
    }
  }
  return {
    width: meta.width,
    height: meta.height,
    data: rgba,
    format: "bmp",
    space: "srgb",
    channels: meta.channels,
    depth: "uchar",
    density: meta.density,
    hasAlpha: meta.hasAlpha
  };
}

export function encodeBmpImage(img: RgbaImage): Uint8Array {
  const { width, height, data } = img;
  const rowStride = Math.ceil((width * 3) / 4) * 4;
  const pixelSize = rowStride * height;
  const out = new Uint8Array(54 + pixelSize);
  const view = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  view.setUint32(2, 54 + pixelSize, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelSize, true);
  const ppm = Math.round((img.density ?? 72) / 0.0254);
  view.setInt32(38, ppm, true);
  view.setInt32(42, ppm, true);

  for (let y = 0; y < height; y++) {
    const dstRow = 54 + (height - 1 - y) * rowStride;
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      out[dstRow + x * 3] = data[srcIdx + 2]!;
      out[dstRow + x * 3 + 1] = data[srcIdx + 1]!;
      out[dstRow + x * 3 + 2] = data[srcIdx]!;
    }
  }
  return out;
}

export function encodeTiffImage(
  img: RgbaImage,
  options?: { readonly density?: number; readonly orientation?: number }
): Uint8Array {
  const { width, height, data } = img;
  const pixelBytes = width * height * 4;
  const density = Math.max(1, Math.round(options?.density ?? img.density ?? 72));
  const orientation = options?.orientation ?? img.orientation ?? 1;
  // Little-endian baseline RGBA TIFF: 8-byte header + pixel data + IFD (12 entries) + extras
  const ifdOffset = 8 + pixelBytes;
  const numEntries = 12;
  const bpsOffset = ifdOffset + 2 + numEntries * 12 + 4;
  const xResOffset = bpsOffset + 8;
  const yResOffset = xResOffset + 8;
  const out = new Uint8Array(yResOffset + 8);
  const view = new DataView(out.buffer);
  out[0] = 0x49;
  out[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);
  out.set(data, 8);

  view.setUint16(ifdOffset, numEntries, true);
  const writeEntry = (idx: number, tag: number, type: number, count: number, val: number) => {
    const p = ifdOffset + 2 + idx * 12;
    view.setUint16(p, tag, true);
    view.setUint16(p + 2, type, true);
    view.setUint32(p + 4, count, true);
    if (type === 3 && count === 1) {
      view.setUint16(p + 8, val, true);
    } else {
      view.setUint32(p + 8, val, true);
    }
  };
  writeEntry(0, 256, 4, 1, width); // ImageWidth
  writeEntry(1, 257, 4, 1, height); // ImageLength
  writeEntry(2, 258, 3, 4, bpsOffset); // BitsPerSample (8,8,8,8)
  writeEntry(3, 259, 3, 1, 1); // Compression = None
  writeEntry(4, 262, 3, 1, 2); // PhotometricInterpretation = RGB
  writeEntry(5, 273, 4, 1, 8); // StripOffsets
  writeEntry(6, 274, 3, 1, orientation); // Orientation
  writeEntry(7, 277, 3, 1, 4); // SamplesPerPixel = 4
  writeEntry(8, 279, 4, 1, pixelBytes); // StripByteCounts
  writeEntry(9, 282, 5, 1, xResOffset); // XResolution
  writeEntry(10, 283, 5, 1, yResOffset); // YResolution
  writeEntry(11, 296, 3, 1, 2); // ResolutionUnit = Inch
  view.setUint32(ifdOffset + 2 + numEntries * 12, 0, true);
  view.setUint16(bpsOffset, 8, true);
  view.setUint16(bpsOffset + 2, 8, true);
  view.setUint16(bpsOffset + 4, 8, true);
  view.setUint16(bpsOffset + 6, 8, true);
  view.setUint32(xResOffset, density, true);
  view.setUint32(xResOffset + 4, 1, true);
  view.setUint32(yResOffset, density, true);
  view.setUint32(yResOffset + 4, 1, true);
  return out;
}

function readTiffTagValues(
  view: DataView,
  entryPos: number,
  le: boolean
): number[] {
  const type = view.getUint16(entryPos + 2, le);
  const count = view.getUint32(entryPos + 4, le);
  const elemSize = type === 3 ? 2 : type === 4 ? 4 : type === 5 ? 8 : 1;
  const totalBytes = count * elemSize;
  const valPos = totalBytes <= 4 ? entryPos + 8 : view.getUint32(entryPos + 8, le);
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    const off = valPos + i * elemSize;
    if (off + elemSize > view.byteLength) break;
    if (type === 3) values.push(view.getUint16(off, le));
    else if (type === 4) values.push(view.getUint32(off, le));
    else if (type === 5) {
      const num = view.getUint32(off, le);
      const den = view.getUint32(off + 4, le);
      values.push(den > 0 ? num / den : num);
    }
    else values.push(view.getUint8(off));
  }
  return values;
}

function decodePackBits(src: Uint8Array, expectedLen: number): Uint8Array {
  const out = new Uint8Array(expectedLen);
  let sp = 0;
  let dp = 0;
  while (sp < src.length && dp < expectedLen) {
    const n = (src[sp++]! << 24) >> 24;
    if (n >= 0) {
      const count = n + 1;
      for (let i = 0; i < count && sp < src.length && dp < expectedLen; i++) {
        out[dp++] = src[sp++]!;
      }
    } else if (n !== -128) {
      const count = 1 - n;
      const val = src[sp++] ?? 0;
      for (let i = 0; i < count && dp < expectedLen; i++) {
        out[dp++] = val;
      }
    }
  }
  return out;
}

function decodeTiffLzw(src: Uint8Array, expectedLen: number): Uint8Array {
  const out = new Uint8Array(expectedLen);
  let dp = 0;
  let bitPos = 0;
  let codeSize = 9;
  const CLEAR_CODE = 256;
  const EOI_CODE = 257;
  let dict: Uint8Array[] = [];

  const resetDict = () => {
    dict = [];
    for (let i = 0; i < 256; i++) dict[i] = new Uint8Array([i]);
    dict[CLEAR_CODE] = new Uint8Array(0);
    dict[EOI_CODE] = new Uint8Array(0);
    codeSize = 9;
  };
  resetDict();

  const readCode = (): number => {
    if (bitPos + codeSize > src.length * 8) return EOI_CODE;
    let code = 0;
    for (let i = 0; i < codeSize; i++) {
      const byteIdx = (bitPos + i) >>> 3;
      const bitIdx = 7 - ((bitPos + i) & 7);
      code = (code << 1) | ((src[byteIdx]! >>> bitIdx) & 1);
    }
    bitPos += codeSize;
    return code;
  };

  let prevEntry: Uint8Array | undefined;
  while (dp < expectedLen) {
    const code = readCode();
    if (code === EOI_CODE) break;
    if (code === CLEAR_CODE) {
      resetDict();
      const first = readCode();
      if (first === EOI_CODE) break;
      const entry = dict[first] ?? new Uint8Array([first & 0xff]);
      for (let i = 0; i < entry.length && dp < expectedLen; i++) out[dp++] = entry[i]!;
      prevEntry = entry;
      continue;
    }
    let entry: Uint8Array;
    if (code < dict.length && dict[code]) {
      entry = dict[code]!;
    } else if (prevEntry && code === dict.length) {
      entry = new Uint8Array(prevEntry.length + 1);
      entry.set(prevEntry, 0);
      entry[prevEntry.length] = prevEntry[0]!;
    } else {
      break;
    }
    for (let i = 0; i < entry.length && dp < expectedLen; i++) out[dp++] = entry[i]!;
    if (prevEntry && dict.length < 4096) {
      const next = new Uint8Array(prevEntry.length + 1);
      next.set(prevEntry, 0);
      next[prevEntry.length] = entry[0]!;
      dict.push(next);
      if (dict.length === 511 && codeSize === 9) codeSize = 10;
      else if (dict.length === 1023 && codeSize === 10) codeSize = 11;
      else if (dict.length === 2047 && codeSize === 11) codeSize = 12;
    }
    prevEntry = entry;
  }
  return out;
}

export function decodeTiffImage(bytes: Uint8Array): RgbaImage {
  const le = bytes[0] === 0x49;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ifdOffset = view.getUint32(4, le);
  const numEntries = view.getUint16(ifdOffset, le);
  let width = 0;
  let height = 0;
  let bitsPerSample = 8;
  let compression = 1;
  let photometric = 2;
  let stripOffsets: number[] = [8];
  let stripByteCounts: number[] = [];
  let samplesPerPixel = 4;
  let rowsPerStrip = 0;
  let predictor = 1;
  let xRes = 72;
  let resUnit = 2;
  let orientation: number | undefined;
  for (let i = 0; i < numEntries; i++) {
    const p = ifdOffset + 2 + i * 12;
    const tag = view.getUint16(p, le);
    const vals = readTiffTagValues(view, p, le);
    const first = vals[0] ?? 0;
    if (tag === 256) width = first;
    else if (tag === 257) height = first;
    else if (tag === 258 && first > 0) bitsPerSample = first;
    else if (tag === 259 && first > 0) compression = first;
    else if (tag === 262) photometric = first;
    else if (tag === 273 && vals.length > 0) stripOffsets = vals;
    else if (tag === 274 && first >= 1 && first <= 8) orientation = first;
    else if (tag === 277 && first > 0) samplesPerPixel = first;
    else if (tag === 278 && first > 0) rowsPerStrip = first;
    else if (tag === 279 && vals.length > 0) stripByteCounts = vals;
    else if (tag === 282 && first > 0) xRes = first;
    else if (tag === 296 && (first === 2 || first === 3)) resUnit = first;
    else if (tag === 317 && first > 0) predictor = first;
  }

  const bytesPerSample = Math.max(1, bitsPerSample >>> 3);
  const rowByteWidth = width * samplesPerPixel * bytesPerSample;
  const totalExpectedBytes = height * rowByteWidth;
  const combined = new Uint8Array(totalExpectedBytes);
  const effectiveRowsPerStrip = rowsPerStrip > 0 ? rowsPerStrip : height;
  let dstOff = 0;
  for (let s = 0; s < stripOffsets.length && dstOff < totalExpectedBytes; s++) {
    const off = stripOffsets[s]!;
    const remainingBytes = totalExpectedBytes - dstOff;
    const expectedStripBytes = Math.min(remainingBytes, effectiveRowsPerStrip * rowByteWidth);
    const rawLen = stripByteCounts[s] ?? Math.max(0, bytes.length - off);
    const rawSlice = bytes.subarray(off, Math.min(bytes.length, off + rawLen));
    let decodedStrip: Uint8Array;
    if (compression === 8 || compression === 32946) {
      try {
        decodedStrip = inflate(rawSlice);
      } catch {
        decodedStrip = rawSlice;
      }
    } else if (compression === 5) {
      decodedStrip = decodeTiffLzw(rawSlice, expectedStripBytes);
    } else if (compression === 32773) {
      decodedStrip = decodePackBits(rawSlice, expectedStripBytes);
    } else {
      decodedStrip = rawSlice;
    }
    const copyLen = Math.min(decodedStrip.length, remainingBytes);
    combined.set(decodedStrip.subarray(0, copyLen), dstOff);
    dstOff += copyLen;
  }

  if (predictor === 2 && bytesPerSample === 1) {
    for (let y = 0; y < height; y++) {
      const rowStart = y * rowByteWidth;
      for (let x = samplesPerPixel; x < rowByteWidth; x++) {
        combined[rowStart + x] =
          ((combined[rowStart + x] ?? 0) + (combined[rowStart + x - samplesPerPixel] ?? 0)) & 0xff;
      }
    }
  }

  const readSample8 = (pixelIdx: number, ch: number): number => {
    const base = (pixelIdx * samplesPerPixel + ch) * bytesPerSample;
    if (bytesPerSample === 2) {
      const val16 = le
        ? (combined[base] ?? 0) | ((combined[base + 1] ?? 0) << 8)
        : ((combined[base] ?? 0) << 8) | (combined[base + 1] ?? 0);
      return Math.round((val16 * 255) / 65535);
    }
    return combined[base] ?? 0;
  };

  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    if (samplesPerPixel === 1) {
      let g = readSample8(i, 0);
      if (photometric === 0) g = 255 - g;
      rgba[i * 4] = g;
      rgba[i * 4 + 1] = g;
      rgba[i * 4 + 2] = g;
      rgba[i * 4 + 3] = 255;
    } else if (samplesPerPixel === 2) {
      let g = readSample8(i, 0);
      if (photometric === 0) g = 255 - g;
      rgba[i * 4] = g;
      rgba[i * 4 + 1] = g;
      rgba[i * 4 + 2] = g;
      rgba[i * 4 + 3] = readSample8(i, 1);
    } else {
      rgba[i * 4] = readSample8(i, 0);
      rgba[i * 4 + 1] = readSample8(i, 1);
      rgba[i * 4 + 2] = readSample8(i, 2);
      rgba[i * 4 + 3] = samplesPerPixel >= 4 ? readSample8(i, 3) : 255;
    }
  }
  const density = resUnit === 3 ? Math.max(1, Math.round(xRes * 2.54)) : Math.max(1, Math.round(xRes));
  return {
    width,
    height,
    data: rgba,
    format: "tiff",
    space: samplesPerPixel < 3 ? "b-w" : "srgb",
    channels: samplesPerPixel === 4 ? 4 : samplesPerPixel === 1 ? 1 : 3,
    depth: bitsPerSample === 16 ? "ushort" : "uchar",
    density,
    hasAlpha: samplesPerPixel === 2 || samplesPerPixel === 4,
    ...(orientation !== undefined ? { orientation } : {})
  };
}
