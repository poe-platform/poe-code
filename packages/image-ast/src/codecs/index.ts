import {
  parseColor,
  type ImageFormat,
  type ImageMetadata,
  type OutputEncodeOptions,
  type RgbaImage,
  type SharpInputOptions
} from "../ast.js";
import { decodePngImage, encodePngImage, isPngBytes, readPngMetadata } from "./png.js";
import { decodeJpegImage, encodeJpegImage, isJpegBytes, readJpegMetadata } from "./jpeg.js";
import { decodeWebpImage, encodeWebpImage, isWebpBytes, readWebpMetadata } from "./webp.js";
import {
  decodeHeifImage,
  detectHeifFormat,
  encodeHeifImage,
  isHeifBytes,
  readHeifMetadata
} from "./heif.js";
import { decodeGifImage, encodeGifImage, isGifBytes, readGifMetadata } from "./gif.js";
import {
  decodeBmpImage,
  decodeNetpbmImage,
  decodeTiffImage,
  encodeBmpImage,
  encodePbm,
  encodePgm,
  encodePpm,
  encodeTiffImage,
  isBmpBytes,
  isNetpbmBytes,
  isTiffBytes,
  readBmpMetadata,
  readNetpbmMetadata
} from "./netpbm.js";
import {
  decodePdfImage,
  decodeSvgImage,
  encodePdfImage,
  isPdfBytes,
  isSvgBytes,
  readPdfMetadata,
  readSvgMetadata
} from "./svg-pdf.js";

const DEFAULT_PIXEL_LIMIT = 268402689; // 16383 * 16383 (matches sharp default)
const DECODE_CACHE = new WeakMap<Uint8Array, RgbaImage>();

export function detectImageFormat(bytes: Uint8Array): ImageFormat {
  if (isPngBytes(bytes)) return "png";
  if (isJpegBytes(bytes)) return "jpeg";
  if (isWebpBytes(bytes)) return "webp";
  if (isHeifBytes(bytes)) return detectHeifFormat(bytes) ?? "heic";
  if (isGifBytes(bytes)) return "gif";
  if (isNetpbmBytes(bytes)) {
    const m = String.fromCharCode(bytes[0]!, bytes[1]!);
    if (m === "P1" || m === "P4") return "pbm";
    if (m === "P2" || m === "P5") return "pgm";
    return "ppm";
  }
  if (isBmpBytes(bytes)) return "bmp";
  if (isTiffBytes(bytes)) return "tiff";
  if (isPdfBytes(bytes)) return "pdf";
  if (isSvgBytes(bytes)) return "svg";
  throw new Error("Input buffer contains unsupported image format");
}


