import { Deflate, Inflate } from "pako";

function detachZStreamBuffers(strm: unknown): void {
  const state = (strm as { state?: Record<string, { buffer?: { transfer?: (n: number) => ArrayBuffer } }> } | undefined)?.state;
  if (!state) return;
  for (const key of ["window", "prev", "head", "pending_buf"]) {
    const buf = state[key]?.buffer;
    if (buf && typeof buf.transfer === "function") {
      try { buf.transfer(0); } catch {}
    }
  }
}

function inflatePngIdat(compressed: Uint8Array, target: Uint8Array): Uint8Array {
  const inf = new Inflate();
  let written = 0;
  let overflow = null as Uint8Array[] | null;
  (inf as unknown as { onStart: (strm: { output: Uint8Array; next_out: number; avail_out: number }) => void }).onStart = (strm) => {
    strm.output = target;
    strm.next_out = 0;
    strm.avail_out = target.length;
  };
  inf.onData = (chunk: Uint8Array) => {
    if (!overflow && chunk.buffer === target.buffer) {
      written += chunk.length;
      if (written < target.length) {
        (inf as unknown as { strm: { output: Uint8Array; next_out: number; avail_out: number } }).strm.output = target.subarray(written);
        (inf as unknown as { strm: { output: Uint8Array; next_out: number; avail_out: number } }).strm.next_out = 0;
        (inf as unknown as { strm: { output: Uint8Array; next_out: number; avail_out: number } }).strm.avail_out = target.length - written;
      }
    } else {
      if (!overflow) overflow = [target.subarray(0, written)];
      overflow.push(chunk);
    }
  };
  inf.onEnd = () => {};
  inf.push(compressed, true);
  detachZStreamBuffers((inf as unknown as { strm?: unknown }).strm);
  if (inf.err) throw new Error(inf.msg || "PNG inflate failed");
  if (!overflow) return target.subarray(0, written);
  const total = overflow.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of overflow) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function deflatePngScanlines(raw: Uint8Array, level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9): Uint8Array {
  const def = new Deflate({ level });
  def.push(raw, true);
  detachZStreamBuffers((def as unknown as { strm?: unknown }).strm);
  if (def.err) throw new Error(def.msg || "PNG deflate failed");
  return def.result;
}
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
  const space =
    colorType === 0 || colorType === 4
      ? bitDepth === 16
        ? "grey16"
        : "b-w"
      : bitDepth === 16
        ? "rgb16"
        : "srgb";
  const depth = bitDepth === 16 ? "ushort" : bitDepth < 8 ? "bit" : "uchar";

  return {
    format: "png",
    width,
    height,
    space,
    channels,
    depth,
    bitsPerSample: bitDepth,
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
  const compressed = idatChunks.length === 1 ? idatChunks[0]! : new Uint8Array(totalIdat);
  if (idatChunks.length !== 1) {
    let offset = 0;
    for (const c of idatChunks) {
      compressed.set(c, offset);
      offset += c.length;
    }
  }

  const samplesPerPixel =
    colorType === 6 ? 4 : colorType === 4 ? 2 : colorType === 2 ? 3 : 1;
  const bitsPerPixel = samplesPerPixel * bitDepth;
  const bytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const directRgbaInPlace = !meta.isProgressive && bitDepth === 8 && colorType === 6 && !trns;
  const directRgbInPlace = !meta.isProgressive && bitDepth === 8 && colorType === 2 && !trns && width >= 1;
  const expectedScanlineBytes = meta.isProgressive
    ? height * (1 + Math.ceil((width * bitsPerPixel) / 8)) + height * 8
    : height * (1 + Math.ceil((width * bitsPerPixel) / 8));
  let rgba: Uint8Array = directRgbInPlace
    ? new Uint8Array(width * height * 4)
    : directRgbaInPlace
      ? new Uint8Array(expectedScanlineBytes)
      : new Uint8Array(width * height * 4);
  const inflateTarget = (directRgbInPlace || directRgbaInPlace)
    ? rgba
    : new Uint8Array(expectedScanlineBytes);
  const inflated = inflatePngIdat(compressed, inflateTarget);
  if (idatChunks.length !== 1 && typeof (compressed.buffer as any).transfer === "function") {
    try { (compressed.buffer as any).transfer(0); } catch { /* Buffer detachment is best-effort; ordinary garbage collection remains available. */ }
  }

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
    const rawData = inflated.subarray(inOffset, inOffset + subH * rowBytes);
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

    if (directRgbaInPlace) {
      rgba = rawData;
      return curOffset;
    }
    if (directRgbInPlace) {
      if (inflated.buffer !== rgba.buffer) {
        rgba.set(rawData, 0);
      }
      for (let i = width * height - 1; i >= 0; i--) {
        const s = i * 3;
        const d = i * 4;
        const r = rgba[s]!, g = rgba[s + 1]!, b = rgba[s + 2]!;
        rgba[d] = r;
        rgba[d + 1] = g;
        rgba[d + 2] = b;
        rgba[d + 3] = 255;
      }
      return curOffset;
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
  if (rgba.buffer !== inflated.buffer && typeof (inflated.buffer as any).transfer === "function") {
    try { (inflated.buffer as any).transfer(0); } catch { /* Buffer detachment is best-effort; ordinary garbage collection remains available. */ }
  }

  return {
    width,
    height,
    data: rgba,
    format: "png",
    space: colorType === 0 && trns ? "srgb" : meta.space,
    channels: colorType === 0 && trns ? 4 : meta.channels,
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
  if (type === "IDAT" && data.byteOffset === 0 && typeof (data.buffer as any).transfer === "function") {
    try { (data.buffer as any).transfer(0); } catch { /* Buffer detachment is best-effort; ordinary garbage collection remains available. */ }
  }
  return out;
}

export function encodePngImage(
  img: RgbaImage,
  options?: {
    readonly compressionLevel?: number;
    readonly density?: number;
    readonly orientation?: number;
    readonly forceOpaque?: boolean;
    readonly consumeInput?: boolean;
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
  const canFilterInPlace = Boolean(options?.consumeInput && bpp <= 3 && width >= 1 && data.length >= height * (rowBytes + 1));
  const raw = canFilterInPlace ? data.subarray(0, height * (rowBytes + 1)) : new Uint8Array(height * (rowBytes + 1));
  const rowScratch = canFilterInPlace ? new Uint8Array(width * 4) : undefined;

  for (let y = 0; y < height; y++) {
    const dstRow = y * (rowBytes + 1);
    let srcRowData = data;
    let rowBase = y * width * 4;
    if (rowScratch) {
      rowScratch.set(data.subarray(rowBase, rowBase + width * 4));
      srcRowData = rowScratch;
      rowBase = 0;
    }
    raw[dstRow] = 1;
    for (let x = 0; x < width; x++) {
      const srcIdx = rowBase + x * 4;
      const prevIdx = x > 0 ? rowBase + (x - 1) * 4 : -1;
      const outCol = dstRow + 1 + x * bpp;
      if (isBw) {
        const g = srcRowData[srcIdx]!;
        const pg = prevIdx >= 0 ? srcRowData[prevIdx]! : 0;
        raw[outCol] = (g - pg) & 0xff;
        if (hasAlpha) {
          const a = srcRowData[srcIdx + 3]!;
          const pa = prevIdx >= 0 ? srcRowData[prevIdx + 3]! : 0;
          raw[outCol + 1] = (a - pa) & 0xff;
        }
      } else {
        const r = srcRowData[srcIdx]!;
        const g = srcRowData[srcIdx + 1]!;
        const b = srcRowData[srcIdx + 2]!;
        const pr = prevIdx >= 0 ? srcRowData[prevIdx]! : 0;
        const pg = prevIdx >= 0 ? srcRowData[prevIdx + 1]! : 0;
        const pb = prevIdx >= 0 ? srcRowData[prevIdx + 2]! : 0;
        raw[outCol] = (r - pr) & 0xff;
        raw[outCol + 1] = (g - pg) & 0xff;
        raw[outCol + 2] = (b - pb) & 0xff;
        if (hasAlpha) {
          const a = srcRowData[srcIdx + 3]!;
          const pa = prevIdx >= 0 ? srcRowData[prevIdx + 3]! : 0;
          raw[outCol + 3] = (a - pa) & 0xff;
        }
      }
    }
  }
  if (options?.consumeInput && !canFilterInPlace && data.byteOffset === 0 && typeof (data.buffer as any).transfer === "function") {
    try { (data.buffer as any).transfer(0); } catch { /* Buffer detachment is best-effort; ordinary garbage collection remains available. */ }
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
  const compressed = deflatePngScanlines(raw, level);
  if (typeof (raw.buffer as any).transfer === "function" && (options?.consumeInput || (raw.byteOffset === 0 && raw.byteLength === raw.buffer.byteLength))) {
    try { (raw.buffer as any).transfer(0); } catch { /* Buffer detachment is best-effort; ordinary garbage collection remains available. */ }
  }

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

export function decodePngToCanvas(
  bytes: Uint8Array,
  canvas: RgbaImage,
  dstX: number,
  dstY: number
): { readonly width: number; readonly height: number; readonly anyTransparent: boolean } | undefined {
  if (!isPngBytes(bytes) || bytes.length < 24) return undefined;
  const meta = readPngMetadata(bytes);
  const width = meta.width;
  const height = meta.height;
  if (meta.isProgressive || width <= 0 || height <= 0) return undefined;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let bitDepth = 8;
  let colorType = 6;
  let hasTrns = false;
  const idatChunks: Uint8Array[] = [];

  let pos = 8;
  while (pos + 8 <= bytes.length) {
    const len = view.getUint32(pos, false);
    const type = String.fromCharCode(bytes[pos + 4]!, bytes[pos + 5]!, bytes[pos + 6]!, bytes[pos + 7]!);
    const dataStart = pos + 8;
    if (dataStart + len > bytes.length) break;
    const chunk = bytes.subarray(dataStart, dataStart + len);
    if (type === "IHDR" && len >= 13) {
      bitDepth = chunk[8]!;
      colorType = chunk[9]!;
    } else if (type === "tRNS") {
      hasTrns = true;
    } else if (type === "IDAT") {
      idatChunks.push(chunk);
    } else if (type === "IEND") {
      break;
    }
    pos = dataStart + len + 4;
  }

  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || hasTrns || idatChunks.length === 0) {
    return undefined;
  }

  const bpp = colorType === 6 ? 4 : 3;
  const rowPixelBytes = width * bpp;
  const rowStride = 1 + rowPixelBytes;
  const prevRow = new Uint8Array(rowPixelBytes);
  const curRow = new Uint8Array(rowStride);
  let y = 0;
  let rowFill = 0;
  let anyTransparent = false;

  const inf = new Inflate({ chunkSize: 65536 });
  inf.onData = (chunk: Uint8Array) => {
    let cOff = 0;
    while (cOff < chunk.length && y < height) {
      const need = rowStride - rowFill;
      const take = Math.min(need, chunk.length - cOff);
      curRow.set(chunk.subarray(cOff, cOff + take), rowFill);
      rowFill += take;
      cOff += take;
      if (rowFill === rowStride) {
        const filterType = curRow[0]!;
        for (let x = 0; x < rowPixelBytes; x++) {
          const raw = curRow[1 + x]!;
          const a = x >= bpp ? curRow[1 + x - bpp]! : 0;
          const b = y > 0 ? prevRow[x]! : 0;
          const c = y > 0 && x >= bpp ? prevRow[x - bpp]! : 0;
          let recon = raw;
          if (filterType === 1) recon = (raw + a) & 0xff;
          else if (filterType === 2) recon = (raw + b) & 0xff;
          else if (filterType === 3) recon = (raw + ((a + b) >>> 1)) & 0xff;
          else if (filterType === 4) recon = (raw + paethPredictor(a, b, c)) & 0xff;
          curRow[1 + x] = recon;
        }
        prevRow.set(curRow.subarray(1));
        const cy = dstY + y;
        if (cy >= 0 && cy < canvas.height) {
          const xStart = Math.max(0, -dstX);
          const xEnd = Math.min(width, canvas.width - dstX);
          let dstIdx = (cy * canvas.width + (dstX + xStart)) * 4;
          let srcIdx = 1 + xStart * bpp;
          for (let x = xStart; x < xEnd; x++) {
            const r = curRow[srcIdx]!;
            const g = curRow[srcIdx + 1]!;
            const b = curRow[srcIdx + 2]!;
            const a = bpp === 4 ? curRow[srcIdx + 3]! : 255;
            if (a < 255) anyTransparent = true;
            if (a === 255) {
              canvas.data[dstIdx] = r;
              canvas.data[dstIdx + 1] = g;
              canvas.data[dstIdx + 2] = b;
              canvas.data[dstIdx + 3] = 255;
            } else if (a > 0) {
              const sa = a / 255;
              const da = (canvas.data[dstIdx + 3] ?? 0) / 255;
              const outA = sa + da * (1 - sa);
              if (outA > 0) {
                canvas.data[dstIdx] = Math.round((r * sa + (canvas.data[dstIdx] ?? 0) * da * (1 - sa)) / outA);
                canvas.data[dstIdx + 1] = Math.round((g * sa + (canvas.data[dstIdx + 1] ?? 0) * da * (1 - sa)) / outA);
                canvas.data[dstIdx + 2] = Math.round((b * sa + (canvas.data[dstIdx + 2] ?? 0) * da * (1 - sa)) / outA);
                canvas.data[dstIdx + 3] = Math.round(outA * 255);
              }
            }
            srcIdx += bpp;
            dstIdx += 4;
          }
        }
        y++;
        rowFill = 0;
      }
    }
    if (typeof (chunk.buffer as unknown as { transfer?: (n: number) => ArrayBuffer }).transfer === "function") {
      try { (chunk.buffer as unknown as { transfer: (n: number) => ArrayBuffer }).transfer(0); } catch {}
    }
  };
  inf.onEnd = () => {};
  for (let i = 0; i < idatChunks.length; i++) {
    inf.push(idatChunks[i]!, i === idatChunks.length - 1);
    if (inf.err) break;
  }
  detachZStreamBuffers((inf as unknown as { strm?: unknown }).strm);
  if (inf.err || y < height) return undefined;
  return { width, height, anyTransparent };
}
