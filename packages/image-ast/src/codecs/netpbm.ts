import {NetpbmAscii} from "./netpbm-ascii.js";
import { bmpProfileRange } from "./bmp-profile.js";
import { decodePngImage } from "./png.js";
import {tiffTextProperties,tiffPhotometricNames} from "./tiff-properties.js";
import {decodeCcittFax} from "@poe-code/pdf-ast";
import {tiffPageSteps} from "./tiff-pages.js";
import {encodeTiffIntegerSamples} from "./tiff-integer.js";
import {encodeTiffFloatSamples} from "./tiff-float.js";
import { BmpRleEncoder } from "./bmp-rle-encoder.js";
import {BmpPalette} from "./bmp-palette.js";
import {BmpRle,bmpRlePacketSize} from "./bmp-rle.js";
import {tiffLabToRgb} from "./tiff-lab.js";
import {tiffYCbCrToRgb} from "./tiff-ycbcr.js";
import {readTiffFloat8} from "./tiff-float.js";
import {createTiffCompressor,tiffReversedBytes} from "./tiff-compression.js";
import {tiffChannels,tiffSamplePlane,associateTiffSamples,createTiffLayout} from "./tiff-layout.js";
import {createBmpHeader,readBmpHeader,readBmpMasks,bmpMaskedChannel,packBmpPixel} from "./bmp-header.js";
import {netpbmComment,parseNetpbmSequence} from "./netpbm-header.js";
import { transformBytes } from "@poe-code/compression";
import type { ImageMetadata, RgbaImage } from "../ast.js";
import { encodeJpegImage, decodeJpegImage } from "./jpeg.js";

export function isNetpbmBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 7 || bytes[0] !== 0x50) return false; // 'P'
  const m = bytes[1]!;
  if (m < 0x31 || m > 0x37) return false; // '1'..'7'
  const ws = bytes[2]!;
  return ws === 0x20 || ws === 0x0a || ws === 0x0d || ws === 0x09;
}

export function isBmpBytes(bytes: Uint8Array): boolean {
  return (bytes.length >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d)
    || (bytes.length >= 4 && [12, 40, 52, 56, 64, 108, 124].includes(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true)));
}

export function isTiffBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    ((bytes[0] === 0x49 && bytes[1] === 0x49 && (bytes[2] === 0x2a || bytes[2] === 0x2b) && bytes[3] === 0x00) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && (bytes[3] === 0x2a || bytes[3] === 0x2b)))
  );
}

export function readNetpbmMetadata(bytes: Uint8Array, page?: number): ImageMetadata {
  const { header: hdr, pages } = parseNetpbmSequence(bytes, page);
  return {
    ...(hdr.properties ? {properties: hdr.properties} : {}),
    format: hdr.format,
    width: hdr.width,
    height: hdr.height,
    space: hdr.cmyk ? "cmyk" : hdr.channels >= 3 ? "srgb" : "b-w",
    channels: hdr.channels,
    depth: hdr.format === "pbm" ? "bit" : hdr.maxval > 255 ? "ushort" : "uchar",
    bitsPerSample: Math.ceil(Math.log2(hdr.maxval + 1)),
    density: 72,
    hasAlpha: hdr.hasAlpha,
    size: bytes.byteLength,
    ...(pages > 1 ? { pages } : {})
  };
}