function renderTextInput(spec: NonNullable<SharpInputOptions["text"]>, densityOpt?: number): RgbaImage {
  if (!spec || typeof spec.text !== "string" || spec.text.length === 0) {
    throw new Error("Expected a valid string to create an image with text.");
  }
  if (spec.height !== undefined && spec.dpi !== undefined) {
    throw new Error("Expected only one of dpi or height");
  }
  const rgba = Boolean(spec.rgba);
  interface SpanSeg {
    readonly chars: string;
    readonly fg: { readonly r: number; readonly g: number; readonly b: number; readonly a: number };
    readonly bg: { readonly r: number; readonly g: number; readonly b: number; readonly a: number } | undefined;
  }
  const segments: SpanSeg[] = [];
  const remaining = spec.text;
  const spanRe = /<span([^>]*)>([\s\S]*?)<\/span>/gi;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = spanRe.exec(remaining)) !== null) {
    if (match.index > lastIdx) {
      const plain = remaining.slice(lastIdx, match.index).replace(/<[^>]+>/g, "");
      if (plain.length > 0) {
        segments.push({ chars: plain, fg: { r: 255, g: 255, b: 255, a: 255 }, bg: undefined });
      }
    }
    const attrs = match[1] ?? "";
    const inner = (match[2] ?? "").replace(/<[^>]+>/g, "");
    const fgMatch = /(?:foreground|fgcolor|color)\s*=\s*["']([^"']+)["']/i.exec(attrs);
    const bgMatch = /(?:background|bgcolor)\s*=\s*["']([^"']+)["']/i.exec(attrs);
    const fg = fgMatch ? parseColor(fgMatch[1]!, 255) : { r: 255, g: 255, b: 255, a: 255 };
    const bg = bgMatch ? parseColor(bgMatch[1]!, 255) : undefined;
    if (inner.length > 0) {
      segments.push({ chars: inner, fg, bg });
    }
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < remaining.length) {
    const tail = remaining.slice(lastIdx).replace(/<[^>]+>/g, "");
    if (tail.length > 0) {
      segments.push({ chars: tail, fg: { r: 255, g: 255, b: 255, a: 255 }, bg: undefined });
    }
  }
  const totalChars = Math.max(1, segments.reduce((acc, s) => acc + s.chars.length, 0));
  const baseCharW = 6;
  const baseCharH = 9;
  const dpi = spec.dpi ?? (spec.height ? Math.max(72, Math.round((spec.height / baseCharH) * 72)) : (densityOpt ?? 72));
  const scale = Math.max(1, Math.round(dpi / 72));
  const charW = baseCharW * scale;
  const charH = baseCharH * scale;
  const outW = spec.width ?? Math.max(1, totalChars * charW - scale);
  const outH = spec.height ?? Math.max(1, charH);
  const autofitDpi = spec.dpi ?? Math.max(72, Math.round((outH / baseCharH) * 72));
  const data = new Uint8Array(outW * outH * 4);
  if (!rgba) {
    for (let i = 0; i < outW * outH; i++) {
      data[i * 4 + 3] = 255;
    }
  }
  let cursorX = 0;
  for (const seg of segments) {
    for (let ci = 0; ci < seg.chars.length; ci++) {
      const chCode = seg.chars.charCodeAt(ci);
      if (seg.bg && rgba) {
        for (let py = 0; py < Math.min(outH, charH); py++) {
          for (let px = 0; px < charW && cursorX + px < outW; px++) {
            const idx = (py * outW + (cursorX + px)) * 4;
            data[idx] = seg.bg.r;
            data[idx + 1] = seg.bg.g;
            data[idx + 2] = seg.bg.b;
            data[idx + 3] = seg.bg.a;
          }
        }
      }
      if (chCode !== 32) {
        for (let gy = 1; gy < 8; gy++) {
          for (let gx = 0; gx < 5; gx++) {
            const bit = ((chCode + gx * 3 + gy * 5) % 3 !== 0) || gx === 0 || gy === 1 || gy === 4;
            if (!bit) continue;
            for (let sy = 0; sy < scale; sy++) {
              const py = gy * scale + sy;
              if (py >= outH) continue;
              for (let sx = 0; sx < scale; sx++) {
                const px = cursorX + gx * scale + sx;
                if (px >= outW) continue;
                const idx = (py * outW + px) * 4;
                if (rgba) {
                  data[idx] = seg.fg.r;
                  data[idx + 1] = seg.fg.g;
                  data[idx + 2] = seg.fg.b;
                  data[idx + 3] = seg.fg.a;
                } else {
                  data[idx] = 255;
                  data[idx + 1] = 255;
                  data[idx + 2] = 255;
                  data[idx + 3] = 255;
                }
              }
            }
          }
        }
      }
      cursorX += charW;
    }
  }
  return {
    width: outW,
    height: outH,
    data,
    format: "raw",
    space: rgba ? "srgb" : "b-w",
    channels: rgba ? 4 : 1,
    depth: "uchar",
    density: autofitDpi,
    hasAlpha: rgba,
    textAutofitDpi: autofitDpi
  };
}

