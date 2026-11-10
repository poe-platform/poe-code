import { ADAM7_PASSES } from "./png-pixels.js";
import { PngPalette } from "./png-palette.js";
import { GifPalette } from "./gif-output-parts.js";
import {pngMetadataSteps} from "./png-metadata.js";
import {PNG_SIGNATURE, validPngTransparencyLength, pngCrc32, makeChunk, gammaChunk, canvasChunk, iccChunk, xmpChunk, textChunks} from "./png-chunks.js";
import {paethPredictor, writePngPixel} from "./png-pixels.js";
import { createByteCodec, transformBytes, ByteCodecError } from "@poe-code/compression";

function inflatePngIdat(compressed: Uint8Array, target: Uint8Array): Uint8Array {
  const codec = createByteCodec({ direction: "decode", format: "zlib-or-gzip" });
  let written = 0;
  const overflow: Uint8Array[] = [];
  try {
    for (const chunk of codec.push(compressed, true)) {
      const take = Math.min(chunk.length, Math.max(0, target.length - written));
      target.set(chunk.subarray(0, take), Math.min(written, target.length));
      if (take < chunk.length) overflow.push(chunk.subarray(take));
      written += chunk.length;
    }
  } finally { codec.close(); }
  if (!overflow.length) return target.subarray(0, written);
  const output = new Uint8Array(written);
  output.set(target);
  let offset = target.length;
  for (const chunk of overflow) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

import type { ImageMetadata, RgbaImage } from "../ast.js";
import { buildExifApp1Segment } from "./exif.js";


export function isPngBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

export function readPngMetadata(bytes:Uint8Array):ImageMetadata {
  const steps=pngMetadataSteps(bytes.length);let next=steps.next();
  while(!next.done)next=steps.next(bytes.subarray(next.value.position,next.value.position+next.value.length));
  return next.value;
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
    if (dataStart + len + 4 > bytes.length) throw new Error("Truncated PNG chunk");
    if (pngCrc32(bytes.subarray(pos + 4, dataStart + len)) !== view.getUint32(dataStart + len, false)) {
      if ((bytes[pos + 4]! & 32) === 0) throw new Error(`PNG ${type} CRC mismatch`);
      pos = dataStart + len + 4;
      continue;
    }
    if ((bytes[pos + 4]! & 32) === 0 && type !== "IHDR" && type !== "PLTE" && type !== "IDAT" && type !== "IEND") {
      throw new Error(`PNG unhandled critical chunk ${type}`);
    }
    const chunk = bytes.subarray(dataStart, dataStart + len);
    if (type === "IHDR" && len >= 13) {
      bitDepth = chunk[8]!;
      colorType = chunk[9]!;
    } else if (type === "PLTE") {
      palette = chunk;
    } else if (type === "tRNS") {
      if (idatChunks.length === 0 && validPngTransparencyLength(colorType, len, palette?.length)) trns ??= chunk;
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
  const pngIndices = colorType === 3 ? new Uint8Array(width * height) : undefined;
  const data16 = bitDepth === 16 ? new Uint16Array(width * height * 4) : undefined;
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
    if (inOffset + subH * (1 + rowBytes) > inflated.length) throw new Error("Truncated PNG image data");
    const rawData = inflated.subarray(inOffset, inOffset + subH * rowBytes);
    let curOffset = inOffset;

    for (let y = 0; y < subH; y++) {
      const filterType = inflated[curOffset++] ?? 0;
      if (filterType > 4) throw new Error(`Invalid PNG row filter: ${filterType}`);
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
        writePngPixel(rawData, rowStart, x, outIdx, rgba, bitDepth, colorType, palette, trns, data16);
        if (pngIndices) pngIndices[outIdx / 4] = (rawData[rowStart + ((x * bitDepth) >>> 3)]! >>> (8 - bitDepth - x * bitDepth % 8)) & ((1 << bitDepth) - 1);
      }
    }
    return curOffset;
  };

  let consumed = 0;
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
    for (const p of passes) {
      const pw = Math.ceil((width - p.x0) / p.dx);
      const ph = Math.ceil((height - p.y0) / p.dy);
      consumed = decodePass(pw, ph, consumed, p.x0, p.y0, p.dx, p.dy);
    }
  } else {
    consumed = decodePass(width, height, 0, 0, 0, 1, 1);
  }
  const decodeWarnings = inflated.length > consumed ? [...(meta.decodeWarnings ?? []), "IDAT: Too much image data"] : meta.decodeWarnings;
  if (rgba.buffer !== inflated.buffer && typeof (inflated.buffer as any).transfer === "function") {
    try { (inflated.buffer as any).transfer(0); } catch { /* Buffer detachment is best-effort; ordinary garbage collection remains available. */ }
  } else if (rgba.byteOffset === 0 && rgba.byteLength < rgba.buffer.byteLength && typeof (rgba.buffer as any).transfer === "function") {
    try { rgba = new Uint8Array((rgba.buffer as any).transfer(rgba.byteLength)); } catch { /* Buffer resize is best-effort. */ }
  }

  return {
    width,
    height,
    data: rgba,
    ...(pngIndices && palette ? { pngIndices, pngPalette: { bytes: palette.slice(), depth: bitDepth, ...(trns ? { transparency: trns.slice() } : {}) } } : {}),
    ...(meta.isPalette ? {isPalette: true} : {}),
    ...(data16 ? { data16 } : {}),
    format: "png",
    space: colorType === 0 && trns ? "srgb" : meta.space,
    channels: colorType === 0 && trns ? 4 : meta.channels,
    depth: meta.depth,
    ...(meta.bitsPerSample === undefined ? {} : {bitsPerSample: meta.bitsPerSample}),
    ...(meta.backgroundColor === undefined ? {} : {backgroundColor: meta.backgroundColor}),
    density: meta.density,
    ...(meta.gamma === undefined ? {} : {gamma: meta.gamma}),
    ...(meta.resolution ? {resolution: meta.resolution} : {}),
    hasAlpha: meta.hasAlpha,
    ...(meta.virtualCanvas === undefined ? {} : {virtualCanvas: meta.virtualCanvas}),
    ...(decodeWarnings === undefined ? {} : {decodeWarnings}),
    ...(meta.properties === undefined ? {} : {properties: meta.properties}),
    ...(meta.icc === undefined ? {} : {icc: meta.icc}),
    ...(meta.exif === undefined ? {} : {exif: meta.exif}),
    ...(meta.xmp === undefined ? {} : {xmp: meta.xmp}),
    ...(meta.orientation !== undefined ? { orientation: meta.orientation } : {}),
    ...(meta.isProgressive !== undefined ? { isProgressive: meta.isProgressive } : {})
  };
}