export function decodeNetpbmImage(bytes: Uint8Array, page = 0): RgbaImage {
  const { header: hdr } = parseNetpbmSequence(bytes, page);
  const { width, height, maxval, magic, format, channels, hasAlpha, cmyk } = hdr;
  if (magic === "P6" && bytes.length - hdr.dataOffset < width * height * 3 * (maxval > 65535 ? 4 : maxval > 255 ? 2 : 1)) {
    throw new Error("Truncated PPM raster");
  }
  if (magic === "P7" && bytes.length - hdr.dataOffset < width * height * channels * (maxval > 65535 ? 4 : maxval > 255 ? 2 : 1)) throw new Error("Truncated PAM raster");
  // Native 8/16-bit binary rasters use stored values across their full-depth MAXVAL range.
  const sampleMax = magic === "P5" || magic === "P6" || magic === "P7"
    ? maxval >= 32768 && maxval <= 65535 ? 65535 : maxval >= 128 && maxval <= 255 ? 255 : maxval
    : maxval;
  const rgba = new Uint8Array(width * height * 4);
  const evaluateSamples = cmyk || 65535 % sampleMax !== 0 ? new Float64Array(rgba.length) : undefined;
  const hueSamples = cmyk ? new Float64Array(rgba.length) : undefined;
  // Retain precision whenever the input scale cannot be represented in 8 bits.
  const data16 = 255 % sampleMax !== 0 ? new Uint16Array(width * height * 4) : undefined;
  let pos = hdr.dataOffset;

  const readNextAsciiInt = (): number => {
    while (pos < bytes.length) {
      const c = bytes[pos]!;
      if (c === 0x23) {
        while (pos < bytes.length && bytes[pos] !== 0x0a && bytes[pos] !== 0x0d) pos++;
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
      if (magic === "P1") break;
    }
    return val;
  };

  if (magic === "P7" || magic === "P6" || magic === "P5" || magic === "P3" || magic === "P2") {
    const readSample = magic === "P3" || magic === "P2" ? readNextAsciiInt : () => {
      const hi = bytes[pos++] ?? 0;
      if (maxval > 65535) return hi * 16777216 + bytes[pos++]! * 65536 + bytes[pos++]! * 256 + bytes[pos++]!;
      return maxval > 255 ? (hi << 8) | (bytes[pos++] ?? 0) : hi;
    };
    for (let i = 0; i < width * height; i++) {
      const r = format === "pgm" ? Math.min(readSample(), sampleMax) : readSample(), g = channels >= 3 ? readSample() : r, b = channels >= 3 ? readSample() : r, k = cmyk ? readSample() : 0, a = hasAlpha ? readSample() : sampleMax;
      hueSamples?.set([r / sampleMax, g / sampleMax, b / sampleMax, k / sampleMax], i * 4);
      for (const [channel, value] of (cmyk ? [(sampleMax-r)*(sampleMax-k)/sampleMax, (sampleMax-g)*(sampleMax-k)/sampleMax, (sampleMax-b)*(sampleMax-k)/sampleMax, a] : [r, g, b, a]).entries()) {
        // HDRI stores each scaled quantum as a float, before integer output quantization.
        if (evaluateSamples) evaluateSamples[i * 4 + channel] = cmyk ? value * 255 / sampleMax : Math.fround(value * 65535 / sampleMax) / 257;
        rgba[i * 4 + channel] = Math.round(value * 255 / sampleMax);
        if (data16) data16[i * 4 + channel] = Math.round(value * 65535 / sampleMax);
      }
      if (!hasAlpha) { rgba[i * 4 + 3] = 255; if (data16) data16[i * 4 + 3] = 65535; }
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
  } else if (magic === "P1") {
    for (let i = 0; i < width * height; i++) {
      const bit = readNextAsciiInt();
      const g = bit === 0 ? 255 : 0;
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
    ...(hdr.properties ? {properties: hdr.properties} : {}),
    ...(data16 ? {data16} : {}),
    format,
    space: cmyk ? "cmyk" : channels >= 3 ? "srgb" : "b-w",
    ...(hueSamples ? {hueSamples} : {}),
    ...(evaluateSamples ? {evaluateSamples} : {}),
    channels,
    depth: format === "pbm" ? "bit" : maxval > 255 ? "ushort" : "uchar",
    bitsPerSample: Math.ceil(Math.log2(maxval + 1)),
    density: 72,
    hasAlpha
  };
}

export function encodePpm(img: RgbaImage, depth = Math.min(16, img.bitsPerSample ?? (img.data16 ? 16 : 8)), ascii = false, pam = false): Uint8Array {
  if (pam) ascii = false;
  const gray = pam && (img.space === "b-w" || img.space === "grey16");
  const cmyk = pam && img.space === "cmyk" && img.hueSamples !== undefined;
  const channels = pam ? (cmyk ? 4 : gray ? 1 : 3) + (img.hasAlpha ? 1 : 0) : 3;
  if (!Number.isInteger(depth) || depth < 1 || depth > 32) throw new RangeError("Invalid Netpbm depth");
  const maximum = ascii ? (depth <= 8 ? 255 : 65535) : 2 ** depth - 1;
  const text: string[] = [];
  const layout = new NetpbmAscii(img.width, img.height, 3);
  const comment = netpbmComment(img.properties?.comment);
  const header = pam ? `P7\n${comment}WIDTH ${img.width}\nHEIGHT ${img.height}\nDEPTH ${channels}\nMAXVAL ${maximum}\nTUPLTYPE ${cmyk ? "CMYK" : gray ? "GRAYSCALE" : "RGB"}${img.hasAlpha ? "_ALPHA" : ""}\nENDHDR\n` : `${ascii ? "P3" : "P6"}\n${comment}${img.width} ${img.height}\n${maximum}\n`;
  const headerBytes = new TextEncoder().encode(header);
  const out = new Uint8Array(ascii ? 0 : headerBytes.length + img.width * img.height * channels * (depth > 16 ? 4 : depth > 8 ? 2 : 1));
  if (!ascii) out.set(headerBytes, 0);
  let dst = headerBytes.length;
  for (let i = 0; i < img.width * img.height; i++) {
    for (let channel = 0; channel < channels; channel++) {
      const value = Math.round(cmyk && channel < 4 ? img.hueSamples![i * 4 + channel]! * maximum : (img.data16 ?? img.data)[i * 4 + (channel === 4 || (gray && channel === 1) ? 3 : channel)]! * maximum / (img.data16 ? 65535 : 255));
      if (ascii) { text.push(layout.sample(value)); continue; }
      if (depth > 16) { out[dst++] = value >>> 24; out[dst++] = value >>> 16; }
      if (depth > 8) out[dst++] = value >>> 8;
      out[dst++] = value & 255;
    }
  }
  return ascii ? new TextEncoder().encode(header + text.join("")) : out;
}

export function encodePgm(img: RgbaImage, depth = Math.min(16, img.bitsPerSample ?? (img.data16 ? 16 : 8)), ascii = false): Uint8Array {
  if (!Number.isInteger(depth) || depth < 1 || depth > 32) throw new RangeError("Invalid Netpbm depth");
  const maximum = ascii ? (depth <= 8 ? 255 : 65535) : 2 ** depth - 1;
  const text: string[] = [];
  const layout = new NetpbmAscii(img.width, img.height, 1);
  const comment = netpbmComment(img.properties?.comment);
  const header = `${ascii ? "P2" : "P5"}\n${comment}${img.width} ${img.height}\n${maximum}\n`;
  const headerBytes = new TextEncoder().encode(header);
  const out = new Uint8Array(ascii ? 0 : headerBytes.length + img.width * img.height * (depth > 16 ? 4 : depth > 8 ? 2 : 1));
  if (!ascii) out.set(headerBytes, 0);
  let dst = headerBytes.length;
  for (let i = 0; i < img.width * img.height; i++) {
    const samples = img.data16 ?? img.data;
    const r = samples[i * 4]!;
    const g = samples[i * 4 + 1]!;
    const b = samples[i * 4 + 2]!;
    const value = Math.round((0.212656 * r + 0.715158 * g + 0.072186 * b) * maximum / (img.data16 ? 65535 : 255));
    if (ascii) { text.push(layout.sample(value)); continue; }
    if (depth > 16) { out[dst++] = value >>> 24; out[dst++] = value >>> 16; }
    if (depth > 8) out[dst++] = value >>> 8;
    out[dst++] = value & 255;
  }
  return ascii ? new TextEncoder().encode(header + text.join("")) : out;
}

export function encodePbm(img: RgbaImage, ascii = false): Uint8Array {
  const text: string[] = [];
  const layout = new NetpbmAscii(img.width, img.height, 1);
  const comment = netpbmComment(img.properties?.comment);
  const header = `${ascii ? "P1" : "P4"}\n${comment}${img.width} ${img.height}\n`;
  const rowBytes = Math.ceil(img.width / 8);
  const headerBytes = new TextEncoder().encode(header);
  const out = new Uint8Array(ascii ? 0 : headerBytes.length + rowBytes * img.height);
  if (!ascii) out.set(headerBytes, 0);
  for (let y = 0; y < img.height; y++) {
    const rowOffset = headerBytes.length + y * rowBytes;
    for (let x = 0; x < img.width; x++) {
      const idx = (y * img.width + x) * 4;
      const luma = 0.299 * img.data[idx]! + 0.587 * img.data[idx + 1]! + 0.114 * img.data[idx + 2]!;
      const bit = luma < 128 ? 1 : 0; // 1 = black
      if (ascii) { text.push(layout.sample(bit)); continue; }
      if (bit) {
        const bIdx = rowOffset + (x >>> 3);
        out[bIdx] = (out[bIdx] ?? 0) | (1 << (7 - (x & 7)));
      }
    }
  }
  return ascii ? new TextEncoder().encode(header + text.join("")) : out;
}

export function readBmpMetadata(bytes: Uint8Array): ImageMetadata {
  const metadata = readBmpHeaderMetadata(bytes);
  const profile = bmpProfileRange(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), bytes.length);
  return { ...metadata, ...(profile ? { icc: bytes.slice(profile.offset, profile.offset + profile.length) } : {}) };
}

export function readBmpHeaderMetadata(bytes: Uint8Array): ImageMetadata {
  const { view } = readBmpHeader(bytes);
  const dibHeaderSize = view.getUint32(0, true);
  const core = dibHeaderSize === 12;
  if (view.getUint16(core ? 8 : 12, true) !== 1) throw new Error("Invalid BMP plane count: expected 1");
  const width = core ? view.getUint16(4, true) : Math.abs(view.getInt32(4, true));
  const height = core ? view.getUint16(6, true) : Math.abs(view.getInt32(8, true));
  const bpp = view.getUint16(core ? 10 : 14, true);
  const compression = core ? 0 : view.getUint32(16, true);
  if (compression > 5) throw new Error("Unsupported BMP compression");
  if ((compression === 1 && bpp !== 8) || (compression === 2 && bpp !== 4) || (compression === 3 && bpp !== 16 && bpp !== 32)) throw new Error("Invalid BMP compression bit depth");
  if (![1, 4, 8, 16, 24, 32].includes(bpp)) throw new Error("Unsupported BMP bits per pixel");
  if (!core && [1, 4, 8].includes(bpp) && view.getUint32(32, true) > 2 ** bpp) throw new Error("Invalid BMP palette count");
  const ppmX = core ? 0 : view.getInt32(24, true);
  const ppmY = core ? 0 : view.getInt32(28, true);
  const renderingIntent = dibHeaderSize === 124 ? ({ 1: "Saturation", 2: "Relative", 4: "Perceptual", 8: "Absolute" } as Record<number, string>)[view.getUint32(108, true)] : undefined;
  const density = ppmX > 0 ? Math.max(1, Math.round(ppmX * 0.0254)) : 72;
  const hasAlpha = (bpp === 32 && (core || view.getUint32(16, true) !== 3)) || ((bpp === 16 || bpp === 32) && !core && view.getUint32(16, true) === 3 && view.getUint32(0, true) >= 56 && view.byteLength >= 56 && view.getUint32(52, true) !== 0);
  return {
    format: "bmp",
    ...(renderingIntent ? { renderingIntent } : {}),
    width,
    height,
    space: "srgb",
    channels: hasAlpha ? 4 : 3,
    depth: "uchar",
    density,
    ...(ppmX || ppmY ? { resolution: { x: ppmX, y: ppmY, unit: "meter" as const } } : {}),
    hasAlpha,
    size: bytes.byteLength
  };
}

export function decodeBmpImage(bytes: Uint8Array): RgbaImage {
  const meta = readBmpMetadata(bytes);
  const { view, fileHeader, dataOffset: pixelOffset } = readBmpHeader(bytes);
  if (fileHeader && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(2, true) !== bytes.byteLength) throw new Error("Invalid BMP file size");
  let dataOffset = pixelOffset;
  const dibHeaderSize = view.getUint32(0, true);
  const compression = dibHeaderSize >= 40 ? view.getUint32(16, true) : 0;
  if (compression === 4 || compression === 5) {
    if (dataOffset < fileHeader + dibHeaderSize || dataOffset >= bytes.length) throw new Error("Invalid BMP payload offset");
    const image = (compression === 4 ? decodeJpegImage : decodePngImage)(bytes.subarray(dataOffset));
    return { ...image, ...(meta.renderingIntent ? { renderingIntent: meta.renderingIntent } : {}), ...(meta.icc ? { icc: meta.icc } : {}), format: "bmp", density: meta.density, ...(meta.resolution ? { resolution: meta.resolution } : {}) };
  }
  if (dataOffset < dibHeaderSize || dataOffset >= bytes.length) throw new Error("Invalid BMP pixel offset");
  // ImageMagick tolerates offsets into the DIB, but never seeks back into it.
  dataOffset = Math.max(dataOffset, fileHeader + dibHeaderSize);
  const topDown = dibHeaderSize !== 12 && view.getInt32(8, true) < 0;
  const bpp = view.getUint16(dibHeaderSize === 12 ? 10 : 14, true);
  const rowStride = Math.floor((meta.width * bpp + 31) / 32) * 4;
  if (compression !== 1 && compression !== 2 && rowStride * meta.height > bytes.length - dataOffset) throw new Error("Truncated BMP rows");
  const bitfieldMasks = readBmpMasks(view, pixelOffset - fileHeader);
  const rgba = new Uint8Array(meta.width * meta.height * 4);
  const paletteOffset = fileHeader + dibHeaderSize;
  const paletteStep = dibHeaderSize === 12 ? 3 : 4;
  const paletteSize = bpp <= 8 ? Math.min(1 << bpp, (dibHeaderSize >= 40 ? view.getUint32(32, true) : 0) || 1 << bpp) : 0;

  if (compression === 1 || compression === 2) {
    const decoder = new BmpRle(meta.width, meta.height, bpp, topDown);
    for (let i = 0; i < rgba.length; i += 4) rgba.set([bytes[paletteOffset + 2] ?? 0, bytes[paletteOffset + 1] ?? 0, bytes[paletteOffset] ?? 0, 255], i);
    let offset = dataOffset;
    while (!decoder.done) {
      const size = bmpRlePacketSize(bytes[offset]!, bytes[offset + 1]!, bpp);
      const run = decoder.packet(bytes.subarray(offset, offset + size));
      offset += size;
      for (let i = 0; i < run.indices.length; i++) {
        if (run.indices[i]! >= paletteSize) throw new Error("Invalid BMP colormap index");
        const palette = paletteOffset + run.indices[i]! * paletteStep;
        rgba.set([bytes[palette + 2] ?? 0, bytes[palette + 1] ?? 0, bytes[palette] ?? 0, 255], (run.y * meta.width + run.x + i) * 4);
      }
    }
    return {...meta, data: rgba};
  }

  // Legacy BI_RGB writers leave the reserved fourth byte zero in every pixel.
  let opaqueReserved = bpp === 32 && dibHeaderSize >= 40 && view.getUint32(16, true) === 0;
  if (opaqueReserved) {
    for (let offset = dataOffset + 3; offset < dataOffset + rowStride * meta.height; offset += 4) {
      if ((bytes[offset] ?? 255) !== 0) { opaqueReserved = false; break; }
    }
  }

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
        if (pIdx >= paletteSize) throw new Error("Invalid BMP colormap index");
        const pOff = paletteOffset + pIdx * paletteStep;
        rgba[dstIdx] = bytes[pOff + 2] ?? 0;
        rgba[dstIdx + 1] = bytes[pOff + 1] ?? 0;
        rgba[dstIdx + 2] = bytes[pOff] ?? 0;
        rgba[dstIdx + 3] = 255;
      } else {
        const bytesPerPixel = bpp >>> 3;
        const srcIdx = rowStart + x * bytesPerPixel;
        if (bitfieldMasks) {
          const pixel = bpp === 16 ? (bytes[srcIdx] ?? 0) | ((bytes[srcIdx + 1] ?? 0) << 8) : view.getUint32(srcIdx - fileHeader, true);
          for (let c = 0; c < 4; c++) rgba[dstIdx + c] = bmpMaskedChannel(pixel, bitfieldMasks[c]!);
          continue;
        }
        rgba[dstIdx] = bytes[srcIdx + 2] ?? 0;
        rgba[dstIdx + 1] = bytes[srcIdx + 1] ?? 0;
        rgba[dstIdx + 2] = bytes[srcIdx] ?? 0;
        rgba[dstIdx + 3] = bytesPerPixel === 4 && !opaqueReserved ? (bytes[srcIdx + 3] ?? 255) : 255;
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
    ...(meta.resolution ? { resolution: meta.resolution } : {}),
    ...(meta.renderingIntent ? { renderingIntent: meta.renderingIntent } : {}),
    ...(meta.icc ? { icc: meta.icc } : {}),
    hasAlpha: meta.hasAlpha
  };
}

export function encodeBmpImage(img: RgbaImage, options?: Parameters<typeof createBmpHeader>[1]): Uint8Array {
  const { width, height, data } = img;
  let palette = options?.bmpSubtype && options.bmpFormat !== "bmp2" && options.bmpSubtype.startsWith("ARGB") === Boolean(img.hasAlpha) ? undefined : BmpPalette.forImage(img);
  if (palette) for(let i=0;i<data.length;i+=4) {
    if(!palette.add(data[i]!,data[i+1]!,data[i+2]!,data[i+3]!)){palette=undefined;break;}
  }
  if (palette && options?.bmpCompression === "rle" && options.bmpFormat !== "bmp2") {
    const encoder = new BmpRleEncoder(), payload = new Uint8Array((width + 1) * height * 2 + 2);
    let used = 0;
    for (let y = height - 1; y >= 0; y--) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const run = encoder.push(palette.index(data[i]!, data[i + 1]!, data[i + 2]!));
        payload.set(run, used); used += run.length;
      }
      const run = encoder.endRow(); payload.set(run, used); used += run.length;
    }
    payload.set([0, 1], used); used += 2;
    const { data: header, icc } = createBmpHeader(img, options, palette, used);
    const out = new Uint8Array(header.length + used + (icc?.length ?? 0));
    out.set(header); out.set(payload.subarray(0, used), header.length);
    if (icc) out.set(icc, header.length + used);
    return out;
  }
  const {data:header,rowStride,pixelSize,bytesPerPixel,bitDepth,masks,icc}=createBmpHeader(img,options,palette);
  const out=new Uint8Array(header.length+pixelSize+(icc?.length ?? 0));
  out.set(header);
  if (icc) out.set(icc, header.length+pixelSize);

  for (let y = 0; y < height; y++) {
    const dstRow = header.length + (height - 1 - y) * rowStride;
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      if(palette) {
        const bit=x*bitDepth, offset=dstRow+(bit>>>3);
        out[offset]=out[offset]! | palette.index(data[srcIdx]!,data[srcIdx+1]!,data[srcIdx+2]!) << (8-bitDepth-bit%8);
        continue;
      }
      if(masks) {
        const packed=packBmpPixel(data[srcIdx]!,data[srcIdx+1]!,data[srcIdx+2]!,data[srcIdx+3]!,masks);
        out[dstRow+x*2]=packed&255;out[dstRow+x*2+1]=packed>>>8;
        continue;
      }
      out[dstRow + x * bytesPerPixel] = data[srcIdx + 2]!;
      out[dstRow + x * bytesPerPixel + 1] = data[srcIdx + 1]!;
      out[dstRow + x * bytesPerPixel + 2] = data[srcIdx]!;
      if (bytesPerPixel === 4) out[dstRow + x * bytesPerPixel + 3] = data[srcIdx + 3]!;
    }
  }
  return out;
}