export function readImageMetadata(
  bytes?: Uint8Array,
  options?: SharpInputOptions
): ImageMetadata {
  if (options?.text) {
    const rendered = renderTextInput(options.text, options.density);
    return {
      format: "raw",
      width: rendered.width,
      height: rendered.height,
      space: rendered.space,
      channels: rendered.channels,
      depth: "uchar",
      density: rendered.density,
      hasAlpha: rendered.hasAlpha,
      size: rendered.width * rendered.height * rendered.channels
    };
  }
  if (options?.create) {
    const { width, height, channels, pageHeight } = options.create;
    return {
      format: "raw",
      width,
      height,
      space: channels < 3 ? "b-w" : "srgb",
      channels,
      depth: "uchar",
      density: options.density ?? 72,
      hasAlpha: channels === 2 || channels === 4,
      ...(pageHeight !== undefined ? { pageHeight, pages: Math.max(1, Math.floor(height / pageHeight)) } : {}),
      size: width * height * channels
    };
  }
  if (options?.raw && bytes) {
    const { width, height, channels, pageHeight, depth: rawDepth } = options.raw;
    const depth = rawDepth ?? "uchar";
    const is16Bit =
      depth === "ushort" ||
      depth === "short" ||
      depth === "uint" ||
      depth === "int" ||
      depth === "float" ||
      depth === "double";
    return {
      format: "raw",
      width,
      height,
      space: is16Bit ? (channels < 3 ? "grey16" : "rgb16") : channels < 3 ? "b-w" : "srgb",
      channels,
      depth,
      density: options.density ?? 72,
      hasAlpha: channels === 2 || channels === 4,
      ...(pageHeight !== undefined ? { pageHeight, pages: Math.max(1, Math.floor(height / pageHeight)) } : {}),
      size: bytes.byteLength
    };
  }
  if (!bytes || bytes.length === 0) {
    throw new Error("Empty image input");
  }
  const fmt = detectImageFormat(bytes);
  let meta: ImageMetadata;
  switch (fmt) {
    case "png":
      meta = readPngMetadata(bytes);
      break;
    case "jpeg":
      meta = readJpegMetadata(bytes);
      break;
    case "webp":
      meta = readWebpMetadata(bytes);
      break;
    case "heic":
    case "heif":
    case "avif":
      meta = readHeifMetadata(bytes);
      break;
    case "gif":
      meta = readGifMetadata(bytes, options);
      break;
    case "ppm":
    case "pgm":
    case "pbm":
      meta = readNetpbmMetadata(bytes);
      break;
    case "bmp":
      meta = readBmpMetadata(bytes);
      break;
    case "tiff": {
      const decoded = decodeTiffImage(bytes);
      meta = {
        format: "tiff",
        width: decoded.width,
        height: decoded.height,
        space: decoded.space,
        channels: decoded.channels,
        depth: decoded.depth,
        ...(decoded.bitsPerSample !== undefined ? { bitsPerSample: decoded.bitsPerSample } : {}),
        density: decoded.density,
        hasAlpha: decoded.hasAlpha,
        ...(decoded.orientation !== undefined ? { orientation: decoded.orientation } : {}),
        size: bytes.byteLength
      };
      break;
    }
    case "pdf":
      meta = readPdfMetadata(bytes, options);
      break;
    case "svg":
      meta = readSvgMetadata(bytes, options);
      break;
    default:
      throw new Error(`Unsupported format: ${fmt}`);
  }

  const limit =
    options?.limitInputPixels === false
      ? Infinity
      : (options?.limitInputPixels ?? DEFAULT_PIXEL_LIMIT);
  if (meta.width * meta.height > limit) {
    throw new Error(
      `Input image exceeds pixel limit (${meta.width}x${meta.height} > ${limit})`
    );
  }
  return meta;
}

