import { deflate, inflate } from "pako";
import type { ImageMetadata, RgbaImage } from "../ast.js";
import { buildExifApp1Segment, parseExifBuffer } from "./exif.js";

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

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

function crc32(typeBytes: Uint8Array, data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < typeBytes.length; i++) {
    c = CRC_TABLE[(c ^ typeBytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function isPngBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

export function readPngMetadata(bytes: Uint8Array): ImageMetadata {
  if (!isPngBytes(bytes) || bytes.length < 24) {
    throw new Error("Invalid PNG header");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  let interlace = 0;
  let density = 72;
  let hasTrns = false;
  let orientation: number | undefined;

  let pos = 8;
  while (pos + 8 <= bytes.length) {
    const len = view.getUint32(pos, false);
    const type = String.fromCharCode(
      bytes[pos + 4]!,
      bytes[pos + 5]!,
      bytes[pos + 6]!,
      bytes[pos + 7]!
    );
    const dataStart = pos + 8;
    if (dataStart + len > bytes.length) break;
    const chunk = bytes.subarray(dataStart, dataStart + len);

    if (type === "IHDR" && len >= 13) {
      width = view.getUint32(dataStart, false);
      height = view.getUint32(dataStart + 4, false);
      bitDepth = chunk[8]!;
      colorType = chunk[9]!;
      interlace = chunk[12]!;
    } else if (type === "pHYs" && len >= 9) {
      const ppuX = view.getUint32(dataStart, false);
      const unit = chunk[8]!;
      if (unit === 1 && ppuX > 0) {
        density = Math.max(1, Math.round(ppuX * 0.0254));
      } else if (ppuX > 0) {
        density = ppuX;
      }
    } else if (type === "tRNS") {
      hasTrns = true;
    } else if (type === "eXIf" && len >= 8) {
      const exif = parseExifBuffer(chunk);
      if (exif.orientation !== undefined) orientation = exif.orientation;
      if (exif.density !== undefined) density = exif.density;
    } else if (type === "IDAT" || type === "IEND") {
      if (type === "IEND") break;
    }
    pos = dataStart + len + 4;
  }

  const channels: 1 | 2 | 3 | 4 =
    colorType === 6
      ? 4
      : colorType === 4
        ? 2
        : colorType === 2
          ? hasTrns
            ? 4
            : 3
          : colorType === 3
            ? hasTrns
              ? 4
              : 3
            : hasTrns
              ? 2
              : 1;

  const hasAlpha = colorType === 6 || colorType === 4 || hasTrns;
  const space = colorType === 0 || colorType === 4 ? "b-w" : "srgb";
  const depth = bitDepth === 16 ? "ushort" : bitDepth < 8 ? "bit" : "uchar";

  return {
    format: "png",
    width,
    height,
    space,
    channels,
    depth,
    density,
    hasAlpha,
    ...(orientation !== undefined ? { orientation } : {}),
    isProgressive: interlace === 1,
    size: bytes.byteLength
  };
}

export function decodePngImage(bytes: Uint8Array): RgbaImage {
  const meta = readPngMetadata(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = meta.width;
  const height = meta.height;
  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid PNG dimensions: ${width}x${height}`);
  }

  let bitDepth = 8;
  let colorType = 6;
  let palette: Uint8Array | undefined;
  let trns: Uint8Array | undefined;
  const idatChunks: Uint8Array[] = [];

  let pos = 8;
  while (pos + 8 <= bytes.length) {
    const len = view.getUint32(pos, false);
    const type = String.fromCharCode(
      bytes[pos + 4]!,
      bytes[pos + 5]!,
      bytes[pos + 6]!,
      bytes[pos + 7]!
    );
    const dataStart = pos + 8;
    if (dataStart + len > bytes.length) break;
    const chunk = bytes.subarray(dataStart, dataStart + len);
    if (type === "IHDR" && len >= 13) {
      bitDepth = chunk[8]!;
      colorType = chunk[9]!;
    } else if (type === "PLTE") {
      palette = chunk;
    } else if (type === "tRNS") {
      trns = chunk;
    } else if (type === "IDAT") {
      idatChunks.push(chunk);
    } else if (type === "IEND") {
      break;
    }
    pos = dataStart + len + 4;
  }

  const totalIdat = idatChunks.reduce((sum, c) => sum + c.length, 0);
  const compressed = new Uint8Array(totalIdat);
  let offset = 0;
  for (const c of idatChunks) {
    compressed.set(c, offset);
    offset += c.length;
  }
  const inflated = inflate(compressed);

  const samplesPerPixel =
    colorType === 6 ? 4 : colorType === 4 ? 2 : colorType === 2 ? 3 : 1;
  const bitsPerPixel = samplesPerPixel * bitDepth;
  const bytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const rgba = new Uint8Array(width * height * 4);

  const decodePass = (
    subW: number,
    subH: number,
    inOffset: number,
    x0: number,
    y0: number,
    dx: number,
    dy: number
  ): number => {
    if (subW <= 0 || subH <= 0) return inOffset;
    const rowBytes = Math.ceil((subW * bitsPerPixel) / 8);
    const rawData = new Uint8Array(subH * rowBytes);
    let curOffset = inOffset;

    for (let y = 0; y < subH; y++) {
      const filterType = inflated[curOffset++] ?? 0;
      const dstRowOffset = y * rowBytes;
      const prevRowOffset = (y - 1) * rowBytes;
      for (let x = 0; x < rowBytes; x++) {
        const raw = inflated[curOffset++] ?? 0;
        const a = x >= bytesPerPixel ? rawData[dstRowOffset + x - bytesPerPixel]! : 0;
        const b = y > 0 ? rawData[prevRowOffset + x]! : 0;
        const c = y > 0 && x >= bytesPerPixel ? rawData[prevRowOffset + x - bytesPerPixel]! : 0;
        let recon = raw;
        if (filterType === 1) recon = (raw + a) & 0xff;
        else if (filterType === 2) recon = (raw + b) & 0xff;
        else if (filterType === 3) recon = (raw + ((a + b) >>> 1)) & 0xff;
        else if (filterType === 4) recon = (raw + paethPredictor(a, b, c)) & 0xff;
        rawData[dstRowOffset + x] = recon;
      }
    }

    for (let y = 0; y < subH; y++) {
      const rowStart = y * rowBytes;
      const dstY = y0 + y * dy;
      for (let x = 0; x < subW; x++) {
        const dstX = x0 + x * dx;
        const outIdx = (dstY * width + dstX) * 4;
        if (bitDepth === 8) {
          if (colorType === 6) {
            const idx = rowStart + x * 4;
            rgba[outIdx] = rawData[idx]!;
            rgba[outIdx + 1] = rawData[idx + 1]!;
            rgba[outIdx + 2] = rawData[idx + 2]!;
            rgba[outIdx + 3] = rawData[idx + 3]!;
          } else if (colorType === 2) {
            const idx = rowStart + x * 3;
            const r = rawData[idx]!;
            const g = rawData[idx + 1]!;
            const b = rawData[idx + 2]!;
            let a = 255;
            if (trns && trns.length >= 6 && r === trns[1] && g === trns[3] && b === trns[5]) a = 0;
            rgba[outIdx] = r;
            rgba[outIdx + 1] = g;
            rgba[outIdx + 2] = b;
            rgba[outIdx + 3] = a;
          } else if (colorType === 4) {
            const idx = rowStart + x * 2;
            const g = rawData[idx]!;
            rgba[outIdx] = g;
            rgba[outIdx + 1] = g;
            rgba[outIdx + 2] = g;
            rgba[outIdx + 3] = rawData[idx + 1]!;
          } else if (colorType === 0) {
            const g = rawData[rowStart + x]!;
            const a = trns && trns.length >= 2 && g === trns[1] ? 0 : 255;
            rgba[outIdx] = g;
            rgba[outIdx + 1] = g;
            rgba[outIdx + 2] = g;
            rgba[outIdx + 3] = a;
          } else if (colorType === 3) {
            const pIdx = rawData[rowStart + x]!;
            rgba[outIdx] = palette ? (palette[pIdx * 3] ?? 0) : 0;
            rgba[outIdx + 1] = palette ? (palette[pIdx * 3 + 1] ?? 0) : 0;
            rgba[outIdx + 2] = palette ? (palette[pIdx * 3 + 2] ?? 0) : 0;
            rgba[outIdx + 3] = trns && pIdx < trns.length ? trns[pIdx]! : 255;
          }
        } else if (bitDepth === 16) {
          if (colorType === 6) {
            const idx = rowStart + x * 8;
            rgba[outIdx] = rawData[idx]!;
            rgba[outIdx + 1] = rawData[idx + 2]!;
            rgba[outIdx + 2] = rawData[idx + 4]!;
            rgba[outIdx + 3] = rawData[idx + 6]!;
          } else if (colorType === 2) {
            const idx = rowStart + x * 6;
            let a = 255;
            if (
              trns &&
              trns.length >= 6 &&
              rawData[idx] === trns[0] &&
              rawData[idx + 1] === trns[1] &&
              rawData[idx + 2] === trns[2] &&
              rawData[idx + 3] === trns[3] &&
              rawData[idx + 4] === trns[4] &&
              rawData[idx + 5] === trns[5]
            ) {
              a = 0;
            }
            rgba[outIdx] = rawData[idx]!;
            rgba[outIdx + 1] = rawData[idx + 2]!;
            rgba[outIdx + 2] = rawData[idx + 4]!;
            rgba[outIdx + 3] = a;
          } else if (colorType === 4) {
            const idx = rowStart + x * 4;
            const g = rawData[idx]!;
            rgba[outIdx] = g;
            rgba[outIdx + 1] = g;
            rgba[outIdx + 2] = g;
            rgba[outIdx + 3] = rawData[idx + 2]!;
          } else {
            const idx = rowStart + x * 2;
            const g = rawData[idx]!;
            const a =
              trns && trns.length >= 2 && rawData[idx] === trns[0] && rawData[idx + 1] === trns[1]
                ? 0
                : 255;
            rgba[outIdx] = g;
            rgba[outIdx + 1] = g;
            rgba[outIdx + 2] = g;
            rgba[outIdx + 3] = a;
          }
        } else {
          const pixelsPerByte = 8 / bitDepth;
          const byteIndex = rowStart + Math.floor(x / pixelsPerByte);
          const shift = (pixelsPerByte - 1 - (x % pixelsPerByte)) * bitDepth;
          const mask = (1 << bitDepth) - 1;
          const sample = (rawData[byteIndex]! >>> shift) & mask;
          if (colorType === 3) {
            rgba[outIdx] = palette ? (palette[sample * 3] ?? 0) : 0;
            rgba[outIdx + 1] = palette ? (palette[sample * 3 + 1] ?? 0) : 0;
            rgba[outIdx + 2] = palette ? (palette[sample * 3 + 2] ?? 0) : 0;
            rgba[outIdx + 3] = trns && sample < trns.length ? trns[sample]! : 255;
          } else {
            const scaled = Math.round((sample * 255) / mask);
            const a = trns && trns.length >= 2 && sample === trns[1] ? 0 : 255;
            rgba[outIdx] = scaled;
            rgba[outIdx + 1] = scaled;
            rgba[outIdx + 2] = scaled;
            rgba[outIdx + 3] = a;
          }
        }
      }
    }
    return curOffset;
  };

  if (meta.isProgressive) {
    const passes = [
      { x0: 0, y0: 0, dx: 8, dy: 8 },
      { x0: 4, y0: 0, dx: 8, dy: 8 },
      { x0: 0, y0: 4, dx: 4, dy: 8 },
      { x0: 2, y0: 0, dx: 4, dy: 4 },
      { x0: 0, y0: 2, dx: 2, dy: 4 },
      { x0: 1, y0: 0, dx: 2, dy: 2 },
      { x0: 0, y0: 1, dx: 1, dy: 2 }
    ];
    let inOff = 0;
    for (const p of passes) {
      const pw = Math.ceil((width - p.x0) / p.dx);
      const ph = Math.ceil((height - p.y0) / p.dy);
      inOff = decodePass(pw, ph, inOff, p.x0, p.y0, p.dx, p.dy);
    }
  } else {
    decodePass(width, height, 0, 0, 0, 1, 1);
  }

  return {
    width,
    height,
    data: rgba,
    format: "png",
    space: meta.space,
    channels: meta.channels,
    depth: meta.depth,
    density: meta.density,
    hasAlpha: meta.hasAlpha,
    ...(meta.orientation !== undefined ? { orientation: meta.orientation } : {}),
    ...(meta.isProgressive !== undefined ? { isProgressive: meta.isProgressive } : {})
  };
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array([
    type.charCodeAt(0),
    type.charCodeAt(1),
    type.charCodeAt(2),
    type.charCodeAt(3)
  ]);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(typeBytes, data), false);
  return out;
}

export function encodePngImage(
  img: RgbaImage,
  options?: {
    readonly compressionLevel?: number;
    readonly density?: number;
    readonly orientation?: number;
    readonly forceOpaque?: boolean;
  }
): Uint8Array {
  const { width, height, data } = img;
  const density = options?.density ?? img.density ?? 72;
  let hasAlpha = Boolean(img.hasAlpha || img.channels === 4 || img.channels === 2);
  if (options?.forceOpaque) {
    hasAlpha = false;
  } else if (!hasAlpha) {
    for (let i = 3; i < data.length; i += 4) {
      if (data[i]! < 255) {
        hasAlpha = true;
        break;
      }
    }
  }

  const isBw = img.space === "b-w" || img.channels === 1 || img.channels === 2;
  const colorType = isBw ? (hasAlpha ? 4 : 0) : (hasAlpha ? 6 : 2);
  const bpp = isBw ? (hasAlpha ? 2 : 1) : (hasAlpha ? 4 : 3);
  const rowBytes = width * bpp;
  const raw = new Uint8Array(height * (rowBytes + 1));

  for (let y = 0; y < height; y++) {
    const dstRow = y * (rowBytes + 1);
    raw[dstRow] = 1;
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const prevIdx = x > 0 ? (y * width + (x - 1)) * 4 : -1;
      const outCol = dstRow + 1 + x * bpp;
      if (isBw) {
        const g = data[srcIdx]!;
        const pg = prevIdx >= 0 ? data[prevIdx]! : 0;
        raw[outCol] = (g - pg) & 0xff;
        if (hasAlpha) {
          const a = data[srcIdx + 3]!;
          const pa = prevIdx >= 0 ? data[prevIdx + 3]! : 0;
          raw[outCol + 1] = (a - pa) & 0xff;
        }
      } else {
        const r = data[srcIdx]!;
        const g = data[srcIdx + 1]!;
        const b = data[srcIdx + 2]!;
        const pr = prevIdx >= 0 ? data[prevIdx]! : 0;
        const pg = prevIdx >= 0 ? data[prevIdx + 1]! : 0;
        const pb = prevIdx >= 0 ? data[prevIdx + 2]! : 0;
        raw[outCol] = (r - pr) & 0xff;
        raw[outCol + 1] = (g - pg) & 0xff;
        raw[outCol + 2] = (b - pb) & 0xff;
        if (hasAlpha) {
          const a = data[srcIdx + 3]!;
          const pa = prevIdx >= 0 ? data[prevIdx + 3]! : 0;
          raw[outCol + 3] = (a - pa) & 0xff;
        }
      }
    }
  }

  const level = Math.max(0, Math.min(9, options?.compressionLevel ?? 6)) as
    | 0
    | 1
    | 2
    | 3
    | 4
    | 5
    | 6
    | 7
    | 8
    | 9;
  const compressed = deflate(raw, { level });

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const phys = new Uint8Array(9);
  const physView = new DataView(phys.buffer);
  const ppu = Math.round(density / 0.0254);
  physView.setUint32(0, ppu, false);
  physView.setUint32(4, ppu, false);
  phys[8] = 1; // meter

  const orientation = options?.orientation ?? img.orientation;
  const exifChunk = orientation !== undefined
    ? [makeChunk("eXIf", buildExifApp1Segment({ orientation, density }).subarray(6))]
    : [];
  const chunks = [
    PNG_SIGNATURE,
    makeChunk("IHDR", ihdr),
    makeChunk("pHYs", phys),
    ...exifChunk,
    makeChunk("IDAT", compressed),
    makeChunk("IEND", new Uint8Array(0))
  ];

  const totalLength = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(totalLength);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}