export function encodeTiffImage(img:RgbaImage,options?:Parameters<typeof createTiffLayout>[1]):Uint8Array {
 const pages=img.tiffPages ?? [img];
 const layouts: ReturnType<typeof createTiffLayout>[]=[];
 const payloads: Uint8Array[][]=[];
 let end=0;
 for(let index=0;index<pages.length;index++) {
  const page=pages[index]!;
  if(page.space === "cmyk" && page.hueSamples?.length !== page.width*page.height*4) throw new Error("Invalid TIFF CMYK samples");
  const channels=createTiffLayout(page,options).channels,chunks:Uint8Array[]=[];
  const rows=options?.tiffTile?.height ?? options?.tiffRowsPerStrip ?? page.height,columns=options?.tiffTile?.width ?? page.width,stripSizes:number[]=[];
  for(let plane=0;plane<(options?.tiffPlanar ? channels : 1);plane++) {
  for(let row=0;row<page.height;row+=rows) {
  for(let left=0;left<page.width;left+=columns) {
  const height=options?.tiffTile ? rows : Math.min(rows,page.height-row),start=chunks.length;
  let block=page;
  if(options?.tiffTile) {
   const data=new Uint8Array(columns*height*4);
   for(let y=0;y<Math.min(height,page.height-row);y++) data.set(page.data.subarray(((row+y)*page.width+left)*4,((row+y)*page.width+Math.min(left+columns,page.width))*4),y*columns*4);
   block={...page,width:columns,height,data};
  } else block={...page,height,data:page.data.subarray(row*page.width*4,(row+height)*page.width*4)};
  if(options?.tiffCompression === "jpeg") chunks.push(encodeJpegImage({...block,space:"srgb"}, {...options,chromaSubsampling:"4:4:4"}));
  else {
   const compressor=createTiffCompressor(options?.tiffCompression,columns*(options?.tiffPlanar ? 1 : channels)*((options?.tiffFloatDepth ?? options?.tiffIntegerDepth ?? 8)/8));
   try {
    for(let offset=0;offset<block.data.length;offset+=4096) {
     const size=Math.min(4096,block.data.length-offset),raw=new Uint8Array(size/4*channels);
     for(let src=offset,dst=0;src<offset+size;src+=4) {
      const pixel = src / 4, x = left + pixel % columns, y = row + Math.floor(pixel / columns);
      if(page.space === "cmyk") {
       for(let channel=0;channel<4;channel++) raw[dst++]=x<page.width && y<page.height ? Math.round(Math.max(0,Math.min(1,page.hueSamples![(y*page.width+x)*4+channel]!))*255) : 0;
      } else {raw[dst++]=block.data[src]!;if(tiffChannels(page)>=3){raw[dst++]=block.data[src+1]!;raw[dst++]=block.data[src+2]!;}}
      if(page.hasAlpha)raw[dst++]=block.data[src+3]!;
      for (const meta of page.metaChannels ?? []) raw[dst++] = x < page.width && y < page.height ? meta.data[(y * page.width + x) * 4]! : 0;}

     if (page.hasAlpha && options?.tiffAlpha === "associated") associateTiffSamples(raw, channels, tiffChannels(page) - 1);
     chunks.push(...compressor.push(encodeTiffIntegerSamples(encodeTiffFloatSamples(options?.tiffPlanar ? tiffSamplePlane(raw, channels, plane) : raw, options?.tiffFloatDepth, options?.tiffEndian !== "msb"), options?.tiffFloatDepth ? undefined : options?.tiffIntegerDepth, options?.tiffEndian !== "msb")));
    }
    chunks.push(...compressor.push(new Uint8Array(),true));
   } finally {compressor.close();}
  }
  stripSizes.push(chunks.slice(start).reduce((sum,chunk)=>sum+chunk.length,0));
  }
  }
  }
  payloads.push(chunks);
  layouts[index]=createTiffLayout(page,options,end,index+1<pages.length,stripSizes);end=layouts[index]!.end;
 }
 const out=new Uint8Array(end);
 let offset=0;
 for(let index=0;index<pages.length;index++) {
  const {header,directory,padding}=layouts[index]!;
  out.set(index===0?header:directory,offset);offset+=index===0?header.length:directory.length;
  for(const chunk of payloads[index]!) {out.set(chunk,offset);offset+=chunk.length;}
  offset+=padding;
  if(index===0) { out.set(directory,offset);offset+=directory.length; }
 }
 return out;
}