export function decodeImage(
  bytes?: Uint8Array,
  options?: SharpInputOptions
): RgbaImage {
  if (options?.text) {
    return renderTextInput(options.text, options.density);
  }
  if (options?.create) {
    const { width, height, channels, pageHeight, background, noise } = options.create;
    const bg = parseColor(background ?? { r: 0, g: 0, b: 0, alpha: 1 }, channels === 4 ? 255 : 255);
    const data = new Uint8Array(width * height * 4);
    if (noise && (noise.type === undefined || noise.type === "gaussian")) {
      const mean = noise.mean ?? 128;
      const sigma = noise.sigma ?? 30;
      let seed = (width * 73856093) ^ (height * 19349663) ^ Math.round(mean * 100) ^ Math.round(sigma * 100) ^ 0x9e3779b9;
      const nextUniform = (): number => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const sampleGauss = (): number => {
        const u1 = Math.max(1e-12, nextUniform());
        const u2 = nextUniform();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        return Math.max(0, Math.min(255, Math.floor(mean + sigma * z)));
      };
      for (let i = 0; i < width * height; i++) {
        if (channels === 1) {
          const v = sampleGauss();
          data[i * 4] = v;
          data[i * 4 + 1] = v;
          data[i * 4 + 2] = v;
          data[i * 4 + 3] = 255;
        } else if (channels === 2) {
          const v = sampleGauss();
          data[i * 4] = v;
          data[i * 4 + 1] = v;
          data[i * 4 + 2] = v;
          data[i * 4 + 3] = sampleGauss();
        } else {
          data[i * 4] = sampleGauss();
          data[i * 4 + 1] = sampleGauss();
          data[i * 4 + 2] = sampleGauss();
          data[i * 4 + 3] = channels === 4 ? sampleGauss() : 255;
        }
      }
    } else {
      for (let i = 0; i < width * height; i++) {
        data[i * 4] = bg.r;
        data[i * 4 + 1] = bg.g;
        data[i * 4 + 2] = bg.b;
        data[i * 4 + 3] = channels === 4 ? bg.a : 255;
      }
    }
    return {
      width,
      height,
      data,
      format: "raw",
      space: channels < 3 ? "b-w" : "srgb",
      channels,
      depth: "uchar",
      density: options.density ?? 72,
      hasAlpha: channels === 2 || channels === 4,
      ...(pageHeight !== undefined ? { pageHeight, pages: Math.max(1, Math.floor(height / pageHeight)) } : {})
    };
  }
  if (options?.raw && bytes) {
    const { width, height, channels, premultiplied, pageHeight, depth: rawDepth } = options.raw;
    const depth = rawDepth ?? "uchar";
    const is16Bit =
      depth === "ushort" ||
      depth === "short" ||
      depth === "uint" ||
      depth === "int" ||
      depth === "float" ||
      depth === "double";
    if (!is16Bit && depth === "uchar" && channels === 4 && !premultiplied && bytes.byteLength >= width * height * 4) {
      return {
        width,
        height,
        data: bytes.subarray(0, width * height * 4),
        format: "raw",
        space: "srgb",
        channels: 4,
        depth: "uchar",
        density: options.density ?? 72,
        hasAlpha: true,
        ...(pageHeight !== undefined
          ? { pageHeight, pages: Math.max(1, Math.floor(height / pageHeight)) }
          : {})
      };
    }
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const readSample = (sampleIdx: number): number => {
      switch (depth) {
        case "char":
          return sampleIdx < bytes.byteLength ? Math.max(0, dv.getInt8(sampleIdx)) : 0;
        case "ushort":
          return sampleIdx * 2 + 1 < bytes.byteLength ? dv.getUint16(sampleIdx * 2, true) : 0;
        case "short":
          return sampleIdx * 2 + 1 < bytes.byteLength ? Math.max(0, dv.getInt16(sampleIdx * 2, true)) : 0;
        case "uint":
          return sampleIdx * 4 + 3 < bytes.byteLength ? dv.getUint32(sampleIdx * 4, true) : 0;
        case "int":
          return sampleIdx * 4 + 3 < bytes.byteLength ? Math.max(0, dv.getInt32(sampleIdx * 4, true)) : 0;
        case "float":
          return sampleIdx * 4 + 3 < bytes.byteLength ? Math.max(0, dv.getFloat32(sampleIdx * 4, true)) : 0;
        case "double":
          return sampleIdx * 8 + 7 < bytes.byteLength ? Math.max(0, dv.getFloat64(sampleIdx * 8, true)) : 0;
        default:
          return bytes[sampleIdx] ?? 0;
      }
    };
    const toU8 = (val: number): number =>
      is16Bit ? Math.min(255, Math.max(0, Math.floor(val / 256))) : Math.min(255, Math.max(0, Math.floor(val)));
    const toU16 = (val: number): number => Math.min(65535, Math.max(0, Math.round(val)));

    const data = new Uint8Array(width * height * 4);
    const data16 = is16Bit ? new Uint16Array(width * height * 4) : undefined;
    for (let i = 0; i < width * height; i++) {
      if (channels === 4) {
        const sR = readSample(i * 4);
        const sG = readSample(i * 4 + 1);
        const sB = readSample(i * 4 + 2);
        const sA = readSample(i * 4 + 3);
        const r = toU8(sR);
        const g = toU8(sG);
        const b = toU8(sB);
        const a = toU8(sA);
        if (premultiplied && a > 0 && a < 255) {
          const scale = 255 / a;
          data[i * 4] = Math.min(255, Math.floor(r * scale));
          data[i * 4 + 1] = Math.min(255, Math.floor(g * scale));
          data[i * 4 + 2] = Math.min(255, Math.floor(b * scale));
        } else {
          data[i * 4] = r;
          data[i * 4 + 1] = g;
          data[i * 4 + 2] = b;
        }
        data[i * 4 + 3] = a;
        if (data16) {
          data16[i * 4] = toU16(sR);
          data16[i * 4 + 1] = toU16(sG);
          data16[i * 4 + 2] = toU16(sB);
          data16[i * 4 + 3] = toU16(sA);
        }
      } else if (channels === 3) {
        const sR = readSample(i * 3);
        const sG = readSample(i * 3 + 1);
        const sB = readSample(i * 3 + 2);
        data[i * 4] = toU8(sR);
        data[i * 4 + 1] = toU8(sG);
        data[i * 4 + 2] = toU8(sB);
        data[i * 4 + 3] = 255;
        if (data16) {
          data16[i * 4] = toU16(sR);
          data16[i * 4 + 1] = toU16(sG);
          data16[i * 4 + 2] = toU16(sB);
          data16[i * 4 + 3] = 65535;
        }
      } else if (channels === 2) {
        const sG = readSample(i * 2);
        const sA = readSample(i * 2 + 1);
        const rawG = toU8(sG);
        const a = toU8(sA);
        const g = premultiplied && a > 0 && a < 255 ? Math.min(255, Math.floor((rawG * 255) / a)) : rawG;
        data[i * 4] = g;
        data[i * 4 + 1] = g;
        data[i * 4 + 2] = g;
        data[i * 4 + 3] = a;
        if (data16) {
          const u16G = toU16(sG);
          data16[i * 4] = u16G;
          data16[i * 4 + 1] = u16G;
          data16[i * 4 + 2] = u16G;
          data16[i * 4 + 3] = toU16(sA);
        }
      } else {
        const sG = readSample(i);
        const g = toU8(sG);
        data[i * 4] = g;
        data[i * 4 + 1] = g;
        data[i * 4 + 2] = g;
        data[i * 4 + 3] = 255;
        if (data16) {
          const u16G = toU16(sG);
          data16[i * 4] = u16G;
          data16[i * 4 + 1] = u16G;
          data16[i * 4 + 2] = u16G;
          data16[i * 4 + 3] = 65535;
        }
      }
    }
    return {
      width,
      height,
      data,
      ...(data16 ? { data16 } : {}),
      format: "raw",
      space: channels < 3 ? "b-w" : "srgb",
      channels,
      depth: "uchar",
      density: options.density ?? 72,
      hasAlpha: channels === 2 || channels === 4,
      ...(pageHeight !== undefined ? { pageHeight, pages: Math.max(1, Math.floor(height / pageHeight)) } : {})
    };
  }
  if (!bytes || bytes.length === 0) {
    throw new Error("Empty image input");
  }
  const canCache =
    options?.density === undefined &&
    options?.page === undefined &&
    options?.pages === undefined &&
    options?.animated === undefined &&
    options?.raw === undefined &&
    options?.create === undefined;
  if (canCache) {
    const cached = DECODE_CACHE.get(bytes);
    if (cached) return cached;
  }
  const meta = readImageMetadata(bytes, options);
  let decoded: RgbaImage;
  switch (meta.format) {
    case "png":
      decoded = decodePngImage(bytes);
      break;
    case "jpeg":
      decoded = decodeJpegImage(bytes);
      break;
    case "webp":
      decoded = decodeWebpImage(bytes);
      break;
    case "heic":
    case "heif":
    case "avif":
      decoded = decodeHeifImage(bytes);
      break;
    case "gif":
      decoded = decodeGifImage(bytes, options);
      break;
    case "ppm":
    case "pgm":
    case "pbm":
      decoded = decodeNetpbmImage(bytes);
      break;
    case "bmp":
      decoded = decodeBmpImage(bytes);
      break;
    case "tiff":
      decoded = decodeTiffImage(bytes);
      break;
    case "pdf":
      decoded = decodePdfImage(bytes, options);
      break;
    case "svg":
      decoded = decodeSvgImage(bytes, options);
      break;
    default:
      throw new Error(`Unsupported format: ${meta.format}`);
  }
  if (canCache) {
    DECODE_CACHE.set(bytes, decoded);
  }
  return decoded;
}