export function encodePngImage(
  img: RgbaImage,
  options?: {
    readonly synthesizeExif?: boolean;
    readonly compressionLevel?: number;
    readonly density?: number;
    readonly orientation?: number;
    readonly omitPngResolution?: boolean;
    readonly pngPreserveColormap?: boolean | undefined;
    readonly pngInterlace?: boolean | undefined;
    readonly pngBitDepth?: 1 | 8 | 16 | undefined;
    readonly pngColorType?: 0 | 2 | 3 | 4 | 6 | undefined;
    readonly pngCoder?: "png00" | "png8" | "png24" | "png32" | "png48" | "png64" | undefined;
    readonly forceOpaque?: boolean;
    readonly consumeInput?: boolean;
    readonly palette?: boolean;
  }
): Uint8Array {
  const { width, height, data } = img;
  const coder = options?.pngCoder === "png00" ? undefined : options?.pngCoder;
  const requestedColor = coder ? undefined : options?.pngColorType;
  const bitDepth = requestedColor === 3 ? 8 : coder === "png48" || coder === "png64" ? 16 : coder ? 8 : options?.pngBitDepth;
  let data16 = bitDepth === 16 ? img.data16 ?? Uint16Array.from(data, value => value * 257) : bitDepth === 8 || bitDepth === 1 ? undefined : img.data16;
  const palette = (coder === "png8" || requestedColor === 3) ? new GifPalette() : undefined;
  if (palette) {
    for (let i = 0; i < data.length; i += 4) palette.add(data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!);
  }
  const pngPalette = palette?.finishPng();
  const density = options?.density ?? img.density ?? 72;
  const resolution = options?.density === undefined ? img.resolution : undefined;
  const scale = resolution?.unit === "inch" ? 1 / 0.0254 : resolution?.unit === "cm" ? 100 : 1;
  let hasAlpha = Boolean(img.hasAlpha || img.channels === 4 || img.channels === 2);
  if (requestedColor === 0 || requestedColor === 2 || coder === "png24" || coder === "png48" || options?.forceOpaque) {
    hasAlpha = false;
  } else if (!hasAlpha) {
    for (let i = 3; i < data.length; i += 4) {
      if (data[i]! < 255) {
        hasAlpha = true;
        break;
      }
    }
  }

  if (requestedColor === 4 || requestedColor === 6 || coder === "png32" || coder === "png64") hasAlpha = true;
  const isBw = !coder && requestedColor !== 2 && requestedColor !== 3 && requestedColor !== 6 && (img.space === "b-w" || img.channels === 1 || img.channels === 2);
  let exactPalette = options?.palette && !options.forceOpaque && !options.pngCoder && options.pngBitDepth === undefined && requestedColor === undefined && !options?.pngBitDepth && !isBw && !data16 ? new PngPalette() : undefined;
  if (options?.pngPreserveColormap && !options.forceOpaque && img.pngPalette && !coder && requestedColor === undefined && !bitDepth && !data16) exactPalette = new PngPalette(img.pngPalette);
  if (exactPalette && !exactPalette.add(data)) exactPalette = undefined;
  const colorType = exactPalette || palette ? 3 : isBw ? (hasAlpha ? 4 : 0) : (hasAlpha ? 6 : 2);
  const channels = isBw ? (hasAlpha ? [0, 3] : [0]) : (hasAlpha ? [0, 1, 2, 3] : [0, 1, 2]);
  // Grayscale PNG keeps the image's output depth after Q16 raster operations.
  if (colorType === 0 && bitDepth === undefined && (img.depth === "uchar" || img.depth === "bit")) data16 = undefined;
  let grayDepth = bitDepth === 1 && colorType === 0 ? 1 : 8;
  if (colorType === 0 && bitDepth === undefined && !data16) {
    grayDepth = 1;
    for (let i = 0; i < data.length && grayDepth < 8; i += 4) {
      while (data[i]! % (255 / (2 ** grayDepth - 1)) !== 0) grayDepth *= 2;
    }
  }
  const packedGray = colorType === 0 && grayDepth < 8;
  if (bitDepth === 1 && !packedGray) throw new Error("1-bit PNG requires grayscale without alpha");
  const bpp = palette ? 1 : channels.length * (data16 ? 2 : 1);
  const passes = options?.pngInterlace ? ADAM7_PASSES : [[0, 0, 1, 1] as const];
  const scanlineBytes = (w: number) => 1 + (exactPalette ? Math.ceil(w * exactPalette.depth / 8) : packedGray ? Math.ceil(w * grayDepth / 8) : w * bpp);
  let activeData = data;
  const totalScanlineBytes = passes.reduce((sum, [x, y, dx, dy]) => {
    const w = Math.max(0, Math.ceil((width - x) / dx));
    return sum + (w ? Math.max(0, Math.ceil((height - y) / dy)) * scanlineBytes(w) : 0);
  }, 0);
  if (
    !options?.pngInterlace && !data16 && options?.consumeInput &&
    bpp === 4 &&
    width >= 1 &&
    activeData.byteOffset === 0
  ) {
    if (activeData.buffer.byteLength >= totalScanlineBytes) {
      activeData = new Uint8Array(activeData.buffer, 0, totalScanlineBytes);
    } else if (
      activeData.byteLength === activeData.buffer.byteLength &&
      typeof (activeData.buffer as any).transfer === "function"
    ) {
      try {
        activeData = new Uint8Array((activeData.buffer as any).transfer(totalScanlineBytes));
      } catch {
        // Fall back to separate allocation if buffer transfer is unavailable.
      }
    }
  }
  const canFilterInPlace = Boolean(!packedGray && !exactPalette && !options?.pngInterlace && !data16 && options?.consumeInput && width >= 1 && activeData.length >= totalScanlineBytes);
  const raw = canFilterInPlace ? activeData.subarray(0, totalScanlineBytes) : new Uint8Array(totalScanlineBytes);
  const rowScratch = canFilterInPlace ? new Uint8Array(width * 4) : undefined;
  const reverseRows = canFilterInPlace && bpp === 4;

  let passOffset = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const passWidth = Math.max(0, Math.ceil((width - x0) / dx));
    const passHeight = Math.max(0, Math.ceil((height - y0) / dy));
    if (!passWidth || !passHeight) continue;
    const rowSize = scanlineBytes(passWidth);
    for (let step = 0; step < passHeight; step++) {
      const row = reverseRows ? passHeight - 1 - step : step;
      const y = y0 + row * dy;
      const dstRow = passOffset + row * rowSize;
      let srcRowData = activeData;
      let rowBase = y * width * 4;
      if (rowScratch) {
        rowScratch.set(activeData.subarray(rowBase, rowBase + width * 4));
        srcRowData = rowScratch;
        rowBase = 0;
      }
      if (exactPalette) {
        const pixels = new Uint8Array(passWidth * 4);
        const indices = img.pngIndices ? new Uint8Array(passWidth) : undefined;
        for (let x = 0; x < passWidth; x++) {
          const source = y * width + x0 + x * dx;
          pixels.set(data.subarray(source * 4, source * 4 + 4), x * 4);
          if (indices) indices[x] = img.pngIndices![source]!;
        }
        raw.set(exactPalette.pack(pixels, indices), dstRow + 1);
        continue;
      }
      if (packedGray) {
        for (let x = 0; x < passWidth; x++) {
          const value = Math.round(srcRowData[rowBase + (x0 + x * dx) * 4]! * (2 ** grayDepth - 1) / 255);
          raw[dstRow + 1 + ((x * grayDepth) >> 3)]! |= value << (8 - grayDepth - x * grayDepth % 8);
        }
        continue;
      }
      raw[dstRow] = 1;
      for (let x = 0; x < passWidth; x++) {
        const srcIdx = rowBase + (x0 + x * dx) * 4;
        const prevIdx = x > 0 ? srcIdx - dx * 4 : -1;
        const outCol = dstRow + 1 + x * bpp;
        if (palette) {
          const value = pngPalette!.indices[palette.index(srcRowData[srcIdx]!, srcRowData[srcIdx + 1]!, srcRowData[srcIdx + 2]!, srcRowData[srcIdx + 3]!)]!;
          const previous = prevIdx < 0 ? 0 : pngPalette!.indices[palette.index(srcRowData[prevIdx]!, srcRowData[prevIdx + 1]!, srcRowData[prevIdx + 2]!, srcRowData[prevIdx + 3]!)]!;
          raw[outCol] = (value - previous) & 255;
        } else if (data16) {
          for (let channel = 0; channel < channels.length; channel++) {
            const value = data16[srcIdx + channels[channel]!]!;
            const previous = prevIdx >= 0 ? data16[prevIdx + channels[channel]!]! : 0;
            raw[outCol + channel * 2] = ((value >>> 8) - (previous >>> 8)) & 255;
            raw[outCol + channel * 2 + 1] = ((value & 255) - (previous & 255)) & 255;
          }
        } else if (isBw) {
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
    passOffset += passHeight * rowSize;
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
  const compressed = transformBytes(raw, { direction: "encode", format: "zlib", level });
  if (typeof (raw.buffer as any).transfer === "function" && (options?.consumeInput || (raw.byteOffset === 0 && raw.byteLength === raw.buffer.byteLength))) {
    try { (raw.buffer as any).transfer(0); } catch { /* Buffer detachment is best-effort; ordinary garbage collection remains available. */ }
  }

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = exactPalette?.depth ?? (packedGray ? grayDepth : data16 ? 16 : 8);
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = options?.pngInterlace ? 1 : 0;

  const phys = new Uint8Array(9);
  const physView = new DataView(phys.buffer);
  // setUint32 truncates fractional pixels per meter, matching ImageMagick.
  const ppu = density / 0.0254;
  physView.setUint32(0, resolution ? resolution.x * scale : ppu, false);
  physView.setUint32(4, resolution ? resolution.y * scale : ppu, false);
  phys[8] = resolution?.unit === "unknown" ? 0 : 1; // meter

  const orientation = options?.orientation ?? img.orientation;
  const exifChunk = img.exif || (options?.synthesizeExif !== false && orientation !== undefined)
    ? [makeChunk("eXIf", buildExifApp1Segment({ exif: img.exif, orientation, density, resolution }).subarray(6))]
    : orientation !== undefined ? [makeChunk("orNT", Uint8Array.of(orientation))] : [];
  const chunks = [
    PNG_SIGNATURE,
    makeChunk("IHDR", ihdr),
    ...(img.gamma === undefined ? [] : [gammaChunk(img.gamma)]),
    ...(img.icc ? [iccChunk(img.icc)] : []),
    ...(exactPalette ? [makeChunk("PLTE", exactPalette.bytes), ...(exactPalette.transparency ? [makeChunk("tRNS", exactPalette.transparency)] : [])] : []),
    ...(palette ? [makeChunk("PLTE", pngPalette!.bytes), ...(pngPalette!.transparency ? [makeChunk("tRNS", pngPalette!.transparency)] : [])] : []),
    ...(!options?.omitPngResolution && (resolution !== undefined || options?.density !== undefined) ? [makeChunk("pHYs", phys)] : []),
    ...exifChunk,
    ...textChunks(img.properties),
    ...(img.xmp ? [xmpChunk(img.xmp)] : []),
    ...(img.virtualCanvas === undefined || img.virtualCanvas.width === width && img.virtualCanvas.height === height && img.virtualCanvas.x === 0 && img.virtualCanvas.y === 0 ? [] : [canvasChunk(img.virtualCanvas)]),
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
  const idatChunks: Uint8Array[] = [];

  let pos = 8;
  while (pos + 8 <= bytes.length) {
    const len = view.getUint32(pos, false);
    const type = String.fromCharCode(bytes[pos + 4]!, bytes[pos + 5]!, bytes[pos + 6]!, bytes[pos + 7]!);
    const dataStart = pos + 8;
    if (dataStart + len + 4 > bytes.length) throw new Error("Truncated PNG chunk");
    if (pngCrc32(bytes.subarray(pos + 4, dataStart + len)) !== view.getUint32(dataStart + len, false)) {
      if ((bytes[pos + 4]! & 32) === 0) throw new Error(`PNG ${type} CRC mismatch`);
      pos = dataStart + len + 4;
      continue;
    }
    if ((bytes[pos + 4]! & 32) === 0 && type !== "IHDR" && type !== "PLTE" && type !== "IDAT" && type !== "IEND") {
      throw new Error(`PNG unhandled critical chunk ${type}`);
    }
    const chunk = bytes.subarray(dataStart, dataStart + len);
    if (type === "IHDR" && len >= 13) {
      bitDepth = chunk[8]!;
      colorType = chunk[9]!;
    } else if (type === "IDAT") {
      idatChunks.push(chunk);
    } else if (type === "IEND") {
      break;
    }
    pos = dataStart + len + 4;
  }

  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || (colorType === 2 && meta.hasAlpha) || idatChunks.length === 0) {
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

  const inf = createByteCodec({ direction: "decode", format: "zlib-or-gzip" });
  const onData = (chunk: Uint8Array) => {
    let cOff = 0;
    while (cOff < chunk.length && y < height) {
      const need = rowStride - rowFill;
      const take = Math.min(need, chunk.length - cOff);
      curRow.set(chunk.subarray(cOff, cOff + take), rowFill);
      rowFill += take;
      cOff += take;
      if (rowFill === rowStride) {
        const filterType = curRow[0]!;
        if (filterType > 4) throw new Error(`Invalid PNG row filter: ${filterType}`);
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
            } else if (canvas.data[dstIdx + 3] === 0) {
              canvas.data.fill(0, dstIdx, dstIdx + 3);
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
      try { (chunk.buffer as unknown as { transfer: (n: number) => ArrayBuffer }).transfer(0); } catch { /* Detachment is best effort for host buffers. */ }
    }
  };
  try {
    for (let i = 0; i < idatChunks.length; i++) {
      for (const chunk of inf.push(idatChunks[i]!, i === idatChunks.length - 1)) onData(chunk);
      if (inf.complete) break;
    }
  } catch (error) {
    if (error instanceof ByteCodecError) return undefined;
    throw error;
  } finally { inf.close(); }
  if (y < height) return undefined;
  return { width, height, anyTransparent };
}