function readTiffUint64(view: DataView, at: number, le: boolean): number {
  const value = Number(view.getBigUint64(at, le));
  if (!Number.isSafeInteger(value)) throw new RangeError("Unsafe TIFF integer");
  return value;
}

function readTiffTagValues(
  view: DataView,
  entryPos: number,
  le: boolean,
  big: boolean
): number[] {
  const type = view.getUint16(entryPos + 2, le);
  const count = big ? readTiffUint64(view, entryPos + 4, le) : view.getUint32(entryPos + 4, le);
  const elemSize = type === 3 ? 2 : type === 4 ? 4 : (type === 5 || type === 16 || type === 18) ? 8 : 1;
  const totalBytes = count * elemSize;
  const valPos = big ? (totalBytes <= 8 ? entryPos + 12 : readTiffUint64(view, entryPos + 12, le)) : (totalBytes <= 4 ? entryPos + 8 : view.getUint32(entryPos + 8, le));
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    const off = valPos + i * elemSize;
    if (off + elemSize > view.byteLength) break;
    if (type === 3) values.push(view.getUint16(off, le));
    else if (type === 4) values.push(view.getUint32(off, le));
    else if (type === 16 || type === 18) values.push(readTiffUint64(view, off, le));
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
      if (count > src.length - sp) throw new Error("Truncated TIFF PackBits literal run");
      for (let i = 0; i < count && dp < expectedLen; i++) {
        out[dp++] = src[sp++]!;
      }
    } else if (n !== -128) {
      const count = 1 - n;
      if (sp >= src.length) throw new Error("Truncated TIFF PackBits repeat run");
      const val = src[sp++]!;
      for (let i = 0; i < count && dp < expectedLen; i++) {
        out[dp++] = val;
      }
    }
  }
  if (dp < expectedLen) throw new Error("Truncated TIFF PackBits pixels");
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
      prevEntry = undefined;
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
      throw new Error("Invalid TIFF LZW dictionary code");
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
  if (dp < expectedLen) throw new Error("Truncated TIFF LZW pixels");
  return out;
}