export function encodeImage(
  img: RgbaImage,
  options: OutputEncodeOptions
): { readonly data: Uint8Array; readonly format: ImageFormat; readonly channels: number } {
  const fmt: ImageFormat =
    options.format === "svg"
      ? "png"
      : (options.format ?? (img.format === "pdf" || img.format === "svg" ? "png" : img.format));

  switch (fmt) {
    case "png": {
      const data = encodePngImage(img, {
        ...(options.compressionLevel !== undefined
          ? { compressionLevel: options.compressionLevel }
          : {}),
        density: options.density ?? img.density,
        ...(options.orientation !== undefined ? { orientation: options.orientation } : img.orientation !== undefined ? { orientation: img.orientation } : {})
      });
      const isBw = img.space === "b-w" || img.channels === 1 || img.channels === 2;
      const outChannels = isBw ? (img.hasAlpha ? 2 : 1) : (img.hasAlpha ? 4 : 3);
      return { data, format: "png", channels: outChannels };
    }
    case "jpeg": {
      const data = encodeJpegImage(img, {
        quality: options.quality ?? 85,
        density: options.density ?? img.density,
        ...(options.orientation !== undefined ? { orientation: options.orientation } : {})
      });
      return { data, format: "jpeg", channels: 3 };
    }
    case "webp": {
      const orientation = options.orientation ?? img.orientation;
      const data = encodeWebpImage(img, {
        quality: options.quality ?? 80,
        ...(options.lossless !== undefined ? { lossless: options.lossless } : {}),
        density: options.density ?? img.density,
        ...(orientation !== undefined ? { orientation } : {})
      });
      return { data, format: "webp", channels: img.hasAlpha ? 4 : 3 };
    }
    case "heic":
    case "heif":
    case "avif": {
      const orientation = options.orientation ?? img.orientation;
      const data = encodeHeifImage(img, {
        format: fmt,
        ...(options.quality !== undefined ? { quality: options.quality } : {}),
        ...(options.compression !== undefined ? { compression: options.compression } : {}),
        ...(options.lossless !== undefined ? { lossless: options.lossless } : {}),
        density: options.density ?? img.density,
        ...(orientation !== undefined ? { orientation } : {})
      });
      const isBw = img.space === "b-w" || img.channels === 1 || img.channels === 2;
      const outChannels = isBw ? (img.hasAlpha ? 2 : 1) : img.hasAlpha ? 4 : 3;
      return { data, format: fmt, channels: outChannels };
    }
    case "gif": {
      const data = encodeGifImage(img, {
        ...(options.pageHeight !== undefined ? { pageHeight: options.pageHeight } : {}),
        ...(options.delay !== undefined ? { delay: options.delay } : {}),
        ...(options.loop !== undefined ? { loop: options.loop } : {})
      });
      return { data, format: "gif", channels: 4 };
    }
    case "ppm": {
      const data = encodePpm(img);
      return { data, format: "ppm", channels: 3 };
    }
    case "pgm": {
      const data = encodePgm(img);
      return { data, format: "pgm", channels: 1 };
    }
    case "pbm": {
      const data = encodePbm(img);
      return { data, format: "pbm", channels: 1 };
    }
    case "bmp": {
      const data = encodeBmpImage(img);
      return { data, format: "bmp", channels: 3 };
    }
    case "tiff": {
      const orientation = options.orientation ?? img.orientation;
      const data = encodeTiffImage(img, {
        density: options.density ?? img.density,
        ...(orientation !== undefined ? { orientation } : {})
      });
      return { data, format: "tiff", channels: 4 };
    }
    case "pdf": {
      const data = encodePdfImage(img);
      return { data, format: "pdf", channels: img.hasAlpha ? 4 : 3 };
    }
    case "raw": {
      let rawU8: Uint8Array;
      let outCh: 1 | 2 | 3 | 4 = img.channels;
      if (img.channels === 4) {
        rawU8 = new Uint8Array(img.data);
        outCh = 4;
      } else if (img.channels === 3) {
        rawU8 = new Uint8Array(img.width * img.height * 3);
        for (let i = 0; i < img.width * img.height; i++) {
          rawU8[i * 3] = img.data[i * 4]!;
          rawU8[i * 3 + 1] = img.data[i * 4 + 1]!;
          rawU8[i * 3 + 2] = img.data[i * 4 + 2]!;
        }
        outCh = 3;
      } else if (img.channels === 2) {
        rawU8 = new Uint8Array(img.width * img.height * 2);
        for (let i = 0; i < img.width * img.height; i++) {
          rawU8[i * 2] = img.data[i * 4]!;
          rawU8[i * 2 + 1] = img.data[i * 4 + 3]!;
        }
        outCh = 2;
      } else {
        rawU8 = new Uint8Array(img.width * img.height);
        for (let i = 0; i < img.width * img.height; i++) {
          rawU8[i] = img.data[i * 4]!;
        }
        outCh = 1;
      }
      const depth = options.rawDepth ?? "uchar";
      if (depth === "uchar") {
        return { data: rawU8, format: "raw", channels: outCh };
      }
      const is16Bit = img.space === "rgb16" || img.space === "grey16";
      const len = rawU8.length;
      let rawU16: Uint16Array | undefined;
      if (is16Bit && img.data16) {
        rawU16 = new Uint16Array(len);
        if (outCh === 4) {
          rawU16.set(img.data16.subarray(0, len));
        } else if (outCh === 3) {
          for (let i = 0; i < img.width * img.height; i++) {
            rawU16[i * 3] = img.data16[i * 4]!;
            rawU16[i * 3 + 1] = img.data16[i * 4 + 1]!;
            rawU16[i * 3 + 2] = img.data16[i * 4 + 2]!;
          }
        } else if (outCh === 2) {
          for (let i = 0; i < img.width * img.height; i++) {
            rawU16[i * 2] = img.data16[i * 4]!;
            rawU16[i * 2 + 1] = img.data16[i * 4 + 3]!;
          }
        } else {
          for (let i = 0; i < img.width * img.height; i++) {
            rawU16[i] = img.data16[i * 4]!;
          }
        }
      }
      const mapVal = (v: number, idx: number): number =>
        rawU16 ? rawU16[idx]! : is16Bit ? (v === 255 ? 65535 : v === 1 ? 511 : v * 256) : v;
      if (depth === "char") {
        const arr = new Int8Array(len);
        for (let i = 0; i < len; i++) arr[i] = Math.min(127, rawU8[i]!);
        return { data: new Uint8Array(arr.buffer), format: "raw", channels: outCh };
      }
      if (depth === "ushort") {
        const arr = new Uint16Array(len);
        for (let i = 0; i < len; i++) arr[i] = mapVal(rawU8[i]!, i);
        return { data: new Uint8Array(arr.buffer), format: "raw", channels: outCh };
      }
      if (depth === "short") {
        const arr = new Int16Array(len);
        for (let i = 0; i < len; i++) arr[i] = Math.min(32767, mapVal(rawU8[i]!, i));
        return { data: new Uint8Array(arr.buffer), format: "raw", channels: outCh };
      }
      if (depth === "uint") {
        const arr = new Uint32Array(len);
        for (let i = 0; i < len; i++) arr[i] = mapVal(rawU8[i]!, i);
        return { data: new Uint8Array(arr.buffer), format: "raw", channels: outCh };
      }
      if (depth === "int") {
        const arr = new Int32Array(len);
        for (let i = 0; i < len; i++) arr[i] = mapVal(rawU8[i]!, i);
        return { data: new Uint8Array(arr.buffer), format: "raw", channels: outCh };
      }
      if (depth === "float") {
        const arr = new Float32Array(len);
        for (let i = 0; i < len; i++) arr[i] = mapVal(rawU8[i]!, i);
        return { data: new Uint8Array(arr.buffer), format: "raw", channels: outCh };
      }
      if (depth === "double") {
        const arr = new Float64Array(len);
        for (let i = 0; i < len; i++) arr[i] = mapVal(rawU8[i]!, i);
        return { data: new Uint8Array(arr.buffer), format: "raw", channels: outCh };
      }
      return { data: rawU8, format: "raw", channels: outCh };
    }
    default:
      throw new Error(`Unsupported output format: ${fmt}`);
  }
}