export function decodeTiffImage(bytes: Uint8Array, page = 0): RgbaImage {
  const le = bytes[0] === 0x49;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const steps = tiffPageSteps(bytes.length, page);
  let next = steps.next();
  while (!next.done) next = steps.next(bytes[next.value]);
  const {offset: ifdOffset, pages} = next.value;
  const big = view.getUint16(2, le) === 43;
  const numEntries = big ? readTiffUint64(view, ifdOffset, le) : view.getUint16(ifdOffset, le);
  let width = 0;
  let height = 0;
  let bitsPerSample = 8;
  let fillOrder = 1;
  let faxOptions = 0;
  let sampleFormat = 1;
  let compression = 1;
  let photometric = 2;
  let colorMap: number[] = [];
  let stripOffsets: number[] = [8];
  let stripByteCounts: number[] = [];
  let tileWidth = 0;
  let tileLength = 0;
  let tileOffsets: number[] = [];
  let tileByteCounts: number[] = [];
  let samplesPerPixel = 4;
  let extraSample: number | undefined;
  let planar = false;
  let rowsPerStrip = 0;
  let predictor = 1;
  let xRes = 72, yRes = 72;
  let xPosition = 0, yPosition = 0;
  let hasResolution = false;
  let resUnit = 2;
  let orientation = 1;
  let properties: Record<string,string> | undefined;
  let jpegTables: Uint8Array | undefined;
  for (let i = 0; i < numEntries; i++) {
    const p = ifdOffset + (big ? 8 : 2) + i * (big ? 20 : 12);
    const tag = view.getUint16(p, le);
    const vals = readTiffTagValues(view, p, le, big);
    const first = vals[0] ?? 0;
    const property = tiffTextProperties[tag];
    if (property && view.getUint16(p + 2, le) === 2) {
      (properties ??= {})[property] = new TextDecoder().decode(new Uint8Array(vals.slice(0, vals.indexOf(0) < 0 ? vals.length : vals.indexOf(0))));
    }
    if (tag === 262) (properties ??= {})["tiff:photometric"] = tiffPhotometricNames[first] ?? "unknown";
    if (tag === 278) (properties ??= {})["tiff:rows-per-strip"] = String(first);
    if (tag === 256) width = first;
    else if (tag === 257) height = first;
    else if (tag === 258 && first > 0) bitsPerSample = first;
    else if (tag === 259) compression = first;
    else if (tag === 292 || tag === 293) faxOptions = first;
    else if (tag === 266) fillOrder = first;
    else if (tag === 262) photometric = first;
    else if (tag === 273 && vals.length > 0) stripOffsets = vals;
    else if (tag === 274 && first >= 1 && first <= 8) orientation = first;
    else if (tag === 277 && first > 0) samplesPerPixel = first;
    else if (tag === 278 && first > 0) rowsPerStrip = first;
    else if (tag === 279 && vals.length > 0) stripByteCounts = vals;
    else if (tag === 282 && first > 0) { xRes = first; hasResolution = true; }
    else if (tag === 283 && first > 0) { yRes = first; hasResolution = true; }
    else if (tag === 284) planar = first === 2;
    else if (tag === 286) xPosition = first;
    else if (tag === 287) yPosition = first;
    else if (tag === 296 && (first === 1 || first === 2 || first === 3)) resUnit = first;
    else if (tag === 317 && first > 0) predictor = first;
    else if (tag === 320) colorMap = vals;
    else if (tag === 322 && first > 0) tileWidth = first;
    else if (tag === 323 && first > 0) tileLength = first;
    else if (tag === 324 && vals.length > 0) tileOffsets = vals;
    else if (tag === 325 && vals.length > 0) tileByteCounts = vals;
    else if (tag === 338) extraSample = first;
    else if (tag === 339) sampleFormat = first;
    else if (tag === 347) {
      const count = big ? readTiffUint64(view, p + 4, le) : view.getUint32(p + 4, le);
      const valOff = big ? (count <= 8 ? p + 12 : readTiffUint64(view, p + 12, le)) : (count <= 4 ? p + 8 : view.getUint32(p + 8, le));
      if (valOff + count <= bytes.length) {
        jpegTables = bytes.subarray(valOff, valOff + count);
      }
    }
  }

  if (![1, 3, 4, 5, 6, 7, 8, 32773, 32946].includes(compression)) throw new Error(`Unsupported TIFF compression: ${compression}`);

  const bytesPerSample = Math.max(1, bitsPerSample >>> 3);
  const chunkSamples = planar ? 1 : samplesPerPixel;
  const bytesPerPixel = chunkSamples * bytesPerSample;
  const rowByteWidth = width * bytesPerPixel;
  const planeBytes = height * rowByteWidth;
  const totalExpectedBytes = planeBytes * (planar ? samplesPerPixel : 1);
  const combined = new Uint8Array(totalExpectedBytes);

  const decompressChunk = (off: number, rawLen: number, expectedBytes: number, rowSamples: number): Uint8Array => {
    if (!Number.isSafeInteger(off) || off < 0 || !Number.isSafeInteger(rawLen) || rawLen < 0 || off > bytes.length - rawLen) throw new Error("Truncated TIFF strip or tile range");
    const encoded = bytes.subarray(off, off + rawLen);
    // JPEG keeps its own bit order, independently of the TIFF FillOrder tag.
    const rawSlice = fillOrder === 2 && compression !== 6 && compression !== 7
      ? encoded.map(byte => tiffReversedBytes[byte]!) : encoded;
    if (compression === 3 || compression === 4) {
      if (bitsPerSample !== 1 || samplesPerPixel !== 1 || (faxOptions & 2)) throw new Error("Unsupported TIFF CCITT options");
      const packed = decodeCcittFax(rawSlice, { Columns: rowSamples, Rows: expectedBytes / rowSamples, K: compression === 4 ? -1 : faxOptions & 1, EndOfLine: compression === 3, BlackIs1: true });
      const unpacked = new Uint8Array(expectedBytes), packedStride = Math.ceil(rowSamples / 8);
      for (let i = 0; i < unpacked.length; i++) {
        const x = i % rowSamples;
        unpacked[i] = (((packed[Math.floor(i / rowSamples) * packedStride + (x >>> 3)] ?? 0) >>> (7 - x % 8)) & 1) * 255;
      }
      return unpacked;
    }
    if (compression === 1 && bitsPerSample === 1) {
      const unpacked = new Uint8Array(expectedBytes), packedStride = Math.ceil(rowSamples / 8);
      if (rawLen < packedStride * (expectedBytes / rowSamples)) throw new Error("Truncated TIFF strip or tile pixels");
      for (let i = 0; i < unpacked.length; i++) {
        const x = i % rowSamples, byte = rawSlice[Math.floor(i / rowSamples) * packedStride + (x >>> 3)] ?? 0;
        unpacked[i] = ((byte >>> (7 - x % 8)) & 1) * 255;
      }
      return unpacked;
    }
    if (compression === 7 || compression === 6) {
      let fullJpeg = rawSlice;
      if (
        jpegTables &&
        jpegTables.length > 4 &&
        jpegTables[0] === 0xff &&
        jpegTables[1] === 0xd8 &&
        rawSlice.length > 2 &&
        rawSlice[0] === 0xff &&
        rawSlice[1] === 0xd8
      ) {
        const tablesBody = jpegTables.subarray(2, jpegTables.length - 2);
        fullJpeg = new Uint8Array(tablesBody.length + rawSlice.length);
        fullJpeg[0] = 0xff;
        fullJpeg[1] = 0xd8;
        fullJpeg.set(tablesBody, 2);
        fullJpeg.set(rawSlice.subarray(2), 2 + tablesBody.length);
      }
      const decJpeg = decodeJpegImage(fullJpeg);
      const outChunk = new Uint8Array(expectedBytes);
      const numPx = Math.min(decJpeg.width * decJpeg.height, Math.floor(expectedBytes / chunkSamples));
      for (let p = 0; p < numPx; p++) {
        for (let c = 0; c < chunkSamples; c++) {
          outChunk[p * chunkSamples + c] = decJpeg.data[p * 4 + Math.min(3, c)] ?? 255;
        }
      }
      return outChunk;
    }
    if (compression === 8 || compression === 32946) {
      return transformBytes(rawSlice, { direction: "decode", format: "zlib-or-gzip" });
    }
    if (compression === 5) return decodeTiffLzw(rawSlice, expectedBytes);
    if (compression === 32773) return decodePackBits(rawSlice, expectedBytes);
    return rawSlice;
  };

  const applyHorizontalPredictor = (buf: Uint8Array, rows: number, strideBytes: number) => {
    if (bytesPerSample === 1) {
      for (let ry = 0; ry < rows; ry++) {
        const rStart = ry * strideBytes;
        for (let rx = chunkSamples; rx < strideBytes && rStart + rx < buf.length; rx++) {
          buf[rStart + rx] = ((buf[rStart + rx] ?? 0) + (buf[rStart + rx - chunkSamples] ?? 0)) & 0xff;
        }
      }
    } else if (bytesPerSample === 2) {
      const step = chunkSamples * 2;
      for (let ry = 0; ry < rows; ry++) {
        const rStart = ry * strideBytes;
        for (let rx = step; rx + 1 < strideBytes && rStart + rx + 1 < buf.length; rx += 2) {
          const prevOff = rStart + rx - step;
          const curOff = rStart + rx;
          const prev16 = le
            ? (buf[prevOff] ?? 0) | ((buf[prevOff + 1] ?? 0) << 8)
            : ((buf[prevOff] ?? 0) << 8) | (buf[prevOff + 1] ?? 0);
          const cur16 = le
            ? (buf[curOff] ?? 0) | ((buf[curOff + 1] ?? 0) << 8)
            : ((buf[curOff] ?? 0) << 8) | (buf[curOff + 1] ?? 0);
          const sum16 = (prev16 + cur16) & 0xffff;
          if (le) {
            buf[curOff] = sum16 & 0xff;
            buf[curOff + 1] = (sum16 >>> 8) & 0xff;
          } else {
            buf[curOff] = (sum16 >>> 8) & 0xff;
            buf[curOff + 1] = sum16 & 0xff;
          }
        }
      }
    }
  };

  if (tileWidth > 0 && tileLength > 0 && tileOffsets.length > 0) {
    const tilesAcross = Math.max(1, Math.ceil(width / tileWidth));
    const tilesPerPlane = tilesAcross * Math.ceil(height / tileLength);
    const tileRowByteWidth = tileWidth * bytesPerPixel;
    const expectedTileBytes = tileLength * tileRowByteWidth;
    for (let t = 0; t < tileOffsets.length; t++) {
      const off = tileOffsets[t]!;
      const rawLen = tileByteCounts[t] ?? Math.max(0, bytes.length - off);
      const decodedTile = new Uint8Array(decompressChunk(off, rawLen, expectedTileBytes, tileRowByteWidth));
      if (predictor === 2) {
        applyHorizontalPredictor(decodedTile, tileLength, tileRowByteWidth);
      }
      const tx = (t % tilesAcross) * tileWidth;
      const ty = Math.floor((planar ? t % tilesPerPlane : t) / tilesAcross) * tileLength;
      const planeOffset = planar ? Math.floor(t / tilesPerPlane) * planeBytes : 0;
      const validW = Math.max(0, Math.min(tileWidth, width - tx));
      const validH = Math.max(0, Math.min(tileLength, height - ty));
      const validRowBytes = validW * bytesPerPixel;
      for (let ry = 0; ry < validH; ry++) {
        const srcStart = ry * tileRowByteWidth;
        const dstStart = planeOffset + (ty + ry) * rowByteWidth + tx * bytesPerPixel;
        if (srcStart + validRowBytes <= decodedTile.length && dstStart + validRowBytes <= combined.length) {
          combined.set(decodedTile.subarray(srcStart, srcStart + validRowBytes), dstStart);
        }
      }
    }
  } else {
    const effectiveRowsPerStrip = rowsPerStrip > 0 ? rowsPerStrip : height;
    const stripsPerPlane = Math.ceil(height / effectiveRowsPerStrip);
    let dstOff = 0;
    for (let s = 0; s < stripOffsets.length && dstOff < totalExpectedBytes; s++) {
      const off = stripOffsets[s]!;
      if (planar) {
        if (s >= stripsPerPlane * samplesPerPixel) break;
        dstOff = Math.floor(s / stripsPerPlane) * planeBytes + (s % stripsPerPlane) * effectiveRowsPerStrip * rowByteWidth;
      }
      const remainingBytes = planar ? planeBytes - dstOff % planeBytes : totalExpectedBytes - dstOff;
      const expectedStripBytes = Math.min(remainingBytes, effectiveRowsPerStrip * rowByteWidth);
      const rawLen = stripByteCounts[s] ?? Math.max(0, bytes.length - off);
      const decodedStrip = decompressChunk(off, rawLen, expectedStripBytes, rowByteWidth);
      if (decodedStrip.length < expectedStripBytes) throw new Error("Truncated TIFF strip pixels");
      const copyLen = Math.min(decodedStrip.length, remainingBytes);
      combined.set(decodedStrip.subarray(0, copyLen), dstOff);
      dstOff += copyLen;
    }

    if (dstOff < totalExpectedBytes) throw new Error("Truncated TIFF strips");
    if (predictor === 2) {
      applyHorizontalPredictor(combined, height * (planar ? samplesPerPixel : 1), rowByteWidth);
    }
  }

  const sampleView = new DataView(combined.buffer, combined.byteOffset, combined.byteLength);
  const readSample = (pixelIdx: number, ch: number, high: boolean): number => {
    const base = planar ? ch * planeBytes + pixelIdx * bytesPerSample : (pixelIdx * samplesPerPixel + ch) * bytesPerSample;
    if (sampleFormat === 3) return readTiffFloat8(sampleView, base, bitsPerSample, le);
    // ImageMagick imports both integer formats as unsigned bits into float Q16 samples.
    if (bitsPerSample === 32) return Math.round(Math.fround(sampleView.getUint32(base, le) / 65537) / 257);
    if (high) return (combined[base + (le ? 1 : 0)] ?? 0) * 256 + (combined[base + (le ? 0 : 1)] ?? 0);
    if (bytesPerSample === 2) {
      return le ? (combined[base + 1] ?? 0) : (combined[base] ?? 0);
    }
    return combined[base] ?? 0;
  };

  const palette = photometric === 3;
  const paletteSize = 2 ** bitsPerSample;
  if (palette && (colorMap.length !== paletteSize * 3 || ![8, 16].includes(bitsPerSample))) throw new Error("Invalid or unsupported TIFF ColorMap");
  const cmyk = photometric === 5;
  const colorSamples = cmyk ? 4 : photometric === 0 || photometric === 1 || palette ? 1 : 3;
  const hasAlpha = samplesPerPixel > colorSamples && (extraSample === undefined || extraSample === 1 || extraSample === 2);
  const rgba = new Uint8Array(width * height * 4);
  const data16 = bitsPerSample === 16 && sampleFormat !== 3 ? new Uint16Array(rgba.length) : undefined;
  for (const target of data16 ? [rgba, data16] : [rgba]) {
    const high = target === data16, max = high ? 65535 : 255;
    for (let i = 0; i < width * height; i++) {
      if (palette) {
        const index = readSample(i, 0, bitsPerSample === 16);
        for (let c = 0; c < 3; c++) target[i * 4 + c] = high ? colorMap[c * paletteSize + index]! : Math.round(colorMap[c * paletteSize + index]! / 257);
        target[i * 4 + 3] = hasAlpha ? readSample(i, 1, high) : max;
      } else if (cmyk) {
        const alpha = hasAlpha ? readSample(i, 4, high) : max;
        const straight = (value: number) => hasAlpha && extraSample === 1 ? Math.min(max, Math.round(value * max / Math.max(alpha, Number.EPSILON))) : value;
        const black = straight(readSample(i, 3, high));
        for (let c = 0; c < 3; c++) target[i * 4 + c] = Math.round((max - straight(readSample(i, c, high))) * (max - black) / max);
        target[i * 4 + 3] = alpha;
      } else if (photometric === 6 && samplesPerPixel >= 3 && compression !== 6 && compression !== 7) {
        // Embedded JPEG decoding already returns RGB samples.
        target.set(tiffYCbCrToRgb(readSample(i, 0, high), readSample(i, 1, high), readSample(i, 2, high), max), i * 4);
        target[i * 4 + 3] = hasAlpha ? readSample(i, 3, high) : max;
      } else if (photometric === 8 && samplesPerPixel >= 3) {
        const rgb = tiffLabToRgb(readSample(i, 0, high), readSample(i, 1, high), readSample(i, 2, high), max);
        target.set(rgb, i * 4);
        target[i * 4 + 3] = hasAlpha ? readSample(i, 3, high) : max;
      } else if (colorSamples === 1 && !hasAlpha) {
        let g = readSample(i, 0, high);
        if (photometric === 0) g = max - g;
        target[i * 4] = g;
        target[i * 4 + 1] = g;
        target[i * 4 + 2] = g;
        target[i * 4 + 3] = max;
      } else if (colorSamples === 1) {
        let g = readSample(i, 0, high);
        if (photometric === 0) g = max - g;
        target[i * 4] = g;
        target[i * 4 + 1] = g;
        target[i * 4 + 2] = g;
        target[i * 4 + 3] = hasAlpha ? readSample(i, 1, high) : max;
      } else {
        target[i * 4] = readSample(i, 0, high);
        target[i * 4 + 1] = readSample(i, 1, high);
        target[i * 4 + 2] = readSample(i, 2, high);
        target[i * 4 + 3] = hasAlpha ? readSample(i, 3, high) : max;
      }
      if (!cmyk && hasAlpha && extraSample === 1) {
        const alpha = target[i * 4 + 3]!;
        for (let c = 0; c < 3; c++) target[i * 4 + c] = Math.min(max, Math.round(target[i * 4 + c]! * max / Math.max(alpha, Number.EPSILON)));
      }
    }
  }
  const metaChannels: RgbaImage[] = [];
  for (let channel = colorSamples + Number(hasAlpha); channel < samplesPerPixel; channel++) {
    const data = new Uint8Array(rgba.length);
    const plane16 = data16 ? new Uint16Array(rgba.length) : undefined;
    for (const target of plane16 ? [data, plane16] : [data]) {
      const high = target === plane16;
      for (let i = 0; i < width * height; i++) {
        const value = readSample(i, channel, high);
        target.set([value, value, value, high ? 65535 : 255], i * 4);
      }
    }
    metaChannels.push({ width, height, data, ...(plane16 ? { data16: plane16 } : {}), format: "tiff", space: plane16 ? "grey16" : "b-w", channels: 1, hasAlpha: false, depth: plane16 ? "ushort" : "uchar", density: 72 });
  }
  const density = resUnit === 3 ? Math.max(1, Math.round(xRes * 2.54)) : Math.max(1, Math.round(xRes));
  return {
    width,
    height,
    data: rgba,
    ...(metaChannels.length ? { metaChannels } : {}),
    ...(data16 ? {data16} : {}),
    format: "tiff",
    ...(xPosition || yPosition ? {virtualCanvas: {width, height, x: Math.round(xPosition * xRes), y: Math.round(yPosition * yRes)}} : {}),
    ...(pages > 1 ? {pages} : {}),
    space:
      !palette && colorSamples === 1
        ? bitsPerSample === 16
          ? "grey16"
          : "b-w"
        : bitsPerSample === 16
          ? "rgb16"
          : "srgb",
    channels: !palette && colorSamples === 1 ? hasAlpha ? 2 : 1 : hasAlpha ? 4 : 3,
    depth: bitsPerSample === 16 ? "ushort" : "uchar",
    bitsPerSample,
    density,
    ...(hasResolution ? {resolution: {x:xRes,y:yRes,unit:resUnit===3?"cm" as const:resUnit===1?"unknown" as const:"inch" as const}} : {}),
    hasAlpha,
    ...(properties ? {properties} : {}),
    orientation
  };
}
